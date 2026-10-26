import { Pool } from 'pg';
import { PostgresWorkflowStore } from './postgres-workflows.js';
import { OperationalExtensionsStore } from './operational-extensions.js';
import { CitizenNotificationStore } from './citizen-notifications.js';
import type { CitizenNotificationPage, NotificationQuery } from './types.js';
import type {
  AreaLookupResponse,
  AreaOverview,
  AreaSummary,
  CreateIncidentInput,
  CreateSosInput,
  DirectoryEntryResponse,
  DirectoryRepository,
  HotlineResponse,
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
  OfficerStatisticsResponse,
  OperationalMapPointInput,
  OperationalMapPointResponse,
  StatisticsPeriod,
  SosResponse,
  StationResponse,
  WorkflowActorResponse,
  CitizenAccountRecord,
  OfficerAccountRecord,
} from './types.js';
import type { IncidentStatus, SosStatus } from './workflow.js';

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

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.workflows = new PostgresWorkflowStore(this.pool);
    this.operations = new OperationalExtensionsStore(this.pool);
    this.citizenNotifications = new CitizenNotificationStore(this.pool);
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

  listPublicAlerts(areaCode: string): Promise<PublicAlertResponse[]> {
    return this.operations.listPublicAlerts(areaCode);
  }

  createIncident(citizenId: string, input: CreateIncidentInput): Promise<IncidentResponse> {
    return this.workflows.createIncident(citizenId, input);
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

  listCitizenSos(citizenId: string): Promise<SosResponse[]> {
    return this.workflows.listCitizenSos(citizenId);
  }

  getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null> {
    return this.workflows.getCitizenSos(citizenId, receiptCode);
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

  listOfficerQueue(actorId: string, kind?: 'incident' | 'sos'): Promise<OfficerQueueItemResponse[]> {
    return this.workflows.listOfficerQueue(actorId, kind);
  }

  getOfficerIncident(actorId: string, id: string): Promise<IncidentResponse | null> {
    return this.workflows.getOfficerIncident(actorId, id);
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

  getOfficerStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse> {
    return this.operations.getStatistics(actorId, period, anchorDate);
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

  transitionIncident(
    actorId: string,
    id: string,
    toStatus: IncidentStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage?: boolean,
  ): Promise<IncidentResponse> {
    return this.workflows.transitionIncident(actorId, id, toStatus, note, assignedOfficerId, publicMessage);
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
