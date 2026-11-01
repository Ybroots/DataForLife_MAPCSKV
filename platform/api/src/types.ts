export interface AreaSummary {
  code: string;
  name: string;
  localityType: string | null;
  provinceName: string | null;
}

export interface AreaOverview {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id: string; properties: AreaSummary; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>;
}

export interface StationResponse {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: 'address_only' | 'surveyed' | 'official_coordinate' | 'area_centroid';
}

export interface DirectoryEntryResponse {
  id: string;
  displayName: string;
  rank: string | null;
  roleTitle: string | null;
  phone: string;
  entryType: 'officer' | 'unit_contact';
}

export interface HotlineResponse {
  id: string;
  categoryCode: string;
  categoryLabel: string;
  label: string;
  phone: string;
}

export interface PublicUnitContactResponse extends DirectoryEntryResponse {
  unitCode: string;
  unitName: string;
  address: string | null;
}

export interface ServiceAreaResponse {
  code: string;
  name: string;
  legacyWardCode: string | null;
  groupName: string | null;
  description: string | null;
  displayColor: string;
  areaKm2: number | null;
  center: { latitude: number; longitude: number };
  boundary: GeoJSON.MultiPolygon | GeoJSON.Polygon;
  selected: boolean;
  isDemo: boolean;
  provenanceStatus: 'reference_reconstructed' | 'manually_verified' | 'official';
}

export interface AreaLookupResponse extends AreaSummary {
  population: number | null;
  areaKm2: number | null;
  densityPerKm2: number | null;
  center: { latitude: number; longitude: number } | null;
  boundary: GeoJSON.MultiPolygon | GeoJSON.Polygon | null;
  serviceAreas: ServiceAreaResponse[];
  station: StationResponse | null;
  directory: DirectoryEntryResponse[];
}

export namespace GeoJSON {
  export interface Polygon {
    type: 'Polygon';
    coordinates: number[][][];
  }

  export interface MultiPolygon {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  }
}

export interface WorkflowLocationResponse {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  localityCode: string;
  localityName: string;
  serviceAreaCode: string | null;
  serviceAreaName: string | null;
  routingStatus: 'approved_service_area' | 'locality_dispatch';
}

export interface WorkflowHistoryResponse<TStatus extends string> {
  fromStatus: TStatus | null;
  toStatus: TStatus;
  actorId: string;
  actorRole: string;
  note: string | null;
  publicMessage: boolean;
  createdAt: string;
}

export interface AssignedOfficerResponse {
  id: string;
  displayName: string;
}

export interface IncidentResponse {
  kind: 'incident';
  id: string;
  receiptCode: string;
  category: 'security' | 'traffic' | 'public_order' | 'administrative' | 'environment' | 'other';
  summary: string;
  description: string;
  locationNote: string | null;
  contactPhone: string | null;
  status: import('./workflow.js').IncidentStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  location: WorkflowLocationResponse;
  assignedOfficer: AssignedOfficerResponse | null;
  operationalMode: 'local_sandbox' | 'pilot' | 'production';
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistoryResponse<import('./workflow.js').IncidentStatus>[];
  attachments: IncidentAttachmentResponse[];
  satisfactionRating?: SatisfactionRatingResponse | null;
  /** Chỉ có ở hồ sơ cán bộ: hồ sơ chính mà cán bộ đã gộp phản ánh này vào. */
  duplicateOf?: CaseRef | null;
  /** Chỉ có ở hồ sơ cán bộ: hệ thống tự gợi ý khi tiếp nhận, chờ cán bộ xác nhận. */
  suggestedDuplicateOf?: (CaseRef & { score: number }) | null;
  /** Chỉ có ở hồ sơ cán bộ: các phản ánh đã được gộp vào hồ sơ này. */
  duplicates?: CaseRef[];
}

export interface CaseRef {
  id: string;
  receiptCode: string;
}

export interface IncidentDraftResponse {
  category: IncidentResponse['category'];
  summary: string;
  description: string;
  occurredAt: string | null;
  locationNote: string | null;
  /** Lời mô tả có dấu hiệu khẩn cấp: giao diện nhắc gọi 113 hoặc dùng SOS. */
  emergency: boolean;
  provider: 'OpenAI' | 'Gemini';
}

export type ImageLabel =
  | 'fire_smoke' | 'traffic_accident' | 'crowd_gathering' | 'fighting_or_weapon' | 'flood_or_landslide'
  | 'property_damage' | 'waste_or_pollution' | 'document_or_screenshot' | 'no_incident_visible' | 'unclear';

export interface IncidentSuggestion {
  suggestedCategory: IncidentResponse['category'];
  confidence: 'low' | 'medium' | 'high';
  reason: string | null;
  imageFindings: Array<{ attachmentId: string; labels: ImageLabel[] }>;
  provider: 'OpenAI' | 'Gemini';
  model: string;
}

export interface IncidentAiReviewResponse extends IncidentSuggestion {
  id: string;
  incidentId: string;
  createdAt: string;
  decision: 'accepted' | 'changed' | 'kept' | null;
  decidedCategory: IncidentResponse['category'] | null;
  decidedAt: string | null;
}

export interface DuplicateCandidateResponse {
  id: string;
  receiptCode: string;
  summary: string;
  status: string;
  category: string;
  createdAt: string;
  distanceM: number;
  minutesApart: number;
  sameCategory: boolean;
  textSimilarity: number;
  score: number;
  level: 'likely' | 'possible';
  duplicateOf: CaseRef | null;
}

export interface AppRatingResponse {
  score: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Bộ chỉ số mục 9.2 của bản mô tả giải pháp. */
export interface OfficerKpiResponse {
  reach: { citizenAccounts: number; newCitizenAccounts: number; pushDevices: number };
  response: { incidentFirstResponseMinutes: number | null; sosAcknowledgeMinutes: number | null; respondedRate: number | null };
  dataQuality: { duplicateLinked: number; duplicateRate: number | null; vneidConnected: false; vneidVerifiedRate: null };
  ai: { reviews: number; decided: number; accepted: number; accuracy: number | null };
  satisfaction: {
    incidentAverage: number | null; incidentCount: number;
    sosAverage: number | null; sosCount: number;
    appAverage: number | null; appCount: number;
  };
}

export interface IncidentAttachmentResponse {
  id: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  purpose: 'initial' | 'supplemental' | 'evidence';
  uploaderRole: 'citizen' | 'officer' | 'supervisor';
}

export interface IncidentAttachmentInput {
  fileName: string;
  mimeType: IncidentAttachmentResponse['mimeType'];
  sizeBytes: number;
  dataBase64: string;
}

export interface SosResponse {
  kind: 'sos';
  id: string;
  receiptCode: string;
  category: 'security' | 'traffic_accident' | 'fire_rescue' | 'medical' | 'other_emergency';
  note: string | null;
  contactPhone: string | null;
  status: import('./workflow.js').SosStatus;
  location: WorkflowLocationResponse;
  assignedOfficer: AssignedOfficerResponse | null;
  operationalMode: 'local_sandbox' | 'pilot' | 'production';
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistoryResponse<import('./workflow.js').SosStatus>[];
  /** Chỉ có ở hồ sơ người dân: điểm người dân chấm sau khi SOS được xử lý xong. */
  satisfactionRating?: SatisfactionRatingResponse | null;
}

export interface CreateIncidentInput {
  clientRequestId: string;
  category: IncidentResponse['category'];
  summary: string;
  description: string;
  locationNote?: string | null;
  contactPhone?: string | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  attachments: IncidentAttachmentInput[];
}

export interface CreateSosInput {
  idempotencyKey: string;
  category: SosResponse['category'];
  note?: string | null;
  contactPhone?: string | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  deviceTimestamp: string;
}

export interface OfficerArchiveQuery {
  kind?: 'incident' | 'sos';
  /** Tìm theo mã tiếp nhận hoặc tiêu đề. */
  q?: string;
  /** Ngày đóng hồ sơ, định dạng yyyy-mm-dd (giờ Việt Nam). */
  from?: string;
  to?: string;
}

/** Một dòng trong báo cáo chi tiết theo kỳ (dùng để xuất CSV/Excel và in). */
export interface OfficerReportCaseResponse {
  kind: 'incident' | 'sos';
  receiptCode: string;
  category: string;
  title: string;
  status: string;
  priority: string;
  serviceAreaName: string | null;
  assignedOfficerName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionMinutes: number | null;
  ratingScore: number | null;
}

export interface OfficerQueueItemResponse {
  kind: 'incident' | 'sos';
  id: string;
  receiptCode: string;
  category: string;
  title: string;
  status: import('./workflow.js').IncidentStatus | import('./workflow.js').SosStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  localityCode: string;
  localityName: string;
  serviceAreaName: string | null;
  assignedOfficer: AssignedOfficerResponse | null;
  createdAt: string;
  updatedAt: string;
  /** Phản ánh đã được cán bộ gộp vào hồ sơ chính này. */
  duplicateOfReceiptCode?: string | null;
  /** Hệ thống gợi ý có thể trùng với hồ sơ này, chờ cán bộ xác nhận. */
  suggestedDuplicateReceiptCode?: string | null;
  /** Ảnh đầu tiên của phản ánh, để hiện ảnh thu nhỏ ngay trên danh sách. */
  previewAttachmentId?: string | null;
  photoCount?: number;
}

export interface OfficerNotificationResponse {
  id: string;
  aggregateType: 'incident' | 'sos';
  aggregateId: string;
  eventType: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface CitizenNotification {
  id: string;
  kind: 'incident' | 'sos';
  receiptCode: string;
  caseTitle: string;
  status: string | null;
  eventType: 'status' | 'message' | 'request_media';
  title: string;
  message: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface CitizenNotificationPage {
  items: CitizenNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationQuery { limit: number; cursor?: string; unreadOnly?: boolean }

export interface WorkflowActorResponse {
  id: string;
  actorType: 'officer' | 'supervisor';
  displayName: string;
  localityCode: string | null;
}

export interface CitizenAccountRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

export interface OfficerAccountRecord {
  actorId: string;
  username: string;
  passwordHash: string;
}

export interface PublicAlertResponse {
  id: string;
  areaCode: string;
  title: string;
  category: 'security' | 'traffic' | 'fire_rescue' | 'weather' | 'other';
  riskLevel: 'info' | 'medium' | 'high';
  summary: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'published' | 'expired' | 'cancelled';
  createdAt: string;
}

export interface IncidentMessageResponse {
  id: string;
  authorRole: 'citizen' | 'officer' | 'supervisor';
  authorLabel: string;
  message: string;
  requestMedia: boolean;
  createdAt: string;
}

export interface SatisfactionRatingResponse {
  id: string;
  receiptCode: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export interface PatrolSessionResponse {
  id: string;
  title: string;
  routeNote: string | null;
  officerId: string;
  officerName: string;
  status: 'planned' | 'active' | 'paused' | 'completed';
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lastCheckin: { latitude: number; longitude: number; at: string } | null;
}

export interface ShiftSummaryResponse {
  date: string;
  incidentsReceived: number;
  incidentsResolved: number;
  sosReceived: number;
  sosResolved: number;
  patrolsCompleted: number;
  overdueOpen: number;
}

export type StatisticsPeriod = 'day' | 'month' | 'year';

export interface OfficerStatisticsResponse {
  period: StatisticsPeriod;
  anchorDate: string;
  from: string;
  to: string;
  totals: {
    incidents: number;
    sos: number;
    resolved: number;
    open: number;
    overdue: number;
    averageResolutionMinutes: number | null;
    averageRating: number | null;
    ratingCount: number;
  };
  trend: Array<{ label: string; incidents: number; sos: number; resolved: number }>;
  categories: Array<{ category: string; count: number }>;
  kpis?: OfficerKpiResponse;
}

export interface OperationalMapPointResponse {
  id: string;
  localityCode: string;
  name: string;
  pointType: 'police_post' | 'camera' | 'risk_point' | 'patrol_checkpoint' | 'public_facility';
  description: string | null;
  contactPhone: string | null;
  status: 'active' | 'inactive' | 'maintenance';
  visibility: 'officer' | 'public';
  latitude: number;
  longitude: number;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalMapPointInput {
  name: string;
  pointType: OperationalMapPointResponse['pointType'];
  description?: string | null;
  contactPhone?: string | null;
  status: OperationalMapPointResponse['status'];
  visibility: OperationalMapPointResponse['visibility'];
  latitude: number;
  longitude: number;
}

export interface DirectoryRepository {
  readonly sourceName: 'postgres' | 'fixture';
  getAreaOverview(): Promise<AreaOverview>;
  searchAreas(query: string, limit: number): Promise<AreaSummary[]>;
  lookupByCode(code: string): Promise<AreaLookupResponse | null>;
  lookupByLocation(latitude: number, longitude: number): Promise<AreaLookupResponse | null>;
  listHotlines(): Promise<HotlineResponse[]>;
  listUnitContacts(): Promise<PublicUnitContactResponse[]>;
  findCitizenAccountByUsername(username: string): Promise<CitizenAccountRecord | null>;
  findCitizenAccountById(id: string): Promise<CitizenAccountRecord | null>;
  createCitizenAccount(input: CitizenAccountRecord): Promise<CitizenAccountRecord | null>;
  findOfficerAccountByUsername(username: string): Promise<OfficerAccountRecord | null>;
  findOfficerAccountById(actorId: string): Promise<OfficerAccountRecord | null>;
  updateCitizenPasswordHash(id: string, passwordHash: string): Promise<boolean>;
  updateOfficerPasswordHash(actorId: string, passwordHash: string): Promise<boolean>;
  listPublicAlerts(areaCode?: string): Promise<PublicAlertResponse[]>;
  createIncident(citizenId: string, input: CreateIncidentInput): Promise<IncidentResponse>;
  listCitizenIncidents(citizenId: string): Promise<IncidentResponse[]>;
  getCitizenIncident(citizenId: string, receiptCode: string): Promise<IncidentResponse | null>;
  listCitizenIncidentMessages(citizenId: string, receiptCode: string): Promise<IncidentMessageResponse[]>;
  addCitizenIncidentMessage(citizenId: string, receiptCode: string, message: string): Promise<IncidentMessageResponse>;
  addCitizenIncidentAttachment(citizenId: string, receiptCode: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse>;
  getCitizenIncidentAttachment(citizenId: string, receiptCode: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null>;
  createSatisfactionRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse>;
  createSos(citizenId: string, input: CreateSosInput): Promise<SosResponse>;
  listCitizenSos(citizenId: string): Promise<SosResponse[]>;
  getCitizenSos(citizenId: string, receiptCode: string): Promise<SosResponse | null>;
  cancelCitizenSos(citizenId: string, receiptCode: string, note: string): Promise<SosResponse>;
  reportCitizenSosSafe(citizenId: string, receiptCode: string, note: string): Promise<SosResponse>;
  withdrawCitizenIncident(citizenId: string, receiptCode: string, note: string): Promise<IncidentResponse>;
  listDutyLocalityCodes(): Promise<string[]>;
  listOfficerQueue(actorId: string, kind?: 'incident' | 'sos'): Promise<OfficerQueueItemResponse[]>;
  listOfficerArchive(actorId: string, query: OfficerArchiveQuery): Promise<OfficerQueueItemResponse[]>;
  listReportCases(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerReportCaseResponse[]>;
  getOfficerIncident(actorId: string, id: string): Promise<IncidentResponse | null>;
  getOfficerSos(actorId: string, id: string): Promise<SosResponse | null>;
  listOfficerIncidentMessages(actorId: string, id: string): Promise<IncidentMessageResponse[]>;
  addOfficerIncidentMessage(actorId: string, id: string, message: string, requestMedia: boolean): Promise<IncidentMessageResponse>;
  addOfficerIncidentAttachment(actorId: string, id: string, input: IncidentAttachmentInput): Promise<IncidentAttachmentResponse>;
  getOfficerIncidentAttachment(actorId: string, id: string, attachmentId: string): Promise<{ mimeType: string; content: Buffer } | null>;
  createPublicAlert(actorId: string, input: Omit<PublicAlertResponse, 'id' | 'areaCode' | 'status' | 'createdAt'>): Promise<PublicAlertResponse>;
  listPatrolSessions(actorId: string): Promise<PatrolSessionResponse[]>;
  createPatrolSession(actorId: string, title: string, routeNote: string | null, scheduledAt: string): Promise<PatrolSessionResponse>;
  updatePatrolSession(actorId: string, id: string, action: 'start' | 'pause' | 'resume' | 'checkin' | 'complete', latitude?: number | null, longitude?: number | null): Promise<PatrolSessionResponse>;
  getShiftSummary(actorId: string): Promise<ShiftSummaryResponse>;
  confirmShiftReport(actorId: string, note: string | null): Promise<{ id: string; confirmedAt: string; summary: ShiftSummaryResponse }>;
  getOfficerStatistics(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<OfficerStatisticsResponse>;
  listOperationalMapPoints(actorId: string): Promise<OperationalMapPointResponse[]>;
  createOperationalMapPoint(actorId: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse>;
  updateOperationalMapPoint(actorId: string, id: string, input: OperationalMapPointInput): Promise<OperationalMapPointResponse>;
  deleteOperationalMapPoint(actorId: string, id: string): Promise<void>;
  transitionIncident(
    actorId: string,
    id: string,
    toStatus: import('./workflow.js').IncidentStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage?: boolean,
  ): Promise<IncidentResponse>;
  transitionSos(
    actorId: string,
    id: string,
    toStatus: import('./workflow.js').SosStatus,
    note: string,
    assignedOfficerId?: string | null,
    publicMessage?: boolean,
  ): Promise<SosResponse>;
  listWorkflowActors(actorId: string): Promise<WorkflowActorResponse[]>;
  listOfficerNotifications(actorId: string): Promise<OfficerNotificationResponse[]>;
  listCitizenNotifications(citizenId: string, query: NotificationQuery): Promise<CitizenNotificationPage>;
  findIncidentDuplicates(actorId: string, incidentId: string): Promise<DuplicateCandidateResponse[]>;
  setIncidentDuplicateOf(actorId: string, incidentId: string, primaryId: string | null): Promise<IncidentResponse>;
  saveIncidentAiReview(actorId: string, incidentId: string, suggestion: IncidentSuggestion): Promise<IncidentAiReviewResponse>;
  getLatestIncidentAiReview(actorId: string, incidentId: string): Promise<IncidentAiReviewResponse | null>;
  decideIncidentCategory(actorId: string, incidentId: string, category: IncidentResponse['category'], reviewId: string | null): Promise<IncidentResponse>;
  getCitizenAppRating(citizenId: string): Promise<AppRatingResponse | null>;
  saveCitizenAppRating(citizenId: string, score: number, comment: string | null): Promise<AppRatingResponse>;
  createSosRating(citizenId: string, receiptCode: string, score: number, comment: string | null): Promise<SatisfactionRatingResponse>;
  markCitizenNotificationsRead(citizenId: string, ids: string[]): Promise<number>;
  close(): Promise<void>;
}
