import { randomUUID } from 'node:crypto';
import { notificationTitle, paginateNotifications } from './citizen-notifications.js';
import type { CitizenNotification, CitizenNotificationPage, NotificationQuery } from './types.js';
import { haversineMeters, rankDuplicates, type DuplicateCaseInput } from './incident-intelligence.js';
import type {
  AppRatingResponse,
  DuplicateCandidateResponse,
  IncidentAiReviewResponse,
  IncidentSuggestion,
  OfficerKpiResponse,
  AreaLookupResponse,
  AreaOverview,
  AreaSummary,
  CreateIncidentInput,
  CreateSosInput,
  DirectoryRepository,
  HotlineResponse,
  IncidentAttachmentInput,
  IncidentAttachmentResponse,
  IncidentMessageResponse,
  IncidentResponse,
  OfficerNotificationResponse,
  OfficerQueueItemResponse,
  OfficerArchiveQuery,
  OfficerReportCaseResponse,
  OfficerStatisticsResponse,
  OperationalMapPointInput,
  OperationalMapPointResponse,
  PatrolSessionResponse,
  PublicAlertResponse,
  UpdatePublicAlertInput,
  PublicStatsResponse,
  SatisfactionRatingResponse,
  ShiftSummaryResponse,
  StatisticsPeriod,
  SosResponse,
  WorkflowActorResponse,
  AreaOfficerOverviewResponse,
  CitizenAccountRecord,
  CitizenAccountEventType,
  CitizenEmailCodePurpose,
  CitizenEmailCodeRecord,
  OfficerAccountRecord,
} from './types.js';
import { loadPilotAreaSources, PilotArea } from './fixture-pilot-areas.js';
import { assertCaseOwnership, assertIncidentTransition, assertSosTransition, COMMANDER_READ_ONLY_MESSAGE, type IncidentStatus, type SosStatus, WorkflowError } from './workflow.js';
import { sosTitle } from './sos-title.js';

const demoArea: AreaLookupResponse = {
  code: 'DEMO-DA-LAT',
  name: 'Phường Xuân Hương - Đà Lạt',
  localityType: 'Phường',
  provinceName: 'Lâm Đồng',
  population: 72_000,
  areaKm2: 31.2,
  densityPerKm2: 2307.7,
  center: { latitude: 11.944, longitude: 108.441 },
  boundary: {
    type: 'MultiPolygon',
    coordinates: [[[
      [108.414, 11.924],
      [108.466, 11.924],
      [108.466, 11.965],
      [108.414, 11.965],
      [108.414, 11.924],
    ]]],
  },
  serviceAreas: [],
  station: {
    name: 'Trụ sở Công an phường (dữ liệu minh họa)',
    address: '01 Đường Minh Họa, Lâm Đồng',
    latitude: null,
    longitude: null,
    locationSource: 'address_only',
  },
  directory: [
    {
      id: 'demo-officer-1',
      displayName: 'Cảnh sát khu vực phụ trách',
      rank: null,
      roleTitle: 'Liên hệ theo địa bàn',
      phone: '090 000 0000',
      entryType: 'officer',
    },
  ],
};

function cloneArea(): AreaLookupResponse {
  return structuredClone(demoArea);
}

function localDatePart(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).replaceAll('-', '');
}

function publicIncident(item: IncidentResponse): IncidentResponse {
  const clone = structuredClone(item);
  clone.history = clone.history.filter((entry) => entry.publicMessage);
  return clone;
}

function publicSos(item: SosResponse): SosResponse {
  const clone = structuredClone(item);
  clone.history = clone.history.filter((entry) => entry.publicMessage);
  return clone;
}

export class FixtureDirectoryRepository implements DirectoryRepository {
  readonly sourceName = 'fixture' as const;
  /** `pilotAreas`: dùng ba địa bàn trình diễn (Xuân Hương, Xuân Trường, Lâm Viên) có khu vực bên trong thay cho địa bàn minh họa đơn. */
  constructor(options: { pilotAreas?: boolean } = {}) {
    this.pilots = options.pilotAreas ? loadPilotAreaSources().map((source) => new PilotArea(source)) : [];
  }
  private readonly pilots: PilotArea[];

  async getAreaOverview(): Promise<AreaOverview> {
    if (this.pilots.length) {
      return { type: 'FeatureCollection', features: this.pilots.map((pilot) => ({ type: 'Feature' as const, id: pilot.code,
        properties: { code: pilot.code, name: pilot.name, localityType: pilot.localityType, provinceName: pilot.provinceName },
        geometry: structuredClone(pilot.boundary) })) };
    }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', id: demoArea.code,
      properties: { code: demoArea.code, name: demoArea.name, localityType: demoArea.localityType, provinceName: demoArea.provinceName },
      geometry: structuredClone(demoArea.boundary!) }] };
  }
  async listUnitContacts() { return []; }
  private readonly incidents = new Map<string, IncidentResponse & { citizenId: string; clientRequestId: string }>();
  private readonly sosEvents = new Map<string, SosResponse & { citizenId: string; idempotencyKey: string }>();
  private readonly alerts: PublicAlertResponse[] = [];
  private readonly messages = new Map<string, IncidentMessageResponse[]>();
  private readonly attachmentContent = new Map<string, { mimeType: string; content: Buffer }>();
  private readonly ratings = new Map<string, SatisfactionRatingResponse>();
  private readonly patrols = new Map<string, PatrolSessionResponse>();
  private readonly mapPoints = new Map<string, OperationalMapPointResponse>();
  private readonly citizenAccounts = new Map<string, CitizenAccountRecord>();
  private readonly citizenRecoveryHashes = new Map<string, string>();
  private readonly citizenAssistedResets = new Map<string, { codeHash: string; expiresAt: string; issuedBy: string }>();
  private readonly citizenEmails = new Map<string, { email: string; verified: boolean }>();
  private readonly citizenEmailCodes = new Map<string, CitizenEmailCodeRecord>();
  readonly citizenAccountEvents: Array<{ citizenId: string; eventType: CitizenAccountEventType; actorId: string | null; at: string }> = [];
  private readonly officerAccounts = new Map<string, OfficerAccountRecord>();

  private readonly actors: WorkflowActorResponse[] = [
    { id: 'officer-demo-xuan-huong', actorType: 'officer', displayName: 'CSKV trực địa bàn Xuân Hương', localityCode: 'DEMO-DA-LAT', serviceArea: null, phone: null, beatNote: null },
    { id: 'supervisor-demo-xuan-huong', actorType: 'supervisor', displayName: 'Chỉ huy trực Xuân Hương', localityCode: 'DEMO-DA-LAT', serviceArea: null, phone: null, beatNote: null },
  ];

  async findCitizenAccountByUsername(username: string): Promise<CitizenAccountRecord | null> {
    const normalized = username.toLocaleLowerCase('vi-VN');
    return [...this.citizenAccounts.values()].find((account) => account.username.toLocaleLowerCase('vi-VN') === normalized) ?? null;
  }

  async findCitizenAccountById(id: string): Promise<CitizenAccountRecord | null> {
    return this.citizenAccounts.get(id) ?? null;
  }

  async createCitizenAccount(input: CitizenAccountRecord): Promise<CitizenAccountRecord | null> {
    if (await this.findCitizenAccountByUsername(input.username)) return null;
    this.citizenAccounts.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async findOfficerAccountByUsername(username: string): Promise<OfficerAccountRecord | null> {
    const normalized = username.toLocaleLowerCase('vi-VN');
    return [...this.officerAccounts.values()].find((account) => account.username.toLocaleLowerCase('vi-VN') === normalized) ?? null;
  }

  async findOfficerAccountById(actorId: string): Promise<OfficerAccountRecord | null> {
    return [...this.officerAccounts.values()].find((account) => account.actorId === actorId) ?? null;
  }

  async getCitizenRecoveryCodeHash(id: string): Promise<string | null> {
    return this.citizenAccounts.has(id) ? this.citizenRecoveryHashes.get(id) ?? null : null;
  }

  async setCitizenRecoveryCodeHash(id: string, recoveryCodeHash: string): Promise<boolean> {
    if (!this.citizenAccounts.has(id)) return false;
    this.citizenRecoveryHashes.set(id, recoveryCodeHash);
    return true;
  }

  async resetCitizenPasswordWithRecovery(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedRecoveryCodeHash: string): Promise<boolean> {
    const account = this.citizenAccounts.get(id);
    if (!account || this.citizenRecoveryHashes.get(id) !== expectedRecoveryCodeHash) return false;
    this.citizenAccounts.set(id, { ...account, passwordHash });
    this.citizenRecoveryHashes.set(id, newRecoveryCodeHash);
    return true;
  }

  async issueCitizenAssistedResetCode(username: string, officerId: string, codeHash: string, expiresAt: string): Promise<{ id: string; displayName: string } | null> {
    const account = await this.findCitizenAccountByUsername(username);
    if (!account) return null;
    this.citizenAssistedResets.set(account.id, { codeHash, expiresAt, issuedBy: officerId });
    return { id: account.id, displayName: account.displayName };
  }

  async getCitizenAssistedResetCode(id: string): Promise<{ codeHash: string; expiresAt: string } | null> {
    const entry = this.citizenAssistedResets.get(id);
    return entry ? { codeHash: entry.codeHash, expiresAt: entry.expiresAt } : null;
  }

  async resetCitizenPasswordWithAssistedCode(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedAssistedCodeHash: string): Promise<boolean> {
    const account = this.citizenAccounts.get(id);
    const entry = this.citizenAssistedResets.get(id);
    if (!account || !entry || entry.codeHash !== expectedAssistedCodeHash || Date.parse(entry.expiresAt) <= Date.now()) return false;
    this.citizenAccounts.set(id, { ...account, passwordHash });
    this.citizenRecoveryHashes.set(id, newRecoveryCodeHash);
    this.citizenAssistedResets.delete(id);
    return true;
  }

  async recordCitizenAccountEvent(citizenId: string, eventType: CitizenAccountEventType, actorId: string | null): Promise<void> {
    this.citizenAccountEvents.push({ citizenId, eventType, actorId, at: new Date().toISOString() });
  }

  async putCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, email: string, codeHash: string, expiresAt: string): Promise<void> {
    this.citizenEmailCodes.set(`${citizenId}|${purpose}`, { email, codeHash, expiresAt, attempts: 0 });
  }

  async getCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<CitizenEmailCodeRecord | null> {
    const entry = this.citizenEmailCodes.get(`${citizenId}|${purpose}`);
    return entry ? { ...entry } : null;
  }

  async bumpCitizenEmailCodeAttempts(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<number> {
    const entry = this.citizenEmailCodes.get(`${citizenId}|${purpose}`);
    if (!entry) return 0;
    entry.attempts += 1;
    return entry.attempts;
  }

  async consumeCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, expectedCodeHash: string, maxAttempts: number): Promise<boolean> {
    const key = `${citizenId}|${purpose}`;
    const entry = this.citizenEmailCodes.get(key);
    if (!entry || entry.codeHash !== expectedCodeHash || Date.parse(entry.expiresAt) <= Date.now() || entry.attempts >= maxAttempts) return false;
    this.citizenEmailCodes.delete(key);
    return true;
  }

  async setCitizenVerifiedEmail(citizenId: string, email: string): Promise<boolean> {
    if (!this.citizenAccounts.has(citizenId)) return false;
    this.citizenEmails.set(citizenId, { email, verified: true });
    return true;
  }

  async getCitizenEmail(citizenId: string): Promise<{ email: string; verified: boolean } | null> {
    const entry = this.citizenEmails.get(citizenId);
    return entry ? { ...entry } : null;
  }

  async updateCitizenPasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const account = this.citizenAccounts.get(id);
    if (!account) return false;
    this.citizenAccounts.set(id, { ...account, passwordHash });
    return true;
  }

  async updateOfficerPasswordHash(actorId: string, passwordHash: string): Promise<boolean> {
    const account = [...this.officerAccounts.values()].find((candidate) => candidate.actorId === actorId);
    if (!account) return false;
    this.officerAccounts.set(account.username, { ...account, passwordHash });
    return true;
  }

  async searchAreas(query: string, limit: number): Promise<AreaSummary[]> {
    const normalized = query.trim().toLocaleLowerCase('vi');
    const candidates: AreaSummary[] = this.pilots.length
      ? this.pilots.map((pilot) => ({ code: pilot.code, name: pilot.name, localityType: pilot.localityType, provinceName: pilot.provinceName }))
      : [{ code: demoArea.code, name: demoArea.name, localityType: demoArea.localityType, provinceName: demoArea.provinceName }];
    return candidates
      .filter((area) => !normalized || area.name.toLocaleLowerCase('vi').includes(normalized) || area.code.toLocaleLowerCase('vi').includes(normalized))
      .slice(0, limit);
  }

  async lookupByCode(code: string): Promise<AreaLookupResponse | null> {
    if (this.pilots.length) return this.pilots.find((pilot) => pilot.code === code)?.lookup() ?? null;
    return code === demoArea.code ? cloneArea() : null;
  }

  async lookupByLocation(latitude: number, longitude: number): Promise<AreaLookupResponse | null> {
    if (this.pilots.length) return this.pilots.find((pilot) => pilot.contains(latitude, longitude))?.lookup({ latitude, longitude }) ?? null;
    return latitude >= 11.924 && latitude <= 11.965 && longitude >= 108.414 && longitude <= 108.466
      ? cloneArea()
      : null;
  }

  async getPublicStats(): Promise<PublicStatsResponse> {
    const all = [...this.incidents.values()];
    return {
      pilotAreas: 0, officers: 0, installs: 0, verifiedUsers: 0,
      incidentsReceived: all.length,
      incidentsProcessed: all.filter((item) => item.status === 'resolved' || item.status === 'closed').length,
      avgResponseMinutes: null, opinions: [], demoData: false, updatedAt: new Date().toISOString(),
    };
  }

  async listHotlines(): Promise<HotlineResponse[]> {
    return [{
      id: 'demo-hotline-1',
      categoryCode: 'DEMO',
      categoryLabel: 'Đầu mối khẩn cấp',
      label: 'Đầu mối trực địa bàn - dữ liệu minh họa',
      phone: '090 000 0000',
    }];
  }

  async listPublicAlerts(areaCode?: string): Promise<PublicAlertResponse[]> {
    return structuredClone(this.alerts.filter((item) => (areaCode === undefined || item.areaCode === areaCode) && item.status === 'published').slice(0, 200));
  }

  async createIncident(citizenId: string, input: CreateIncidentInput): Promise<IncidentResponse> {
    const repeated = [...this.incidents.values()].find(
      (item) => item.citizenId === citizenId && item.clientRequestId === input.clientRequestId,
    );
    if (repeated) return publicIncident(repeated);
    this.assertDemoLocation(input.latitude, input.longitude);
    const id = randomUUID();
    const now = new Date().toISOString();
    const item: IncidentResponse & { citizenId: string; clientRequestId: string } = {
      kind: 'incident',
      id,
      receiptCode: `PA-${new Date().getUTCFullYear()}-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      citizenId,
      clientRequestId: input.clientRequestId,
      category: input.category,
      summary: input.summary,
      description: input.description,
      locationNote: input.locationNote ?? null,
      contactPhone: input.contactPhone ?? null,
      status: 'submitted',
      priority: input.category === 'security' ? 'high' : 'normal',
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM: input.accuracyM ?? null,
        localityCode: this.localityAt(input.latitude, input.longitude).code,
        localityName: this.localityAt(input.latitude, input.longitude).name,
        serviceAreaCode: null,
        serviceAreaName: null,
        routingStatus: 'locality_dispatch',
      },
      assignedOfficer: null,
      operationalMode: 'local_sandbox',
      createdAt: now,
      updatedAt: now,
      history: [{
        fromStatus: null,
        toStatus: 'submitted',
        actorId: citizenId,
        actorRole: 'citizen',
        note: 'Người dân đã gửi phản ánh và nhận mã tiếp nhận.',
        publicMessage: true,
        createdAt: now,
      }],
      attachments: input.attachments.map((attachment) => ({
        id: randomUUID(),
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sha256: 'fixture-not-persisted',
        createdAt: now,
        purpose: 'initial' as const,
        uploaderRole: 'citizen' as const,
      })),
    };
    item.attachments.forEach((attachment, index) => {
      this.attachmentContent.set(attachment.id, {
        mimeType: attachment.mimeType,
        content: Buffer.from(input.attachments[index]?.dataBase64 ?? '', 'base64'),
      });
    });
    this.incidents.set(id, item);
    this.refreshDuplicateSuggestion(id);
    return publicIncident(item);
  }

  async listCitizenIncidents(citizenId: string): Promise<IncidentResponse[]> {
    return [...this.incidents.values()]
      .filter((item) => item.citizenId === citizenId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicIncident);
  }

  async getCitizenIncident(citizenId: string, receiptCode: string): Promise<IncidentResponse | null> {
    const item = [...this.incidents.values()].find(
      (candidate) => candidate.citizenId === citizenId && candidate.receiptCode === receiptCode,
    );
    return item ? publicIncident(item) : null;
  }

  async listCitizenIncidentMessages(citizenId: string, receiptCode: string): Promise<IncidentMessageResponse[]> {
    const item = this.findCitizenIncident(citizenId, receiptCode);
    return structuredClone(this.messages.get(item.id) ?? []);
  }

  async addCitizenIncidentMessage(citizenId: string, receiptCode: string, message: string): Promise<IncidentMessageResponse> {
    const item = this.findCitizenIncident(citizenId, receiptCode);
    return this.addMessage(item.id, 'citizen', 'Người dân', message, false);
  }

  async addCitizenIncidentAttachment(citizenId: string, receiptCode: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    const item = this.findCitizenIncident(citizenId, receiptCode);
    return this.addAttachment(item, input, 'citizen', 'supplemental');
  }

  async getCitizenIncidentAttachment(citizenId: string, receiptCode: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    const item = this.findCitizenIncident(citizenId, receiptCode);
    if (!item.attachments.some((entry) => entry.id === attachmentId)) return null;
    return this.attachmentContent.get(attachmentId) ?? null;
  }

  async createSatisfactionRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    const item = this.findCitizenIncident(citizenId, receiptCode);
    if (!['resolved', 'closed'].includes(item.status)) throw new WorkflowError('INVALID_TRANSITION', 'Chỉ đánh giá sau khi phản ánh đã có kết quả.');
    const key = `${citizenId}:${item.id}`;
    const rating = { id: this.ratings.get(key)?.id ?? randomUUID(), receiptCode, score, comment, createdAt: new Date().toISOString() };
    this.ratings.set(key, rating);
    return structuredClone(rating);
  }

  async createSos(citizenId: string, input: CreateSosInput): Promise<SosResponse> {
    const repeated = [...this.sosEvents.values()].find(
      (item) => item.citizenId === citizenId && item.idempotencyKey === input.idempotencyKey,
    );
    if (repeated) return publicSos(repeated);
    this.assertDemoLocation(input.latitude, input.longitude);
    const id = randomUUID();
    const now = new Date().toISOString();
    const item: SosResponse & { citizenId: string; idempotencyKey: string } = {
      kind: 'sos',
      id,
      receiptCode: `SOS-${localDatePart(new Date(now))}-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      citizenId,
      idempotencyKey: input.idempotencyKey,
      category: input.category,
      note: input.note ?? null,
      contactPhone: input.contactPhone ?? null,
      status: 'dispatched',
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM: input.accuracyM ?? null,
        localityCode: this.localityAt(input.latitude, input.longitude).code,
        localityName: this.localityAt(input.latitude, input.longitude).name,
        serviceAreaCode: null,
        serviceAreaName: null,
        routingStatus: 'locality_dispatch',
      },
      assignedOfficer: null,
      operationalMode: 'local_sandbox',
      acknowledgedAt: null,
      createdAt: now,
      updatedAt: now,
      history: [
        { fromStatus: null, toStatus: 'triggered', actorId: citizenId, actorRole: 'citizen', note: 'Thiết bị đã tạo yêu cầu SOS trong môi trường local.', publicMessage: true, createdAt: now },
        { fromStatus: 'triggered', toStatus: 'dispatched', actorId: 'workflow-router', actorRole: 'system', note: 'Đã đưa vào hàng đợi trực ban theo địa bàn. Chưa kết nối tổng đài khẩn cấp chính thức.', publicMessage: true, createdAt: now },
      ],
    };
    this.sosEvents.set(id, item);
    return publicSos(item);
  }

  async listCitizenSos(citizenId: string): Promise<SosResponse[]> {
    return [...this.sosEvents.values()]
      .filter((item) => item.citizenId === citizenId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.withSosRating(publicSos(item)));
  }

  async getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null> {
    const item = [...this.sosEvents.values()].find((entry) => entry.citizenId === citizenId && entry.receiptCode === receiptCode);
    return item ? this.withSosRating(publicSos(item)) : null;
  }

  async cancelCitizenSos(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    const item = [...this.sosEvents.values()].find(
      (candidate) => candidate.citizenId === citizenId && candidate.receiptCode === receiptCode,
    );
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS này.');
    assertSosTransition(item.status, 'cancelled_by_citizen');
    this.pushSosHistory(item, 'cancelled_by_citizen', citizenId, 'citizen', note);
    return publicSos(item);
  }

  async reportCitizenSosSafe(citizenId: string, receiptCode: string, note: string): Promise<SosResponse> {
    const item = [...this.sosEvents.values()].find(
      (candidate) => candidate.citizenId === citizenId && candidate.receiptCode === receiptCode,
    );
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS này.');
    if (!['dispatched', 'acknowledged', 'responding', 'escalated'].includes(item.status)) {
      throw new WorkflowError('INVALID_TRANSITION', 'Chỉ báo an toàn được khi yêu cầu SOS đang được xử lý.');
    }
    const already = item.history.some((entry) => entry.actorRole === 'citizen' && entry.fromStatus === entry.toStatus);
    if (!already) {
      const now = new Date().toISOString();
      item.updatedAt = now;
      item.history.push({ fromStatus: item.status, toStatus: item.status, actorId: citizenId, actorRole: 'citizen', note, publicMessage: true, createdAt: now });
    }
    return publicSos(item);
  }

  async withdrawCitizenIncident(citizenId: string, receiptCode: string, note: string): Promise<IncidentResponse> {
    const item = [...this.incidents.values()].find(
      (candidate) => candidate.citizenId === citizenId && candidate.receiptCode === receiptCode,
    );
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    if (!['submitted', 'received'].includes(item.status)) {
      throw new WorkflowError('INVALID_TRANSITION', 'Phản ánh đã được phân công xử lý, không thể tự rút. Hãy nhắn cho cán bộ phụ trách.');
    }
    assertIncidentTransition(item.status, 'closed');
    this.pushIncidentHistory(item, 'closed', citizenId, 'citizen', note, true);
    return publicIncident(item);
  }

  async listDutyLocalityCodes(): Promise<string[]> {
    return ['DEMO-DA-LAT'];
  }

  async listOfficerQueue(actorId: string, kind?: 'incident' | 'sos'): Promise<OfficerQueueItemResponse[]> {
    this.requireActor(actorId, true);
    const sos: OfficerQueueItemResponse[] = [...this.sosEvents.values()]
      .filter((item) => !['closed', 'cancelled_by_citizen'].includes(item.status))
      .map((item) => ({
        kind: 'sos', id: item.id, receiptCode: item.receiptCode, category: item.category,
        title: sosTitle(null, item.contactPhone), status: item.status, priority: 'critical',
        localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, reporterName: null, reporterPhone: item.contactPhone,
        assignedOfficer: item.assignedOfficer, createdAt: item.createdAt, updatedAt: item.updatedAt,
      }));
    const incidents: OfficerQueueItemResponse[] = [...this.incidents.values()]
      .filter((item) => !['closed', 'rejected'].includes(item.status))
      .map((item) => ({
        kind: 'incident', id: item.id, receiptCode: item.receiptCode, category: item.category,
        title: item.summary, status: item.status, priority: item.priority,
        localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, assignedOfficer: item.assignedOfficer,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
        duplicateOfReceiptCode: this.incidents.get(this.duplicateLinks.get(item.id) ?? '')?.receiptCode ?? null,
        suggestedDuplicateReceiptCode: this.duplicateLinks.has(item.id) ? null
          : this.incidents.get(this.suggestedDuplicates.get(item.id)?.id ?? '')?.receiptCode ?? null,
      }));
    const statusOrder: Record<string, number> = {
      triggered: 0, dispatched: 0, escalated: 1, acknowledged: 2, responding: 3, resolved: 4,
    };
    return [...sos, ...incidents]
      .filter((item) => !kind || item.kind === kind)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'sos' ? -1 : 1;
        const statusDifference = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
        return statusDifference || a.createdAt.localeCompare(b.createdAt);
      });
  }

  async getOfficerIncident(actorId: string, id: string): Promise<IncidentResponse | null> {
    this.requireActor(actorId, true);
    const item = this.incidents.get(id);
    if (!item) return null;
    const clone = structuredClone(item);
    clone.satisfactionRating = structuredClone(this.ratings.get(`${item.citizenId}:${item.id}`) ?? null);
    return this.withDuplicateInfo(clone);
  }

  async getOfficerSos(actorId: string, id: string): Promise<SosResponse | null> {
    this.requireActor(actorId, true);
    const item = this.sosEvents.get(id);
    return item ? structuredClone(item) : null;
  }

  async listOfficerIncidentMessages(actorId: string, id: string): Promise<IncidentMessageResponse[]> {
    this.requireActor(actorId, true);
    if (!this.incidents.has(id)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return structuredClone(this.messages.get(id) ?? []);
  }

  async addOfficerIncidentMessage(actorId: string, id: string, message: string, requestMedia: boolean): Promise<IncidentMessageResponse> {
    const actor = this.requireActor(actorId);
    if (!this.incidents.has(id)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return this.addMessage(id, actor.actorType, actor.displayName, message, requestMedia);
  }

  async addOfficerIncidentAttachment(actorId: string, id: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse> {
    const actor = this.requireActor(actorId);
    const item = this.incidents.get(id);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return this.addAttachment(item, input, actor.actorType, 'evidence');
  }

  async getOfficerIncidentAttachment(actorId: string, id: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null> {
    this.requireActor(actorId, true);
    const item = this.incidents.get(id);
    if (!item?.attachments.some((entry) => entry.id === attachmentId)) return null;
    return this.attachmentContent.get(attachmentId) ?? null;
  }

  async createPublicAlert(actorId: string, input: Omit<PublicAlertResponse, 'id' | 'areaCode' | 'status' | 'createdAt'>): Promise<PublicAlertResponse> {
    const actor = this.requireActor(actorId);
    const alert: PublicAlertResponse = { ...input, id: randomUUID(), areaCode: actor.localityCode ?? demoArea.code, status: 'published', createdAt: new Date().toISOString() };
    this.alerts.unshift(alert);
    return structuredClone(alert);
  }

  async updatePublicAlert(actorId: string, id: string, input: UpdatePublicAlertInput): Promise<PublicAlertResponse> {
    const actor = this.requireActor(actorId);
    const alert = this.alerts.find((item) => item.id === id && item.status === 'published' && item.areaCode === (actor.localityCode ?? demoArea.code));
    if (!alert) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy cảnh báo đang hiển thị.');
    const startsAt = input.startsAt ?? alert.startsAt;
    const endsAt = input.endsAt ?? alert.endsAt;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new WorkflowError('INVALID_INPUT', 'Thời gian kết thúc phải sau thời gian bắt đầu.');
    Object.assign(alert, {
      title: input.title ?? alert.title, summary: input.summary ?? alert.summary, category: input.category ?? alert.category,
      riskLevel: input.riskLevel ?? alert.riskLevel, startsAt, endsAt,
      latitude: input.latitude ?? alert.latitude, longitude: input.longitude ?? alert.longitude,
    });
    return structuredClone(alert);
  }

  async cancelPublicAlert(actorId: string, id: string): Promise<void> {
    const actor = this.requireActor(actorId);
    const alert = this.alerts.find((item) => item.id === id && item.status === 'published' && item.areaCode === (actor.localityCode ?? demoArea.code));
    if (!alert) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy cảnh báo đang hiển thị.');
    alert.status = 'cancelled';
  }

  async listPatrolSessions(actorId: string): Promise<PatrolSessionResponse[]> {
    this.requireActor(actorId, true);
    return structuredClone([...this.patrols.values()]);
  }

  async createPatrolSession(actorId: string, title: string, routeNote: string | null, scheduledAt: string): Promise<PatrolSessionResponse> {
    const actor = this.requireActor(actorId);
    const patrol: PatrolSessionResponse = { id: randomUUID(), title, routeNote, officerId: actor.id, officerName: actor.displayName, status: 'planned', scheduledAt, startedAt: null, endedAt: null, lastCheckin: null };
    this.patrols.set(patrol.id, patrol);
    return structuredClone(patrol);
  }

  async updatePatrolSession(actorId: string, id: string, action: 'start' | 'pause' | 'resume' | 'checkin' | 'complete', latitude?: number | null, longitude?: number | null): Promise<PatrolSessionResponse> {
    this.requireActor(actorId);
    const patrol = this.patrols.get(id);
    if (!patrol) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy lịch tuần tra.');
    const now = new Date().toISOString();
    if (action === 'start') { patrol.status = 'active'; patrol.startedAt = now; }
    if (action === 'pause') patrol.status = 'paused';
    if (action === 'resume') patrol.status = 'active';
    if (action === 'complete') { patrol.status = 'completed'; patrol.endedAt = now; }
    if (action === 'checkin') {
      if (latitude == null || longitude == null) throw new WorkflowError('INVALID_INPUT', 'Thiếu tọa độ check-in.');
      patrol.lastCheckin = { latitude, longitude, at: now };
    }
    return structuredClone(patrol);
  }

  async getShiftSummary(actorId: string): Promise<ShiftSummaryResponse> {
    this.requireActor(actorId, true);
    return this.fixtureShiftSummary();
  }

  async confirmShiftReport(actorId: string, _note: string | null): Promise<{ id: string; confirmedAt: string; summary: ShiftSummaryResponse }> {
    this.requireActor(actorId);
    return { id: randomUUID(), confirmedAt: new Date().toISOString(), summary: this.fixtureShiftSummary() };
  }

  async listOfficerArchive(actorId: string, query: OfficerArchiveQuery): Promise<OfficerQueueItemResponse[]> {
    this.requireActor(actorId, true);
    const needle = query.q?.toLocaleLowerCase('vi-VN');
    const dateOf = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
    const rows: OfficerQueueItemResponse[] = [
      ...[...this.sosEvents.values()].filter((item) => ['closed', 'cancelled_by_citizen'].includes(item.status)).map((item): OfficerQueueItemResponse => ({
        kind: 'sos', id: item.id, receiptCode: item.receiptCode, category: item.category, title: sosTitle(null, item.contactPhone),
        status: item.status, priority: 'critical', localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, assignedOfficer: item.assignedOfficer, createdAt: item.createdAt, updatedAt: item.updatedAt,
      })),
      ...[...this.incidents.values()].filter((item) => ['closed', 'rejected'].includes(item.status)).map((item): OfficerQueueItemResponse => ({
        kind: 'incident', id: item.id, receiptCode: item.receiptCode, category: item.category, title: item.summary,
        status: item.status, priority: item.priority, localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, assignedOfficer: item.assignedOfficer, createdAt: item.createdAt, updatedAt: item.updatedAt,
      })),
    ];
    return rows
      .filter((item) => !query.kind || item.kind === query.kind)
      .filter((item) => !needle || item.receiptCode.toLocaleLowerCase('vi-VN').includes(needle) || item.title.toLocaleLowerCase('vi-VN').includes(needle))
      .filter((item) => !query.from || dateOf(item.updatedAt) >= query.from)
      .filter((item) => !query.to || dateOf(item.updatedAt) <= query.to)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 200);
  }

  async listReportCases(actorId: string, _period: StatisticsPeriod, _anchorDate: string): Promise<OfficerReportCaseResponse[]> {
    this.requireActor(actorId, true);
    const minutes = (from: string, to: string | null) => to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000)) : null;
    const finished = (status: string, updatedAt: string) => ['resolved', 'closed'].includes(status) ? updatedAt : null;
    return [
      ...[...this.incidents.values()].map((item): OfficerReportCaseResponse => ({
        kind: 'incident', receiptCode: item.receiptCode, category: item.category, title: item.summary, status: item.status, priority: item.priority,
        serviceAreaName: item.location.serviceAreaName, assignedOfficerName: item.assignedOfficer?.displayName ?? null,
        createdAt: item.createdAt, resolvedAt: finished(item.status, item.updatedAt), closedAt: item.status === 'closed' ? item.updatedAt : null,
        resolutionMinutes: minutes(item.createdAt, finished(item.status, item.updatedAt)), ratingScore: item.satisfactionRating?.score ?? null,
      })),
      ...[...this.sosEvents.values()].map((item): OfficerReportCaseResponse => ({
        kind: 'sos', receiptCode: item.receiptCode, category: item.category, title: sosTitle(null, item.contactPhone), status: item.status, priority: 'critical',
        serviceAreaName: item.location.serviceAreaName, assignedOfficerName: item.assignedOfficer?.displayName ?? null,
        createdAt: item.createdAt, resolvedAt: finished(item.status, item.updatedAt), closedAt: item.status === 'closed' ? item.updatedAt : null,
        resolutionMinutes: minutes(item.createdAt, finished(item.status, item.updatedAt)), ratingScore: null,
      })),
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async getOfficerStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse> {
    this.requireActor(actorId, true);
    const incidents = [...this.incidents.values()];
    const sos = [...this.sosEvents.values()];
    const resolved = [...incidents, ...sos].filter((item) => ['resolved', 'closed'].includes(item.status)).length;
    return {
      period, anchorDate, from: new Date(`${anchorDate}T00:00:00+07:00`).toISOString(), to: new Date().toISOString(),
      totals: { incidents: incidents.length, sos: sos.length, resolved, open: incidents.length + sos.length - resolved, overdue: 0, averageResolutionMinutes: null, averageRating: null, ratingCount: this.ratings.size },
      trend: [{ label: anchorDate, incidents: incidents.length, sos: sos.length, resolved }],
      categories: [],
      kpis: this.fixtureKpis(incidents, sos),
    };
  }

  async listOperationalMapPoints(actorId: string): Promise<OperationalMapPointResponse[]> {
    this.requireActor(actorId, true); return structuredClone([...this.mapPoints.values()]);
  }

  async createOperationalMapPoint(actorId: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    const actor = this.requireActor(actorId); const now = new Date().toISOString();
    const item: OperationalMapPointResponse = {
      ...input, description: input.description ?? null, contactPhone: input.contactPhone ?? null,
      id: randomUUID(), localityCode: actor.localityCode ?? demoArea.code, createdAt: now, updatedAt: now,
    };
    this.mapPoints.set(item.id, item); return structuredClone(item);
  }

  async updateOperationalMapPoint(actorId: string, id: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse> {
    this.requireActor(actorId); const previous = this.mapPoints.get(id);
    if (!previous) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy điểm bản đồ trong địa bàn.');
    const item = { ...previous, ...input, updatedAt: new Date().toISOString() };
    this.mapPoints.set(id, item); return structuredClone(item);
  }

  async deleteOperationalMapPoint(actorId: string, id: string): Promise<void> {
    this.requireActor(actorId); if (!this.mapPoints.delete(id)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy điểm bản đồ trong địa bàn.');
  }

  async transitionIncident(
    actorId: string,
    id: string,
    toStatus: IncidentStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage = false,
  ): Promise<IncidentResponse> {
    const actor = this.requireActor(actorId);
    const item = this.incidents.get(id);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    assertIncidentTransition(item.status, toStatus);
    assertCaseOwnership(actor.id, item.assignedOfficer?.id, assignedOfficerId, 'hồ sơ');
    const assigneeId = assignedOfficerId ?? (toStatus === 'assigned' ? actorId : item.assignedOfficer?.id);
    if (assigneeId) {
      const assignee = this.requireActor(assigneeId);
      if (assignee.actorType !== 'officer') throw new WorkflowError('INVALID_TRANSITION', 'Hồ sơ chỉ được phân công cho tài khoản CSKV.');
      item.assignedOfficer = { id: assignee.id, displayName: assignee.displayName };
    }
    this.pushIncidentHistory(item, toStatus, actorId, actor.actorType, note, publicMessage);
    return this.withDuplicateInfo(structuredClone(item));
  }

  async transitionSos(
    actorId: string,
    id: string,
    toStatus: SosStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage = false,
  ): Promise<SosResponse> {
    const actor = this.requireActor(actorId);
    const item = this.sosEvents.get(id);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS.');
    assertSosTransition(item.status, toStatus);
    assertCaseOwnership(actor.id, item.assignedOfficer?.id, assignedOfficerId, 'SOS');
    const assigneeId = assignedOfficerId ?? (['acknowledged', 'responding'].includes(toStatus) ? actorId : item.assignedOfficer?.id);
    if (assigneeId) {
      const assignee = this.requireActor(assigneeId);
      if (assignee.actorType !== 'officer') throw new WorkflowError('INVALID_TRANSITION', 'SOS chỉ được phân công cho tài khoản CSKV.');
      item.assignedOfficer = { id: assignee.id, displayName: assignee.displayName };
    }
    this.pushSosHistory(item, toStatus, actorId, actor.actorType, note, publicMessage);
    if (toStatus === 'acknowledged') item.acknowledgedAt = item.updatedAt;
    return structuredClone(item);
  }

  async listWorkflowActors(actorId: string): Promise<WorkflowActorResponse[]> {
    this.requireActor(actorId, true);
    return structuredClone(this.actors);
  }

  async listAreaOfficerOverview(actorId: string, _from: string, _to: string): Promise<AreaOfficerOverviewResponse[]> {
    const actor = this.requireActor(actorId, true);
    if (actor.actorType !== 'supervisor') throw new WorkflowError('FORBIDDEN', 'Chỉ chỉ huy mới xem được đánh giá theo cán bộ khu vực.');
    return [];
  }

  async listOfficerNotifications(actorId: string): Promise<OfficerNotificationResponse[]> {
    this.requireActor(actorId, true);
    return [];
  }

  private readonly citizenNotificationReads = new Map<string, string>();

  /* ---------- Nhóm trùng, gợi ý AI, đánh giá SOS/ứng dụng, chỉ số (kho mẫu) ---------- */

  private readonly duplicateLinks = new Map<string, string>();
  private readonly suggestedDuplicates = new Map<string, { id: string; score: number }>();
  private readonly aiReviews: IncidentAiReviewResponse[] = [];
  private readonly sosRatings = new Map<string, SatisfactionRatingResponse>();
  private readonly appRatings = new Map<string, AppRatingResponse>();

  private duplicateCase(item: IncidentResponse): DuplicateCaseInput {
    const primaryId = this.duplicateLinks.get(item.id);
    const primary = primaryId ? this.incidents.get(primaryId) : undefined;
    return {
      id: item.id, receiptCode: item.receiptCode, category: item.category, summary: item.summary,
      description: item.description, status: item.status, createdAt: item.createdAt,
      duplicateOf: primary ? { id: primary.id, receiptCode: primary.receiptCode } : null,
    };
  }

  private rankFor(id: string): DuplicateCandidateResponse[] {
    const target = this.incidents.get(id);
    if (!target) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    const candidates = [...this.incidents.values()]
      .filter((item) => item.id !== id && item.location.localityCode === target.location.localityCode)
      .map((item) => ({ item: this.duplicateCase(item), distanceM: haversineMeters(target.location, item.location) }));
    return rankDuplicates(this.duplicateCase(target), candidates);
  }

  private refreshDuplicateSuggestion(id: string): void {
    if (this.duplicateLinks.has(id)) return;
    const best = this.rankFor(id).find((item) => item.level === 'likely');
    const target = best ? best.duplicateOf ?? { id: best.id, receiptCode: best.receiptCode } : null;
    if (target && best) this.suggestedDuplicates.set(id, { id: target.id, score: best.score });
    else this.suggestedDuplicates.delete(id);
  }

  private withDuplicateInfo(incident: IncidentResponse): IncidentResponse {
    const primary = this.incidents.get(this.duplicateLinks.get(incident.id) ?? '');
    const suggestion = this.suggestedDuplicates.get(incident.id);
    const suggested = primary ? undefined : this.incidents.get(suggestion?.id ?? '');
    return {
      ...incident,
      duplicateOf: primary ? { id: primary.id, receiptCode: primary.receiptCode } : null,
      suggestedDuplicateOf: suggested && suggestion ? { id: suggested.id, receiptCode: suggested.receiptCode, score: suggestion.score } : null,
      duplicates: [...this.duplicateLinks].filter(([, primaryId]) => primaryId === incident.id)
        .map(([childId]) => this.incidents.get(childId)!)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((child) => ({ id: child.id, receiptCode: child.receiptCode })),
    };
  }

  private withSosRating(sos: SosResponse): SosResponse {
    return { ...sos, satisfactionRating: structuredClone(this.sosRatings.get(sos.id) ?? null) };
  }

  async findIncidentDuplicates(actorId: string, incidentId: string): Promise<DuplicateCandidateResponse[]> {
    this.requireActor(actorId, true);
    return this.rankFor(incidentId);
  }

  async setIncidentDuplicateOf(actorId: string, incidentId: string, primaryId: string | null): Promise<IncidentResponse> {
    this.requireActor(actorId);
    const target = this.incidents.get(incidentId);
    if (!target) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    if (primaryId === null) {
      if (!this.duplicateLinks.delete(incidentId)) throw new WorkflowError('INVALID_INPUT', 'Phản ánh này chưa được gộp vào hồ sơ nào.');
    } else {
      if (primaryId === incidentId) throw new WorkflowError('INVALID_INPUT', 'Không thể gộp phản ánh vào chính nó.');
      const primary = this.incidents.get(primaryId);
      if (!primary || primary.location.localityCode !== target.location.localityCode) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
      if (this.duplicateLinks.has(primaryId)) throw new WorkflowError('INVALID_INPUT', `Hồ sơ ${primary.receiptCode} đã được gộp vào hồ sơ khác. Hãy gộp vào hồ sơ chính đó.`);
      if ([...this.duplicateLinks.values()].includes(incidentId)) {
        throw new WorkflowError('INVALID_INPUT', 'Phản ánh này đang là hồ sơ chính của phản ánh khác. Hãy gộp các phản ánh kia vào hồ sơ mới trước.');
      }
      this.duplicateLinks.set(incidentId, primaryId);
      this.suggestedDuplicates.delete(incidentId);
    }
    target.updatedAt = new Date().toISOString();
    return (await this.getOfficerIncident(actorId, incidentId))!;
  }

  async saveIncidentAiReview(actorId: string, incidentId: string, suggestion: IncidentSuggestion): Promise<IncidentAiReviewResponse> {
    this.requireActor(actorId);
    if (!this.incidents.has(incidentId)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    const review: IncidentAiReviewResponse = {
      ...structuredClone(suggestion), id: randomUUID(), incidentId, createdAt: new Date().toISOString(),
      decision: null, decidedCategory: null, decidedAt: null,
    };
    this.aiReviews.push(review);
    return structuredClone(review);
  }

  async getLatestIncidentAiReview(actorId: string, incidentId: string): Promise<IncidentAiReviewResponse | null> {
    this.requireActor(actorId);
    if (!this.incidents.has(incidentId)) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    const review = [...this.aiReviews].reverse().find((item) => item.incidentId === incidentId);
    return review ? structuredClone(review) : null;
  }

  async decideIncidentCategory(actorId: string, incidentId: string, category: IncidentResponse['category'], reviewId: string | null): Promise<IncidentResponse> {
    this.requireActor(actorId);
    const item = this.incidents.get(incidentId);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh trong địa bàn.');
    if (['closed', 'rejected'].includes(item.status)) throw new WorkflowError('INVALID_TRANSITION', 'Hồ sơ đã đóng, không đổi lĩnh vực được nữa.');
    if (reviewId) {
      const review = this.aiReviews.find((entry) => entry.id === reviewId && entry.incidentId === incidentId);
      if (!review) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy kết quả phân tích của hồ sơ này.');
      review.decision = category === review.suggestedCategory ? 'accepted' : category === item.category ? 'kept' : 'changed';
      review.decidedCategory = category;
      review.decidedAt = new Date().toISOString();
    }
    if (category !== item.category) {
      item.category = category;
      item.updatedAt = new Date().toISOString();
    }
    return (await this.getOfficerIncident(actorId, incidentId))!;
  }

  async getCitizenAppRating(citizenId: string): Promise<AppRatingResponse | null> {
    return structuredClone(this.appRatings.get(citizenId) ?? null);
  }

  async saveCitizenAppRating(citizenId: string, score: number, comment: string | null): Promise<AppRatingResponse> {
    const now = new Date().toISOString();
    const rating = { score, comment, createdAt: this.appRatings.get(citizenId)?.createdAt ?? now, updatedAt: now };
    this.appRatings.set(citizenId, rating);
    return structuredClone(rating);
  }

  async createSosRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse> {
    const item = [...this.sosEvents.values()].find((entry) => entry.citizenId === citizenId && entry.receiptCode === receiptCode);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy yêu cầu SOS thuộc tài khoản này.');
    if (!['resolved', 'closed'].includes(item.status)) throw new WorkflowError('INVALID_TRANSITION', 'Chỉ đánh giá sau khi cán bộ đã xử lý xong SOS.');
    const rating = { id: this.sosRatings.get(item.id)?.id ?? randomUUID(), receiptCode, score, comment, createdAt: new Date().toISOString() };
    this.sosRatings.set(item.id, rating);
    return structuredClone(rating);
  }

  private fixtureKpis(incidents: IncidentResponse[], sos: SosResponse[]): OfficerKpiResponse {
    const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);
    const average = (values: number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null);
    const minutes = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000;
    const firstResponses = incidents
      .map((item) => item.history.find((entry) => entry.actorRole === 'officer' || entry.actorRole === 'supervisor'))
      .map((entry, index) => (entry ? minutes(incidents[index]!.createdAt, entry.createdAt) : null))
      .filter((value): value is number => value !== null);
    const acknowledged = sos.filter((item) => item.acknowledgedAt && item.status !== 'cancelled_by_citizen');
    const counted = sos.filter((item) => item.status !== 'cancelled_by_citizen');
    const decided = this.aiReviews.filter((item) => item.decision !== null);
    const accepted = decided.filter((item) => item.decision === 'accepted').length;
    const incidentScores = [...this.ratings.values()].map((item) => item.score);
    const sosScores = [...this.sosRatings.values()].map((item) => item.score);
    const appScores = [...this.appRatings.values()].map((item) => item.score);
    return {
      reach: { citizenAccounts: this.citizenAccounts.size, newCitizenAccounts: this.citizenAccounts.size, pushDevices: 0 },
      response: {
        incidentFirstResponseMinutes: average(firstResponses),
        sosAcknowledgeMinutes: average(acknowledged.map((item) => minutes(item.createdAt, item.acknowledgedAt!))),
        respondedRate: ratio(firstResponses.length + acknowledged.length, incidents.length + counted.length),
      },
      dataQuality: {
        duplicateLinked: this.duplicateLinks.size, duplicateRate: ratio(this.duplicateLinks.size, incidents.length),
        vneidConnected: false, vneidVerifiedRate: null,
      },
      ai: { reviews: this.aiReviews.length, decided: decided.length, accepted, accuracy: ratio(accepted, decided.length) },
      satisfaction: {
        incidentAverage: average(incidentScores), incidentCount: incidentScores.length,
        sosAverage: average(sosScores), sosCount: sosScores.length,
        appAverage: average(appScores), appCount: appScores.length,
      },
    };
  }

  private citizenNotificationEvents(citizenId: string): CitizenNotification[] {
    const items: CitizenNotification[] = [];
    for (const item of [...this.incidents.values(), ...this.sosEvents.values()]) {
      if (item.citizenId !== citizenId) continue;
      item.history.forEach((entry, index) => {
        if (!['officer', 'supervisor'].includes(entry.actorRole)) return;
        if (entry.fromStatus === entry.toStatus && !entry.publicMessage) return;
        const id = `${item.kind}:${item.id}-${index}`;
        items.push({
          id, kind: item.kind, receiptCode: item.receiptCode,
          caseTitle: item.kind === 'incident' ? item.summary : 'Yêu cầu SOS',
          status: entry.toStatus, eventType: 'status', title: notificationTitle(item.kind, entry.toStatus, 'status'),
          message: entry.publicMessage ? entry.note : null, createdAt: entry.createdAt,
          readAt: this.citizenNotificationReads.get(`${citizenId}/${id}`) ?? null,
        });
      });
      if (item.kind !== 'incident') continue;
      for (const entry of this.messages.get(item.id) ?? []) {
        if (entry.authorRole === 'citizen') continue;
        const id = `message:${entry.id}`;
        const eventType = entry.requestMedia ? 'request_media' : 'message';
        items.push({ id, kind: 'incident', receiptCode: item.receiptCode, caseTitle: item.summary, status: null,
          eventType, title: notificationTitle('incident', null, eventType), message: entry.message, createdAt: entry.createdAt,
          readAt: this.citizenNotificationReads.get(`${citizenId}/${id}`) ?? null });
      }
    }
    return items;
  }

  async listCitizenNotifications(citizenId: string, query: NotificationQuery): Promise<CitizenNotificationPage> {
    return paginateNotifications(this.citizenNotificationEvents(citizenId), query);
  }

  async markCitizenNotificationsRead(citizenId: string, ids: string[]): Promise<number> {
    let changed = 0;
    for (const item of this.citizenNotificationEvents(citizenId)) {
      if (!ids.includes(item.id) || item.readAt) continue;
      this.citizenNotificationReads.set(`${citizenId}/${item.id}`, new Date().toISOString());
      changed++;
    }
    return changed;
  }

  private findCitizenIncident(citizenId: string, receiptCode: string): IncidentResponse & { citizenId: string; clientRequestId: string } {
    const item = [...this.incidents.values()].find((candidate) => candidate.citizenId === citizenId && candidate.receiptCode === receiptCode);
    if (!item) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy phản ánh.');
    return item;
  }

  private addMessage(
    incidentId: string,
    authorRole: IncidentMessageResponse['authorRole'],
    authorLabel: string,
    message: string,
    requestMedia: boolean,
  ): IncidentMessageResponse {
    const entry: IncidentMessageResponse = { id: randomUUID(), authorRole, authorLabel, message, requestMedia, createdAt: new Date().toISOString() };
    const thread = this.messages.get(incidentId) ?? [];
    thread.push(entry);
    this.messages.set(incidentId, thread);
    return structuredClone(entry);
  }

  private addAttachment(
    item: IncidentResponse,
    input: IncidentAttachmentInput,
    uploaderRole: IncidentAttachmentResponse['uploaderRole'],
    purpose: IncidentAttachmentResponse['purpose'],
  ): IncidentAttachmentResponse {
    const attachment: IncidentAttachmentResponse = {
      id: randomUUID(), fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
      sha256: 'fixture-not-persisted', createdAt: new Date().toISOString(), uploaderRole, purpose,
    };
    item.attachments.push(attachment);
    this.attachmentContent.set(attachment.id, { mimeType: attachment.mimeType, content: Buffer.from(input.dataBase64, 'base64') });
    return structuredClone(attachment);
  }

  private fixtureShiftSummary(): ShiftSummaryResponse {
    return {
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()),
      incidentsReceived: this.incidents.size,
      incidentsResolved: [...this.incidents.values()].filter((item) => ['resolved', 'closed'].includes(item.status)).length,
      sosReceived: this.sosEvents.size,
      sosResolved: [...this.sosEvents.values()].filter((item) => ['resolved', 'closed'].includes(item.status)).length,
      patrolsCompleted: [...this.patrols.values()].filter((item) => item.status === 'completed').length,
      overdueOpen: 0,
    };
  }

  private localityAt(latitude: number, longitude: number): { code: string; name: string } {
    const pilot = this.pilots.find((candidate) => candidate.contains(latitude, longitude));
    return pilot ? { code: pilot.code, name: pilot.name } : { code: demoArea.code, name: demoArea.name };
  }

  private assertDemoLocation(latitude: number, longitude: number): void {
    if (this.pilots.length) {
      if (!this.pilots.some((pilot) => pilot.contains(latitude, longitude))) {
        throw new WorkflowError('INVALID_INPUT', 'Vị trí nằm ngoài phạm vi dữ liệu đang phục vụ.');
      }
      return;
    }
    if (latitude < 11.924 || latitude > 11.965 || longitude < 108.414 || longitude > 108.466) {
      throw new WorkflowError('INVALID_INPUT', 'Vị trí nằm ngoài phạm vi dữ liệu đang phục vụ.');
    }
  }

  /** Chỉ huy (supervisor) chỉ được vào các thao tác xem (allowSupervisor = true); mọi thao tác ghi đòi hỏi cán bộ. */
  private requireActor(actorId: string, allowSupervisor = false): WorkflowActorResponse {
    const actor = this.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new WorkflowError('FORBIDDEN', 'Tài khoản cán bộ local không hợp lệ.');
    if (actor.actorType === 'supervisor' && !allowSupervisor) throw new WorkflowError('FORBIDDEN', COMMANDER_READ_ONLY_MESSAGE);
    return actor;
  }

  private pushIncidentHistory(
    item: IncidentResponse,
    toStatus: IncidentStatus,
    actorId: string,
    actorRole: string,
    note: string,
    publicMessage: boolean,
  ): void {
    const fromStatus = item.status;
    const now = new Date().toISOString();
    item.status = toStatus;
    item.updatedAt = now;
    item.history.push({ fromStatus, toStatus, actorId, actorRole, note, publicMessage, createdAt: now });
  }

  private pushSosHistory(
    item: SosResponse,
    toStatus: SosStatus,
    actorId: string,
    actorRole: string,
    note: string,
    publicMessage = true,
  ): void {
    const fromStatus = item.status;
    const now = new Date().toISOString();
    item.status = toStatus;
    item.updatedAt = now;
    item.history.push({ fromStatus, toStatus, actorId, actorRole, note, publicMessage, createdAt: now });
  }

  async close(): Promise<void> {}
}
