import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  DUPLICATE_LIKELY_SCORE,
  DUPLICATE_RADIUS_M,
  DUPLICATE_WINDOW_HOURS,
  rankDuplicates,
  type DuplicateCaseInput,
} from './incident-intelligence.js';
import type {
  AppRatingResponse,
  CaseRef,
  DuplicateCandidateResponse,
  IncidentAiReviewResponse,
  IncidentResponse,
  IncidentSuggestion,
  OfficerKpiResponse,
  SatisfactionRatingResponse,
} from './types.js';
import { WorkflowError } from './workflow.js';

interface ActorRow extends QueryResultRow {
  id: string;
  actor_type: 'officer' | 'supervisor';
  locality_id: string;
}

interface CaseRow extends QueryResultRow {
  id: string;
  receipt_code: string;
  category: string;
  summary: string;
  description: string;
  status: string;
  created_at: Date | string;
  duplicate_of_id: string | null;
  duplicate_of_receipt: string | null;
  distance_m?: number | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCase(row: CaseRow): DuplicateCaseInput {
  return {
    id: row.id, receiptCode: row.receipt_code, category: row.category, summary: row.summary,
    description: row.description, status: row.status, createdAt: iso(row.created_at),
    duplicateOf: row.duplicate_of_id && row.duplicate_of_receipt ? { id: row.duplicate_of_id, receiptCode: row.duplicate_of_receipt } : null,
  };
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

const caseColumns = `i.id::text, i.receipt_code, i.category, i.summary, i.description, i.status, i.created_at,
  i.duplicate_of_id::text, p.receipt_code AS duplicate_of_receipt`;

/** Nhóm phản ánh trùng, gợi ý AI, đánh giá SOS/ứng dụng và bộ chỉ số mục 9.2 trên PostgreSQL. */
export class IntelligenceStore {
  constructor(private readonly pool: Pool) {}

  async findDuplicates(actorId: string, incidentId: string): Promise<DuplicateCandidateResponse[]> {
    const actor = await this.requireActor(this.pool, actorId);
    const target = await this.loadCase(this.pool, incidentId, actor.locality_id);
    return rankDuplicates(toCase(target), await this.candidates(this.pool, incidentId));
  }

  async setDuplicateOf(actorId: string, incidentId: string, primaryId: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await this.requireActor(client, actorId);
      const target = await this.loadCase(client, incidentId, actor.locality_id, true);
      if (primaryId === null) {
        if (!target.duplicate_of_id) throw new WorkflowError('INVALID_INPUT', 'Phản ánh này chưa được gộp vào hồ sơ nào.');
        await client.query(`UPDATE incident_reports SET duplicate_of_id=NULL, duplicate_linked_at=NULL, updated_at=now() WHERE id=$1`, [incidentId]);
        await this.audit(client, incidentId, 'duplicate_unlinked', actor.id, actor.actor_type, { duplicateOf: target.duplicate_of_id }, { duplicateOf: null });
      } else {
        if (primaryId === incidentId) throw new WorkflowError('INVALID_INPUT', 'Không thể gộp phản ánh vào chính nó.');
        const primary = await this.loadCase(client, primaryId, actor.locality_id, true);
        if (primary.duplicate_of_id) {
          throw new WorkflowError('INVALID_INPUT', `Hồ sơ ${primary.receipt_code} đã được gộp vào ${primary.duplicate_of_receipt ?? 'hồ sơ khác'}. Hãy gộp vào hồ sơ chính đó.`);
        }
        const children = await client.query(`SELECT 1 FROM incident_reports WHERE duplicate_of_id=$1 LIMIT 1`, [incidentId]);
        if (children.rows[0]) {
          throw new WorkflowError('INVALID_INPUT', 'Phản ánh này đang là hồ sơ chính của phản ánh khác. Hãy gộp các phản ánh kia vào hồ sơ mới trước.');
        }
        await client.query(
          `UPDATE incident_reports SET duplicate_of_id=$2, duplicate_linked_at=now(), suggested_duplicate_of_id=NULL,
             suggested_duplicate_score=NULL, updated_at=now() WHERE id=$1`,
          [incidentId, primaryId],
        );
        await this.audit(client, incidentId, 'duplicate_linked', actor.id, actor.actor_type, { duplicateOf: target.duplicate_of_id }, { duplicateOf: primaryId });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async refreshSuggestion(incidentId: string): Promise<void> {
    const ranked = rankDuplicates(toCase(await this.loadCase(this.pool, incidentId, null)), await this.candidates(this.pool, incidentId));
    const best = ranked.find((item) => item.level === 'likely');
    // Gợi ý luôn trỏ về hồ sơ chính để các phản ánh trùng gom về một mối.
    const target = best ? best.duplicateOf ?? { id: best.id, receiptCode: best.receiptCode } : null;
    await this.pool.query(
      `UPDATE incident_reports SET suggested_duplicate_of_id=$2, suggested_duplicate_score=$3 WHERE id=$1 AND duplicate_of_id IS NULL`,
      [incidentId, target?.id ?? null, best?.score ?? null],
    );
  }

  /** Gắn mã hồ sơ chính (đã gộp) hoặc mã hồ sơ gợi ý trùng vào hàng đợi cán bộ, một truy vấn cho cả danh sách. */
  async decorateQueue<T extends { kind: 'incident' | 'sos'; id: string }>(items: T[]): Promise<Array<T & { duplicateOfReceiptCode: string | null; suggestedDuplicateReceiptCode: string | null }>> {
    const ids = items.filter((item) => item.kind === 'incident').map((item) => item.id);
    if (!ids.length) return items.map((item) => ({ ...item, duplicateOfReceiptCode: null, suggestedDuplicateReceiptCode: null }));
    const result = await this.pool.query<{ id: string; primary_receipt: string | null; suggested_receipt: string | null }>(
      `SELECT i.id::text, p.receipt_code AS primary_receipt, CASE WHEN i.duplicate_of_id IS NULL THEN s.receipt_code END AS suggested_receipt
       FROM incident_reports i
       LEFT JOIN incident_reports p ON p.id = i.duplicate_of_id
       LEFT JOIN incident_reports s ON s.id = i.suggested_duplicate_of_id
       WHERE i.id = ANY($1::uuid[]) AND (i.duplicate_of_id IS NOT NULL OR i.suggested_duplicate_of_id IS NOT NULL)`,
      [ids],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return items.map((item) => {
      const row = item.kind === 'incident' ? byId.get(item.id) : undefined;
      return { ...item, duplicateOfReceiptCode: row?.primary_receipt ?? null, suggestedDuplicateReceiptCode: row?.suggested_receipt ?? null };
    });
  }

  /** Bổ sung thông tin gộp trùng vào hồ sơ cán bộ. */
  async decorateIncident(incident: IncidentResponse): Promise<IncidentResponse> {
    const result = await this.pool.query<{
      duplicate_of_id: string | null; duplicate_of_receipt: string | null;
      suggested_id: string | null; suggested_receipt: string | null; suggested_score: string | number | null;
      children: CaseRef[] | null;
    }>(
      `SELECT i.duplicate_of_id::text, p.receipt_code AS duplicate_of_receipt,
              i.suggested_duplicate_of_id::text AS suggested_id, s.receipt_code AS suggested_receipt,
              i.suggested_duplicate_score AS suggested_score,
              (SELECT json_agg(json_build_object('id', c.id::text, 'receiptCode', c.receipt_code) ORDER BY c.created_at)
                 FROM incident_reports c WHERE c.duplicate_of_id = i.id) AS children
       FROM incident_reports i
       LEFT JOIN incident_reports p ON p.id = i.duplicate_of_id
       LEFT JOIN incident_reports s ON s.id = i.suggested_duplicate_of_id
       WHERE i.id = $1`,
      [incident.id],
    );
    const row = result.rows[0];
    if (!row) return incident;
    return {
      ...incident,
      duplicateOf: row.duplicate_of_id && row.duplicate_of_receipt ? { id: row.duplicate_of_id, receiptCode: row.duplicate_of_receipt } : null,
      suggestedDuplicateOf: !row.duplicate_of_id && row.suggested_id && row.suggested_receipt
        ? { id: row.suggested_id, receiptCode: row.suggested_receipt, score: Number(row.suggested_score ?? 0) } : null,
      duplicates: row.children ?? [],
    };
  }

  async saveAiReview(actorId: string, incidentId: string, suggestion: IncidentSuggestion): Promise<IncidentAiReviewResponse> {
    const actor = await this.requireActor(this.pool, actorId);
    const target = await this.loadCase(this.pool, incidentId, actor.locality_id);
    const result = await this.pool.query(
      `INSERT INTO incident_ai_reviews
         (id, incident_id, requested_by, provider, model, original_category, suggested_category, confidence, reason, image_findings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING *`,
      [randomUUID(), incidentId, actor.id, suggestion.provider, suggestion.model, target.category, suggestion.suggestedCategory,
        suggestion.confidence, suggestion.reason, JSON.stringify(suggestion.imageFindings)],
    );
    return this.mapReview(result.rows[0]);
  }

  async latestAiReview(actorId: string, incidentId: string): Promise<IncidentAiReviewResponse | null> {
    const actor = await this.requireActor(this.pool, actorId);
    await this.loadCase(this.pool, incidentId, actor.locality_id);
    const result = await this.pool.query(
      `SELECT * FROM incident_ai_reviews WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 1`, [incidentId],
    );
    return result.rows[0] ? this.mapReview(result.rows[0]) : null;
  }

  async decideCategory(actorId: string, incidentId: string, category: IncidentResponse['category'], reviewId: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await this.requireActor(client, actorId);
      const target = await this.loadCase(client, incidentId, actor.locality_id, true);
      if (['closed', 'rejected'].includes(target.status)) throw new WorkflowError('INVALID_TRANSITION', 'Hồ sơ đã đóng, không đổi lĩnh vực được nữa.');
      if (reviewId) {
        const review = await client.query<{ suggested_category: string; original_category: string; decision: string | null }>(
          `SELECT suggested_category, original_category, decision FROM incident_ai_reviews WHERE id=$1 AND incident_id=$2 FOR UPDATE`,
          [reviewId, incidentId],
        );
        const row = review.rows[0];
        if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy gợi ý AI của hồ sơ này.');
        const decision = category === row.suggested_category ? 'accepted' : category === row.original_category ? 'kept' : 'changed';
        await client.query(
          `UPDATE incident_ai_reviews SET decision=$2, decided_category=$3, decided_by=$4, decided_at=now() WHERE id=$1`,
          [reviewId, decision, category, actor.id],
        );
      }
      if (category !== target.category) {
        await client.query(`UPDATE incident_reports SET category=$2, updated_at=now() WHERE id=$1`, [incidentId, category]);
        await this.audit(client, incidentId, 'category_changed', actor.id, actor.actor_type, { category: target.category }, { category, aiReviewId: reviewId });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAppRating(citizenId: string): Promise<AppRatingResponse | null> {
    const result = await this.pool.query(`SELECT score, comment, created_at, updated_at FROM app_ratings WHERE citizen_external_id=$1`, [citizenId]);
    const row = result.rows[0];
    return row ? { score: row.score, comment: row.comment, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null;
  }

  async saveAppRating(citizenId: string, score: number, comment: string | null): Promise<AppRatingResponse> {
    const result = await this.pool.query(
      `INSERT INTO app_ratings (citizen_external_id, score, comment) VALUES ($1,$2,$3)
       ON CONFLICT (citizen_external_id) DO UPDATE SET score=EXCLUDED.score, comment=EXCLUDED.comment, updated_at=now()
       RETURNING score, comment, created_at, updated_at`,
      [citizenId, score, comment],
    );
    const row = result.rows[0];
    return { score: row.score, comment: row.comment, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  }

  async createSosRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    const sos = await this.pool.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM sos_events WHERE citizen_external_id=$1 AND receipt_code=$2`, [citizenId, receiptCode],
    );
    const row = sos.rows[0];
    if (!row) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS thuộc tài khoản này.');
    if (!['resolved', 'closed'].includes(row.status)) throw new WorkflowError('INVALID_TRANSITION', 'Chỉ đánh giá sau khi cán bộ đã xử lý xong SOS.');
    const result = await this.pool.query(
      `INSERT INTO sos_ratings (id, sos_event_id, citizen_external_id, score, comment) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (sos_event_id) DO UPDATE SET score=EXCLUDED.score, comment=EXCLUDED.comment, created_at=now()
       RETURNING id::text, score, comment, created_at`,
      [randomUUID(), row.id, citizenId, score, comment],
    );
    const rating = result.rows[0];
    await this.pool.query(`UPDATE sos_events SET updated_at=now() WHERE id=$1`, [row.id]);
    return { id: rating.id, receiptCode, score: rating.score, comment: rating.comment, createdAt: iso(rating.created_at) };
  }

  /** Gắn đánh giá vào danh sách SOS của người dân (một truy vấn cho cả danh sách). */
  async attachSosRatings<T extends { id: string; receiptCode: string; satisfactionRating?: SatisfactionRatingResponse | null }>(items: T[]): Promise<T[]> {
    if (!items.length) return items;
    const result = await this.pool.query(
      `SELECT sos_event_id::text, id::text, score, comment, created_at FROM sos_ratings WHERE sos_event_id = ANY($1::uuid[])`,
      [items.map((item) => item.id)],
    );
    const byId = new Map(result.rows.map((row) => [row.sos_event_id as string, row]));
    return items.map((item) => {
      const row = byId.get(item.id);
      return { ...item, satisfactionRating: row ? { id: row.id, receiptCode: item.receiptCode, score: row.score, comment: row.comment, createdAt: iso(row.created_at) } : null };
    });
  }

  /** Bộ chỉ số mục 9.2 cho địa bàn của cán bộ trong khoảng [from, to). */
  async kpis(actorId: string, from: string, to: string): Promise<OfficerKpiResponse> {
    const actor = await this.requireActor(this.pool, actorId);
    const result = await this.pool.query(
      `WITH inc AS (
         SELECT i.id, i.created_at, i.duplicate_of_id FROM incident_reports i
         WHERE i.locality_id=$1 AND i.created_at>=$2 AND i.created_at<$3
       ), first_response AS (
         SELECT inc.id, min(h.created_at) AS first_at FROM inc
         JOIN incident_status_history h ON h.incident_id=inc.id AND h.actor_role IN ('officer','supervisor')
         GROUP BY inc.id
       ), sos AS (
         SELECT s.id, s.created_at, s.acknowledged_at FROM sos_events s
         WHERE s.locality_id=$1 AND s.created_at>=$2 AND s.created_at<$3 AND s.status <> 'cancelled_by_citizen'
       ), reviews AS (
         SELECT r.decision FROM incident_ai_reviews r JOIN incident_reports i ON i.id=r.incident_id
         WHERE i.locality_id=$1 AND r.created_at>=$2 AND r.created_at<$3
       )
       SELECT
         (SELECT count(*) FROM citizen_accounts)::int AS citizen_accounts,
         (SELECT count(*) FROM citizen_accounts WHERE created_at>=$2 AND created_at<$3)::int AS new_citizen_accounts,
         (SELECT count(*) FROM push_devices WHERE $4 = ANY(area_codes))::int AS push_devices,
         (SELECT round(avg(extract(epoch FROM (f.first_at - inc.created_at))/60)::numeric, 1) FROM inc JOIN first_response f ON f.id=inc.id) AS incident_first_response,
         (SELECT round(avg(extract(epoch FROM (acknowledged_at - created_at))/60)::numeric, 1) FROM sos WHERE acknowledged_at IS NOT NULL) AS sos_acknowledge,
         (SELECT count(*) FROM inc)::int AS incident_count,
         (SELECT count(*) FROM sos)::int AS sos_count,
         (SELECT count(*) FROM first_response)::int AS incident_responded,
         (SELECT count(*) FROM sos WHERE acknowledged_at IS NOT NULL)::int AS sos_responded,
         (SELECT count(*) FROM inc WHERE duplicate_of_id IS NOT NULL)::int AS duplicate_linked,
         (SELECT count(*) FROM reviews)::int AS ai_reviews,
         (SELECT count(*) FROM reviews WHERE decision IS NOT NULL)::int AS ai_decided,
         (SELECT count(*) FROM reviews WHERE decision='accepted')::int AS ai_accepted,
         (SELECT round(avg(r.score)::numeric,1) FROM satisfaction_ratings r JOIN incident_reports i ON i.id=r.incident_id
            WHERE i.locality_id=$1 AND r.created_at>=$2 AND r.created_at<$3) AS incident_rating,
         (SELECT count(*) FROM satisfaction_ratings r JOIN incident_reports i ON i.id=r.incident_id
            WHERE i.locality_id=$1 AND r.created_at>=$2 AND r.created_at<$3)::int AS incident_rating_count,
         (SELECT round(avg(r.score)::numeric,1) FROM sos_ratings r JOIN sos_events s ON s.id=r.sos_event_id
            WHERE s.locality_id=$1 AND r.created_at>=$2 AND r.created_at<$3) AS sos_rating,
         (SELECT count(*) FROM sos_ratings r JOIN sos_events s ON s.id=r.sos_event_id
            WHERE s.locality_id=$1 AND r.created_at>=$2 AND r.created_at<$3)::int AS sos_rating_count,
         (SELECT round(avg(score)::numeric,1) FROM app_ratings) AS app_rating,
         (SELECT count(*) FROM app_ratings)::int AS app_rating_count`,
      [actor.locality_id, from, to, await this.localityCode(actor.locality_id)],
    );
    const row = result.rows[0];
    const total = row.incident_count + row.sos_count;
    return {
      reach: { citizenAccounts: row.citizen_accounts, newCitizenAccounts: row.new_citizen_accounts, pushDevices: row.push_devices },
      response: {
        incidentFirstResponseMinutes: numberOrNull(row.incident_first_response),
        sosAcknowledgeMinutes: numberOrNull(row.sos_acknowledge),
        respondedRate: ratio(row.incident_responded + row.sos_responded, total),
      },
      dataQuality: {
        duplicateLinked: row.duplicate_linked,
        duplicateRate: ratio(row.duplicate_linked, row.incident_count),
        vneidConnected: false,
        vneidVerifiedRate: null,
      },
      ai: { reviews: row.ai_reviews, decided: row.ai_decided, accepted: row.ai_accepted, accuracy: ratio(row.ai_accepted, row.ai_decided) },
      satisfaction: {
        incidentAverage: numberOrNull(row.incident_rating), incidentCount: row.incident_rating_count,
        sosAverage: numberOrNull(row.sos_rating), sosCount: row.sos_rating_count,
        appAverage: numberOrNull(row.app_rating), appCount: row.app_rating_count,
      },
    };
  }

  private async localityCode(localityId: string): Promise<string> {
    const result = await this.pool.query<{ code: string }>(`SELECT code FROM localities WHERE id=$1`, [localityId]);
    return result.rows[0]?.code ?? '';
  }

  private async candidates(client: Pool | PoolClient, incidentId: string): Promise<Array<{ item: DuplicateCaseInput; distanceM: number }>> {
    const result = await client.query<CaseRow>(
      `SELECT ${caseColumns}, ST_Distance(i.geom::geography, t.geom::geography) AS distance_m
       FROM incident_reports t
       JOIN incident_reports i ON i.locality_id = t.locality_id AND i.id <> t.id
       LEFT JOIN incident_reports p ON p.id = i.duplicate_of_id
       WHERE t.id = $1 AND i.status <> 'rejected'
         AND i.created_at BETWEEN t.created_at - make_interval(hours => $2) AND t.created_at + make_interval(hours => $2)
         AND ST_DWithin(i.geom::geography, t.geom::geography, $3)
       ORDER BY distance_m LIMIT 50`,
      [incidentId, DUPLICATE_WINDOW_HOURS, DUPLICATE_RADIUS_M],
    );
    return result.rows.map((row) => ({ item: toCase(row), distanceM: Number(row.distance_m) }));
  }

  private async loadCase(client: Pool | PoolClient, incidentId: string, localityId: string | null, lock = false): Promise<CaseRow> {
    if (!/^[0-9a-f-]{36}$/i.test(incidentId)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    const result = await client.query<CaseRow>(
      `SELECT ${caseColumns} FROM incident_reports i LEFT JOIN incident_reports p ON p.id = i.duplicate_of_id
       WHERE i.id=$1 AND ($2::uuid IS NULL OR i.locality_id=$2)${lock ? ' FOR UPDATE OF i' : ''}`,
      [incidentId, localityId],
    );
    if (!result.rows[0]) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    return result.rows[0];
  }

  private async requireActor(client: Pool | PoolClient, actorId: string): Promise<ActorRow> {
    const result = await client.query<ActorRow>(
      `SELECT id, actor_type, locality_id::text FROM workflow_actors
       WHERE id=$1 AND active=true AND actor_type IN ('officer','supervisor') AND locality_id IS NOT NULL`, [actorId],
    );
    if (!result.rows[0]) throw new WorkflowError('FORBIDDEN', 'Tài khoản không có quyền truy cập địa bàn.');
    return result.rows[0];
  }

  private async audit(client: PoolClient, incidentId: string, action: string, actorId: string, actorRole: string, before: object, after: object): Promise<void> {
    await client.query(
      `INSERT INTO workflow_audit_events (aggregate_type, aggregate_id, action, actor_id, actor_role, before_data, after_data)
       VALUES ('incident', $1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [incidentId, action, actorId, actorRole, JSON.stringify(before), JSON.stringify(after)],
    );
  }

  private mapReview(row: QueryResultRow): IncidentAiReviewResponse {
    return {
      id: row.id, incidentId: row.incident_id, createdAt: iso(row.created_at),
      suggestedCategory: row.suggested_category, confidence: row.confidence, reason: row.reason,
      imageFindings: Array.isArray(row.image_findings) ? row.image_findings : [],
      provider: row.provider, model: row.model,
      decision: row.decision, decidedCategory: row.decided_category, decidedAt: row.decided_at ? iso(row.decided_at) : null,
    };
  }
}
