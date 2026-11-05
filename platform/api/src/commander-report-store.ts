import type { Pool, QueryResultRow } from 'pg';
import { periodBounds, previousAnchorDate } from './report-period.js';
import type {
  CommanderReportAreaRow,
  CommanderReportAttentionRow,
  CommanderReportOfficerRow,
  CommanderReportResponse,
  CommanderReportTotals,
  StatisticsPeriod,
} from './types.js';
import { WorkflowError } from './workflow.js';

const OPEN = `c.status NOT IN ('resolved','closed','rejected','cancelled_by_citizen')`;

/** Hồ sơ của phường (phản ánh + SOS, không tính SOS đã hủy) trong khoảng [kỳ trước, hết kỳ này), kèm mốc phản hồi và mốc kết thúc. */
const CASES_CTE = `cases AS (
  SELECT 'incident'::text AS kind, i.id::text AS id, i.status, i.service_area_id, i.assigned_officer_id, i.created_at,
         (SELECT min(h.created_at) FROM incident_status_history h
           WHERE h.incident_id = i.id AND h.actor_role IN ('officer','supervisor')) AS responded_at,
         CASE WHEN i.status IN ('resolved','closed') THEN COALESCE(i.resolved_at, i.closed_at, i.updated_at) END AS done_at
  FROM incident_reports i
  WHERE i.locality_id = $1 AND i.created_at >= $4 AND i.created_at < $3
  UNION ALL
  SELECT 'sos'::text, s.id::text, s.status, s.service_area_id, s.assigned_officer_id, s.created_at,
         s.acknowledged_at,
         CASE WHEN s.status IN ('resolved','closed') THEN COALESCE(s.resolved_at, s.closed_at, s.updated_at) END
  FROM sos_events s
  WHERE s.locality_id = $1 AND s.status <> 'cancelled_by_citizen' AND s.created_at >= $4 AND s.created_at < $3
)`;

const METRICS = `
  count(*) FILTER (WHERE c.kind = 'incident')::int AS incidents,
  count(*) FILTER (WHERE c.kind = 'sos')::int AS sos,
  count(*) FILTER (WHERE c.status IN ('resolved','closed'))::int AS resolved,
  count(*) FILTER (WHERE ${OPEN})::int AS open,
  count(*) FILTER (WHERE ${OPEN} AND c.created_at < now() - CASE WHEN c.kind = 'sos' THEN interval '5 minutes' ELSE interval '15 minutes' END)::int AS overdue,
  round((avg(extract(epoch FROM c.responded_at - c.created_at) / 60) FILTER (WHERE c.kind = 'incident' AND c.responded_at IS NOT NULL))::numeric, 1) AS first_response,
  round((avg(extract(epoch FROM c.responded_at - c.created_at) / 60) FILTER (WHERE c.kind = 'sos' AND c.responded_at IS NOT NULL))::numeric, 1) AS sos_ack,
  round((avg(extract(epoch FROM c.done_at - c.created_at) / 60) FILTER (WHERE c.done_at IS NOT NULL))::numeric, 0) AS resolution,
  count(*) FILTER (WHERE c.responded_at IS NOT NULL)::int AS responded,
  count(*) FILTER (WHERE c.kind = 'sos' AND c.responded_at IS NULL AND ${OPEN})::int AS sos_unack,
  count(*) FILTER (WHERE c.kind = 'sos' AND c.status = 'escalated')::int AS sos_escalated,
  count(*) FILTER (WHERE c.kind IS NOT NULL AND c.service_area_id IS NULL)::int AS unrouted`;

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function average(total: number, count: number): number | null {
  return count > 0 ? Math.round((total / count) * 10) / 10 : null;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
}

interface RatingSum { total: number; count: number; low: number }

function emptyTotals(): CommanderReportTotals {
  return {
    incidents: 0, sos: 0, resolved: 0, open: 0, overdue: 0, firstResponseMinutes: null, sosAcknowledgeMinutes: null,
    resolutionMinutes: null, respondedRate: null, sosUnacknowledged: 0, sosEscalated: 0, unrouted: 0, averageRating: null, ratingCount: 0,
  };
}

function totalsOf(row: QueryResultRow | undefined, rating: RatingSum | undefined): CommanderReportTotals {
  if (!row) return { ...emptyTotals(), averageRating: rating ? average(rating.total, rating.count) : null, ratingCount: rating?.count ?? 0 };
  return {
    incidents: row.incidents, sos: row.sos, resolved: row.resolved, open: row.open, overdue: row.overdue,
    firstResponseMinutes: numberOrNull(row.first_response), sosAcknowledgeMinutes: numberOrNull(row.sos_ack),
    resolutionMinutes: numberOrNull(row.resolution), respondedRate: ratio(row.responded, row.incidents + row.sos),
    sosUnacknowledged: row.sos_unack, sosEscalated: row.sos_escalated, unrouted: row.unrouted,
    averageRating: rating ? average(rating.total, rating.count) : null, ratingCount: rating?.count ?? 0,
  };
}

function addRating(map: Map<string, RatingSum>, key: string, row: QueryResultRow): void {
  const entry = map.get(key) ?? { total: 0, count: 0, low: 0 };
  entry.total += Number(row.total);
  entry.count += Number(row.n);
  entry.low += Number(row.low);
  map.set(key, entry);
}

/** Báo cáo thống kê chi tiết của chỉ huy: tổng quan so với kỳ trước, theo khu vực, theo cán bộ, giờ cao điểm và hồ sơ chờ quá hạn. */
export class CommanderReportStore {
  constructor(private readonly pool: Pool) {}

  private async requireCommanderLocality(actorId: string): Promise<string> {
    const result = await this.pool.query<{ actor_type: string; locality_id: string }>(
      `SELECT actor_type, locality_id::text FROM workflow_actors
       WHERE id = $1 AND active = true AND actor_type IN ('officer', 'supervisor') AND locality_id IS NOT NULL`, [actorId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('FORBIDDEN', 'Tài khoản không có quyền truy cập địa bàn.');
    if (row.actor_type !== 'supervisor') throw new WorkflowError('FORBIDDEN', 'Chỉ chỉ huy mới xem được báo cáo chi tiết.');
    return row.locality_id;
  }

  async report(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<CommanderReportResponse> {
    const localityId = await this.requireCommanderLocality(actorId);
    const { from, to } = periodBounds(period, anchorDate);
    const previous = periodBounds(period, previousAnchorDate(period, anchorDate));
    const params = [localityId, from, to, previous.from];

    const [overall, ratings, areaRows, officerRows, timeRows, attentionRows] = await Promise.all([
      this.pool.query(`WITH ${CASES_CTE} SELECT (c.created_at >= $2) AS is_current, ${METRICS} FROM cases c GROUP BY 1`, params),
      this.pool.query(
        `WITH r AS (
           SELECT r.score::int AS score, r.created_at, i.service_area_id, i.assigned_officer_id
           FROM satisfaction_ratings r JOIN incident_reports i ON i.id = r.incident_id
           WHERE i.locality_id = $1 AND r.created_at >= $4 AND r.created_at < $3
           UNION ALL
           SELECT r.score::int, r.created_at, s.service_area_id, s.assigned_officer_id
           FROM sos_ratings r JOIN sos_events s ON s.id = r.sos_event_id
           WHERE s.locality_id = $1 AND r.created_at >= $4 AND r.created_at < $3
         )
         SELECT (created_at >= $2) AS is_current, service_area_id::text AS area_id, assigned_officer_id AS officer_id,
                count(*)::int AS n, sum(score)::int AS total, count(*) FILTER (WHERE score <= 2)::int AS low
         FROM r GROUP BY 1, 2, 3`, params,
      ),
      this.pool.query(
        `WITH ${CASES_CTE}
         SELECT sa.id::text AS area_id, sa.code, sa.name, ${METRICS}
         FROM service_areas sa
         LEFT JOIN cases c ON c.service_area_id = sa.id AND c.created_at >= $2
         WHERE sa.locality_id = $1
         GROUP BY sa.id, sa.code, sa.name, sa.display_order
         ORDER BY sa.display_order, sa.name`, params,
      ),
      this.pool.query(
        `WITH ${CASES_CTE}
         SELECT a.id, a.display_name, sa.id::text AS area_id, sa.name AS area_name, ${METRICS}
         FROM workflow_actors a
         LEFT JOIN service_areas sa ON sa.id = a.service_area_id
         LEFT JOIN cases c ON c.assigned_officer_id = a.id AND c.created_at >= $2
         WHERE a.locality_id = $1 AND a.actor_type = 'officer' AND a.active = true
         GROUP BY a.id, a.display_name, sa.id, sa.name, sa.display_order
         ORDER BY sa.display_order NULLS LAST, a.display_name`, params,
      ),
      this.pool.query(
        `WITH ${CASES_CTE}
         SELECT extract(hour FROM c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS h,
                extract(isodow FROM c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS d,
                count(*)::int AS n
         FROM cases c WHERE c.created_at >= $2 GROUP BY 1, 2`, params,
      ),
      this.pool.query(
        `SELECT * FROM (
           SELECT 'incident'::text AS kind, i.id::text AS id, i.receipt_code, i.status, i.summary AS title,
                  sa.name AS area_name, a.display_name AS officer_name, i.created_at
           FROM incident_reports i
           LEFT JOIN service_areas sa ON sa.id = i.service_area_id
           LEFT JOIN workflow_actors a ON a.id = i.assigned_officer_id
           WHERE i.locality_id = $1 AND i.status = 'submitted' AND i.created_at < now() - interval '15 minutes'
           UNION ALL
           SELECT 'sos'::text, s.id::text, s.receipt_code, s.status, 'SOS khẩn cấp',
                  sa.name, a.display_name, s.created_at
           FROM sos_events s
           LEFT JOIN service_areas sa ON sa.id = s.service_area_id
           LEFT JOIN workflow_actors a ON a.id = s.assigned_officer_id
           WHERE s.locality_id = $1 AND s.status IN ('triggered', 'dispatched', 'escalated') AND s.created_at < now() - interval '5 minutes'
         ) waiting ORDER BY created_at LIMIT 10`, [localityId],
      ),
    ]);

    const totalRating = new Map<string, RatingSum>();
    const areaRating = new Map<string, RatingSum>();
    const officerRating = new Map<string, RatingSum>();
    for (const row of ratings.rows) {
      addRating(totalRating, row.is_current ? 'current' : 'previous', row);
      if (!row.is_current) continue;
      if (row.area_id) addRating(areaRating, row.area_id, row);
      if (row.officer_id) addRating(officerRating, row.officer_id, row);
    }

    const officersByArea = new Map<string, Array<{ id: string; displayName: string }>>();
    for (const row of officerRows.rows) {
      if (!row.area_id) continue;
      const list = officersByArea.get(row.area_id) ?? [];
      list.push({ id: row.id, displayName: row.display_name });
      officersByArea.set(row.area_id, list);
    }

    const areas: CommanderReportAreaRow[] = areaRows.rows.map((row) => ({
      code: row.code, name: row.name, officers: officersByArea.get(row.area_id) ?? [],
      incidents: row.incidents, sos: row.sos, resolved: row.resolved, open: row.open, overdue: row.overdue,
      firstResponseMinutes: numberOrNull(row.first_response), sosAcknowledgeMinutes: numberOrNull(row.sos_ack),
      resolutionMinutes: numberOrNull(row.resolution),
      averageRating: areaRating.has(row.area_id) ? average(areaRating.get(row.area_id)!.total, areaRating.get(row.area_id)!.count) : null,
      ratingCount: areaRating.get(row.area_id)?.count ?? 0, lowRatings: areaRating.get(row.area_id)?.low ?? 0,
    }));

    const officers: CommanderReportOfficerRow[] = officerRows.rows.map((row) => ({
      id: row.id, displayName: row.display_name, areaName: row.area_name ?? null,
      incidents: row.incidents, sos: row.sos, resolved: row.resolved, open: row.open, overdue: row.overdue,
      firstResponseMinutes: numberOrNull(row.first_response), resolutionMinutes: numberOrNull(row.resolution),
      averageRating: officerRating.has(row.id) ? average(officerRating.get(row.id)!.total, officerRating.get(row.id)!.count) : null,
      ratingCount: officerRating.get(row.id)?.count ?? 0, lowRatings: officerRating.get(row.id)?.low ?? 0,
    }));

    const hourly = Array.from({ length: 24 }, () => 0);
    const weekdays = Array.from({ length: 7 }, () => 0);
    for (const row of timeRows.rows) {
      if (row.h >= 0 && row.h < 24) hourly[row.h]! += row.n;
      if (row.d >= 1 && row.d <= 7) weekdays[row.d - 1]! += row.n;
    }

    const now = Date.now();
    const attention: CommanderReportAttentionRow[] = attentionRows.rows.map((row) => ({
      kind: row.kind, id: row.id, receiptCode: row.receipt_code, status: row.status, title: row.title,
      areaName: row.area_name ?? null, officerName: row.officer_name ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      ageMinutes: Math.max(0, Math.round((now - new Date(row.created_at).getTime()) / 60_000)),
    }));

    const current = overall.rows.find((row) => row.is_current);
    const before = overall.rows.find((row) => !row.is_current);
    return {
      period, anchorDate, from, to, previousFrom: previous.from, previousTo: previous.to,
      current: totalsOf(current, totalRating.get('current')),
      previous: totalsOf(before, totalRating.get('previous')),
      areas, officers, hourly, weekdays, attention,
    };
  }
}
