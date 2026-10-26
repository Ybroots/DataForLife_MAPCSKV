import { randomUUID } from 'node:crypto';
import { notificationTitle, paginateNotifications } from './citizen-notifications.js';
import type { CitizenNotification, CitizenNotificationPage, NotificationQuery } from './types.js';
import type {
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
  OfficerStatisticsResponse,
  OperationalMapPointInput,
  OperationalMapPointResponse,
  PatrolSessionResponse,
  PublicAlertResponse,
  SatisfactionRatingResponse,
  ShiftSummaryResponse,
  StatisticsPeriod,
  SosResponse,
  WorkflowActorResponse,
  CitizenAccountRecord,
  OfficerAccountRecord,
} from './types.js';
import { assertCaseOwnership, assertIncidentTransition, assertSosTransition, type IncidentStatus, type SosStatus, WorkflowError } from './workflow.js';

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
  async getAreaOverview(): Promise<AreaOverview> {
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
  private readonly officerAccounts = new Map<string, OfficerAccountRecord>();

  private readonly actors: WorkflowActorResponse[] = [
    { id: 'officer-demo-xuan-huong', actorType: 'officer', displayName: 'CSKV trực địa bàn Xuân Hương', localityCode: 'DEMO-DA-LAT' },
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

  async searchAreas(query: string, limit: number): Promise<AreaSummary[]> {
    const normalized = query.trim().toLocaleLowerCase('vi');
    if (normalized && !demoArea.name.toLocaleLowerCase('vi').includes(normalized)) return [];
    return [{
      code: demoArea.code,
      name: demoArea.name,
      localityType: demoArea.localityType,
      provinceName: demoArea.provinceName,
    }].slice(0, limit);
  }

  async lookupByCode(code: string): Promise<AreaLookupResponse | null> {
    return code === demoArea.code ? cloneArea() : null;
  }

  async lookupByLocation(latitude: number, longitude: number): Promise<AreaLookupResponse | null> {
    return latitude >= 11.924 && latitude <= 11.965 && longitude >= 108.414 && longitude <= 108.466
      ? cloneArea()
      : null;
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

  async listPublicAlerts(areaCode: string): Promise<PublicAlertResponse[]> {
    return structuredClone(this.alerts.filter((item) => item.areaCode === areaCode && item.status === 'published'));
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
        localityCode: demoArea.code,
        localityName: demoArea.name,
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
        localityCode: demoArea.code,
        localityName: demoArea.name,
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
      .map(publicSos);
  }

  async getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null> {
    const item = [...this.sosEvents.values()].find((entry) => entry.citizenId === citizenId && entry.receiptCode === receiptCode);
    return item ? publicSos(item) : null;
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
    this.requireActor(actorId);
    const sos: OfficerQueueItemResponse[] = [...this.sosEvents.values()]
      .filter((item) => !['closed', 'cancelled_by_citizen'].includes(item.status))
      .map((item) => ({
        kind: 'sos', id: item.id, receiptCode: item.receiptCode, category: item.category,
        title: item.note || 'Yêu cầu hỗ trợ khẩn cấp', status: item.status, priority: 'critical',
        localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, assignedOfficer: item.assignedOfficer,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
      }));
    const incidents: OfficerQueueItemResponse[] = [...this.incidents.values()]
      .filter((item) => !['closed', 'rejected'].includes(item.status))
      .map((item) => ({
        kind: 'incident', id: item.id, receiptCode: item.receiptCode, category: item.category,
        title: item.summary, status: item.status, priority: item.priority,
        localityCode: item.location.localityCode, localityName: item.location.localityName,
        serviceAreaName: item.location.serviceAreaName, assignedOfficer: item.assignedOfficer,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
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
    this.requireActor(actorId);
    const item = this.incidents.get(id);
    if (!item) return null;
    const clone = structuredClone(item);
    clone.satisfactionRating = structuredClone(this.ratings.get(`${item.citizenId}:${item.id}`) ?? null);
    return clone;
  }

  async getOfficerSos(actorId: string, id: string): Promise<SosResponse | null> {
    this.requireActor(actorId);
    const item = this.sosEvents.get(id);
    return item ? structuredClone(item) : null;
  }

  async listOfficerIncidentMessages(actorId: string, id: string): Promise<IncidentMessageResponse[]> {
    this.requireActor(actorId);
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
    this.requireActor(actorId);
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

  async listPatrolSessions(actorId: string): Promise<PatrolSessionResponse[]> {
    this.requireActor(actorId);
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
    this.requireActor(actorId);
    return this.fixtureShiftSummary();
  }

  async confirmShiftReport(actorId: string, _note: string | null): Promise<{ id: string; confirmedAt: string; summary: ShiftSummaryResponse }> {
    this.requireActor(actorId);
    return { id: randomUUID(), confirmedAt: new Date().toISOString(), summary: this.fixtureShiftSummary() };
  }

  async getOfficerStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse> {
    this.requireActor(actorId);
    const incidents = [...this.incidents.values()];
    const sos = [...this.sosEvents.values()];
    const resolved = [...incidents, ...sos].filter((item) => ['resolved', 'closed'].includes(item.status)).length;
    return {
      period, anchorDate, from: new Date(`${anchorDate}T00:00:00+07:00`).toISOString(), to: new Date().toISOString(),
      totals: { incidents: incidents.length, sos: sos.length, resolved, open: incidents.length + sos.length - resolved, overdue: 0, averageResolutionMinutes: null, averageRating: null, ratingCount: this.ratings.size },
      trend: [{ label: anchorDate, incidents: incidents.length, sos: sos.length, resolved }],
      categories: [],
    };
  }

  async listOperationalMapPoints(actorId: string): Promise<OperationalMapPointResponse[]> {
    this.requireActor(actorId); return structuredClone([...this.mapPoints.values()]);
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
    return structuredClone(item);
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
    this.requireActor(actorId);
    return structuredClone(this.actors);
  }

  async listOfficerNotifications(actorId: string): Promise<OfficerNotificationResponse[]> {
    this.requireActor(actorId);
    return [];
  }

  private readonly citizenNotificationReads = new Map<string, string>();

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

  private assertDemoLocation(latitude: number, longitude: number): void {
    if (latitude < 11.924 || latitude > 11.965 || longitude < 108.414 || longitude > 108.466) {
      throw new WorkflowError('INVALID_INPUT', 'Vị trí nằm ngoài phạm vi dữ liệu đang phục vụ.');
    }
  }

  private requireActor(actorId: string): WorkflowActorResponse {
    const actor = this.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new WorkflowError('FORBIDDEN', 'Tài khoản cán bộ local không hợp lệ.');
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
