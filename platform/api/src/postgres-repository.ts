import { Pool } from 'pg';
import { PostgresWorkflowStore } from './postgres-workflows.js';
import { OperationalExtensionsStore } from './operational-extensions.js';
import { CitizenNotificationStore } from './citizen-notifications.js';
import { IntelligenceStore } from './intelligence-store.js';
import type {
  AppRatingResponse,
  CitizenNotificationPage,
  DuplicateCandidateResponse,
  IncidentAiReviewResponse,
  IncidentSuggestion,
  NotificationQuery,
} from './types.js';
import type {
  AreaLookupResponse,
  AreaOverview,
  AreaSummary,
  CreateIncidentInput,
  CreateSosInput,
  DirectoryEntryResponse,
  DirectoryRepository,
  HotlineResponse,
  PublicStatsResponse,
  PublicUnitContactResponse,
  IncidentAttachmentInput,
  IncidentAttachmentResponse,
  IncidentMessageResponse,
  IncidentResponse,
  OfficerNotificationResponse,
  OfficerQueueItemResponse,
  PatrolSessionResponse,
  PublicAlertResponse,
  SatisfactionRatingResponse,
  ServiceAreaResponse,
  ShiftSummaryResponse,
  OfficerArchiveQuery,
  OfficerReportCaseResponse,
  OfficerStatisticsResponse,
  OperationalMapPointInput,
  OperationalMapPointResponse,
  StatisticsPeriod,
  SosResponse,
  StationResponse,
  WorkflowActorResponse,
  CitizenAccountRecord,
  CitizenAccountEventType,
  CitizenEmailCodePurpose,
  CitizenEmailCodeRecord,
  OfficerAccountRecord,
} from './types.js';
import { WorkflowError, type IncidentStatus, type SosStatus } from './workflow.js';

interface AreaRow {
  code: string;
  name: string;
  locality_type: string | null;
  province_name: string | null;
  population: number | null;
  area_km2: string | number | null;
  density_per_km2: string | number | null;
  center_latitude: number | null;
  center_longitude: number | null;
  boundary: AreaLookupResponse['boundary'];
}

interface LookupPosition {
  latitude: number;
  longitude: number;
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class PostgresDirectoryRepository implements DirectoryRepository {
  readonly sourceName = 'postgres' as const;
  private readonly pool: Pool;
  private readonly workflows: PostgresWorkflowStore;
  private readonly operations: OperationalExtensionsStore;
  private readonly citizenNotifications: CitizenNotificationStore;
  private readonly intelligence: IntelligenceStore;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.workflows = new PostgresWorkflowStore(this.pool);
    this.operations = new OperationalExtensionsStore(this.pool);
    this.citizenNotifications = new CitizenNotificationStore(this.pool);
    this.intelligence = new IntelligenceStore(this.pool);
  }

  listCitizenNotifications(citizenId: string, query: NotificationQuery): Promise<CitizenNotificationPage> {
    return this.citizenNotifications.list(citizenId, query);
  }

  markCitizenNotificationsRead(citizenId: string, ids: string[]): Promise<number> {
    return this.citizenNotifications.markRead(citizenId, ids);
  }

  async findCitizenAccountByUsername(username: string): Promise<CitizenAccountRecord | null> {
    const result = await this.pool.query<{
      id: string; username: string; display_name: string; password_hash: string;
    }>(
      `SELECT id, username, display_name, password_hash
       FROM citizen_accounts
       WHERE username_normalized = $1 AND status = 'active'`,
      [username.toLocaleLowerCase('vi-VN')],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash } : null;
  }

  async findCitizenAccountById(id: string): Promise<CitizenAccountRecord | null> {
    const result = await this.pool.query<{
      id: string; username: string; display_name: string; password_hash: string;
    }>(
      `SELECT id, username, display_name, password_hash
       FROM citizen_accounts WHERE id = $1 AND status = 'active'`,
      [id],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash } : null;
  }

  async createCitizenAccount(input: CitizenAccountRecord): Promise<CitizenAccountRecord | null> {
    const result = await this.pool.query<{
      id: string; username: string; display_name: string; password_hash: string;
    }>(
      `INSERT INTO citizen_accounts (id, username, username_normalized, display_name, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username_normalized) DO NOTHING
       RETURNING id, username, display_name, password_hash`,
      [input.id, input.username, input.username.toLocaleLowerCase('vi-VN'), input.displayName, input.passwordHash],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash } : null;
  }

  async findOfficerAccountById(actorId: string): Promise<OfficerAccountRecord | null> {
    const result = await this.pool.query<{ actor_id: string; username: string; password_hash: string }>(
      `SELECT actor_id, username, password_hash FROM officer_accounts WHERE actor_id = $1 AND status = 'active'`, [actorId]);
    const row = result.rows[0];
    return row ? { actorId: row.actor_id, username: row.username, passwordHash: row.password_hash } : null;
  }

  async getCitizenRecoveryCodeHash(id: string): Promise<string | null> {
    const result = await this.pool.query<{ recovery_code_hash: string | null }>(
      `SELECT recovery_code_hash FROM citizen_accounts WHERE id = $1 AND status = 'active'`, [id]);
    return result.rows[0]?.recovery_code_hash ?? null;
  }

  async setCitizenRecoveryCodeHash(id: string, recoveryCodeHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE citizen_accounts SET recovery_code_hash = $2, recovery_code_created_at = now() WHERE id = $1 AND status = 'active'`,
      [id, recoveryCodeHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async resetCitizenPasswordWithRecovery(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedRecoveryCodeHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE citizen_accounts
       SET password_hash = $2, recovery_code_hash = $3, recovery_code_created_at = now(), password_changed_at = now()
       WHERE id = $1 AND status = 'active' AND recovery_code_hash = $4`,
      [id, passwordHash, newRecoveryCodeHash, expectedRecoveryCodeHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async issueCitizenAssistedResetCode(username: string, officerId: string, codeHash: string, expiresAt: string): Promise<{ id: string; displayName: string } | null> {
    const result = await this.pool.query<{ id: string; display_name: string }>(
      `UPDATE citizen_accounts
       SET assisted_reset_hash = $2, assisted_reset_expires_at = $3, assisted_reset_issued_by = $4
       WHERE username_normalized = $1 AND status = 'active'
       RETURNING id, display_name`,
      [username.toLocaleLowerCase('vi-VN'), codeHash, expiresAt, officerId]);
    const row = result.rows[0];
    return row ? { id: row.id, displayName: row.display_name } : null;
  }

  async getCitizenAssistedResetCode(id: string): Promise<{ codeHash: string; expiresAt: string } | null> {
    const result = await this.pool.query<{ assisted_reset_hash: string | null; assisted_reset_expires_at: Date | null }>(
      `SELECT assisted_reset_hash, assisted_reset_expires_at FROM citizen_accounts WHERE id = $1 AND status = 'active'`, [id]);
    const row = result.rows[0];
    return row?.assisted_reset_hash && row.assisted_reset_expires_at
      ? { codeHash: row.assisted_reset_hash, expiresAt: row.assisted_reset_expires_at.toISOString() }
      : null;
  }

  async resetCitizenPasswordWithAssistedCode(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedAssistedCodeHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE citizen_accounts
       SET password_hash = $2, recovery_code_hash = $3, recovery_code_created_at = now(), password_changed_at = now(),
           assisted_reset_hash = NULL, assisted_reset_expires_at = NULL, assisted_reset_issued_by = NULL
       WHERE id = $1 AND status = 'active' AND assisted_reset_hash = $4 AND assisted_reset_expires_at > now()`,
      [id, passwordHash, newRecoveryCodeHash, expectedAssistedCodeHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async recordCitizenAccountEvent(citizenId: string, eventType: CitizenAccountEventType, actorId: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO citizen_account_events (citizen_id, event_type, actor_id) VALUES ($1, $2, $3)`,
      [citizenId, eventType, actorId]);
  }

  async putCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, email: string, codeHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO citizen_email_codes (citizen_id, purpose, email, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, now())
       ON CONFLICT (citizen_id, purpose)
       DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
      [citizenId, purpose, email, codeHash, expiresAt]);
  }

  async getCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<CitizenEmailCodeRecord | null> {
    const result = await this.pool.query<{ email: string; code_hash: string; expires_at: Date; attempts: number }>(
      `SELECT email, code_hash, expires_at, attempts FROM citizen_email_codes WHERE citizen_id = $1 AND purpose = $2`, [citizenId, purpose]);
    const row = result.rows[0];
    return row ? { email: row.email, codeHash: row.code_hash, expiresAt: row.expires_at.toISOString(), attempts: row.attempts } : null;
  }

  async bumpCitizenEmailCodeAttempts(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<number> {
    const result = await this.pool.query<{ attempts: number }>(
      `UPDATE citizen_email_codes SET attempts = attempts + 1 WHERE citizen_id = $1 AND purpose = $2 RETURNING attempts`, [citizenId, purpose]);
    return result.rows[0]?.attempts ?? 0;
  }

  async consumeCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, expectedCodeHash: string, maxAttempts: number): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM citizen_email_codes
       WHERE citizen_id = $1 AND purpose = $2 AND code_hash = $3 AND expires_at > now() AND attempts < $4`,
      [citizenId, purpose, expectedCodeHash, maxAttempts]);
    return (result.rowCount ?? 0) > 0;
  }

  async setCitizenVerifiedEmail(citizenId: string, email: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE citizen_accounts SET email = $2, email_normalized = lower($2), email_verified_at = now() WHERE id = $1 AND status = 'active'`,
      [citizenId, email]);
    return (result.rowCount ?? 0) > 0;
  }

  async getCitizenEmail(citizenId: string): Promise<{ email: string; verified: boolean } | null> {
    const result = await this.pool.query<{ email: string | null; email_verified_at: Date | null }>(
      `SELECT email, email_verified_at FROM citizen_accounts WHERE id = $1 AND status = 'active'`, [citizenId]);
    const row = result.rows[0];
    return row?.email ? { email: row.email, verified: row.email_verified_at !== null } : null;
  }

  async updateCitizenPasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE citizen_accounts SET password_hash = $2 WHERE id = $1 AND status = 'active'`, [id, passwordHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateOfficerPasswordHash(actorId: string, passwordHash: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE officer_accounts SET password_hash = $2 WHERE actor_id = $1 AND status = 'active'`, [actorId, passwordHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async findOfficerAccountByUsername(username: string): Promise<OfficerAccountRecord | null> {
    const result = await this.pool.query<{
      actor_id: string; username: string; password_hash: string;
    }>(
      `SELECT actor_id, username, password_hash
       FROM officer_accounts
       WHERE username_normalized = $1 AND status = 'active'`,
      [username.toLocaleLowerCase('vi-VN')],
    );
    const row = result.rows[0];
    return row ? {
      actorId: row.actor_id,
      username: row.username,
      passwordHash: row.password_hash,
    } : null;
  }

  async searchAreas(query: string, limit: number): Promise<AreaSummary[]> {
    const result = await this.pool.query<{
      code: string;
      name: string;
      locality_type: string | null;
      province_name: string | null;
    }>(
      `SELECT code, name, locality_type, province_name
       FROM localities
       WHERE visibility = 'public'
         AND ($1 = '' OR unaccent(name) ILIKE '%' || unaccent($1) || '%'
              OR code ILIKE '%' || $1 || '%')
       ORDER BY name
       LIMIT $2`,
      [query.trim(), limit],
    );
    return result.rows.map((row) => ({
      code: row.code,
      name: row.name,
      localityType: row.locality_type,
      provinceName: row.province_name,
    }));
  }

  async getAreaOverview(): Promise<AreaOverview> {
    const result = await this.pool.query<AreaOverview['features'][number]>(
      `SELECT 'Feature'::text AS type, l.code AS id,
        json_build_object('code',l.code,'name',l.name,'localityType',l.locality_type,'provinceName',l.province_name) AS properties,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geom,0.0002),6)::json AS geometry
       FROM localities l JOIN boundaries b ON b.locality_id=l.id
       WHERE l.visibility='public' ORDER BY l.name, l.code`,
    );
    return { type: 'FeatureCollection', features: result.rows };
  }

  async lookupByCode(code: string): Promise<AreaLookupResponse | null> {
    const row = await this.findArea('l.code = $1', [code]);
    return row ? this.hydrate(row, null) : null;
  }

  async lookupByLocation(latitude: number, longitude: number): Promise<AreaLookupResponse | null> {
    const row = await this.findArea(
      `ST_Covers(b.geom, ST_SetSRID(ST_Point($2, $1), 4326))`,
      [latitude, longitude],
    );
    return row ? this.hydrate(row, { latitude, longitude }) : null;
  }

  async listHotlines(): Promise<HotlineResponse[]> {
    const result = await this.pool.query<{
      id: string;
      category_code: string;
      category_label: string;
      label: string;
      phone: string;
    }>(
      `SELECT h.id::text, h.category_code, c.label AS category_label, h.label, h.phone
       FROM hotlines h
       JOIN hotline_categories c ON c.code = h.category_code
       WHERE h.visibility = 'public' AND c.visibility = 'public'
       ORDER BY c.sort_order, c.label, h.label`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      categoryCode: row.category_code,
      categoryLabel: row.category_label,
      label: row.label,
      phone: row.phone,
    }));
  }

  /** Cột email_verified_at (migration 017) và bảng public_testimonials (migration 019) có thể chưa có trên máy chủ cũ: thiếu thì dùng giá trị dự phòng. */
  private statsColumns: Promise<{ emailVerified: boolean; testimonials: boolean }> | null = null;

  async getPublicStats(): Promise<PublicStatsResponse> {
    this.statsColumns ??= this.pool.query<{ email_verified: boolean; testimonials: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'citizen_accounts' AND column_name = 'email_verified_at') AS email_verified,
              to_regclass('public.public_testimonials') IS NOT NULL AS testimonials`,
    ).then((result) => ({ emailVerified: Boolean(result.rows[0]?.email_verified), testimonials: Boolean(result.rows[0]?.testimonials) }));
    const has = await this.statsColumns;
    const counts = await this.pool.query<{
      pilot_areas: number; officers: number; installs: number; verified_users: number;
      received: number; processed: number; avg_response: number | null; demo_accounts: boolean;
    }>(
      `SELECT
         (SELECT count(DISTINCT locality_id)::int FROM directory_entries
           WHERE entry_type = 'officer' AND visibility = 'public' AND source_system = 'cskv_roster') AS pilot_areas,
         (SELECT count(*)::int FROM directory_entries
           WHERE entry_type = 'officer' AND visibility = 'public' AND source_system = 'cskv_roster') AS officers,
         (SELECT count(*)::int FROM push_devices) AS installs,
         (SELECT count(*)::int FROM citizen_accounts WHERE status = 'active'${has.emailVerified ? ' AND email_verified_at IS NOT NULL' : ''}) AS verified_users,
         (SELECT count(*)::int FROM incident_reports) AS received,
         (SELECT count(*)::int FROM incident_reports WHERE status IN ('resolved', 'closed')) AS processed,
         (SELECT round(avg(extract(epoch FROM (received_at - created_at)) / 60))::int FROM incident_reports
           WHERE received_at IS NOT NULL AND received_at >= created_at) AS avg_response,
         EXISTS (SELECT 1 FROM citizen_accounts WHERE id LIKE 'demo-seed-%') AS demo_accounts`,
    );
    const row = counts.rows[0];
    const opinions = has.testimonials ? await this.pool.query<{
      id: string; author_role: 'citizen' | 'officer'; author_label: string; comment: string; score: number | null; is_demo: boolean;
    }>(
      `SELECT id::text, author_role, author_label, comment, score, is_demo
       FROM public_testimonials WHERE approved ORDER BY sort_order, created_at DESC LIMIT 3`,
    ) : { rows: [] as Array<{ id: string; author_role: 'citizen' | 'officer'; author_label: string; comment: string; score: number | null; is_demo: boolean }> };
    return {
      pilotAreas: row?.pilot_areas ?? 0,
      officers: row?.officers ?? 0,
      installs: row?.installs ?? 0,
      verifiedUsers: row?.verified_users ?? 0,
      incidentsReceived: row?.received ?? 0,
      incidentsProcessed: row?.processed ?? 0,
      avgResponseMinutes: row?.avg_response ?? null,
      opinions: opinions.rows.map((item) => ({ id: item.id, authorRole: item.author_role, authorLabel: item.author_label, comment: item.comment, score: item.score })),
      demoData: Boolean(row?.demo_accounts) || opinions.rows.some((item) => item.is_demo),
      updatedAt: new Date().toISOString(),
    };
  }

  async listUnitContacts(): Promise<PublicUnitContactResponse[]> {
    const result = await this.pool.query<PublicUnitContactResponse>(
      `SELECT d.id::text, d.display_name AS "displayName", d.rank,
              d.role_title AS "roleTitle", d.phone, d.entry_type AS "entryType",
              u.code AS "unitCode", u.name AS "unitName", s.address
       FROM directory_entries d JOIN police_units u ON u.id = d.unit_id
       LEFT JOIN stations s ON s.unit_id = u.id AND s.visibility = 'public'
       WHERE d.locality_id IS NULL AND d.visibility = 'public' AND u.visibility = 'public'
       ORDER BY u.name, d.display_name, d.id`,
    );
    return result.rows;
  }

  listPublicAlerts(areaCode?: string): Promise<PublicAlertResponse[]> {
    return this.operations.listPublicAlerts(areaCode);
  }

  async createIncident(citizenId: string, input: CreateIncidentInput): Promise<IncidentResponse> {
    const incident = await this.workflows.createIncident(citizenId, input);
    // Gợi ý trùng chỉ để cán bộ tham khảo: lỗi ở bước này không được làm hỏng việc tiếp nhận phản ánh.
    try { await this.intelligence.refreshSuggestion(incident.id); } catch { /* best effort */ }
    return incident;
  }

  listCitizenIncidents(citizenId: string): Promise<IncidentResponse[]> {
    return this.workflows.listCitizenIncidents(citizenId);
  }

  getCitizenIncident(citizenId: string, receiptCode: string): Promise<IncidentResponse | null> {
    return this.workflows.getCitizenIncident(citizenId, receiptCode);
  }

  listCitizenIncidentMessages(citizenId: string, receiptCode: string): Promise<IncidentMessageResponse[]> {
    return this.operations.listCitizenMessages(citizenId, receiptCode);
  }

  addCitizenIncidentMessage(citizenId: string, receiptCode: string, message: string): Promise<IncidentMessageResponse> {
    return this.operations.addCitizenMessage(citizenId, receiptCode, message);
  }

  addCitizenIncidentAttachment(citizenId: string, receiptCode: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    return this.operations.addCitizenAttachment(citizenId, receiptCode, input);
  }

  getCitizenIncidentAttachment(citizenId: string, receiptCode: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    return this.operations.getCitizenAttachment(citizenId, receiptCode, attachmentId);
  }

  createSatisfactionRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    return this.operations.createRating(citizenId, receiptCode, score, comment);
  }

  createSos(citizenId: string, input: CreateSosInput): Promise<SosResponse> {
    return this.workflows.createSos(citizenId, input);
  }

  async listCitizenSos(citizenId: string): Promise<SosResponse[]> {
    return this.intelligence.attachSosRatings(await this.workflows.listCitizenSos(citizenId));
  }

  async getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null> {
    const sos = await this.workflows.getCitizenSos(citizenId, receiptCode);
    return sos ? (await this.intelligence.attachSosRatings([sos]))[0]! : null;
  }

  cancelCitizenSos(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    return this.workflows.cancelCitizenSos(citizenId, receiptCode, note);
  }

  reportCitizenSosSafe(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    return this.workflows.reportCitizenSosSafe(citizenId, receiptCode, note);
  }

  withdrawCitizenIncident(citizenId: string, receiptCode: string, note: string): Promise<IncidentResponse> {
    return this.workflows.withdrawCitizenIncident(citizenId, receiptCode, note);
  }

  listDutyLocalityCodes(): Promise<string[]> {
    return this.workflows.listDutyLocalityCodes();
  }

  async listOfficerQueue(actorId: string, kind?: 'incident' | 'sos'): Promise<OfficerQueueItemResponse[]> {
    return this.intelligence.decorateQueue(await this.workflows.listOfficerQueue(actorId, kind));
  }

  async getOfficerIncident(actorId: string, id: string): Promise<IncidentResponse | null> {
    const incident = await this.workflows.getOfficerIncident(actorId, id);
    return incident ? this.intelligence.decorateIncident(incident) : null;
  }

  getOfficerSos(actorId: string, id: string): Promise<SosResponse | null> {
    return this.workflows.getOfficerSos(actorId, id);
  }

  listOfficerIncidentMessages(actorId: string, id: string): Promise<IncidentMessageResponse[]> {
    return this.operations.listOfficerMessages(actorId, id);
  }

  addOfficerIncidentMessage(actorId: string, id: string, message: string, requestMedia: boolean): Promise<IncidentMessageResponse> {
    return this.operations.addOfficerMessage(actorId, id, message, requestMedia);
  }

  addOfficerIncidentAttachment(actorId: string, id: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    return this.operations.addOfficerAttachment(actorId, id, input);
  }

  getOfficerIncidentAttachment(actorId: string, id: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    return this.operations.getOfficerAttachment(actorId, id, attachmentId);
  }

  createPublicAlert(actorId: string, input: Omit<PublicAlertResponse, 'id' | 'areaCode' | 'status' | 'createdAt'>): Promise<PublicAlertResponse> {
    return this.operations.createPublicAlert(actorId, input);
  }

  listPatrolSessions(actorId: string): Promise<PatrolSessionResponse[]> {
    return this.operations.listPatrols(actorId);
  }

  createPatrolSession(actorId: string, title: string, routeNote: string | null, scheduledAt: string): Promise<PatrolSessionResponse> {
    return this.operations.createPatrol(actorId, title, routeNote, scheduledAt);
  }

  updatePatrolSession(actorId: string, id: string, action: 'start' | 'pause' | 'resume' | 'checkin' | 'complete', latitude?: number | null, longitude?: number | null): Promise<PatrolSessionResponse> {
    return this.operations.updatePatrol(actorId, id, action, latitude, longitude);
  }

  getShiftSummary(actorId: string): Promise<ShiftSummaryResponse> {
    return this.operations.getShiftSummary(actorId);
  }

  confirmShiftReport(actorId: string, note: string | null): Promise<{ id: string; confirmedAt: string; summary: ShiftSummaryResponse }> {
    return this.operations.confirmShiftReport(actorId, note);
  }

  async listOfficerArchive(actorId: string, query: OfficerArchiveQuery): Promise<OfficerQueueItemResponse[]> {
    return this.intelligence.decorateQueue(await this.workflows.listOfficerArchive(actorId, query));
  }

  listReportCases(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerReportCaseResponse[]> {
    return this.operations.listReportCases(actorId, period, anchorDate);
  }

  async getOfficerStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse> {
    const statistics = await this.operations.getStatistics(actorId, period, anchorDate);
    return { ...statistics, kpis: await this.intelligence.kpis(actorId, statistics.from, statistics.to) };
  }

  listOperationalMapPoints(actorId: string): Promise<OperationalMapPointResponse[]> {
    return this.operations.listMapPoints(actorId);
  }

  createOperationalMapPoint(actorId: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    return this.operations.createMapPoint(actorId, input);
  }

  updateOperationalMapPoint(actorId: string, id: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    return this.operations.updateMapPoint(actorId, id, input);
  }

  deleteOperationalMapPoint(actorId: string, id: string): Promise<void> {
    return this.operations.deleteMapPoint(actorId, id);
  }

  async transitionIncident(
    actorId: string,
    id: string,
    toStatus: IncidentStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage?: boolean,
  ): Promise<IncidentResponse> {
    return this.intelligence.decorateIncident(await this.workflows.transitionIncident(actorId, id, toStatus, note, assignedOfficerId, publicMessage));
  }

  transitionSos(
    actorId: string,
    id: string,
    toStatus: SosStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage?: boolean,
  ): Promise<SosResponse> {
    return this.workflows.transitionSos(actorId, id, toStatus, note, assignedOfficerId, publicMessage);
  }

  listWorkflowActors(actorId: string): Promise<WorkflowActorResponse[]> {
    return this.workflows.listWorkflowActors(actorId);
  }

  listOfficerNotifications(actorId: string): Promise<OfficerNotificationResponse[]> {
    return this.workflows.listOfficerNotifications(actorId);
  }

  findIncidentDuplicates(actorId: string, incidentId: string): Promise<DuplicateCandidateResponse[]> {
    return this.intelligence.findDuplicates(actorId, incidentId);
  }

  async setIncidentDuplicateOf(actorId: string, incidentId: string, primaryId: string | null): Promise<IncidentResponse> {
    await this.intelligence.setDuplicateOf(actorId, incidentId, primaryId);
    return this.requireOfficerIncident(actorId, incidentId);
  }

  saveIncidentAiReview(actorId: string, incidentId: string, suggestion: IncidentSuggestion): Promise<IncidentAiReviewResponse> {
    return this.intelligence.saveAiReview(actorId, incidentId, suggestion);
  }

  getLatestIncidentAiReview(actorId: string, incidentId: string): Promise<IncidentAiReviewResponse | null> {
    return this.intelligence.latestAiReview(actorId, incidentId);
  }

  async decideIncidentCategory(actorId: string, incidentId: string, category: IncidentResponse['category'], reviewId: string | null): Promise<IncidentResponse> {
    await this.intelligence.decideCategory(actorId, incidentId, category, reviewId);
    return this.requireOfficerIncident(actorId, incidentId);
  }

  getCitizenAppRating(citizenId: string): Promise<AppRatingResponse | null> {
    return this.intelligence.getAppRating(citizenId);
  }

  saveCitizenAppRating(citizenId: string, score: number, comment: string | null): Promise<AppRatingResponse> {
    return this.intelligence.saveAppRating(citizenId, score, comment);
  }

  createSosRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    return this.intelligence.createSosRating(citizenId, receiptCode, score, comment);
  }

  private async requireOfficerIncident(actorId: string, incidentId: string): Promise<IncidentResponse> {
    const incident = await this.getOfficerIncident(actorId, incidentId);
    if (!incident) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    return incident;
  }

  async close(): Promise<void> {
    await this.workflows.close();
    await this.pool.end();
  }

  private async findArea(predicate: string, parameters: unknown[]): Promise<AreaRow | null> {
    const result = await this.pool.query<AreaRow>(
      `SELECT l.code, l.name, l.locality_type, l.province_name, l.population,
              l.area_km2, l.density_per_km2,
              ST_Y(ST_PointOnSurface(b.geom)) AS center_latitude,
              ST_X(ST_PointOnSurface(b.geom)) AS center_longitude,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geom, 0.00005), 6)::json AS boundary
       FROM localities l
       JOIN boundaries b ON b.locality_id = l.id
       WHERE l.visibility = 'public' AND ${predicate}
       ORDER BY ST_Area(b.geom::geography)
       LIMIT 1`,
      parameters,
    );
    return result.rows[0] ?? null;
  }

  private async hydrate(row: AreaRow, position: LookupPosition | null): Promise<AreaLookupResponse> {
    const [stationResult, directoryResult, serviceAreaResult] = await Promise.all([
      this.pool.query<{
        name: string;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        location_source: StationResponse['locationSource'];
      }>(
        `SELECT s.name, s.address,
                CASE WHEN s.geom IS NULL THEN NULL ELSE ST_Y(s.geom) END AS latitude,
                CASE WHEN s.geom IS NULL THEN NULL ELSE ST_X(s.geom) END AS longitude,
                s.location_source
         FROM stations s
         JOIN police_units u ON u.id = s.unit_id
         JOIN localities l ON l.id = u.locality_id
         WHERE l.code = $1 AND s.visibility = 'public'
         ORDER BY s.created_at
         LIMIT 1`,
        [row.code],
      ),
      this.pool.query<{
        id: string;
        display_name: string;
        rank: string | null;
        role_title: string | null;
        phone: string;
        entry_type: DirectoryEntryResponse['entryType'];
      }>(
        `SELECT d.id::text, d.display_name, d.rank, d.role_title, d.phone, d.entry_type
         FROM directory_entries d
         JOIN localities l ON l.id = d.locality_id
         WHERE l.code = $1 AND d.visibility = 'public'
         ORDER BY CASE WHEN d.entry_type = 'unit_contact' THEN 0 ELSE 1 END, d.display_name, d.id`,
        [row.code],
      ),
      this.pool.query<{
        code: string;
        name: string;
        legacy_ward_code: string | null;
        group_name: string | null;
        description: string | null;
        display_color: string;
        area_km2: string | number | null;
        center_latitude: number;
        center_longitude: number;
        boundary: ServiceAreaResponse['boundary'];
        selected: boolean;
        is_demo: boolean;
        provenance_status: ServiceAreaResponse['provenanceStatus'];
      }>(
        `SELECT sa.code, sa.name, sa.legacy_ward_code, sa.group_name, sa.description,
                sa.display_color, sa.area_km2,
                ST_Y(sa.label_geom) AS center_latitude,
                ST_X(sa.label_geom) AS center_longitude,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(sa.geom, 0.00003), 6)::json AS boundary,
                CASE
                  WHEN $2::double precision IS NULL OR $3::double precision IS NULL THEN false
                  ELSE ST_Covers(sa.geom, ST_SetSRID(ST_Point($3, $2), 4326))
                END AS selected,
                sa.is_demo,
                sa.provenance_status
         FROM public_service_areas sa
         WHERE sa.locality_code = $1
         ORDER BY sa.display_order, sa.name`,
        [row.code, position?.latitude ?? null, position?.longitude ?? null],
      ),
    ]);

    const stationRow = stationResult.rows[0];
    return {
      code: row.code,
      name: row.name,
      localityType: row.locality_type,
      provinceName: row.province_name,
      population: row.population,
      areaKm2: numberOrNull(row.area_km2),
      densityPerKm2: numberOrNull(row.density_per_km2),
      center: row.center_latitude === null || row.center_longitude === null
        ? null
        : { latitude: row.center_latitude, longitude: row.center_longitude },
      boundary: row.boundary,
      serviceAreas: serviceAreaResult.rows.map((serviceArea) => ({
        code: serviceArea.code,
        name: serviceArea.name,
        legacyWardCode: serviceArea.legacy_ward_code,
        groupName: serviceArea.group_name,
        description: serviceArea.description,
        displayColor: serviceArea.display_color,
        areaKm2: numberOrNull(serviceArea.area_km2),
        center: {
          latitude: serviceArea.center_latitude,
          longitude: serviceArea.center_longitude,
        },
        boundary: serviceArea.boundary,
        selected: serviceArea.selected,
        isDemo: serviceArea.is_demo,
        provenanceStatus: serviceArea.provenance_status,
      })),
      station: stationRow ? {
        name: stationRow.name,
        address: stationRow.address,
        latitude: stationRow.latitude,
        longitude: stationRow.longitude,
        locationSource: stationRow.location_source,
      } : null,
      directory: directoryResult.rows.map((entry) => ({
        id: entry.id,
        displayName: entry.display_name,
        rank: entry.rank,
        roleTitle: entry.role_title,
        phone: entry.phone,
        entryType: entry.entry_type,
      })),
    };
  }
}
