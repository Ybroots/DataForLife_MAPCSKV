import { createHash, randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import type {
  IncidentAttachmentInput,
  IncidentAttachmentResponse,
  IncidentMessageResponse,
  PatrolSessionResponse,
  PublicAlertResponse,
  SatisfactionRatingResponse,
  ShiftSummaryResponse,
  OfficerStatisticsResponse,
  OperationalMapPointInput,
  OperationalMapPointResponse,
  StatisticsPeriod,
} from './types.js';
import { WorkflowError } from './workflow.js';

interface ActorRow extends QueryResultRow {
  id: string;
  actor_type: 'officer' | 'supervisor';
  display_name: string;
  locality_id: string;
  locality_code: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class OperationalExtensionsStore {
  constructor(private readonly pool: Pool) {}

  async listPublicAlerts(areaCode: string): Promise<PublicAlertResponse[]> {
    const result = await this.pool.query(
      `SELECT a.id::text, l.code AS area_code, a.title, a.category, a.risk_level, a.summary,
              CASE WHEN a.geom IS NULL THEN NULL ELSE ST_Y(a.geom) END AS latitude,
              CASE WHEN a.geom IS NULL THEN NULL ELSE ST_X(a.geom) END AS longitude,
              a.starts_at, a.ends_at, a.status, a.created_at
       FROM public_alerts a JOIN localities l ON l.id = a.locality_id
       WHERE l.code = $1 AND a.status = 'published' AND now() BETWEEN a.starts_at AND a.ends_at
       ORDER BY CASE a.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.starts_at DESC`,
      [areaCode],
    );
    return result.rows.map(this.mapAlert);
  }

  async createPublicAlert(
    actorId: string,
    input: Omit<PublicAlertResponse, 'id' | 'areaCode' | 'status' | 'createdAt'>,
  ): Promise<PublicAlertResponse> {
    const actor = await this.requireActor(actorId);
    if (input.latitude !== null && input.longitude !== null) {
      const inside = await this.pool.query(
        `SELECT 1 FROM boundaries b WHERE b.locality_id=$1 AND ST_Covers(b.geom,ST_SetSRID(ST_Point($3,$2),4326)) LIMIT 1`,
        [actor.locality_id, input.latitude, input.longitude],
      );
      if (!inside.rows[0]) throw new WorkflowError('INVALID_INPUT', 'Vị trí cảnh báo phải nằm trong ranh địa bàn được phân quyền.');
    }
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO public_alerts (
         id, locality_id, created_by, title, category, risk_level, summary, geom, starts_at, ends_at, status
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         CASE WHEN $8::double precision IS NULL OR $9::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_Point($9, $8),4326) END,
         $10, $11, 'published'
       ) RETURNING id::text, $12::text AS area_code, title, category, risk_level, summary,
          CASE WHEN geom IS NULL THEN NULL ELSE ST_Y(geom) END AS latitude,
          CASE WHEN geom IS NULL THEN NULL ELSE ST_X(geom) END AS longitude,
          starts_at, ends_at, status, created_at`,
      [id, actor.locality_id, actor.id, input.title, input.category, input.riskLevel, input.summary,
        input.latitude, input.longitude, input.startsAt, input.endsAt, actor.locality_code],
    );
    return this.mapAlert(result.rows[0]);
  }

  async listCitizenMessages(citizenId: string, receiptCode: string): Promise<IncidentMessageResponse[]> {
    const incidentId = await this.citizenIncidentId(citizenId, receiptCode);
    return this.listMessages(incidentId);
  }

  async addCitizenMessage(citizenId: string, receiptCode: string, message: string): Promise<IncidentMessageResponse> {
    const incidentId = await this.citizenIncidentId(citizenId, receiptCode);
    const result = await this.pool.query(
      `INSERT INTO incident_messages (incident_id, author_id, author_role, message)
       VALUES ($1,$2,'citizen',$3)
       RETURNING id::text, author_role, 'Người dân'::text AS author_label, message, request_media, created_at`,
      [incidentId, citizenId, message],
    );
    await this.pool.query(
      `INSERT INTO workflow_outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('incident',$1,'incident.citizen_message',jsonb_build_object('messageId',$2::text))`,
      [incidentId, result.rows[0].id],
    );
    return this.mapMessage(result.rows[0]);
  }

  async listOfficerMessages(actorId: string, incidentId: string): Promise<IncidentMessageResponse[]> {
    const actor = await this.requireActor(actorId);
    await this.assertOfficerIncident(actor.locality_id, incidentId);
    return this.listMessages(incidentId);
  }

  async addOfficerMessage(actorId: string, incidentId: string, message: string, requestMedia: boolean): Promise<IncidentMessageResponse> {
    const actor = await this.requireActor(actorId);
    await this.assertOfficerIncident(actor.locality_id, incidentId);
    const result = await this.pool.query(
      `INSERT INTO incident_messages (incident_id, author_id, author_role, message, request_media)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id::text, author_role, $6::text AS author_label, message, request_media, created_at`,
      [incidentId, actor.id, actor.actor_type, message, requestMedia, actor.display_name],
    );
    return this.mapMessage(result.rows[0]);
  }

  async addCitizenAttachment(citizenId: string, receiptCode: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    const incidentId = await this.citizenIncidentId(citizenId, receiptCode);
    return this.insertAttachment(incidentId, input, 'citizen', 'supplemental');
  }

  async addOfficerAttachment(actorId: string, incidentId: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    const actor = await this.requireActor(actorId);
    await this.assertOfficerIncident(actor.locality_id, incidentId);
    return this.insertAttachment(incidentId, input, actor.actor_type, 'evidence');
  }

  async getCitizenAttachment(citizenId: string, receiptCode: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    const incidentId = await this.citizenIncidentId(citizenId, receiptCode);
    return this.getAttachment(incidentId, attachmentId);
  }

  async getOfficerAttachment(actorId: string, incidentId: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    const actor = await this.requireActor(actorId);
    await this.assertOfficerIncident(actor.locality_id, incidentId);
    return this.getAttachment(incidentId, attachmentId);
  }

  async createRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    const incident = await this.pool.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM incident_reports WHERE citizen_external_id=$1 AND receipt_code=$2`,
      [citizenId, receiptCode],
    );
    const row = incident.rows[0];
    if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh thuộc tài khoản này.');
    if (!['resolved', 'closed'].includes(row.status)) throw new WorkflowError('INVALID_TRANSITION', 'Chỉ đánh giá sau khi phản ánh đã có kết quả.');
    const result = await this.pool.query(
      `INSERT INTO satisfaction_ratings (id,incident_id,citizen_external_id,score,comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (incident_id) DO UPDATE SET score=EXCLUDED.score, comment=EXCLUDED.comment, created_at=now()
       RETURNING id::text, $6::text AS receipt_code, score, comment, created_at`,
      [randomUUID(), row.id, citizenId, score, comment, receiptCode],
    );
    const rating = result.rows[0];
    await this.pool.query(`UPDATE incident_reports SET updated_at=now() WHERE id=$1`, [row.id]);
    return { id: rating.id, receiptCode: rating.receipt_code, score: rating.score, comment: rating.comment, createdAt: iso(rating.created_at) };
  }

  async listPatrols(actorId: string): Promise<PatrolSessionResponse[]> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `SELECT p.id::text,p.title,p.route_note,p.officer_id,a.display_name AS officer_name,p.status,
              p.scheduled_at,p.started_at,p.ended_at,
              CASE WHEN p.last_checkin_geom IS NULL THEN NULL ELSE ST_Y(p.last_checkin_geom) END AS latitude,
              CASE WHEN p.last_checkin_geom IS NULL THEN NULL ELSE ST_X(p.last_checkin_geom) END AS longitude,
              p.last_checkin_at
       FROM patrol_sessions p JOIN workflow_actors a ON a.id=p.officer_id
       WHERE p.locality_id=$1 ORDER BY p.scheduled_at DESC LIMIT 50`,
      [actor.locality_id],
    );
    return result.rows.map(this.mapPatrol);
  }

  async createPatrol(actorId: string, title: string, routeNote: string | null, scheduledAt: string): Promise<PatrolSessionResponse> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `INSERT INTO patrol_sessions (id,locality_id,officer_id,title,route_note,scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id::text,title,route_note,officer_id,$7::text AS officer_name,status,scheduled_at,started_at,ended_at,
         NULL::double precision AS latitude,NULL::double precision AS longitude,last_checkin_at`,
      [randomUUID(), actor.locality_id, actor.id, title, routeNote, scheduledAt, actor.display_name],
    );
    return this.mapPatrol(result.rows[0]);
  }

  async updatePatrol(
    actorId: string,
    id: string,
    action: 'start' | 'pause' | 'resume' | 'checkin' | 'complete',
    latitude?: number | null,
    longitude?: number | null,
  ): Promise<PatrolSessionResponse> {
    const actor = await this.requireActor(actorId);
    const locked = await this.pool.query<{ status: PatrolSessionResponse['status']; officer_id: string }>(
      `SELECT status,officer_id FROM patrol_sessions WHERE id=$1 AND locality_id=$2`, [id, actor.locality_id],
    );
    const patrol = locked.rows[0];
    if (!patrol) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy ca tuần tra.');
    if (patrol.officer_id !== actor.id) throw new WorkflowError('FORBIDDEN', 'Chỉ CSKV phụ trách được cập nhật ca tuần tra.');
    const allowed: Record<string, string[]> = { planned: ['start'], active: ['pause', 'checkin', 'complete'], paused: ['resume', 'complete'], completed: [] };
    if (!allowed[patrol.status]?.includes(action)) throw new WorkflowError('INVALID_TRANSITION', 'Thao tác không phù hợp trạng thái ca tuần tra.');
    if (action === 'checkin' && (latitude == null || longitude == null)) throw new WorkflowError('INVALID_INPUT', 'Check-in cần tọa độ hợp lệ.');
    const nextStatus = action === 'start' || action === 'resume' || action === 'checkin' ? 'active' : action === 'pause' ? 'paused' : 'completed';
    await this.pool.query(
      `UPDATE patrol_sessions SET status=$2,
         started_at=CASE WHEN $3='start' AND started_at IS NULL THEN now() ELSE started_at END,
         ended_at=CASE WHEN $3='complete' THEN now() ELSE ended_at END,
         last_checkin_geom=CASE WHEN $3='checkin' THEN ST_SetSRID(ST_Point($5,$4),4326) ELSE last_checkin_geom END,
         last_checkin_at=CASE WHEN $3='checkin' THEN now() ELSE last_checkin_at END, updated_at=now()
       WHERE id=$1`,
      [id, nextStatus, action, latitude ?? null, longitude ?? null],
    );
    return (await this.listPatrols(actorId)).find((item) => item.id === id)!;
  }

  async getShiftSummary(actorId: string): Promise<ShiftSummaryResponse> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date,
        (SELECT count(*) FROM incident_reports WHERE locality_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS incidents_received,
        (SELECT count(*) FROM incident_reports WHERE locality_id=$1 AND status IN ('resolved','closed') AND updated_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS incidents_resolved,
        (SELECT count(*) FROM sos_events WHERE locality_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS sos_received,
        (SELECT count(*) FROM sos_events WHERE locality_id=$1 AND status IN ('resolved','closed') AND updated_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS sos_resolved,
        (SELECT count(*) FROM patrol_sessions WHERE locality_id=$1 AND status='completed' AND ended_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS patrols_completed,
        ((SELECT count(*) FROM incident_reports WHERE locality_id=$1 AND status IN ('submitted','received') AND created_at < now()-interval '15 minutes') +
         (SELECT count(*) FROM sos_events WHERE locality_id=$1 AND status IN ('triggered','dispatched','acknowledged') AND created_at < now()-interval '5 minutes'))::int AS overdue_open`,
      [actor.locality_id],
    );
    const row = result.rows[0];
    return {
      date: row.date, incidentsReceived: row.incidents_received, incidentsResolved: row.incidents_resolved,
      sosReceived: row.sos_received, sosResolved: row.sos_resolved,
      patrolsCompleted: row.patrols_completed, overdueOpen: row.overdue_open,
    };
  }

  async confirmShiftReport(actorId: string, note: string | null): Promise<{ id: string; confirmedAt: string; summary: ShiftSummaryResponse }> {
    const actor = await this.requireActor(actorId);
    const summary = await this.getShiftSummary(actorId);
    const result = await this.pool.query(
      `INSERT INTO shift_reports (id,locality_id,actor_id,shift_date,summary,note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (locality_id,actor_id,shift_date) DO UPDATE SET summary=EXCLUDED.summary,note=EXCLUDED.note,confirmed_at=now()
       RETURNING id::text,confirmed_at`,
      [randomUUID(), actor.locality_id, actor.id, summary.date, JSON.stringify(summary), note],
    );
    return { id: result.rows[0].id, confirmedAt: iso(result.rows[0].confirmed_at), summary };
  }

  async getStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse> {
    const actor = await this.requireActor(actorId);
    const unit = period === 'day' ? 'hour' : period === 'month' ? 'day' : 'month';
    const interval = period === 'day' ? '1 hour' : period === 'month' ? '1 day' : '1 month';
    const startExpression = period === 'day'
      ? `date_trunc('day', $2::date::timestamp)`
      : period === 'month'
        ? `date_trunc('month', $2::date::timestamp)`
        : `date_trunc('year', $2::date::timestamp)`;
    const endExpression = period === 'day'
      ? `${startExpression} + interval '1 day'`
      : period === 'month'
        ? `${startExpression} + interval '1 month'`
        : `${startExpression} + interval '1 year'`;
    const result = await this.pool.query(
      `WITH bounds AS (
         SELECT (${startExpression} AT TIME ZONE 'Asia/Ho_Chi_Minh') AS from_at,
                ((${endExpression}) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS to_at
       ), events AS (
         SELECT 'incident'::text AS kind, category, status, created_at, updated_at
         FROM incident_reports, bounds WHERE locality_id=$1 AND created_at>=from_at AND created_at<to_at
         UNION ALL
         SELECT 'sos'::text, category, status, created_at, updated_at
         FROM sos_events, bounds WHERE locality_id=$1 AND created_at>=from_at AND created_at<to_at
       ), buckets AS (
         SELECT generate_series((SELECT from_at FROM bounds), (SELECT to_at FROM bounds) - interval '${interval}', interval '${interval}') AS bucket
       ), trend AS (
         SELECT b.bucket,
           count(*) FILTER (WHERE e.kind='incident')::int AS incidents,
           count(*) FILTER (WHERE e.kind='sos')::int AS sos,
           count(*) FILTER (WHERE e.status IN ('resolved','closed'))::int AS resolved
         FROM buckets b LEFT JOIN events e
           ON e.created_at >= b.bucket AND e.created_at < b.bucket + interval '${interval}'
         GROUP BY b.bucket ORDER BY b.bucket
       )
       SELECT (SELECT from_at FROM bounds) AS from_at, (SELECT to_at FROM bounds) AS to_at,
         (SELECT count(*) FROM events WHERE kind='incident')::int AS incidents,
         (SELECT count(*) FROM events WHERE kind='sos')::int AS sos,
         (SELECT count(*) FROM events WHERE status IN ('resolved','closed'))::int AS resolved,
         (SELECT count(*) FROM events WHERE status NOT IN ('resolved','closed','rejected','cancelled_by_citizen'))::int AS open,
         (SELECT count(*) FROM events WHERE status NOT IN ('resolved','closed','rejected','cancelled_by_citizen')
            AND created_at < now() - CASE WHEN kind='sos' THEN interval '5 minutes' ELSE interval '15 minutes' END)::int AS overdue,
         (SELECT round(avg(extract(epoch FROM (updated_at-created_at))/60))::int FROM events WHERE status IN ('resolved','closed')) AS average_resolution_minutes,
         (SELECT round(avg(r.score)::numeric,1) FROM satisfaction_ratings r JOIN incident_reports i ON i.id=r.incident_id, bounds
            WHERE i.locality_id=$1 AND r.created_at>=from_at AND r.created_at<to_at) AS average_rating,
         (SELECT count(*) FROM satisfaction_ratings r JOIN incident_reports i ON i.id=r.incident_id, bounds
            WHERE i.locality_id=$1 AND r.created_at>=from_at AND r.created_at<to_at)::int AS rating_count,
         (SELECT json_agg(json_build_object('label',
             CASE WHEN $3='hour' THEN to_char(bucket AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:00')
                  WHEN $3='day' THEN to_char(bucket AT TIME ZONE 'Asia/Ho_Chi_Minh','DD/MM')
                  ELSE to_char(bucket AT TIME ZONE 'Asia/Ho_Chi_Minh','MM/YYYY') END,
             'incidents',incidents,'sos',sos,'resolved',resolved) ORDER BY bucket) FROM trend) AS trend,
         (SELECT COALESCE(json_agg(json_build_object('category',category,'count',count) ORDER BY count DESC),'[]'::json)
            FROM (SELECT category,count(*)::int AS count FROM events GROUP BY category) c) AS categories`,
      [actor.locality_id, anchorDate, unit],
    );
    const row = result.rows[0];
    return {
      period, anchorDate, from: iso(row.from_at), to: iso(row.to_at),
      totals: {
        incidents: row.incidents, sos: row.sos, resolved: row.resolved, open: row.open, overdue: row.overdue,
        averageResolutionMinutes: row.average_resolution_minutes === null ? null : Number(row.average_resolution_minutes),
        averageRating: row.average_rating === null ? null : Number(row.average_rating), ratingCount: row.rating_count,
      },
      trend: row.trend ?? [], categories: row.categories ?? [],
    };
  }

  async listMapPoints(actorId: string): Promise<OperationalMapPointResponse[]> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `SELECT p.id::text,l.code AS locality_code,p.name,p.point_type,p.description,p.contact_phone,p.status,p.visibility,
              ST_Y(p.geom) AS latitude,ST_X(p.geom) AS longitude,p.created_at,p.updated_at
       FROM operational_map_points p JOIN localities l ON l.id=p.locality_id
       WHERE p.locality_id=$1 ORDER BY p.status,p.point_type,p.name`, [actor.locality_id],
    );
    return result.rows.map(this.mapOperationalPoint);
  }

  async createMapPoint(actorId: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `INSERT INTO operational_map_points
       (id,locality_id,name,point_type,description,contact_phone,status,visibility,geom,created_by,updated_by)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_Point($10,$9),4326),$11,$11
       FROM boundaries b
       WHERE b.locality_id=$2 AND ST_Covers(b.geom,ST_SetSRID(ST_Point($10,$9),4326))
       RETURNING id::text,$12::text AS locality_code,name,point_type,description,contact_phone,status,visibility,
                 ST_Y(geom) AS latitude,ST_X(geom) AS longitude,created_at,updated_at`,
      [randomUUID(), actor.locality_id, input.name, input.pointType, input.description ?? null, input.contactPhone ?? null,
        input.status, input.visibility, input.latitude, input.longitude, actor.id, actor.locality_code],
    );
    if (!result.rows[0]) throw new WorkflowError('INVALID_INPUT', 'Điểm phải nằm trong ranh địa bàn được phân quyền.');
    return this.mapOperationalPoint(result.rows[0]);
  }

  async updateMapPoint(actorId: string, id: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(
      `UPDATE operational_map_points SET name=$3,point_type=$4,description=$5,contact_phone=$6,status=$7,visibility=$8,
              geom=ST_SetSRID(ST_Point($10,$9),4326),updated_by=$11,updated_at=now()
       WHERE id=$1 AND locality_id=$2
         AND EXISTS (SELECT 1 FROM boundaries b WHERE b.locality_id=$2 AND ST_Covers(b.geom,ST_SetSRID(ST_Point($10,$9),4326)))
       RETURNING id::text,$12::text AS locality_code,name,point_type,description,contact_phone,status,visibility,
                 ST_Y(geom) AS latitude,ST_X(geom) AS longitude,created_at,updated_at`,
      [id, actor.locality_id, input.name, input.pointType, input.description ?? null, input.contactPhone ?? null,
        input.status, input.visibility, input.latitude, input.longitude, actor.id, actor.locality_code],
    );
    if (!result.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy điểm bản đồ trong địa bàn.');
    return this.mapOperationalPoint(result.rows[0]);
  }

  async deleteMapPoint(actorId: string, id: string): Promise<void> {
    const actor = await this.requireActor(actorId);
    const result = await this.pool.query(`DELETE FROM operational_map_points WHERE id=$1 AND locality_id=$2`, [id, actor.locality_id]);
    if (!result.rowCount) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy điểm bản đồ trong địa bàn.');
  }

  private async requireActor(actorId: string): Promise<ActorRow> {
    const result = await this.pool.query<ActorRow>(
      `SELECT a.id,a.actor_type,a.display_name,a.locality_id::text,l.code AS locality_code
       FROM workflow_actors a JOIN localities l ON l.id=a.locality_id
       WHERE a.id=$1 AND a.active=true AND a.actor_type='officer'`, [actorId],
    );
    if (!result.rows[0]) throw new WorkflowError('FORBIDDEN', 'Tài khoản không có quyền truy cập địa bàn.');
    return result.rows[0];
  }

  private async citizenIncidentId(citizenId: string, receiptCode: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM incident_reports WHERE citizen_external_id=$1 AND receipt_code=$2`, [citizenId, receiptCode],
    );
    if (!result.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh thuộc tài khoản này.');
    return result.rows[0].id;
  }

  private async assertOfficerIncident(localityId: string, incidentId: string): Promise<void> {
    const result = await this.pool.query(`SELECT 1 FROM incident_reports WHERE id=$1 AND locality_id=$2`, [incidentId, localityId]);
    if (!result.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
  }

  private async listMessages(incidentId: string): Promise<IncidentMessageResponse[]> {
    const result = await this.pool.query(
      `SELECT m.id::text,m.author_role,
              CASE WHEN m.author_role='citizen' THEN 'Người dân' ELSE COALESCE(a.display_name,'Cán bộ xử lý') END AS author_label,
              m.message,m.request_media,m.created_at
       FROM incident_messages m LEFT JOIN workflow_actors a ON a.id=m.author_id
       WHERE m.incident_id=$1 ORDER BY m.created_at,m.id`, [incidentId],
    );
    return result.rows.map(this.mapMessage);
  }

  private async insertAttachment(
    incidentId: string,
    input: IncidentAttachmentInput,
    uploaderRole: IncidentAttachmentResponse['uploaderRole'],
    purpose: IncidentAttachmentResponse['purpose'],
  ): Promise<IncidentAttachmentResponse> {
    const id = randomUUID();
    const content = Buffer.from(input.dataBase64, 'base64');
    const result = await this.pool.query(
      `INSERT INTO incident_attachments (id,incident_id,file_name,mime_type,size_bytes,content,sha256,uploader_role,purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id::text,file_name,mime_type,size_bytes,sha256,created_at,uploader_role,purpose`,
      [id, incidentId, input.fileName, input.mimeType, input.sizeBytes, content,
        createHash('sha256').update(content).digest('hex'), uploaderRole, purpose],
    );
    return this.mapAttachment(result.rows[0]);
  }

  private async getAttachment(incidentId: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    const result = await this.pool.query<{ mime_type: string; content: Buffer }>(
      `SELECT mime_type,content FROM incident_attachments WHERE id=$1 AND incident_id=$2`, [attachmentId, incidentId],
    );
    const row = result.rows[0];
    return row ? { mimeType: row.mime_type, content: row.content } : null;
  }

  private mapAlert(row: any): PublicAlertResponse {
    return {
      id: row.id, areaCode: row.area_code, title: row.title, category: row.category,
      riskLevel: row.risk_level, summary: row.summary,
      latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
      startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), status: row.status, createdAt: iso(row.created_at),
    };
  }

  private mapMessage(row: any): IncidentMessageResponse {
    return { id: row.id, authorRole: row.author_role, authorLabel: row.author_label, message: row.message, requestMedia: row.request_media, createdAt: iso(row.created_at) };
  }

  private mapAttachment(row: any): IncidentAttachmentResponse {
    return {
      id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes),
      sha256: row.sha256, createdAt: iso(row.created_at), purpose: row.purpose, uploaderRole: row.uploader_role,
    };
  }

  private mapPatrol(row: any): PatrolSessionResponse {
    return {
      id: row.id, title: row.title, routeNote: row.route_note, officerId: row.officer_id, officerName: row.officer_name,
      status: row.status, scheduledAt: iso(row.scheduled_at), startedAt: row.started_at ? iso(row.started_at) : null,
      endedAt: row.ended_at ? iso(row.ended_at) : null,
      lastCheckin: row.latitude === null || row.longitude === null || !row.last_checkin_at
        ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude), at: iso(row.last_checkin_at) },
    };
  }

  private mapOperationalPoint(row: any): OperationalMapPointResponse {
    return {
      id: row.id, localityCode: row.locality_code, name: row.name, pointType: row.point_type,
      description: row.description, contactPhone: row.contact_phone, status: row.status, visibility: row.visibility,
      latitude: Number(row.latitude), longitude: Number(row.longitude), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    };
  }
}
