import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  CreateIncidentInput,
  CreateSosInput,
  IncidentResponse,
  OfficerArchiveQuery,
  OfficerNotificationResponse,
  OfficerQueueItemResponse,
  SosResponse,
  WorkflowActorResponse,
  WorkflowHistoryResponse,
  WorkflowLocationResponse,
} from './types.js';
import {
  assertCaseOwnership,
  assertIncidentTransition,
  assertSosTransition,
  WorkflowError,
  type IncidentStatus,
  type SosStatus,
} from './workflow.js';

interface ActorRow extends QueryResultRow {
  id: string;
  actor_type: 'officer' | 'supervisor';
  display_name: string;
  locality_id: string | null;
  locality_code: string | null;
}

interface ResolvedLocationRow extends QueryResultRow {
  locality_id: string;
  locality_code: string;
  locality_name: string;
  service_area_id: string | null;
  service_area_code: string | null;
  service_area_name: string | null;
  dispatch_unit_id: string | null;
}

interface IncidentRow extends QueryResultRow {
  id: string;
  receipt_code: string;
  category: IncidentResponse['category'];
  summary: string;
  description: string;
  location_note: string | null;
  contact_phone: string | null;
  status: IncidentStatus;
  priority: IncidentResponse['priority'];
  latitude: number;
  longitude: number;
  accuracy_m: string | number | null;
  locality_code: string;
  locality_name: string;
  service_area_code: string | null;
  service_area_name: string | null;
  assigned_officer_id: string | null;
  assigned_officer_name: string | null;
  operational_mode: IncidentResponse['operationalMode'];
  created_at: Date | string;
  updated_at: Date | string;
}

interface SosRow extends QueryResultRow {
  id: string;
  receipt_code: string;
  category: SosResponse['category'];
  note: string | null;
  contact_phone: string | null;
  status: SosStatus;
  latitude: number;
  longitude: number;
  accuracy_m: string | number | null;
  locality_code: string;
  locality_name: string;
  service_area_code: string | null;
  service_area_name: string | null;
  assigned_officer_id: string | null;
  assigned_officer_name: string | null;
  operational_mode: SosResponse['operationalMode'];
  acknowledged_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HistoryRow<TStatus extends string> extends QueryResultRow {
  from_status: TStatus | null;
  to_status: TStatus;
  actor_id: string;
  actor_role: string;
  note: string | null;
  public_message: boolean;
  created_at: Date | string;
}

interface OutboxDeliveryRow extends QueryResultRow {
  id: string;
  aggregate_type: 'incident' | 'sos';
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  locality_id: string;
  receipt_code: string;
  attempts: number;
}

interface IncidentAttachmentRow extends QueryResultRow {
  id: string;
  file_name: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';
  size_bytes: number;
  sha256: string;
  created_at: Date | string;
  uploader_role: 'citizen' | 'officer' | 'supervisor';
  purpose: 'initial' | 'supplemental' | 'evidence';
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function receipt(prefix: 'PA' | 'SOS'): { id: string; code: string } {
  const id = randomUUID();
  const compact = id.replaceAll('-', '').slice(0, 8).toUpperCase();
  const date = new Date();
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).replaceAll('-', '');
  const datePart = prefix === 'SOS' ? localDate : localDate.slice(0, 4);
  return { id, code: `${prefix}-${datePart}-${compact}` };
}

function mapHistory<TStatus extends string>(row: HistoryRow<TStatus>): WorkflowHistoryResponse<TStatus> {
  return {
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    note: row.note,
    publicMessage: row.public_message,
    createdAt: iso(row.created_at),
  };
}

function mapLocation(row: IncidentRow | SosRow): WorkflowLocationResponse {
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyM: numberOrNull(row.accuracy_m),
    localityCode: row.locality_code,
    localityName: row.locality_name,
    serviceAreaCode: row.service_area_code,
    serviceAreaName: row.service_area_name,
    routingStatus: row.service_area_code ? 'approved_service_area' : 'locality_dispatch',
  };
}

export class PostgresWorkflowStore {
  private readonly outboxTimer: NodeJS.Timeout;
  private processingOutbox = false;

  constructor(private readonly pool: Pool) {
    this.outboxTimer = setInterval(() => {
      void this.processOutboxBatch().catch(() => undefined);
    }, 1_000);
    this.outboxTimer.unref();
    void this.processOutboxBatch().catch(() => undefined);
  }

  async close(): Promise<void> {
    clearInterval(this.outboxTimer);
    await this.processOutboxBatch().catch(() => undefined);
  }

  async createIncident(citizenId: string, input: CreateIncidentInput): Promise<IncidentResponse> {
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE citizen_external_id = $1 AND client_request_id = $2`,
      [citizenId, input.clientRequestId],
    );
    if (existing.rows[0]) return this.requireIncident(existing.rows[0].id, citizenId);

    const generated = receipt('PA');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const location = await this.resolveLocation(client, input.latitude, input.longitude);
      await client.query(
        `INSERT INTO incident_reports (
           id, receipt_code, client_request_id, citizen_external_id, contact_phone,
           category, summary, description, location_note, geom, accuracy_m,
           locality_id, service_area_id, status, priority, operational_mode
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           ST_SetSRID(ST_Point($11, $10), 4326), $12, $13, $14,
           'submitted', $15, 'local_sandbox'
         )`,
        [
          generated.id,
          generated.code,
          input.clientRequestId,
          citizenId,
          input.contactPhone ?? null,
          input.category,
          input.summary.trim(),
          input.description.trim(),
          input.locationNote?.trim() || null,
          input.latitude,
          input.longitude,
          input.accuracyM ?? null,
          location.locality_id,
          location.service_area_id,
          input.category === 'security' ? 'high' : 'normal',
        ],
      );
      for (const attachment of input.attachments) {
        const content = Buffer.from(attachment.dataBase64, 'base64');
        await client.query(
          `INSERT INTO incident_attachments (
             id, incident_id, file_name, mime_type, size_bytes, content, sha256
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(), generated.id, attachment.fileName, attachment.mimeType,
            attachment.sizeBytes, content, createHash('sha256').update(content).digest('hex'),
          ],
        );
      }
      await this.recordIncidentChange(client, {
        id: generated.id,
        from: null,
        to: 'submitted',
        actorId: citizenId,
        actorRole: 'citizen',
        note: 'Người dân đã gửi phản ánh và nhận mã tiếp nhận.',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const repeated = await client.query<{ id: string }>(
          `SELECT id::text FROM incident_reports WHERE citizen_external_id = $1 AND client_request_id = $2`,
          [citizenId, input.clientRequestId],
        );
        if (repeated.rows[0]) return this.hydrateIncident(client, repeated.rows[0].id, false);
      }
      throw error;
    } finally {
      client.release();
    }
    return this.requireIncident(generated.id, citizenId);
  }

  async listCitizenIncidents(citizenId: string): Promise<IncidentResponse[]> {
    const ids = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE citizen_external_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [citizenId],
    );
    return Promise.all(ids.rows.map((row) => this.requireIncident(row.id, citizenId)));
  }

  async getCitizenIncident(citizenId: string, receiptCode: string): Promise<IncidentResponse | null> {
    const found = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE citizen_external_id = $1 AND receipt_code = $2`,
      [citizenId, receiptCode],
    );
    return found.rows[0] ? this.hydrateIncident(this.pool, found.rows[0].id, false) : null;
  }

  async createSos(citizenId: string, input: CreateSosInput): Promise<SosResponse> {
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM sos_events WHERE citizen_external_id = $1 AND idempotency_key = $2`,
      [citizenId, input.idempotencyKey],
    );
    if (existing.rows[0]) return this.requireSos(existing.rows[0].id, citizenId);

    const generated = receipt('SOS');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const location = await this.resolveLocation(client, input.latitude, input.longitude);
      const duty = await client.query(
        `SELECT 1 FROM workflow_actors WHERE locality_id = $1 AND actor_type = 'officer' AND active = true LIMIT 1`,
        [location.locality_id],
      );
      if (!duty.rows[0]) {
        throw new WorkflowError('NO_DUTY_OFFICER', `Địa bàn ${location.locality_name} chưa có cán bộ trực trên hệ thống này. Vui lòng gọi 112 hoặc 113.`);
      }
      await client.query(
        `INSERT INTO sos_events (
           id, receipt_code, idempotency_key, citizen_external_id, contact_phone,
           category, note, geom, accuracy_m, device_timestamp,
           locality_id, service_area_id, dispatch_unit_id, status, operational_mode
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           ST_SetSRID(ST_Point($9, $8), 4326), $10, $11,
           $12, $13, $14, 'dispatched', 'local_sandbox'
         )`,
        [
          generated.id,
          generated.code,
          input.idempotencyKey,
          citizenId,
          input.contactPhone ?? null,
          input.category,
          input.note?.trim() || null,
          input.latitude,
          input.longitude,
          input.accuracyM ?? null,
          input.deviceTimestamp,
          location.locality_id,
          location.service_area_id,
          location.dispatch_unit_id,
        ],
      );
      await this.recordSosChange(client, {
        id: generated.id,
        from: null,
        to: 'triggered',
        actorId: citizenId,
        actorRole: 'citizen',
        note: 'Thiết bị đã tạo yêu cầu SOS trong môi trường local.',
      });
      await this.recordSosChange(client, {
        id: generated.id,
        from: 'triggered',
        to: 'dispatched',
        actorId: 'workflow-router',
        actorRole: 'system',
        note: 'Đã đưa vào hàng đợi trực ban theo địa bàn. Chưa kết nối tổng đài khẩn cấp chính thức.',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        const repeated = await client.query<{ id: string }>(
          `SELECT id::text FROM sos_events WHERE citizen_external_id = $1 AND idempotency_key = $2`,
          [citizenId, input.idempotencyKey],
        );
        if (repeated.rows[0]) return this.hydrateSos(client, repeated.rows[0].id, false);
      }
      throw error;
    } finally {
      client.release();
    }
    return this.requireSos(generated.id, citizenId);
  }

  async listCitizenSos(citizenId: string): Promise<SosResponse[]> {
    const ids = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM sos_events WHERE citizen_external_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [citizenId],
    );
    return Promise.all(ids.rows.map((row) => this.requireSos(row.id, citizenId)));
  }

  async getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null> {
    const found = await this.pool.query<{ id: string }>(
      'SELECT id::text FROM sos_events WHERE citizen_external_id=$1 AND receipt_code=$2', [citizenId, receiptCode],
    );
    return found.rows[0] ? this.hydrateSos(this.pool, found.rows[0].id, false) : null;
  }

  async cancelCitizenSos(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    const client = await this.pool.connect();
    let id = '';
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; status: SosStatus }>(
        `SELECT id::text, status FROM sos_events
         WHERE citizen_external_id = $1 AND receipt_code = $2 FOR UPDATE`,
        [citizenId, receiptCode],
      );
      const row = result.rows[0];
      if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS này.');
      assertSosTransition(row.status, 'cancelled_by_citizen');
      id = row.id;
      await client.query(
        `UPDATE sos_events SET status = 'cancelled_by_citizen', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.recordSosChange(client, {
        id,
        from: row.status,
        to: 'cancelled_by_citizen',
        actorId: citizenId,
        actorRole: 'citizen',
        note: note.trim() || 'Người dân hủy trước khi cán bộ xác nhận tiếp nhận.',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireSos(id, citizenId);
  }

  async reportCitizenSosSafe(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    const client = await this.pool.connect();
    let id = '';
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; status: SosStatus }>(
        `SELECT id::text, status FROM sos_events
         WHERE citizen_external_id = $1 AND receipt_code = $2 FOR UPDATE`,
        [citizenId, receiptCode],
      );
      const row = result.rows[0];
      if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS này.');
      if (!['dispatched', 'acknowledged', 'responding', 'escalated'].includes(row.status)) {
        throw new WorkflowError('INVALID_TRANSITION', 'Chỉ báo an toàn được khi yêu cầu SOS đang được xử lý.');
      }
      id = row.id;
      const already = await client.query(
        `SELECT 1 FROM sos_status_history WHERE sos_event_id = $1 AND actor_role = 'citizen' AND from_status = to_status LIMIT 1`,
        [id],
      );
      if (!already.rows[0]) {
        // The status is NOT changed: only an officer may close a case, after verifying (coercion/duress is possible).
        await client.query(`UPDATE sos_events SET updated_at = now() WHERE id = $1`, [id]);
        await this.recordSosChange(client, {
          id, from: row.status, to: row.status, actorId: citizenId, actorRole: 'citizen',
          note: note.trim(), publicMessage: true, eventType: 'citizen_safe',
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireSos(id, citizenId);
  }

  async withdrawCitizenIncident(citizenId: string, receiptCode: string, note: string): Promise<IncidentResponse> {
    const client = await this.pool.connect();
    let id = '';
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; status: IncidentStatus }>(
        `SELECT id::text, status FROM incident_reports
         WHERE citizen_external_id = $1 AND receipt_code = $2 FOR UPDATE`,
        [citizenId, receiptCode],
      );
      const row = result.rows[0];
      if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
      if (!['submitted', 'received'].includes(row.status)) {
        throw new WorkflowError('INVALID_TRANSITION', 'Phản ánh đã được phân công xử lý, không thể tự rút. Hãy nhắn cho cán bộ phụ trách.');
      }
      assertIncidentTransition(row.status, 'closed');
      id = row.id;
      await client.query(
        `UPDATE incident_reports SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.recordIncidentChange(client, {
        id, from: row.status, to: 'closed', actorId: citizenId, actorRole: 'citizen', note: note.trim(), publicMessage: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.requireIncident(id, citizenId);
  }

  async listDutyLocalityCodes(): Promise<string[]> {
    const result = await this.pool.query<{ code: string }>(
      `SELECT DISTINCT l.code
       FROM workflow_actors a
       JOIN localities l ON l.id = a.locality_id
       WHERE a.actor_type = 'officer' AND a.active = true AND l.visibility = 'public'
       ORDER BY l.code`,
    );
    return result.rows.map((row) => row.code);
  }

  /** Hồ sơ đã đóng/từ chối/hủy: không còn trong hàng đợi nhưng vẫn xem lại được toàn bộ lịch sử xử lý. */
  async listOfficerArchive(actorId: string, query: OfficerArchiveQuery): Promise<OfficerQueueItemResponse[]> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT 'sos'::text AS kind, s.id::text, s.receipt_code, s.category,
                COALESCE(s.note, 'Yêu cầu hỗ trợ khẩn cấp') AS title,
                s.status, 'critical'::text AS priority, l.code AS locality_code,
                l.name AS locality_name, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                s.created_at, s.updated_at, COALESCE(s.closed_at, s.updated_at) AS ended_at
         FROM sos_events s
         JOIN localities l ON l.id = s.locality_id
         LEFT JOIN service_areas sa ON sa.id = s.service_area_id
         LEFT JOIN workflow_actors a ON a.id = s.assigned_officer_id
         WHERE s.locality_id = $1 AND s.status IN ('closed', 'cancelled_by_citizen')
         UNION ALL
         SELECT 'incident'::text AS kind, i.id::text, i.receipt_code, i.category,
                i.summary AS title, i.status, i.priority, l.code AS locality_code,
                l.name AS locality_name, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                i.created_at, i.updated_at, COALESCE(i.closed_at, i.updated_at) AS ended_at
         FROM incident_reports i
         JOIN localities l ON l.id = i.locality_id
         LEFT JOIN service_areas sa ON sa.id = i.service_area_id
         LEFT JOIN workflow_actors a ON a.id = i.assigned_officer_id
         WHERE i.locality_id = $1 AND i.status IN ('closed', 'rejected')
       ) archive
       WHERE ($2::text IS NULL OR kind = $2)
         AND ($3::text IS NULL OR receipt_code ILIKE $3 OR title ILIKE $3)
         AND ($4::date IS NULL OR (ended_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
         AND ($5::date IS NULL OR (ended_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $5::date)
       ORDER BY ended_at DESC
       LIMIT 200`,
      [actor.locality_id, query.kind ?? null, pattern, query.from ?? null, query.to ?? null],
    );
    return result.rows.map((row) => ({
      kind: row.kind, id: row.id, receiptCode: row.receipt_code, category: row.category, title: row.title,
      status: row.status, priority: row.priority, localityCode: row.locality_code, localityName: row.locality_name,
      serviceAreaName: row.service_area_name,
      assignedOfficer: row.assigned_officer_id && row.assigned_officer_name
        ? { id: row.assigned_officer_id, displayName: row.assigned_officer_name } : null,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }));
  }

  async listOfficerQueue(actorId: string, kind?: 'incident' | 'sos'): Promise<OfficerQueueItemResponse[]> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const result = await this.pool.query<{
      kind: 'incident' | 'sos';
      id: string;
      receipt_code: string;
      category: string;
      title: string;
      status: IncidentStatus | SosStatus;
      priority: OfficerQueueItemResponse['priority'];
      locality_code: string;
      locality_name: string;
      service_area_name: string | null;
      assigned_officer_id: string | null;
      assigned_officer_name: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT * FROM (
         SELECT 'sos'::text AS kind, s.id::text, s.receipt_code, s.category,
                COALESCE(s.note, 'Yêu cầu hỗ trợ khẩn cấp') AS title,
                s.status, 'critical'::text AS priority, l.code AS locality_code,
                l.name AS locality_name, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                s.created_at, s.updated_at
         FROM sos_events s
         JOIN localities l ON l.id = s.locality_id
         LEFT JOIN service_areas sa ON sa.id = s.service_area_id
         LEFT JOIN workflow_actors a ON a.id = s.assigned_officer_id
         WHERE s.locality_id = $1 AND s.status NOT IN ('closed', 'cancelled_by_citizen')
         UNION ALL
         SELECT 'incident'::text AS kind, i.id::text, i.receipt_code, i.category,
                i.summary AS title, i.status, i.priority, l.code AS locality_code,
                l.name AS locality_name, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                i.created_at, i.updated_at
         FROM incident_reports i
         JOIN localities l ON l.id = i.locality_id
         LEFT JOIN service_areas sa ON sa.id = i.service_area_id
         LEFT JOIN workflow_actors a ON a.id = i.assigned_officer_id
         WHERE i.locality_id = $1 AND i.status NOT IN ('closed', 'rejected')
       ) queue
       WHERE ($2::text IS NULL OR kind = $2)
       ORDER BY CASE WHEN kind = 'sos' THEN 0 ELSE 1 END,
                CASE status
                  WHEN 'triggered' THEN 0 WHEN 'dispatched' THEN 0 WHEN 'escalated' THEN 1
                  WHEN 'acknowledged' THEN 2 WHEN 'responding' THEN 3 WHEN 'resolved' THEN 4 ELSE 5
                END,
                CASE priority WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                created_at ASC
       LIMIT 200`,
      [actor.locality_id, kind ?? null],
    );
    return result.rows.map((row) => ({
      kind: row.kind,
      id: row.id,
      receiptCode: row.receipt_code,
      category: row.category,
      title: row.title,
      status: row.status,
      priority: row.priority,
      localityCode: row.locality_code,
      localityName: row.locality_name,
      serviceAreaName: row.service_area_name,
      assignedOfficer: row.assigned_officer_id && row.assigned_officer_name
        ? { id: row.assigned_officer_id, displayName: row.assigned_officer_name }
        : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async getOfficerIncident(actorId: string, id: string): Promise<IncidentResponse | null> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const allowed = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE id = $1 AND locality_id = $2`,
      [id, actor.locality_id],
    );
    return allowed.rows[0] ? this.hydrateIncident(this.pool, id) : null;
  }

  async getOfficerSos(actorId: string, id: string): Promise<SosResponse | null> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const allowed = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM sos_events WHERE id = $1 AND locality_id = $2`,
      [id, actor.locality_id],
    );
    return allowed.rows[0] ? this.hydrateSos(this.pool, id) : null;
  }

  async transitionIncident(
    actorId: string,
    id: string,
    toStatus: IncidentStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage = false,
  ): Promise<IncidentResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await this.requireOfficer(client, actorId);
      const current = await client.query<{ status: IncidentStatus; locality_id: string; assigned_officer_id: string | null }>(
        `SELECT status, locality_id::text, assigned_officer_id FROM incident_reports WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
      if (row.locality_id !== actor.locality_id) throw new WorkflowError('FORBIDDEN', 'Phản ánh nằm ngoài phạm vi địa bàn.');
      assertIncidentTransition(row.status, toStatus);
      assertCaseOwnership(actor.id, row.assigned_officer_id, assignedOfficerId, 'hồ sơ');

      let assignee = assignedOfficerId ?? row.assigned_officer_id;
      if (toStatus === 'assigned' && !assignee) assignee = actorId;
      if (assignee) {
        const target = await this.requireOfficer(client, assignee);
        if (target.locality_id !== actor.locality_id) throw new WorkflowError('FORBIDDEN', 'Cán bộ được chọn nằm ngoài địa bàn.');
        if (target.actor_type !== 'officer') throw new WorkflowError('INVALID_TRANSITION', 'Hồ sơ chỉ được phân công cho tài khoản CSKV.');
      }

      await client.query(
        `UPDATE incident_reports
         SET status = $2,
             assigned_officer_id = $3,
             received_at = CASE WHEN $2 = 'received' AND received_at IS NULL THEN now() ELSE received_at END,
             resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 = 'processing' THEN NULL ELSE resolved_at END,
             closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END,
             updated_at = now()
         WHERE id = $1`,
        [id, toStatus, assignee ?? null],
      );
      await this.recordIncidentChange(client, {
        id,
        from: row.status,
        to: toStatus,
        actorId,
        actorRole: actor.actor_type,
        note: note.trim(),
        publicMessage,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.hydrateIncident(this.pool, id);
  }

  async transitionSos(
    actorId: string,
    id: string,
    toStatus: SosStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage = false,
  ): Promise<SosResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await this.requireOfficer(client, actorId);
      const current = await client.query<{ status: SosStatus; locality_id: string; assigned_officer_id: string | null }>(
        `SELECT status, locality_id::text, assigned_officer_id FROM sos_events WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS.');
      if (row.locality_id !== actor.locality_id) throw new WorkflowError('FORBIDDEN', 'SOS nằm ngoài phạm vi địa bàn.');
      assertSosTransition(row.status, toStatus);
      assertCaseOwnership(actor.id, row.assigned_officer_id, assignedOfficerId, 'SOS');

      let assignee = assignedOfficerId ?? row.assigned_officer_id;
      if ((toStatus === 'acknowledged' || toStatus === 'responding') && !assignee) assignee = actorId;
      if (assignee) {
        const target = await this.requireOfficer(client, assignee);
        if (target.locality_id !== actor.locality_id) throw new WorkflowError('FORBIDDEN', 'Cán bộ được chọn nằm ngoài địa bàn.');
        if (target.actor_type !== 'officer') throw new WorkflowError('INVALID_TRANSITION', 'SOS chỉ được phân công cho tài khoản CSKV.');
      }

      await client.query(
        `UPDATE sos_events
         SET status = $2,
             assigned_officer_id = $3,
             acknowledged_at = CASE WHEN $2 = 'acknowledged' AND acknowledged_at IS NULL THEN now() ELSE acknowledged_at END,
             resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 = 'responding' THEN NULL ELSE resolved_at END,
             closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END,
             updated_at = now()
         WHERE id = $1`,
        [id, toStatus, assignee ?? null],
      );
      await this.recordSosChange(client, {
        id,
        from: row.status,
        to: toStatus,
        actorId,
        actorRole: actor.actor_type,
        note: note.trim(),
        publicMessage,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.hydrateSos(this.pool, id);
  }

  async listWorkflowActors(actorId: string): Promise<WorkflowActorResponse[]> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const result = await this.pool.query<ActorRow>(
      `SELECT a.id, a.actor_type, a.display_name, a.locality_id::text, l.code AS locality_code
       FROM workflow_actors a
       LEFT JOIN localities l ON l.id = a.locality_id
       WHERE a.active = true AND a.actor_type = 'officer' AND a.locality_id = $1
       ORDER BY a.display_name`,
      [actor.locality_id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      displayName: row.display_name,
      localityCode: row.locality_code,
    }));
  }

  async listOfficerNotifications(actorId: string): Promise<OfficerNotificationResponse[]> {
    const actor = await this.requireOfficer(this.pool, actorId);
    const result = await this.pool.query<{
      id: string;
      aggregate_type: 'incident' | 'sos';
      aggregate_id: string;
      event_type: string;
      message: string;
      created_at: Date | string;
      read_at: Date | string | null;
    }>(
      `SELECT id::text, aggregate_type, aggregate_id::text, event_type, message, created_at, read_at
       FROM workflow_notifications
       WHERE locality_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [actor.locality_id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      message: row.message,
      createdAt: iso(row.created_at),
      readAt: row.read_at ? iso(row.read_at) : null,
    }));
  }

  private async processOutboxBatch(limit = 100): Promise<void> {
    if (this.processingOutbox) return;
    this.processingOutbox = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<OutboxDeliveryRow>(
        `SELECT o.id::text, o.aggregate_type, o.aggregate_id::text, o.event_type, o.payload, o.attempts,
                COALESCE(i.locality_id, s.locality_id)::text AS locality_id,
                COALESCE(i.receipt_code, s.receipt_code) AS receipt_code
         FROM workflow_outbox o
         LEFT JOIN incident_reports i ON o.aggregate_type = 'incident' AND i.id = o.aggregate_id
         LEFT JOIN sos_events s ON o.aggregate_type = 'sos' AND s.id = o.aggregate_id
         WHERE o.processed_at IS NULL AND o.dead_lettered_at IS NULL AND o.available_at <= now()
           AND COALESCE(i.locality_id, s.locality_id) IS NOT NULL
         ORDER BY o.id
         LIMIT $1
         FOR UPDATE OF o SKIP LOCKED`,
        [limit],
      );
      for (const event of pending.rows) {
        await client.query('SAVEPOINT deliver_event');
        try {
          const status = String(event.payload.status ?? event.event_type.split('.').at(-1) ?? 'updated');
          const subject = event.aggregate_type === 'sos' ? 'SOS' : 'Phản ánh';
          const message = event.event_type.endsWith('.citizen_safe')
            ? `${subject} ${event.receipt_code}: người gửi báo đã an toàn, cần cán bộ xác minh trước khi đóng.`
            : `${subject} ${event.receipt_code} đã chuyển sang trạng thái ${status}.`;
          await client.query(
            `INSERT INTO workflow_notifications
               (outbox_id, locality_id, aggregate_type, aggregate_id, event_type, message, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (outbox_id) DO NOTHING`,
            [event.id, event.locality_id, event.aggregate_type, event.aggregate_id, event.event_type, message, event.payload],
          );
          await client.query(
            `UPDATE workflow_outbox
             SET processed_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = $1`,
            [event.id],
          );
          await client.query('RELEASE SAVEPOINT deliver_event');
        } catch (deliveryError) {
          await client.query('ROLLBACK TO SAVEPOINT deliver_event');
          const errorMessage = deliveryError instanceof Error ? deliveryError.message.slice(0, 1_000) : 'Unknown delivery error';
          await client.query(
            `UPDATE workflow_outbox
             SET attempts = attempts + 1,
                 last_error = $2,
                 available_at = now() + make_interval(secs => LEAST(300, power(2, attempts + 1)::integer)),
                 dead_lettered_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE NULL END
             WHERE id = $1`,
            [event.id, errorMessage],
          );
          await client.query('RELEASE SAVEPOINT deliver_event');
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      this.processingOutbox = false;
    }
  }

  private async resolveLocation(client: PoolClient, latitude: number, longitude: number): Promise<ResolvedLocationRow> {
    const result = await client.query<ResolvedLocationRow>(
      `WITH locality_matches AS (
         SELECT l.id, l.code, l.name
         FROM localities l
         JOIN boundaries b ON b.locality_id = l.id
         WHERE l.visibility = 'public'
           AND ST_Covers(b.geom, ST_SetSRID(ST_Point($2, $1), 4326))
       ), unique_locality AS (
         SELECT * FROM locality_matches
         WHERE (SELECT count(*) FROM locality_matches) = 1
       )
       SELECT l.id::text AS locality_id, l.code AS locality_code, l.name AS locality_name,
              sa.id::text AS service_area_id, sa.code AS service_area_code, sa.name AS service_area_name,
              u.id::text AS dispatch_unit_id
       FROM unique_locality l
       LEFT JOIN LATERAL (
         WITH service_area_matches AS (
           SELECT x.id, x.code, x.name, x.display_order
           FROM service_areas x
           WHERE x.locality_id = l.id
             AND x.is_demo = false
             AND x.provenance_status IN ('manually_verified', 'official')
             AND ST_Covers(x.geom, ST_SetSRID(ST_Point($2, $1), 4326))
         )
         SELECT id, code, name FROM service_area_matches
         WHERE (SELECT count(*) FROM service_area_matches) = 1
       ) sa ON true
       LEFT JOIN LATERAL (
         SELECT p.id FROM police_units p
         WHERE p.locality_id = l.id AND p.unit_type = 'commune_police'
         ORDER BY p.created_at LIMIT 1
       ) u ON true
       LIMIT 1`,
      [latitude, longitude],
    );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('INVALID_INPUT', 'Vị trí nằm ngoài phạm vi hoặc đúng trên đường ranh chưa thể định tuyến tự động. Vui lòng chọn điểm rõ hơn.');
    return row;
  }

  private async requireOfficer(client: Pool | PoolClient, actorId: string): Promise<ActorRow> {
    const result = await client.query<ActorRow>(
      `SELECT a.id, a.actor_type, a.display_name, a.locality_id::text, l.code AS locality_code
       FROM workflow_actors a
       LEFT JOIN localities l ON l.id = a.locality_id
       WHERE a.id = $1 AND a.active = true AND a.actor_type = 'officer'`,
      [actorId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('FORBIDDEN', 'Tài khoản cán bộ local không hợp lệ.');
    if (!row.locality_id) throw new WorkflowError('FORBIDDEN', 'Tài khoản chưa được gán địa bàn.');
    return row;
  }

  private async requireIncident(id: string, citizenId: string): Promise<IncidentResponse> {
    const allowed = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE id = $1 AND citizen_external_id = $2`,
      [id, citizenId],
    );
    if (!allowed.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return this.hydrateIncident(this.pool, id, false);
  }

  private async requireSos(id: string, citizenId: string): Promise<SosResponse> {
    const allowed = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM sos_events WHERE id = $1 AND citizen_external_id = $2`,
      [id, citizenId],
    );
    if (!allowed.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS.');
    return this.hydrateSos(this.pool, id, false);
  }

  private async hydrateIncident(client: Pool | PoolClient, id: string, includeInternal = true): Promise<IncidentResponse> {
    const result = await client.query<IncidentRow>(
        `SELECT i.id::text, i.receipt_code, i.category, i.summary, i.description,
                i.location_note, i.contact_phone, i.status, i.priority,
                ST_Y(i.geom) AS latitude, ST_X(i.geom) AS longitude, i.accuracy_m,
                l.code AS locality_code, l.name AS locality_name,
                sa.code AS service_area_code, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                i.operational_mode, i.created_at, i.updated_at
         FROM incident_reports i
         JOIN localities l ON l.id = i.locality_id
         LEFT JOIN service_areas sa ON sa.id = i.service_area_id
         LEFT JOIN workflow_actors a ON a.id = i.assigned_officer_id
         WHERE i.id = $1`,
        [id],
      );
    const history = await client.query<HistoryRow<IncidentStatus>>(
        `SELECT from_status, to_status, actor_id, actor_role, note, public_message, created_at
         FROM incident_status_history
         WHERE incident_id = $1 AND ($2::boolean OR public_message = true)
         ORDER BY created_at, id`,
        [id, includeInternal],
      );
    const attachments = await client.query<IncidentAttachmentRow>(
      `SELECT id::text, file_name, mime_type, size_bytes, sha256, created_at, uploader_role, purpose
       FROM incident_attachments WHERE incident_id = $1 ORDER BY created_at, id`,
      [id],
    );
    const ratings = await client.query<{ id: string; score: number; comment: string | null; created_at: Date | string }>(
      `SELECT id::text, score, comment, created_at FROM satisfaction_ratings WHERE incident_id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return {
      kind: 'incident',
      id: row.id,
      receiptCode: row.receipt_code,
      category: row.category,
      summary: row.summary,
      description: row.description,
      locationNote: row.location_note,
      contactPhone: row.contact_phone,
      status: row.status,
      priority: row.priority,
      location: mapLocation(row),
      assignedOfficer: row.assigned_officer_id && row.assigned_officer_name
        ? { id: row.assigned_officer_id, displayName: row.assigned_officer_name }
        : null,
      operationalMode: row.operational_mode,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      history: history.rows.map(mapHistory),
      attachments: attachments.rows.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        sizeBytes: attachment.size_bytes,
        sha256: attachment.sha256,
        createdAt: iso(attachment.created_at),
        uploaderRole: attachment.uploader_role,
        purpose: attachment.purpose,
      })),
      satisfactionRating: ratings.rows[0] ? {
        id: ratings.rows[0].id,
        receiptCode: row.receipt_code,
        score: ratings.rows[0].score,
        comment: ratings.rows[0].comment,
        createdAt: iso(ratings.rows[0].created_at),
      } : null,
    };
  }

  private async hydrateSos(client: Pool | PoolClient, id: string, includeInternal = true): Promise<SosResponse> {
    const result = await client.query<SosRow>(
        `SELECT s.id::text, s.receipt_code, s.category, s.note, s.contact_phone, s.status,
                ST_Y(s.geom) AS latitude, ST_X(s.geom) AS longitude, s.accuracy_m,
                l.code AS locality_code, l.name AS locality_name,
                sa.code AS service_area_code, sa.name AS service_area_name,
                a.id AS assigned_officer_id, a.display_name AS assigned_officer_name,
                s.operational_mode, s.acknowledged_at, s.created_at, s.updated_at
         FROM sos_events s
         JOIN localities l ON l.id = s.locality_id
         LEFT JOIN service_areas sa ON sa.id = s.service_area_id
         LEFT JOIN workflow_actors a ON a.id = s.assigned_officer_id
         WHERE s.id = $1`,
        [id],
      );
    const history = await client.query<HistoryRow<SosStatus>>(
        `SELECT from_status, to_status, actor_id, actor_role, note, public_message, created_at
         FROM sos_status_history
         WHERE sos_event_id = $1 AND ($2::boolean OR public_message = true)
         ORDER BY created_at, id`,
        [id, includeInternal],
      );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS.');
    return {
      kind: 'sos',
      id: row.id,
      receiptCode: row.receipt_code,
      category: row.category,
      note: row.note,
      contactPhone: row.contact_phone,
      status: row.status,
      location: mapLocation(row),
      assignedOfficer: row.assigned_officer_id && row.assigned_officer_name
        ? { id: row.assigned_officer_id, displayName: row.assigned_officer_name }
        : null,
      operationalMode: row.operational_mode,
      acknowledgedAt: row.acknowledged_at ? iso(row.acknowledged_at) : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      history: history.rows.map(mapHistory),
    };
  }

  private async recordIncidentChange(client: PoolClient, change: {
    id: string;
    from: IncidentStatus | null;
    to: IncidentStatus;
    actorId: string;
    actorRole: string;
    note: string;
    publicMessage?: boolean;
  }): Promise<void> {
    const publicMessage = change.publicMessage ?? ['citizen', 'system'].includes(change.actorRole);
    await client.query(
      `INSERT INTO incident_status_history
         (incident_id, from_status, to_status, actor_id, actor_role, note, public_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [change.id, change.from, change.to, change.actorId, change.actorRole, change.note, publicMessage],
    );
    await client.query(
      `INSERT INTO workflow_audit_events
         (aggregate_type, aggregate_id, action, actor_id, actor_role, before_data, after_data)
       VALUES ('incident', $1, 'status_changed', $2, $3, jsonb_build_object('status', $4::text), jsonb_build_object('status', $5::text))`,
      [change.id, change.actorId, change.actorRole, change.from, change.to],
    );
    await client.query(
      `INSERT INTO workflow_outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('incident', $1, $2, jsonb_build_object('status', $3::text, 'actorId', $4::text, 'publicMessage', $5::boolean))`,
      [change.id, `incident.${change.to}`, change.to, change.actorId, publicMessage],
    );
  }

  private async recordSosChange(client: PoolClient, change: {
    id: string;
    from: SosStatus | null;
    to: SosStatus;
    actorId: string;
    actorRole: string;
    note: string;
    publicMessage?: boolean;
    /** Overrides the outbox/audit event name for notes that do not change the status (e.g. citizen_safe). */
    eventType?: string;
  }): Promise<void> {
    const publicMessage = change.publicMessage ?? ['citizen', 'system'].includes(change.actorRole);
    await client.query(
      `INSERT INTO sos_status_history
         (sos_event_id, from_status, to_status, actor_id, actor_role, note, public_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [change.id, change.from, change.to, change.actorId, change.actorRole, change.note, publicMessage],
    );
    await client.query(
      `INSERT INTO workflow_audit_events
         (aggregate_type, aggregate_id, action, actor_id, actor_role, before_data, after_data)
       VALUES ('sos', $1, $6, $2, $3, jsonb_build_object('status', $4::text), jsonb_build_object('status', $5::text))`,
      [change.id, change.actorId, change.actorRole, change.from, change.to, change.eventType ?? 'status_changed'],
    );
    await client.query(
      `INSERT INTO workflow_outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('sos', $1, $2, jsonb_build_object('status', $3::text, 'actorId', $4::text, 'publicMessage', $5::boolean))`,
      [change.id, `sos.${change.eventType ?? change.to}`, change.to, change.actorId, publicMessage],
    );
  }
}
