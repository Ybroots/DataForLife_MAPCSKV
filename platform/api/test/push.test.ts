import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import {
  alertMessage, citizenMessage, officerMessage, createPushSender, FcmSender, MemoryPushStore, parseServiceAccount,
  PostgresPushStore, PushDispatcher, type PendingPush, type PushMessage, type PushOutcome, type PushSender, type PushStore,
} from '../src/push.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const account = { project_id: 'cskv-test-project', client_email: 'push@cskv-test-project.iam.gserviceaccount.com', private_key: privatePem };
const message: PushMessage = {
  title: 'Cảnh báo · Phường A', body: 'Nội dung', channel: 'alerts', urgent: true, tag: 'alert-1',
  data: { type: 'alert', areaCode: 'A1', alertId: '1' },
};
const FCM_TOKEN = 'fcm-token-0123456789abcdefghijklmnop';

function fakeHttp(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { http, calls };
}

describe('FcmSender', () => {
  it('signs a service-account JWT, caches the access token and sends the documented FCM v1 payload', async () => {
    const { http, calls } = fakeHttp([
      { status: 200, body: { access_token: 'access-1', expires_in: 3600 } },
      { status: 200, body: { name: 'projects/x/messages/1' } },
      { status: 200, body: { name: 'projects/x/messages/2' } },
    ]);
    const sender = new FcmSender(account, http, () => 1_800_000_000_000);
    expect(await sender.send(FCM_TOKEN, message)).toBe('sent');
    expect(await sender.send(FCM_TOKEN, message)).toBe('sent');

    expect(calls).toHaveLength(3); // một lần đổi token, hai lần gửi
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.get('assertion')!.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600,
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);

    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/cskv-test-project/messages:send');
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      message: {
        token: FCM_TOKEN,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'alerts', tag: 'alert-1' } },
      },
    });
  });

  it('classifies revoked tokens, transient failures and expired credentials', async () => {
    const run = async (status: number, body: unknown): Promise<PushOutcome> => {
      const { http } = fakeHttp([{ status: 200, body: { access_token: 'a', expires_in: 3600 } }, { status, body }]);
      return new FcmSender(account, http).send(FCM_TOKEN, message);
    };
    expect(await run(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } })).toBe('invalid_token');
    expect(await run(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } })).toBe('invalid_token');
    expect(await run(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received.' } })).toBe('failed');
    expect(await run(503, { error: { status: 'UNAVAILABLE' } })).toBe('failed');

    const { http, calls } = fakeHttp([
      { status: 200, body: { access_token: 'old', expires_in: 3600 } }, { status: 401, body: {} },
      { status: 200, body: { access_token: 'new', expires_in: 3600 } }, { status: 200, body: {} },
    ]);
    const sender = new FcmSender(account, http);
    expect(await sender.send(FCM_TOKEN, message)).toBe('failed');
    expect(await sender.send(FCM_TOKEN, message)).toBe('sent');
    expect((calls[3]!.init.headers as Record<string, string>).Authorization).toBe('Bearer new');
  });

  it('reports a network failure as failed without throwing', async () => {
    const http = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await new FcmSender(account, http).send(FCM_TOKEN, message)).toBe('failed');
  });
});

describe('service account configuration', () => {
  it('rejects malformed keys and token endpoints outside googleapis.com', () => {
    expect(() => parseServiceAccount('{}')).toThrow();
    expect(() => parseServiceAccount(JSON.stringify({ ...account, private_key: 'x' }))).toThrow(/private_key/);
    expect(() => parseServiceAccount(JSON.stringify({ ...account, token_uri: 'https://evil.example/token' }))).toThrow(/googleapis/);
    expect(() => parseServiceAccount(JSON.stringify({ ...account, token_uri: 'http://oauth2.googleapis.com/token' }))).toThrow();
    expect(parseServiceAccount(JSON.stringify(account)).project_id).toBe('cskv-test-project');
  });

  it('stays disabled without a key file and never prints the file contents when it is invalid', () => {
    const logs: string[] = [];
    expect(createPushSender({}, (line) => logs.push(line))).toBeNull();
    expect(logs).toEqual([]);

    const directory = mkdtempSync(path.join(tmpdir(), 'fcm-'));
    const bad = path.join(directory, 'bad.json');
    writeFileSync(bad, '{"private_key":"-----BEGIN PRIVATE KEY----- SECRET-MARKER"}');
    expect(createPushSender({ FCM_SERVICE_ACCOUNT_FILE: bad }, (line) => logs.push(line))).toBeNull();
    expect(createPushSender({ FCM_SERVICE_ACCOUNT_FILE: path.join(directory, 'missing.json') }, (line) => logs.push(line))).toBeNull();
    expect(logs).toHaveLength(2);
    expect(logs.join('\n')).not.toContain('SECRET-MARKER');

    const good = path.join(directory, 'good.json');
    writeFileSync(good, JSON.stringify(account));
    expect(createPushSender({ FCM_SERVICE_ACCOUNT_FILE: good })).toBeInstanceOf(FcmSender);
  });
});

describe('message content', () => {
  it('summarises an alert for the lock screen and marks only high risk as urgent', () => {
    const high = alertMessage({ id: 'a1', areaCode: 'XH', areaName: 'Xuân Hương', title: 'Cháy rừng', summary: 'x'.repeat(400), riskLevel: 'high' });
    expect(high.title).toBe('Cảnh báo khẩn · Xuân Hương');
    expect(high.body.length).toBeLessThanOrEqual(180);
    expect(high.urgent).toBe(true);
    expect(high.channel).toBe('alerts');
    expect(high.data).toEqual({ type: 'alert', areaCode: 'XH', alertId: 'a1' });
    expect(alertMessage({ id: 'a2', areaCode: 'XH', areaName: 'Xuân Hương', title: 'Tạm đóng đường', summary: 'Ngày mai', riskLevel: 'info' }).urgent).toBe(false);
  });

  it('keeps case details off the lock screen', () => {
    const update = citizenMessage({ id: 'incident:7', kind: 'incident', receiptCode: 'PA-2026-0007', status: 'processing', eventType: 'status' });
    expect(update.title).toBe('Phản ánh đang được xử lý');
    expect(update.body).toBe('Chạm để xem chi tiết.');
    expect(update.channel).toBe('cases');
    expect(update.urgent).toBe(false);
    expect(update.data).toEqual({ type: 'citizen', kind: 'incident', receiptCode: 'PA-2026-0007' });
    const sos = citizenMessage({ id: 'sos:1', kind: 'sos', receiptCode: 'SOS-1', status: 'responding', eventType: 'status' });
    expect(sos.urgent).toBe(true);
    expect(citizenMessage({ id: 'message:2', kind: 'incident', receiptCode: 'PA-1', status: null, eventType: 'request_media' }).title).toBe('Cán bộ yêu cầu bổ sung thông tin');
  });
});

describe('officer push', () => {
  it('shows only locality and category on the lock screen, and rings loudly for SOS', () => {
    const sos = officerMessage({ id: 's1', kind: 'sos', receiptCode: 'SOS-2026-0001', category: 'medical', localityName: 'Xuân Hương' });
    expect(sos).toMatchObject({ title: 'SOS khẩn cấp · Xuân Hương', body: 'Y tế · Chạm để mở hồ sơ', channel: 'sos', urgent: true });
    expect(sos.data).toEqual({ type: 'officer', kind: 'sos', id: 's1', receiptCode: 'SOS-2026-0001' });
    const incident = officerMessage({ id: 'i1', kind: 'incident', receiptCode: 'PA-2026-0009', category: 'traffic', localityName: 'Xuân Hương' });
    expect(incident).toMatchObject({ title: 'Phản ánh mới · Xuân Hương', body: 'Giao thông · Chạm để mở hồ sơ', channel: 'officer', urgent: false });
    expect(officerMessage({ id: 'i2', kind: 'incident', receiptCode: 'PA-1', category: 'lạ', localityName: 'X' }).body).toBe('Khác · Chạm để mở hồ sơ');
    const remind = officerMessage({ id: 's1', kind: 'sos', receiptCode: 'SOS-2026-0001', category: 'medical', localityName: 'Xuân Hương', reminder: 2 });
    expect(remind).toMatchObject({ title: 'SOS chưa có người nhận · Xuân Hương', urgent: true, channel: 'sos', tag: 'officer-sos-s1-r2' });
    expect(remind.data.id).toBe('s1');
    expect(sos.tag).toBe('officer-sos-s1');
  });

  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('registers a device only for a signed-in officer and moves it away from the citizen when the token is reused', async () => {
    const store = new MemoryPushStore();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', pushStore: store, allowTestAuthHeaders: true });
    const register = (headers?: Record<string, string>, token: unknown = FCM_TOKEN) => app!.inject({ method: 'POST', url: '/v1/push/officer-devices', payload: { token }, headers });

    expect((await register()).statusCode).toBe(401);
    expect(store.devices.size).toBe(0);
    expect((await register({ 'x-officer-id': 'officer-demo-xuan-huong' }, 'ngắn')).statusCode).toBe(400);
    const ok = await register({ 'x-officer-id': 'officer-demo-xuan-huong' });
    expect(ok.statusCode).toBe(200);
    expect(store.devices.get(FCM_TOKEN)).toEqual({ token: FCM_TOKEN, citizenId: null, officerId: 'officer-demo-xuan-huong', areaCodes: [] });

    // Cùng một máy được dùng lại cho người dân: không còn nhận tin của cán bộ.
    await app.inject({ method: 'POST', url: '/v1/push/devices', payload: { token: FCM_TOKEN, areaCodes: ['24781'] } });
    expect(store.devices.get(FCM_TOKEN)).toEqual({ token: FCM_TOKEN, citizenId: null, areaCodes: ['24781'] });
  });
});

describe('push device routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });
  const body = (token: string, areaCodes: unknown) => ({ method: 'POST' as const, url: '/v1/push/devices', payload: { token, areaCodes } });

  it('reports whether the server can really send notifications', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    expect((await app.inject({ method: 'GET', url: '/v1/push/status' })).json().data).toEqual({ enabled: false });
    await app.close();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', pushEnabled: true });
    expect((await app.inject({ method: 'GET', url: '/v1/push/status' })).json().data).toEqual({ enabled: true });
  });

  it('registers a guest device with deduplicated areas, links the citizen session when present, and removes it', async () => {
    const store = new MemoryPushStore();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', pushStore: store, allowTestAuthHeaders: true });

    const guest = await app.inject(body(FCM_TOKEN, ['24781', '24781', '24805']));
    expect(guest.statusCode).toBe(200);
    expect(store.devices.get(FCM_TOKEN)).toEqual({ token: FCM_TOKEN, citizenId: null, areaCodes: ['24781', '24805'] });

    const signedIn = await app.inject({ ...body(FCM_TOKEN, ['24778']), headers: { 'x-citizen-id': 'citizen-test-001' } });
    expect(signedIn.statusCode).toBe(200);
    expect(store.devices.get(FCM_TOKEN)).toEqual({ token: FCM_TOKEN, citizenId: 'citizen-test-001', areaCodes: ['24778'] });

    // Đăng xuất: đăng ký lại không kèm phiên thì gỡ liên kết tài khoản, không còn nhận tin hồ sơ.
    await app.inject(body(FCM_TOKEN, ['24778']));
    expect(store.devices.get(FCM_TOKEN)?.citizenId).toBeNull();

    const removed = await app.inject({ method: 'POST', url: '/v1/push/devices/remove', payload: { token: FCM_TOKEN } });
    expect(removed.json().data).toEqual({ removed: true });
    expect(store.devices.size).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/v1/push/devices/remove', payload: { token: FCM_TOKEN } })).json().data).toEqual({ removed: false });
  });

  it('rejects malformed tokens and area lists', async () => {
    const store = new MemoryPushStore();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', pushStore: store });
    for (const payload of [
      body('short', []), body('has spaces in the token 0123456789', []), body(FCM_TOKEN, 'not-an-array'),
      body(FCM_TOKEN, ['a']), body(FCM_TOKEN, ['x'.repeat(81)]), body(FCM_TOKEN, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']),
      body(FCM_TOKEN, [7]), body(FCM_TOKEN, ["24781'; DROP TABLE push_devices;--"]),
    ]) {
      const response = await app.inject(payload);
      expect(response.statusCode, JSON.stringify(payload.payload)).toBe(400);
      expect(response.json().error).toBe('INVALID_PUSH_DEVICE');
    }
    expect(store.devices.size).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/v1/push/devices', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/push/devices/remove', payload: { token: 7 } })).statusCode).toBe(400);
  });

  it('limits how often one address can change device settings', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', pushStore: new MemoryPushStore() });
    for (let index = 0; index < 30; index++) expect((await app.inject(body(FCM_TOKEN, []))).statusCode).toBe(200);
    const blocked = await app.inject(body(FCM_TOKEN, []));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('PUSH_RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('PushDispatcher', () => {
  const item = (token: string): PendingPush => ({ kind: 'alert', refId: token, deviceId: 1, token, message });
  class ScriptedStore extends MemoryPushStore {
    finished: Array<{ token: string; outcome: PushOutcome }> = [];
    purged = 0;
    constructor(private queue: PendingPush[][], private failure?: Error) { super(); }
    override async claimPending(_limit: number): Promise<PendingPush[]> {
      if (this.failure) throw this.failure;
      return this.queue.shift() ?? [];
    }
    override async finish(pending: PendingPush, outcome: PushOutcome): Promise<void> { this.finished.push({ token: pending.token, outcome }); }
    override async purgeStale(_days: number): Promise<number> { this.purged += 1; return 0; }
  }

  it('sends every claimed message and records each outcome', async () => {
    const outcomes: Record<string, PushOutcome> = { ok: 'sent', gone: 'invalid_token', down: 'failed' };
    const sender: PushSender = { send: async (token) => outcomes[token] ?? 'failed' };
    const store = new ScriptedStore([[item('ok'), item('gone'), item('down')]]);
    const dispatcher = new PushDispatcher(store, sender);
    expect(await dispatcher.tick()).toBe(1);
    expect(store.finished).toEqual([{ token: 'ok', outcome: 'sent' }, { token: 'gone', outcome: 'invalid_token' }, { token: 'down', outcome: 'failed' }]);
    expect(store.purged).toBe(1);
  });

  it('does not run two sweeps at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sent = 0;
    const sender: PushSender = { send: async () => { await gate; sent += 1; return 'sent'; } };
    const dispatcher = new PushDispatcher(new ScriptedStore([[item('a')], [item('b')]]), sender);
    const first = dispatcher.tick();
    expect(await dispatcher.tick()).toBe(0);
    release();
    expect(await first).toBe(1);
    expect(sent).toBe(1);
  });

  it('logs a repeating database error once and keeps running', async () => {
    const logs: string[] = [];
    const dispatcher = new PushDispatcher(new ScriptedStore([], new Error('relation "push_devices" does not exist')), { send: async () => 'sent' }, { log: (line) => logs.push(line) });
    await dispatcher.tick();
    await dispatcher.tick();
    await dispatcher.tick();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('push_devices');
  });
});

// Kiểm thử SQL thật. Chỉ chạy khi PUSH_TEST_DATABASE_URL trỏ tới một cơ sở dữ liệu dùng thử (tên chứa "test"):
// bài kiểm thử tự tạo bảng giả localities/public_alerts/citizen_notification_events nếu chưa có và xóa dữ liệu bảng push_*.
const databaseUrl = process.env.PUSH_TEST_DATABASE_URL;
const throwaway = Boolean(databaseUrl) && /test/i.test(new URL(databaseUrl!).pathname);
describe.skipIf(!throwaway)('PostgresPushStore (cơ sở dữ liệu thật)', () => {
  let pool: Pool;
  let store: PushStore;
  const migration = readFileSync(new URL('../../database/migrations/013_push_devices.sql', import.meta.url), 'utf8');

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS localities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS public_alerts (
        id uuid PRIMARY KEY, locality_id uuid NOT NULL, title text NOT NULL, summary text NOT NULL, risk_level text NOT NULL,
        status text NOT NULL DEFAULT 'published', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS citizen_notification_events (
        id text PRIMARY KEY, citizen_id text, kind text, receipt_code text, case_title text, status text, event_type text, message text, created_at timestamptz NOT NULL DEFAULT now());`);
    await pool.query(migration);
    await pool.query(migration); // chạy lại phải an toàn
    store = new PostgresPushStore(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE push_devices, push_deliveries, public_alerts, citizen_notification_events, localities RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO localities (code, name) VALUES ('A1', 'Phường A'), ('B2', 'Phường B')`);
  });

  const addAlert = async (code: string, extra: { risk?: string; status?: string; startsAgo?: string; endsIn?: string; createdAgo?: string; title?: string } = {}) => {
    const result = await pool.query(
      `INSERT INTO public_alerts (id, locality_id, title, summary, risk_level, status, starts_at, ends_at, created_at)
       SELECT gen_random_uuid(), l.id, $2, 'Tóm tắt', $3, $4, now() - $5::interval, now() + $6::interval, now() - $7::interval FROM localities l WHERE l.code = $1 RETURNING id::text`,
      [code, extra.title ?? 'Cháy', extra.risk ?? 'high', extra.status ?? 'published', extra.startsAgo ?? '5 minutes', extra.endsIn ?? '2 hours', extra.createdAgo ?? '1 minute'],
    );
    return result.rows[0].id as string;
  };
  const addDevice = async (token: string, areas: string[], citizenId: string | null = null, registeredAgo = '1 hour') => {
    await store.upsertDevice({ token, citizenId, areaCodes: areas });
    await pool.query(`UPDATE push_devices SET created_at = now() - $2::interval WHERE token = $1`, [token, registeredAgo]);
  };

  it('upserts and removes devices, and rejects more than five areas at the database level', async () => {
    await store.upsertDevice({ token: FCM_TOKEN, citizenId: null, areaCodes: ['A1'] });
    await store.upsertDevice({ token: FCM_TOKEN, citizenId: 'c1', areaCodes: ['A1', 'B2'] });
    const rows = (await pool.query('SELECT citizen_id, area_codes FROM push_devices')).rows;
    expect(rows).toEqual([{ citizen_id: 'c1', area_codes: ['A1', 'B2'] }]);
    await expect(store.upsertDevice({ token: `${FCM_TOKEN}-2`, citizenId: null, areaCodes: ['1', '2', '3', '4', '5', '6'] })).rejects.toThrow();
    expect(await store.removeDevice(FCM_TOKEN)).toBe(true);
    expect(await store.removeDevice(FCM_TOKEN)).toBe(false);
  });

  it('delivers an alert once, only to devices following that area and registered before it', async () => {
    await addDevice('follows-a-0123456789abcdefghijkl', ['A1']);
    await addDevice('follows-b-0123456789abcdefghijkl', ['B2']);
    await addDevice('registered-late-0123456789abcdefg', ['A1'], null, '0 seconds');
    const id = await addAlert('A1', { createdAgo: '2 minutes' });

    const first = await store.claimPending(10);
    expect(first.map((entry) => entry.token)).toEqual(['follows-a-0123456789abcdefghijkl']);
    expect(first[0]).toMatchObject({ kind: 'alert', refId: id });
    expect(first[0]!.message).toMatchObject({ title: 'Cảnh báo khẩn · Phường A', channel: 'alerts', urgent: true, data: { type: 'alert', areaCode: 'A1', alertId: id } });
    expect(await store.claimPending(10)).toEqual([]);
    await store.finish(first[0]!, 'sent');
    expect(await store.claimPending(10)).toEqual([]);
    expect((await pool.query('SELECT status FROM push_deliveries')).rows).toEqual([{ status: 'sent' }]);
  });

  it('ignores cancelled, expired, not-yet-active and old alerts', async () => {
    await addDevice(FCM_TOKEN, ['A1']);
    await addAlert('A1', { status: 'cancelled' });
    await addAlert('A1', { status: 'draft' });
    await addAlert('A1', { startsAgo: '3 hours', endsIn: '-1 hour' });
    await addAlert('A1', { startsAgo: '-1 hour', endsIn: '2 hours' });
    await addAlert('A1', { createdAgo: '45 minutes' });
    expect(await store.claimPending(10)).toEqual([]);
  });

  it('retries a failed send after a minute, at most three times in total', async () => {
    await addDevice(FCM_TOKEN, ['A1']);
    await addAlert('A1');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await store.claimPending(10);
      expect(claimed, `lần ${attempt}`).toHaveLength(1);
      await store.finish(claimed[0]!, 'failed');
      expect(await store.claimPending(10), `ngay sau lần ${attempt}`).toEqual([]);
      await pool.query(`UPDATE push_deliveries SET updated_at = now() - interval '2 minutes'`);
    }
    expect(await store.claimPending(10)).toEqual([]);
    expect((await pool.query('SELECT attempts, status FROM push_deliveries')).rows).toEqual([{ attempts: 3, status: 'failed' }]);
  });

  it('never lets two workers claim the same delivery', async () => {
    await addDevice(FCM_TOKEN, ['A1']);
    await addAlert('A1');
    const other = new PostgresPushStore(pool);
    const results = await Promise.all([store.claimPending(10), other.claimPending(10), store.claimPending(10)]);
    expect(results.flat()).toHaveLength(1);
  });

  it('sends case updates only to the owner, without the case description or officer message', async () => {
    await addDevice('owner-device-0123456789abcdefghijk', [], 'citizen-1');
    await addDevice('other-device-0123456789abcdefghijk', [], 'citizen-2');
    await addDevice('guest-device-0123456789abcdefghijk', []);
    await pool.query(
      `INSERT INTO citizen_notification_events (id, citizen_id, kind, receipt_code, case_title, status, event_type, message, created_at)
       VALUES ('incident:9', 'citizen-1', 'incident', 'PA-9', 'Mô tả riêng tư của vụ việc', 'processing', 'status', 'Lời nhắn riêng của cán bộ', now() - interval '1 minute')`,
    );
    const claimed = await store.claimPending(10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.token).toBe('owner-device-0123456789abcdefghijk');
    expect(claimed[0]!.message.title).toBe('Phản ánh đang được xử lý');
    const shown = JSON.stringify(claimed[0]!.message);
    expect(shown).toContain('PA-9');
    expect(shown).not.toContain('riêng');
  });

  it('removes a device whose token was revoked, together with its delivery log', async () => {
    await addDevice(FCM_TOKEN, ['A1']);
    await addAlert('A1');
    const [claimed] = await store.claimPending(10);
    await store.finish(claimed!, 'invalid_token');
    expect((await pool.query('SELECT count(*)::int AS n FROM push_devices')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM push_deliveries')).rows[0].n).toBe(0);
  });

  it('purges devices that have not synced for the retention period', async () => {
    await store.upsertDevice({ token: FCM_TOKEN, citizenId: null, areaCodes: [] });
    await store.upsertDevice({ token: `${FCM_TOKEN}-fresh`, citizenId: null, areaCodes: [] });
    await pool.query(`UPDATE push_devices SET updated_at = now() - interval '130 days' WHERE token = $1`, [FCM_TOKEN]);
    expect(await store.purgeStale(120)).toBe(1);
    expect((await pool.query('SELECT token FROM push_devices')).rows).toEqual([{ token: `${FCM_TOKEN}-fresh` }]);
  });
});
