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
  /** Tên khu vực mà cán bộ phụ trách (chỉ có với cảnh sát khu vực đã gắn khu vực). */
  serviceAreaName?: string | null;
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
  /** Tên tài khoản người bấm SOS, để cán bộ biết gọi cho ai. */
  reporterName?: string | null;
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
  /** Chỉ có ở SOS: người bấm SOS (tên tài khoản, số điện thoại liên hệ). */
  reporterName?: string | null;
  reporterPhone?: string | null;
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
  /** Khu vực cán bộ phụ trách; null với chỉ huy và cán bộ chưa gắn khu vực. */
  serviceArea: { code: string; name: string } | null;
  phone: string | null;
  /** Địa bàn phụ trách theo quyết định phân công (tổ dân phố). */
  beatNote: string | null;
}

/** Số liệu tổng hợp của một kỳ trong báo cáo chỉ huy (phản ánh và SOS; không tính SOS người dân đã hủy). */
export interface CommanderReportTotals {
  incidents: number;
  sos: number;
  resolved: number;
  /** Hồ sơ của kỳ hiện vẫn chưa kết thúc. */
  open: number;
  /** Trong số đang mở: phản ánh quá 15 phút, SOS quá 5 phút kể từ lúc gửi. */
  overdue: number;
  firstResponseMinutes: number | null;
  sosAcknowledgeMinutes: number | null;
  resolutionMinutes: number | null;
  /** Tỷ lệ hồ sơ đã có cán bộ phản hồi (0–1). */
  respondedRate: number | null;
  sosUnacknowledged: number;
  sosEscalated: number;
  /** Hồ sơ chưa xác định được khu vực phụ trách. */
  unrouted: number;
  averageRating: number | null;
  ratingCount: number;
}

export interface CommanderReportAreaRow {
  code: string;
  name: string;
  officers: Array<{ id: string; displayName: string }>;
  incidents: number;
  sos: number;
  resolved: number;
  open: number;
  overdue: number;
  firstResponseMinutes: number | null;
  sosAcknowledgeMinutes: number | null;
  resolutionMinutes: number | null;
  averageRating: number | null;
  ratingCount: number;
  lowRatings: number;
}

export interface CommanderReportOfficerRow {
  id: string;
  displayName: string;
  areaName: string | null;
  incidents: number;
  sos: number;
  resolved: number;
  open: number;
  overdue: number;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  averageRating: number | null;
  ratingCount: number;
  lowRatings: number;
}

/** Hồ sơ đang mở đã quá hạn phản hồi tại thời điểm xem, cũ nhất trước. */
export interface CommanderReportAttentionRow {
  kind: 'incident' | 'sos';
  id: string;
  receiptCode: string;
  status: string;
  title: string;
  areaName: string | null;
  officerName: string | null;
  createdAt: string;
  ageMinutes: number;
}

export interface CommanderReportResponse {
  period: StatisticsPeriod;
  anchorDate: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  current: CommanderReportTotals;
  previous: CommanderReportTotals;
  areas: CommanderReportAreaRow[];
  officers: CommanderReportOfficerRow[];
  /** Số hồ sơ theo giờ trong ngày (0–23, giờ Việt Nam). */
  hourly: number[];
  /** Số hồ sơ theo thứ: chỉ số 0 = thứ hai … 6 = chủ nhật. */
  weekdays: number[];
  attention: CommanderReportAttentionRow[];
}

/** Một khu vực và cán bộ CSKV phụ trách, kèm đánh giá của người dân trong kỳ (chỉ huy xem). */
export interface AreaOfficerOverviewResponse {
  serviceArea: { code: string; name: string };
  officer: { id: string; displayName: string; phone: string | null; beatNote: string | null } | null;
  from: string;
  to: string;
  incidents: { received: number; open: number; resolved: number };
  sosReceived: number;
  incidentRating: { average: number | null; count: number; lowScoreCount: number };
  sosRating: { average: number | null; count: number; lowScoreCount: number };
  /** Số lượt đánh giá 1, 2, 3, 4, 5 sao của cán bộ trong kỳ (gồm cả phản ánh và SOS). */
  starCounts: [number, number, number, number, number];
  /** Các đánh giá mới nhất trong kỳ kèm nội dung góp ý (tối đa 10), không kèm danh tính người dân. */
  recentReviews: OfficerReviewResponse[];
}

/** Tài khoản cán bộ mà chỉ huy quản lý (tên đăng nhập, khu vực). Không bao giờ có mật khẩu hay bản băm. */
export interface ManagedOfficerResponse {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  serviceArea: { code: string; name: string } | null;
}

/** `serviceAreaCode`: mã khu vực, hoặc null để bỏ gắn khu vực (cán bộ thấy cả phường). Bỏ trống thì giữ nguyên. */
export interface UpdateManagedOfficerInput {
  username?: string;
  serviceAreaCode?: string | null;
}

export interface UpdateManagedOfficerResult {
  officer: ManagedOfficerResponse;
  usernameChanged: boolean;
}

export interface OfficerReviewResponse {
  kind: 'incident' | 'sos';
  score: number;
  comment: string | null;
  createdAt: string;
  receiptCode: string;
}

export interface CitizenAccountRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

export type CitizenAccountEventType =
  | 'recovery_code_created'
  | 'password_reset_recovery'
  | 'assisted_reset_issued'
  | 'password_reset_assisted'
  | 'email_verified'
  | 'password_reset_email';

export type CitizenEmailCodePurpose = 'verify_email' | 'reset_password';

export interface CitizenEmailCodeRecord {
  email: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
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

/** Các trường cảnh báo được sửa; trường nào không gửi thì giữ nguyên. Toạ độ phải đi cùng nhau. */
export type UpdatePublicAlertInput = Partial<Pick<PublicAlertResponse, 'title' | 'summary' | 'category' | 'riskLevel' | 'startsAt' | 'endsAt'>> & {
  latitude?: number;
  longitude?: number;
};

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

/** Số đếm công khai trên trang Thống kê. `demoData` = true khi đang có dữ liệu mẫu để trình diễn (hiện nhãn "Số liệu thử nghiệm"). */
export interface PublicStatsResponse {
  pilotAreas: number;
  officers: number;
  installs: number;
  verifiedUsers: number;
  incidentsReceived: number;
  incidentsProcessed: number;
  avgResponseMinutes: number | null;
  opinions: Array<{ id: string; authorRole: 'citizen' | 'officer'; authorLabel: string; comment: string; score: number | null }>;
  demoData: boolean;
  updatedAt: string;
}

export interface DirectoryRepository {
  readonly sourceName: 'postgres' | 'fixture';
  getAreaOverview(): Promise<AreaOverview>;
  searchAreas(query: string, limit: number): Promise<AreaSummary[]>;
  lookupByCode(code: string): Promise<AreaLookupResponse | null>;
  lookupByLocation(latitude: number, longitude: number): Promise<AreaLookupResponse | null>;
  listHotlines(): Promise<HotlineResponse[]>;
  listUnitContacts(): Promise<PublicUnitContactResponse[]>;
  /** Số đếm công khai (địa bàn thí điểm, cán bộ, cài đặt, người dùng, phản ánh, ý kiến đã được duyệt). */
  getPublicStats(): Promise<PublicStatsResponse>;
  findCitizenAccountByUsername(username: string): Promise<CitizenAccountRecord | null>;
  findCitizenAccountById(id: string): Promise<CitizenAccountRecord | null>;
  createCitizenAccount(input: CitizenAccountRecord): Promise<CitizenAccountRecord | null>;
  findOfficerAccountByUsername(username: string): Promise<OfficerAccountRecord | null>;
  findOfficerAccountById(actorId: string): Promise<OfficerAccountRecord | null>;
  updateCitizenPasswordHash(id: string, passwordHash: string): Promise<boolean>;
  /** Mã khôi phục mật khẩu: chỉ lưu bản băm. Cần migration 015. */
  getCitizenRecoveryCodeHash(id: string): Promise<string | null>;
  setCitizenRecoveryCodeHash(id: string, recoveryCodeHash: string): Promise<boolean>;
  /** Đặt lại mật khẩu và đổi mã khôi phục trong một lệnh; chỉ thành công nếu mã cũ vẫn là `expectedRecoveryCodeHash` (mã dùng một lần). */
  resetCitizenPasswordWithRecovery(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedRecoveryCodeHash: string): Promise<boolean>;
  /** Cán bộ cấp mã đặt lại cho người dân theo số điện thoại. Trả null nếu không có tài khoản. Cần migration 016. */
  issueCitizenAssistedResetCode(username: string, officerId: string, codeHash: string, expiresAt: string): Promise<{ id: string; displayName: string } | null>;
  getCitizenAssistedResetCode(id: string): Promise<{ codeHash: string; expiresAt: string } | null>;
  /** Đặt lại mật khẩu bằng mã do cán bộ cấp: chỉ thành công khi mã còn hạn và chưa bị đổi (dùng một lần). */
  resetCitizenPasswordWithAssistedCode(id: string, passwordHash: string, newRecoveryCodeHash: string, expectedAssistedCodeHash: string): Promise<boolean>;
  recordCitizenAccountEvent(citizenId: string, eventType: CitizenAccountEventType, actorId: string | null): Promise<void>;
  /** Email khôi phục mật khẩu (migration 017): mã 6 số gửi qua email, chỉ lưu bản băm, mỗi mục đích một mã còn hiệu lực. */
  putCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, email: string, codeHash: string, expiresAt: string): Promise<void>;
  getCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<CitizenEmailCodeRecord | null>;
  /** Tăng số lần nhập sai và trả về số lần hiện tại. */
  bumpCitizenEmailCodeAttempts(citizenId: string, purpose: CitizenEmailCodePurpose): Promise<number>;
  /** Dùng mã: xóa nếu còn đúng mã, còn hạn và chưa quá số lần thử. Trả true khi dùng được (mã dùng một lần). */
  consumeCitizenEmailCode(citizenId: string, purpose: CitizenEmailCodePurpose, expectedCodeHash: string, maxAttempts: number): Promise<boolean>;
  setCitizenVerifiedEmail(citizenId: string, email: string): Promise<boolean>;
  getCitizenEmail(citizenId: string): Promise<{ email: string; verified: boolean } | null>;
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
  updatePublicAlert(actorId: string, id: string, input: UpdatePublicAlertInput): Promise<PublicAlertResponse>;
  /** Gỡ cảnh báo đang hiển thị (đặt trạng thái đã huỷ, không xoá dữ liệu). */
  cancelPublicAlert(actorId: string, id: string): Promise<void>;
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
  listAreaOfficerOverview(actorId: string, from: string, to: string): Promise<AreaOfficerOverviewResponse[]>;
  /** Chỉ chỉ huy: báo cáo chi tiết theo khu vực, cán bộ, giờ cao điểm và so với kỳ trước. */
  getCommanderReport(actorId: string, period: StatisticsPeriod, anchorDate: string): Promise<CommanderReportResponse>;
  /** Chỉ chỉ huy: danh sách, sửa, đặt mật khẩu cho cán bộ cùng phường. `reservedUsernames`: tên đã dùng bởi tài khoản cấu hình ở máy chủ. */
  listManagedOfficers(actorId: string): Promise<ManagedOfficerResponse[]>;
  updateManagedOfficer(actorId: string, targetId: string, input: UpdateManagedOfficerInput, reservedUsernames?: readonly string[]): Promise<UpdateManagedOfficerResult>;
  setManagedOfficerPasswordHash(actorId: string, targetId: string, passwordHash: string): Promise<ManagedOfficerResponse>;
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
