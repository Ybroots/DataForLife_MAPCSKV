import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { notificationTitle } from './citizen-notifications.js';

/**
 * Thông báo đẩy (FCM) cho ứng dụng người dân.
 *
 * - Cảnh báo khu vực: gửi tới các thiết bị đã chọn theo dõi địa bàn đó. Nội dung cảnh báo là thông tin công khai.
 * - Cập nhật hồ sơ phản ánh/SOS: chỉ gửi tới thiết bị gắn với đúng tài khoản người dân. Nội dung hiện trên màn hình
 *   khóa chỉ gồm tiêu đề trạng thái và mã hồ sơ, không có mô tả vụ việc hay tin nhắn của cán bộ.
 * - Máy chủ chỉ lưu mã thiết bị FCM, mã tài khoản (nếu đã đăng nhập) và mã địa bàn theo dõi. Không lưu vị trí GPS.
 */

export type PushChannel = 'alerts' | 'cases';

export interface PushMessage {
  title: string;
  body: string;
  channel: PushChannel;
  /** Ưu tiên cao: hiện ngay cả khi điện thoại đang ở chế độ tiết kiệm pin. */
  urgent: boolean;
  /** Dùng để gộp thông báo trùng trên thanh trạng thái. */
  tag: string;
  data: Record<string, string>;
}

export type PushOutcome = 'sent' | 'invalid_token' | 'failed';

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushOutcome>;
}

export interface ServiceAccountKey {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function parseServiceAccount(raw: string): ServiceAccountKey {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Tệp khóa dịch vụ không phải JSON object.');
  const { project_id, client_email, private_key, token_uri } = parsed as Record<string, unknown>;
  if (typeof project_id !== 'string' || !/^[a-z][a-z0-9-]{4,29}$/.test(project_id)) throw new Error('Thiếu hoặc sai project_id.');
  if (typeof client_email !== 'string' || !client_email.includes('@')) throw new Error('Thiếu hoặc sai client_email.');
  if (typeof private_key !== 'string' || !private_key.includes('BEGIN PRIVATE KEY')) throw new Error('Thiếu hoặc sai private_key.');
  const uri = typeof token_uri === 'string' ? token_uri : DEFAULT_TOKEN_URI;
  const host = new URL(uri);
  if (host.protocol !== 'https:' || !host.hostname.endsWith('googleapis.com')) throw new Error('token_uri phải thuộc googleapis.com.');
  return { project_id, client_email, private_key, token_uri: uri };
}

/** Gửi qua FCM HTTP v1 bằng khóa dịch vụ của Firebase. Không dùng thư viện ngoài, không ghi log mã thiết bị. */
export class FcmSender implements PushSender {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccountKey,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    const now = this.clock();
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;
    const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
    const issuedAt = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({
      iss: this.account.client_email, scope: FCM_SCOPE, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${signer.sign(this.account.private_key).toString('base64url')}`;
    const response = await this.http(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Không lấy được mã truy cập FCM (HTTP ${response.status}).`);
    const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Phản hồi mã truy cập FCM không hợp lệ.');
    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    this.cached = { token: body.access_token, expiresAt: now + lifetime * 1000 };
    return body.access_token;
  }

  async send(token: string, message: PushMessage): Promise<PushOutcome> {
    try {
      const accessToken = await this.accessToken();
      const response = await this.http(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: {
                priority: message.urgent ? 'HIGH' : 'NORMAL',
                ttl: '86400s',
                notification: { channel_id: message.channel, tag: message.tag },
              },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) return 'sent';
      if (response.status === 401) this.cached = null;
      const payload = await response.json().catch(() => null) as
        { error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } } | null;
      const errorCode = payload?.error?.details?.find((detail) => typeof detail.errorCode === 'string')?.errorCode;
      const badToken = response.status === 404 || errorCode === 'UNREGISTERED'
        || (payload?.error?.status === 'INVALID_ARGUMENT' && /registration token|not a valid fcm/i.test(payload.error.message ?? ''));
      return badToken ? 'invalid_token' : 'failed';
    } catch {
      return 'failed';
    }
  }
}

/** Trả về null khi chưa cấu hình (máy chủ vẫn chạy bình thường, chỉ không gửi được thông báo đẩy). */
export function createPushSender(env: NodeJS.ProcessEnv, log: (message: string) => void = console.error): PushSender | null {
  const file = env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!file) return null;
  try {
    return new FcmSender(parseServiceAccount(readFileSync(file, 'utf8')));
  } catch (error) {
    // Không để lỗi cấu hình thông báo làm sập API phục vụ người dân; không in nội dung tệp khóa.
    log(`Thông báo đẩy bị tắt: không đọc được FCM_SERVICE_ACCOUNT_FILE (${error instanceof Error ? error.message : 'lỗi không rõ'}).`);
    return null;
  }
}

export interface PushDeviceInput {
  token: string;
  citizenId: string | null;
  areaCodes: string[];
}

export interface PendingPush {
  kind: 'alert' | 'citizen';
  refId: string;
  deviceId: number;
  token: string;
  message: PushMessage;
}

export interface PushStore {
  upsertDevice(input: PushDeviceInput): Promise<void>;
  removeDevice(token: string): Promise<boolean>;
  /** Giữ chỗ tối đa `limit` thông báo chưa gửi để không có tiến trình nào khác gửi trùng. */
  claimPending(limit: number): Promise<PendingPush[]>;
  finish(item: PendingPush, outcome: PushOutcome): Promise<void>;
  /** Xóa thiết bị không còn đồng bộ trong `days` ngày. Trả về số thiết bị đã xóa. */
  purgeStale(days: number): Promise<number>;
}

/** Kho trong bộ nhớ: dùng cho chế độ fixture và kiểm thử. Không có sự kiện nào để gửi. */
export class MemoryPushStore implements PushStore {
  readonly devices = new Map<string, PushDeviceInput>();

  async upsertDevice(input: PushDeviceInput): Promise<void> {
    this.devices.set(input.token, { token: input.token, citizenId: input.citizenId, areaCodes: [...input.areaCodes] });
  }

  async removeDevice(token: string): Promise<boolean> {
    return this.devices.delete(token);
  }

  async claimPending(_limit: number): Promise<PendingPush[]> { return []; }
  async finish(_item: PendingPush, _outcome: PushOutcome): Promise<void> { /* không có gì để ghi */ }
  async purgeStale(_days: number): Promise<number> { return 0; }
}

const RISK_PREFIX: Record<string, string> = { high: 'Cảnh báo khẩn', medium: 'Cảnh báo', info: 'Thông tin' };
const MAX_BODY = 180;

function clip(value: string, maximum: number): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= maximum ? single : `${single.slice(0, maximum - 1).trimEnd()}…`;
}

export interface AlertPushRow { id: string; areaCode: string; areaName: string; title: string; summary: string; riskLevel: string }
export interface CitizenPushRow { id: string; kind: 'incident' | 'sos'; receiptCode: string; status: string | null; eventType: string }

export function alertMessage(row: AlertPushRow): PushMessage {
  return {
    title: `${RISK_PREFIX[row.riskLevel] ?? 'Cảnh báo'} · ${row.areaName}`,
    body: clip(`${row.title}. ${row.summary}`, MAX_BODY),
    channel: 'alerts',
    urgent: row.riskLevel === 'high',
    tag: `alert-${row.id}`,
    data: { type: 'alert', areaCode: row.areaCode, alertId: row.id },
  };
}

export function citizenMessage(row: CitizenPushRow): PushMessage {
  return {
    // Màn hình khóa chỉ thấy trạng thái chung và mã hồ sơ, không thấy mô tả vụ việc hay lời nhắn của cán bộ.
    title: notificationTitle(row.kind, row.status, row.eventType),
    body: `Mã hồ sơ ${row.receiptCode}. Mở ứng dụng để xem chi tiết.`,
    channel: 'cases',
    urgent: row.kind === 'sos',
    tag: `case-${row.id}`,
    data: { type: 'citizen', kind: row.kind, receiptCode: row.receiptCode },
  };
}

// Sự kiện chỉ được gửi trong khoảng này sau khi phát sinh: tránh gửi dồn tin cũ khi máy chủ khởi động lại sau thời gian dài.
const DELIVERY_WINDOW = "interval '30 minutes'";
const MAX_ATTEMPTS = 3;

export class PostgresPushStore implements PushStore {
  constructor(private readonly pool: Pool) {}

  async upsertDevice(input: PushDeviceInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_devices (token, citizen_id, area_codes) VALUES ($1, $2, $3::text[])
       ON CONFLICT (token) DO UPDATE SET citizen_id = EXCLUDED.citizen_id, area_codes = EXCLUDED.area_codes, updated_at = now()`,
      [input.token, input.citizenId, input.areaCodes],
    );
  }

  async removeDevice(token: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM push_devices WHERE token = $1', [token]);
    return (result.rowCount ?? 0) > 0;
  }

  async claimPending(limit: number): Promise<PendingPush[]> {
    const due = await this.pool.query(
      `SELECT * FROM (
         SELECT 'alert'::text AS kind, a.id::text AS ref_id, d.id AS device_id, d.token,
                l.code AS area_code, l.name AS area_name, a.title, a.summary, a.risk_level,
                NULL::text AS receipt_code, NULL::text AS case_kind, NULL::text AS status, NULL::text AS event_type,
                a.created_at
         FROM public_alerts a
         JOIN localities l ON l.id = a.locality_id
         JOIN push_devices d ON l.code = ANY(d.area_codes)
         WHERE a.status = 'published' AND now() BETWEEN a.starts_at AND a.ends_at
           AND a.created_at > now() - ${DELIVERY_WINDOW} AND a.created_at >= d.created_at
           AND NOT EXISTS (
             SELECT 1 FROM push_deliveries x WHERE x.kind = 'alert' AND x.ref_id = a.id::text AND x.device_id = d.id
               AND NOT (x.status = 'failed' AND x.attempts < ${MAX_ATTEMPTS} AND x.updated_at < now() - interval '1 minute'))
         UNION ALL
         SELECT 'citizen', n.id, d.id, d.token, NULL, NULL, NULL, NULL, NULL,
                n.receipt_code, n.kind, n.status, n.event_type, n.created_at
         FROM citizen_notification_events n
         JOIN push_devices d ON d.citizen_id = n.citizen_id
         WHERE n.created_at > now() - ${DELIVERY_WINDOW} AND n.created_at >= d.created_at
           AND NOT EXISTS (
             SELECT 1 FROM push_deliveries x WHERE x.kind = 'citizen' AND x.ref_id = n.id AND x.device_id = d.id
               AND NOT (x.status = 'failed' AND x.attempts < ${MAX_ATTEMPTS} AND x.updated_at < now() - interval '1 minute'))
       ) due ORDER BY created_at LIMIT $1`,
      [limit],
    );
    const claimed: PendingPush[] = [];
    for (const row of due.rows as Array<Record<string, string | number | null>>) {
      const kind = row.kind as 'alert' | 'citizen';
      const refId = String(row.ref_id);
      const deviceId = Number(row.device_id);
      // Chỉ tiến trình giành được dòng này mới được gửi; chạy song song hay chạy lại đều không gửi trùng.
      const claim = await this.pool.query(
        `INSERT INTO push_deliveries (kind, ref_id, device_id, status, attempts) VALUES ($1, $2, $3, 'pending', 1)
         ON CONFLICT (kind, ref_id, device_id) DO UPDATE
           SET status = 'pending', attempts = push_deliveries.attempts + 1, updated_at = now()
           WHERE push_deliveries.status = 'failed' AND push_deliveries.attempts < ${MAX_ATTEMPTS}
             AND push_deliveries.updated_at < now() - interval '1 minute'
         RETURNING attempts`,
        [kind, refId, deviceId],
      );
      if (!claim.rowCount) continue;
      const message = kind === 'alert'
        ? alertMessage({
          id: refId, areaCode: String(row.area_code), areaName: String(row.area_name), title: String(row.title),
          summary: String(row.summary), riskLevel: String(row.risk_level),
        })
        : citizenMessage({
          id: refId, kind: row.case_kind === 'sos' ? 'sos' : 'incident', receiptCode: String(row.receipt_code),
          status: row.status === null ? null : String(row.status), eventType: String(row.event_type),
        });
      claimed.push({ kind, refId, deviceId, token: String(row.token), message });
    }
    return claimed;
  }

  async finish(item: PendingPush, outcome: PushOutcome): Promise<void> {
    if (outcome === 'invalid_token') {
      // Mã thiết bị đã bị Google thu hồi (gỡ app, xóa dữ liệu). Xóa để không gửi lại; các dòng gửi tin bị xóa theo.
      await this.pool.query('DELETE FROM push_devices WHERE id = $1', [item.deviceId]);
      return;
    }
    await this.pool.query(
      `UPDATE push_deliveries SET status = $4, updated_at = now() WHERE kind = $1 AND ref_id = $2 AND device_id = $3`,
      [item.kind, item.refId, item.deviceId, outcome === 'sent' ? 'sent' : 'failed'],
    );
  }

  async purgeStale(days: number): Promise<number> {
    const result = await this.pool.query(`DELETE FROM push_devices WHERE updated_at < now() - make_interval(days => $1::int)`, [days]);
    // Nhật ký gửi tin cũ không còn ý nghĩa sau khi hết cửa sổ gửi.
    await this.pool.query(`DELETE FROM push_deliveries WHERE created_at < now() - interval '2 days'`);
    return result.rowCount ?? 0;
  }
}

export interface PushDispatcherOptions {
  intervalMs?: number;
  batchSize?: number;
  staleDays?: number;
  log?: (message: string) => void;
}

/** Quét định kỳ các cảnh báo và cập nhật hồ sơ mới, rồi gửi tới thiết bị phù hợp. */
export class PushDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;
  private lastError = '';

  constructor(
    private readonly store: PushStore,
    private readonly sender: PushSender,
    private readonly options: PushDispatcherOptions = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 15_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một vòng quét. Trả về số thông báo đã gửi thành công. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const items = await this.store.claimPending(this.options.batchSize ?? 50);
      for (const item of items) {
        const outcome = await this.sender.send(item.token, item.message);
        await this.store.finish(item, outcome);
        if (outcome === 'sent') sent += 1;
      }
      // Dọn thiết bị cũ khoảng mỗi giờ (với chu kỳ mặc định 15 giây).
      if (this.ticks++ % 240 === 0) await this.store.purgeStale(this.options.staleDays ?? 120);
      this.lastError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'lỗi không rõ';
      // Ghi một lần cho mỗi loại lỗi để không làm đầy nhật ký khi cơ sở dữ liệu chưa có bảng.
      if (message !== this.lastError) (this.options.log ?? console.error)(`Bộ gửi thông báo đẩy gặp lỗi: ${message}`);
      this.lastError = message;
    } finally {
      this.running = false;
    }
    return sent;
  }
}
