export interface AreaSummary {
  code: string;
  name: string;
  localityType: string | null;
  provinceName: string | null;
}

export interface MapAssistantStatus {
  configured: boolean;
  provider: 'OpenAI' | 'Gemini' | null;
  lookupAvailable?: boolean;
  emergencyDispatchConnected: false;
}

export interface MapAssistantAnswer {
  message: string;
  intent: 'area' | 'directory' | 'alerts' | 'hotlines' | 'help' | 'emergency' | 'unsupported';
  needsClarification: boolean;
  areas: Array<Pick<AreaLookup, 'code' | 'name' | 'population' | 'areaKm2' | 'directory'> & {
    station: { name: string; address: string | null } | null;
    alerts: Array<Pick<PublicAlert, 'id' | 'title' | 'summary' | 'endsAt'>>;
  }>;
  hotlines: Hotline[];
  meta: { provider: string; dataSource: string; retrievedAt: string; emergencyDispatchConnected: false };
}

export interface ProcedureAnswer {
  matched: boolean;
  via: 'keyword' | 'ai' | 'none';
  disclaimer: string;
  procedure: {
    id: string;
    title: string;
    summary: string;
    conditions: string[];
    documents: string[];
    steps: string[];
    where: string;
    notes: string[];
    sources: Array<{ label: string; url: string }>;
    reviewedAt: string;
  } | null;
}

export interface AreaOverview {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id: string; properties: AreaSummary; geometry: NonNullable<AreaLookup['boundary']> }>;
}

export interface DirectoryEntry {
  id: string;
  displayName: string;
  rank: string | null;
  roleTitle: string | null;
  phone: string;
  entryType: 'officer' | 'unit_contact';
  /** Khu vực mà cảnh sát khu vực phụ trách (nếu đã gắn khu vực). */
  serviceAreaName?: string | null;
}

export interface Hotline {
  id: string;
  categoryCode: string;
  categoryLabel: string;
  label: string;
  phone: string;
}

export interface PublicUnitContact extends DirectoryEntry {
  unitCode: string;
  unitName: string;
  address: string | null;
}

export interface Station {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: 'address_only' | 'surveyed' | 'official_coordinate' | 'area_centroid';
}

export interface ServiceArea {
  code: string;
  name: string;
  legacyWardCode: string | null;
  groupName: string | null;
  description: string | null;
  displayColor: string;
  areaKm2: number | null;
  center: { latitude: number; longitude: number };
  boundary: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  selected: boolean;
  isDemo: boolean;
  provenanceStatus: 'reference_reconstructed' | 'manually_verified' | 'official';
}

export interface AreaLookup extends AreaSummary {
  population: number | null;
  areaKm2: number | null;
  densityPerKm2: number | null;
  center: { latitude: number; longitude: number } | null;
  boundary: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  } | null;
  serviceAreas: ServiceArea[];
  station: Station | null;
  directory: DirectoryEntry[];
}

export interface LookupEnvelope {
  data: AreaLookup;
  meta: { dataSource: 'postgres' | 'fixture' };
}

export type IncidentStatus = 'submitted' | 'received' | 'assigned' | 'verifying' | 'processing' | 'resolved' | 'closed' | 'rejected';
export type SosStatus = 'triggered' | 'dispatched' | 'acknowledged' | 'responding' | 'escalated' | 'resolved' | 'closed' | 'cancelled_by_citizen';

export interface WorkflowLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  localityCode: string;
  localityName: string;
  serviceAreaCode: string | null;
  serviceAreaName: string | null;
  routingStatus: 'approved_service_area' | 'locality_dispatch';
}

export interface WorkflowHistory<TStatus extends string> {
  fromStatus: TStatus | null;
  toStatus: TStatus;
  actorId: string;
  actorRole: string;
  note: string | null;
  publicMessage: boolean;
  createdAt: string;
}

export interface AssignedOfficer {
  id: string;
  displayName: string;
}

export interface Incident {
  kind: 'incident';
  id: string;
  receiptCode: string;
  category: 'security' | 'traffic' | 'public_order' | 'administrative' | 'environment' | 'other';
  summary: string;
  description: string;
  locationNote: string | null;
  contactPhone: string | null;
  status: IncidentStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  location: WorkflowLocation;
  assignedOfficer: AssignedOfficer | null;
  operationalMode: 'local_sandbox' | 'pilot' | 'production';
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistory<IncidentStatus>[];
  attachments: IncidentAttachment[];
  satisfactionRating?: SatisfactionRating | null;
  /** Chỉ có ở hồ sơ cán bộ. */
  duplicateOf?: CaseRef | null;
  suggestedDuplicateOf?: (CaseRef & { score: number }) | null;
  duplicates?: CaseRef[];
}

export interface IncidentAttachment {
  id: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  purpose: 'initial' | 'supplemental' | 'evidence';
  uploaderRole: 'citizen' | 'officer' | 'supervisor';
}

export interface IncidentMessage {
  id: string;
  authorRole: 'citizen' | 'officer' | 'supervisor';
  authorLabel: string;
  message: string;
  requestMedia: boolean;
  createdAt: string;
}

export interface PublicStats {
  pilotAreas: number;
  officers: number;
  installs: number;
  verifiedUsers: number;
  incidentsReceived: number;
  incidentsProcessed: number;
  avgResponseMinutes: number | null;
  opinions: Array<{ id: string; authorRole: 'citizen' | 'officer'; authorLabel: string; comment: string; score: number | null }>;
  /** true khi đang có dữ liệu mẫu để trình diễn. */
  demoData: boolean;
  updatedAt: string;
}

export interface PublicAlert {
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

export interface SatisfactionRating {
  id: string;
  receiptCode: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export interface PatrolSession {
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

export interface ShiftSummary {
  date: string;
  incidentsReceived: number;
  incidentsResolved: number;
  sosReceived: number;
  sosResolved: number;
  patrolsCompleted: number;
  overdueOpen: number;
}

export type StatisticsPeriod = 'day' | 'month' | 'year';

export interface OfficerStatistics {
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
  kpis?: OfficerKpis;
}

export interface OperationalMapPoint {
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

export type OperationalMapPointInput = Omit<OperationalMapPoint, 'id' | 'localityCode' | 'createdAt' | 'updatedAt'>;

export interface SosEvent {
  kind: 'sos';
  id: string;
  receiptCode: string;
  category: 'security' | 'traffic_accident' | 'fire_rescue' | 'medical' | 'other_emergency';
  note: string | null;
  contactPhone: string | null;
  reporterName?: string | null;
  status: SosStatus;
  location: WorkflowLocation;
  assignedOfficer: AssignedOfficer | null;
  operationalMode: 'local_sandbox' | 'pilot' | 'production';
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: WorkflowHistory<SosStatus>[];
  satisfactionRating?: SatisfactionRating | null;
}

export interface OfficerReportCase {
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

export interface OfficerQueueItem {
  kind: 'incident' | 'sos';
  id: string;
  receiptCode: string;
  category: string;
  title: string;
  status: IncidentStatus | SosStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  localityCode: string;
  localityName: string;
  serviceAreaName: string | null;
  /** Chỉ có ở SOS: người bấm SOS. */
  reporterName?: string | null;
  reporterPhone?: string | null;
  assignedOfficer: AssignedOfficer | null;
  createdAt: string;
  updatedAt: string;
  duplicateOfReceiptCode?: string | null;
  suggestedDuplicateReceiptCode?: string | null;
  previewAttachmentId?: string | null;
  photoCount?: number;
}

export interface WorkflowActor {
  id: string;
  actorType: 'officer' | 'supervisor';
  displayName: string;
  localityCode: string | null;
  /** Khu vực cán bộ phụ trách; null với chỉ huy. */
  serviceArea: { code: string; name: string } | null;
  phone: string | null;
  /** Địa bàn phụ trách theo quyết định phân công (tổ dân phố). */
  beatNote: string | null;
}

export interface RatingSummary { average: number | null; count: number; lowScoreCount: number }

/** Tài khoản cán bộ mà chỉ huy quản lý. Không bao giờ có mật khẩu. */
export interface ManagedOfficer {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  serviceArea: { code: string; name: string } | null;
}

/** Một khu vực của phường và cán bộ CSKV phụ trách, kèm đánh giá của người dân trong kỳ. */
export interface AreaOfficerOverview {
  serviceArea: { code: string; name: string };
  officer: { id: string; displayName: string; phone: string | null; beatNote: string | null } | null;
  from: string;
  to: string;
  incidents: { received: number; open: number; resolved: number };
  sosReceived: number;
  incidentRating: RatingSummary;
  sosRating: RatingSummary;
  /** Số lượt đánh giá 1 đến 5 sao của cán bộ trong kỳ. */
  starCounts: [number, number, number, number, number];
  /** Đánh giá mới nhất trong kỳ kèm nội dung góp ý. */
  recentReviews: OfficerReview[];
}

export interface OfficerReview {
  kind: 'incident' | 'sos';
  score: number;
  comment: string | null;
  createdAt: string;
  receiptCode: string;
}

export interface OfficerNotification {
  id: string;
  aggregateType: 'incident' | 'sos';
  aggregateId: string;
  eventType: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface WorkflowMeta {
  workflowMode: 'local_sandbox';
  authentication: 'http_only_session';
  emergencyDispatchConnected: false;
}

export interface CitizenSession {
  id: string;
  displayName: string;
  /** Số điện thoại gắn với tài khoản (tên đăng nhập là số điện thoại), nếu có. */
  phone?: string | null;
}

/** Kết quả đăng ký: mã khôi phục chỉ có khi máy chủ đã hỗ trợ và chỉ hiện đúng một lần. */
export interface CitizenRegistration extends CitizenSession {
  recoveryCode?: string;
  /** 'sent': đã gửi mã xác minh tới email vừa nhập; 'unavailable': chưa gửi được (chưa kết nối email hoặc quá hạn mức). */
  emailVerification?: 'sent' | 'unavailable';
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

export interface CaseRef {
  id: string;
  receiptCode: string;
}

export interface AiStatus {
  configured: boolean;
  provider: 'OpenAI' | 'Gemini' | null;
  features: Array<'incident_draft' | 'incident_review' | 'reply_draft' | 'procedure_help' | 'translate' | 'report_summary'>;
}

export interface ReportSummary {
  headline: string;
  highlights: string[];
  concerns: string[];
  unverifiedNumbers: string[];
  provider: 'OpenAI' | 'Gemini';
}

export interface AssigneeSuggestion {
  id: string;
  displayName: string;
  openCases: number;
}

export interface IncidentReplyDraft {
  message: string;
  requestMedia: boolean;
  provider: 'OpenAI' | 'Gemini';
}

export interface IncidentDraft {
  category: Incident['category'];
  summary: string;
  description: string;
  occurredAt: string | null;
  locationNote: string | null;
  emergency: boolean;
  provider: 'OpenAI' | 'Gemini';
}

export type ImageLabel =
  | 'fire_smoke' | 'traffic_accident' | 'crowd_gathering' | 'fighting_or_weapon' | 'flood_or_landslide'
  | 'property_damage' | 'waste_or_pollution' | 'document_or_screenshot' | 'no_incident_visible' | 'unclear';

export interface IncidentAiReview {
  id: string;
  incidentId: string;
  createdAt: string;
  suggestedCategory: Incident['category'];
  confidence: 'low' | 'medium' | 'high';
  reason: string | null;
  imageFindings: Array<{ attachmentId: string; labels: ImageLabel[] }>;
  provider: 'OpenAI' | 'Gemini';
  model: string;
  decision: 'accepted' | 'changed' | 'kept' | null;
  decidedCategory: Incident['category'] | null;
  decidedAt: string | null;
}

export interface DuplicateCandidate {
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

export interface AppRating {
  score: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Bộ chỉ số mục 9.2 của bản mô tả giải pháp. */
export interface OfficerKpis {
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
