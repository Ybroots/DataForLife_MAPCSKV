import type {
  AreaSummary,
  AreaOverview,
  CitizenSession,
  CitizenRegistration,
  CitizenNotificationPage,
  Incident,
  IncidentAttachment,
  IncidentMessage,
  IncidentStatus,
  Hotline,
  PublicUnitContact,
  LookupEnvelope,
  OfficerNotification,
  OfficerReportCase,
  CommanderReport,
  OfficerStatistics,
  OperationalMapPoint,
  OperationalMapPointInput,
  OfficerQueueItem,
  PublicAlert,
  PublicStats,
  SatisfactionRating,
  SosEvent,
  SosStatus,
  WorkflowActor,
  AreaOfficerOverview,
  ManagedOfficer,
  WorkflowMeta,
  StatisticsPeriod,
  MapAssistantStatus,
  MapAssistantAnswer,
  AiStatus,
  AppRating,
  DuplicateCandidate,
  IncidentAiReview,
  AssigneeSuggestion,
  ReportSummary,
  IncidentReplyDraft,
  ProcedureAnswer,
  IncidentDraft,
} from './types';

import { apiFetch } from './native-api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function getMapAssistantStatus(signal?: AbortSignal): Promise<MapAssistantStatus> {
  return (await request<{ data: MapAssistantStatus }>('/v1/assistant/status', { signal })).data;
}

export async function askMapAssistant(question: string, areaCode: string | null, signal?: AbortSignal): Promise<MapAssistantAnswer> {
  return (await request<{ data: MapAssistantAnswer }>('/v1/assistant/query', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, areaCode }),
  })).data;
}

export async function translateWithAi(text: string, target: 'en' | 'vi'): Promise<string> {
  const payload = await request<{ data: { translation: string } }>('/v1/ai/translate', {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ text, target }),
  });
  return payload.data.translation;
}

export async function askProcedure(question: string, useAi: boolean, lang: 'vi' | 'en', signal?: AbortSignal): Promise<ProcedureAnswer> {
  return (await request<{ data: ProcedureAnswer }>('/v1/assistant/procedure', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, ai: useAi, lang }),
  })).data;
}

export async function getAreaOverview(): Promise<{ data: AreaOverview; meta: { dataSource: 'postgres' | 'fixture' } }> {
  return request('/v1/areas/overview');
}

export async function listUnitContacts(): Promise<PublicUnitContact[]> {
  return (await request<{ data: PublicUnitContact[] }>('/v1/directory/units')).data;
}

export async function listCitizenNotifications(options: { cursor?: string; unreadOnly?: boolean; signal?: AbortSignal } = {}): Promise<CitizenNotificationPage> {
  const params = new URLSearchParams({ limit: '30', unread: options.unreadOnly ? '1' : '0' });
  if (options.cursor) params.set('cursor', options.cursor);
  const payload = await request<{ data: CitizenNotificationPage }>(`/v1/citizen/notifications?${params}`, { signal: options.signal });
  return payload.data;
}

export async function markCitizenNotificationsRead(ids: string[]): Promise<void> {
  await request('/v1/citizen/notifications/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as { message?: string; error?: string } & T;
  if (!response.ok) {
    throw new ApiError(
      payload.message || 'Không thể kết nối hệ thống.',
      response.status,
      payload.error || 'REQUEST_FAILED',
    );
  }
  return payload;
}

function citizenHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

function officerHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

export async function signInOfficer(username: string, password: string): Promise<WorkflowActor> {
  const payload = await request<{ data: WorkflowActor }>('/v1/auth/officer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  return payload.data;
}

export async function getOfficerSession(): Promise<WorkflowActor | null> {
  try {
    const payload = await request<{ data: WorkflowActor }>('/v1/auth/officer/session');
    return payload.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOutOfficer(): Promise<void> {
  await request<void>('/v1/auth/officer/logout', { method: 'POST' });
}

export async function signInCitizen(username: string, password: string): Promise<CitizenSession> {
  const payload = await request<{ data: CitizenSession }>('/v1/auth/citizen/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  return payload.data;
}

export async function registerCitizen(username: string, displayName: string, password: string, email?: string): Promise<CitizenRegistration> {
  const payload = await request<{ data: CitizenRegistration }>('/v1/auth/citizen/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, displayName, password, ...(email ? { email } : {}) }),
  });
  return payload.data;
}

/** Quên mật khẩu: số điện thoại + mã khôi phục + mật khẩu mới. Trả về mã khôi phục mới (mã cũ đã dùng, không dùng lại được). */
export async function resetCitizenPassword(username: string, recoveryCode: string, newPassword: string): Promise<{ recoveryCode: string }> {
  const payload = await request<{ data: { recoveryCode: string } }>('/v1/auth/citizen/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, recoveryCode, newPassword }),
  });
  return payload.data;
}

/** Người dân đã đăng nhập tạo lại mã khôi phục (mã cũ hết hiệu lực). */
export async function createCitizenRecoveryCode(currentPassword: string): Promise<{ recoveryCode: string }> {
  const payload = await request<{ data: { recoveryCode: string } }>('/v1/auth/citizen/recovery-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword }),
  });
  return payload.data;
}

export interface CitizenEmailStatus { available: boolean; email: string | null; verified: boolean }

/** Cách tự lấy lại mật khẩu nào đang dùng được trên máy chủ này. */
export async function getCitizenRecoveryOptions(): Promise<{ email: boolean }> {
  const payload = await request<{ data: { email: boolean } }>('/v1/auth/citizen/recovery-options');
  return payload.data;
}

export async function getCitizenEmailStatus(): Promise<CitizenEmailStatus> {
  const payload = await request<{ data: CitizenEmailStatus }>('/v1/auth/citizen/email');
  return payload.data;
}

/** Thêm email khôi phục: máy chủ gửi mã 6 số tới email đó để xác minh. */
export async function requestCitizenEmailVerification(email: string, currentPassword: string): Promise<{ email: string }> {
  const payload = await request<{ data: { sent: boolean; email: string } }>('/v1/auth/citizen/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, currentPassword }),
  });
  return { email: payload.data.email };
}

export async function verifyCitizenEmail(code: string): Promise<{ email: string; verified: boolean }> {
  const payload = await request<{ data: { email: string; verified: boolean } }>('/v1/auth/citizen/email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  return payload.data;
}

/** Quên mật khẩu bước 1: gửi mã 6 số tới email đã xác minh (luôn báo đã gửi, không lộ số nào có tài khoản). */
export async function requestPasswordResetEmail(username: string): Promise<void> {
  await request<unknown>('/v1/auth/citizen/forgot-password/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
  });
}

/** Quên mật khẩu bước 2: số điện thoại + mã từ email + mật khẩu mới. */
export async function confirmPasswordResetEmail(username: string, code: string, newPassword: string): Promise<void> {
  await request<unknown>('/v1/auth/citizen/forgot-password/email-confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, code, newPassword }),
  });
}


export async function getCitizenSession(): Promise<CitizenSession | null> {
  try {
    const payload = await request<{ data: CitizenSession }>('/v1/auth/citizen/session');
    return payload.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function changeCitizenPassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>('/v1/auth/citizen/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function signOutCitizen(): Promise<void> {
  await request<void>('/v1/auth/citizen/logout', { method: 'POST' });
}

export async function searchAreas(query: string): Promise<AreaSummary[]> {
  const payload = await request<{ data: AreaSummary[] }>(`/v1/areas?query=${encodeURIComponent(query)}&limit=8`);
  return payload.data;
}

export async function lookupByCode(code: string): Promise<LookupEnvelope> {
  return request<LookupEnvelope>(`/v1/lookup/by-code/${encodeURIComponent(code)}`);
}

export async function lookupByLocation(latitude: number, longitude: number): Promise<LookupEnvelope> {
  return request<LookupEnvelope>(`/v1/lookup/by-location?lat=${latitude}&lng=${longitude}`);
}

export async function listHotlines(): Promise<Hotline[]> {
  const payload = await request<{ data: Hotline[] }>('/v1/hotlines');
  return payload.data;
}

/** Máy chủ đã cấu hình khóa FCM và thật sự gửi được thông báo đẩy hay chưa. */
export async function getPushStatus(signal?: AbortSignal): Promise<{ enabled: boolean }> {
  return (await request<{ data: { enabled: boolean } }>('/v1/push/status', { signal })).data;
}

/** Đăng ký (hoặc cập nhật) thiết bị nhận thông báo. Phiên đăng nhập người dân, nếu có, được gắn vào thiết bị. */
export async function registerPushDevice(token: string, areaCodes: string[]): Promise<void> {
  await request('/v1/push/devices', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, areaCodes }),
  });
}

export async function registerOfficerPushDevice(token: string): Promise<void> {
  await request('/v1/push/officer-devices', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
}

export async function removePushDevice(token: string): Promise<void> {
  await request('/v1/push/devices/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
}

export async function listPublicAlerts(areaCode?: string): Promise<PublicAlert[]> {
  const payload = await request<{ data: PublicAlert[] }>(areaCode ? `/v1/public/alerts?areaCode=${encodeURIComponent(areaCode)}` : '/v1/public/alerts');
  return payload.data;
}

export async function getPublicStats(): Promise<PublicStats> {
  const payload = await request<{ data: PublicStats }>('/v1/public/stats');
  return payload.data;
}

export async function createIncident(input: {
  clientRequestId: string;
  category: Incident['category'];
  summary: string;
  description: string;
  locationNote?: string | null;
  contactPhone?: string | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  attachments: Array<{
    fileName: string;
    mimeType: IncidentAttachment['mimeType'];
    sizeBytes: number;
    dataBase64: string;
  }>;
}): Promise<{ data: Incident; meta: WorkflowMeta }> {
  return request('/v1/citizen/incidents', {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify(input),
  });
}

export async function listCitizenIncidents(): Promise<{ data: Incident[]; meta: WorkflowMeta }> {
  return request('/v1/citizen/incidents', { headers: citizenHeaders() });
}

export async function getCitizenIncident(receiptCode: string): Promise<Incident> {
  return (await request<{ data: Incident }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}`)).data;
}

export async function getCitizenSos(receiptCode: string): Promise<SosEvent> {
  return (await request<{ data: SosEvent }>(`/v1/citizen/sos/${encodeURIComponent(receiptCode)}`)).data;
}

export async function listCitizenIncidentMessages(receiptCode: string): Promise<IncidentMessage[]> {
  const payload = await request<{ data: IncidentMessage[] }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}/messages`, { headers: citizenHeaders() });
  return payload.data;
}

export async function addCitizenIncidentMessage(receiptCode: string, message: string): Promise<IncidentMessage> {
  const payload = await request<{ data: IncidentMessage }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}/messages`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ message }),
  });
  return payload.data;
}

export async function addCitizenIncidentAttachment(receiptCode: string, attachment: {
  fileName: string; mimeType: IncidentAttachment['mimeType']; sizeBytes: number; dataBase64: string;
}): Promise<IncidentAttachment> {
  const payload = await request<{ data: IncidentAttachment }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}/attachments`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ attachment }),
  });
  return payload.data;
}

export async function createSatisfactionRating(receiptCode: string, score: number, comment: string): Promise<SatisfactionRating> {
  const payload = await request<{ data: SatisfactionRating }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}/rating`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ score, comment }),
  });
  return payload.data;
}

export async function createSos(input: {
  idempotencyKey: string;
  category: SosEvent['category'];
  note?: string | null;
  contactPhone?: string | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  deviceTimestamp: string;
}): Promise<{ data: SosEvent; meta: WorkflowMeta }> {
  return request('/v1/citizen/sos', {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify(input),
  });
}

export async function listCitizenSos(): Promise<{ data: SosEvent[]; meta: WorkflowMeta }> {
  return request('/v1/citizen/sos', { headers: citizenHeaders() });
}

export async function cancelCitizenSos(receiptCode: string, note: string): Promise<{ data: SosEvent; meta: WorkflowMeta }> {
  return request(`/v1/citizen/sos/${encodeURIComponent(receiptCode)}/cancel`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ note }),
  });
}

export async function reportCitizenSosSafe(receiptCode: string): Promise<SosEvent> {
  const payload = await request<{ data: SosEvent }>(`/v1/citizen/sos/${encodeURIComponent(receiptCode)}/safe`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({}),
  });
  return payload.data;
}

export async function withdrawCitizenIncident(receiptCode: string): Promise<Incident> {
  const payload = await request<{ data: Incident }>(`/v1/citizen/incidents/${encodeURIComponent(receiptCode)}/withdraw`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({}),
  });
  return payload.data;
}

/** Locality codes that currently have at least one active officer account able to receive SOS. */
export async function getDutyCoverage(): Promise<string[]> {
  const payload = await request<{ data: { localityCodes: string[] } }>('/v1/public/duty-coverage');
  return payload.data.localityCodes;
}

export async function listOfficerQueue(kind?: 'incident' | 'sos'): Promise<{ data: OfficerQueueItem[]; meta: WorkflowMeta }> {
  return request(`/v1/officer/queue${kind ? `?kind=${kind}` : ''}`, { headers: officerHeaders() });
}

export async function listOfficerArchive(filters: { q?: string; from?: string; to?: string } = {}): Promise<OfficerQueueItem[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim().slice(0, 80));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = params.toString();
  const payload = await request<{ data: OfficerQueueItem[] }>(`/v1/officer/archive${query ? `?${query}` : ''}`, { headers: officerHeaders() });
  return payload.data;
}

export async function listOfficerReportCases(period: StatisticsPeriod, date: string): Promise<OfficerReportCase[]> {
  const payload = await request<{ data: OfficerReportCase[] }>(`/v1/officer/reports/cases?period=${period}&date=${encodeURIComponent(date)}`, { headers: officerHeaders() });
  return payload.data;
}

export async function getCommanderReport(period: StatisticsPeriod, date: string): Promise<CommanderReport> {
  const payload = await request<{ data: CommanderReport }>(`/v1/commander/report?period=${period}&date=${encodeURIComponent(date)}`, { headers: officerHeaders() });
  return payload.data;
}

export async function getAreaOfficerOverview(period: StatisticsPeriod, date: string): Promise<AreaOfficerOverview[]> {
  const payload = await request<{ data: AreaOfficerOverview[] }>(`/v1/commander/area-officers?period=${period}&date=${encodeURIComponent(date)}`, { headers: officerHeaders() });
  return payload.data;
}

export async function listManagedOfficers(): Promise<ManagedOfficer[]> {
  const payload = await request<{ data: ManagedOfficer[] }>('/v1/commander/officers', { headers: officerHeaders() });
  return payload.data;
}

/** `serviceAreaCode`: null để bỏ gắn khu vực (cán bộ thấy cả phường); bỏ trống thì giữ nguyên. */
export async function updateManagedOfficer(id: string, changes: { username?: string; serviceAreaCode?: string | null }): Promise<ManagedOfficer> {
  const payload = await request<{ data: ManagedOfficer }>(`/v1/commander/officers/${encodeURIComponent(id)}/update`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify(changes),
  });
  return payload.data;
}

/** Đặt mật khẩu do chỉ huy nhập, hoặc để hệ thống tạo (`generate`): mật khẩu tạo ra chỉ có trong kết quả này. */
export async function setManagedOfficerPassword(id: string, how: { password: string } | { generate: true }): Promise<{ officer: ManagedOfficer; generatedPassword: string | null }> {
  const payload = await request<{ data: ManagedOfficer; generatedPassword?: string }>(`/v1/commander/officers/${encodeURIComponent(id)}/password`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify(how),
  });
  return { officer: payload.data, generatedPassword: payload.generatedPassword ?? null };
}

export async function listWorkflowActors(): Promise<{ data: WorkflowActor[]; meta: WorkflowMeta }> {
  return request('/v1/officer/actors', { headers: officerHeaders() });
}

export async function getOfficerIncident(id: string): Promise<{ data: Incident; meta: WorkflowMeta }> {
  return request(`/v1/officer/incidents/${encodeURIComponent(id)}`, { headers: officerHeaders() });
}

export async function listOfficerIncidentMessages(id: string): Promise<IncidentMessage[]> {
  const payload = await request<{ data: IncidentMessage[] }>(`/v1/officer/incidents/${encodeURIComponent(id)}/messages`, { headers: officerHeaders() });
  return payload.data;
}

export async function addOfficerIncidentMessage(id: string, message: string, requestMedia: boolean): Promise<IncidentMessage> {
  const payload = await request<{ data: IncidentMessage }>(`/v1/officer/incidents/${encodeURIComponent(id)}/messages`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ message, requestMedia }),
  });
  return payload.data;
}

export async function addOfficerIncidentAttachment(id: string, attachment: {
  fileName: string; mimeType: IncidentAttachment['mimeType']; sizeBytes: number; dataBase64: string;
}): Promise<IncidentAttachment> {
  const payload = await request<{ data: IncidentAttachment }>(`/v1/officer/incidents/${encodeURIComponent(id)}/attachments`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ attachment }),
  });
  return payload.data;
}

export async function createPublicAlert(input: Omit<PublicAlert, 'id' | 'areaCode' | 'status' | 'createdAt' | 'startsAt' | 'endsAt'> & { startsAt?: string; endsAt?: string }): Promise<PublicAlert> {
  const payload = await request<{ data: PublicAlert }>('/v1/officer/alerts', {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify(input),
  });
  return payload.data;
}

export type PublicAlertChanges = Partial<Pick<PublicAlert, 'title' | 'summary' | 'category' | 'riskLevel' | 'startsAt' | 'endsAt'>> & { latitude?: number; longitude?: number };

export async function updatePublicAlert(id: string, changes: PublicAlertChanges): Promise<PublicAlert> {
  const payload = await request<{ data: PublicAlert }>(`/v1/officer/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: officerHeaders(), body: JSON.stringify(changes),
  });
  return payload.data;
}

/** Gỡ cảnh báo đang hiển thị: người dân không còn thấy trên bản đồ. */
export async function cancelPublicAlert(id: string): Promise<void> {
  await request<void>(`/v1/officer/alerts/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export async function getOfficerStatistics(period: StatisticsPeriod, date: string): Promise<OfficerStatistics> {
  const payload = await request<{ data: OfficerStatistics }>(`/v1/officer/statistics?period=${period}&date=${encodeURIComponent(date)}`, { headers: officerHeaders() });
  return payload.data;
}

export async function listOperationalMapPoints(): Promise<OperationalMapPoint[]> {
  const payload = await request<{ data: OperationalMapPoint[] }>('/v1/officer/map-points', { headers: officerHeaders() });
  return payload.data;
}

export async function createOperationalMapPoint(input: OperationalMapPointInput): Promise<OperationalMapPoint> {
  const payload = await request<{ data: OperationalMapPoint }>('/v1/officer/map-points', {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify(input),
  });
  return payload.data;
}

export async function updateOperationalMapPoint(id: string, input: OperationalMapPointInput): Promise<OperationalMapPoint> {
  const payload = await request<{ data: OperationalMapPoint }>(`/v1/officer/map-points/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: officerHeaders(), body: JSON.stringify(input),
  });
  return payload.data;
}

export async function deleteOperationalMapPoint(id: string): Promise<void> {
  await request<void>(`/v1/officer/map-points/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getIncidentAttachmentUrl(scope: 'citizen' | 'officer', incidentKey: string, attachmentId: string): Promise<string> {
  const path = scope === 'citizen'
    ? `/v1/citizen/incidents/${encodeURIComponent(incidentKey)}/attachments/${encodeURIComponent(attachmentId)}/content`
    : `/v1/officer/incidents/${encodeURIComponent(incidentKey)}/attachments/${encodeURIComponent(attachmentId)}/content`;
  const response = await apiFetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: undefined,
  }, true);
  if (!response.ok) throw new ApiError('Không thể tải tệp minh chứng.', response.status, 'ATTACHMENT_LOAD_FAILED');
  return URL.createObjectURL(await response.blob());
}

export async function getOfficerSos(id: string): Promise<{ data: SosEvent; meta: WorkflowMeta }> {
  return request(`/v1/officer/sos/${encodeURIComponent(id)}`, { headers: officerHeaders() });
}

export async function transitionOfficerIncident(
  id: string,
  toStatus: IncidentStatus,
  note: string,
  assignedOfficerId?: string | null,
  publicMessage = false,
): Promise<{ data: Incident; meta: WorkflowMeta }> {
  return request(`/v1/officer/incidents/${encodeURIComponent(id)}/transitions`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ toStatus, note, assignedOfficerId, publicMessage }),
  });
}

export async function transitionOfficerSos(
  id: string,
  toStatus: SosStatus,
  note: string,
  assignedOfficerId?: string | null,
  publicMessage = false,
): Promise<{ data: SosEvent; meta: WorkflowMeta }> {
  return request(`/v1/officer/sos/${encodeURIComponent(id)}/transitions`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ toStatus, note, assignedOfficerId, publicMessage }),
  });
}

export async function listOfficerNotifications(): Promise<{ data: OfficerNotification[]; meta: WorkflowMeta }> {
  return request('/v1/officer/notifications', { headers: officerHeaders() });
}

/* ---------- AI hỗ trợ điền phiếu, nhóm trùng, gợi ý lĩnh vực, đánh giá ---------- */

export async function getAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  return (await request<{ data: AiStatus }>('/v1/ai/status', { signal })).data;
}

export async function draftIncidentWithAi(text: string, image?: { mimeType: string; dataBase64: string }): Promise<IncidentDraft> {
  return (await request<{ data: IncidentDraft }>('/v1/citizen/incident-draft', {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify(image ? { text, image } : { text }),
  })).data;
}

export async function summarizeReportWithAi(period: StatisticsPeriod, date: string): Promise<ReportSummary> {
  return (await request<{ data: ReportSummary }>('/v1/officer/statistics/summary', {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ period, date }),
  })).data;
}

export async function getAssigneeSuggestion(id: string): Promise<AssigneeSuggestion | null> {
  return (await request<{ data: { suggestion: AssigneeSuggestion | null } }>(`/v1/officer/incidents/${encodeURIComponent(id)}/assignee-suggestion`, { headers: officerHeaders() })).data.suggestion;
}

export async function draftIncidentReply(id: string): Promise<IncidentReplyDraft> {
  return (await request<{ data: IncidentReplyDraft }>(`/v1/officer/incidents/${encodeURIComponent(id)}/reply-draft`, {
    method: 'POST',
  })).data;
}

export async function listIncidentDuplicates(id: string): Promise<DuplicateCandidate[]> {
  return (await request<{ data: DuplicateCandidate[] }>(`/v1/officer/incidents/${encodeURIComponent(id)}/duplicates`, { headers: officerHeaders() })).data;
}

export async function setIncidentDuplicateOf(id: string, primaryId: string | null): Promise<Incident> {
  return (await request<{ data: Incident }>(`/v1/officer/incidents/${encodeURIComponent(id)}/duplicate-of`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ primaryId }),
  })).data;
}

export async function getIncidentAiReview(id: string): Promise<IncidentAiReview | null> {
  return (await request<{ data: IncidentAiReview | null }>(`/v1/officer/incidents/${encodeURIComponent(id)}/ai-review`, { headers: officerHeaders() })).data;
}

export async function requestIncidentAiReview(id: string): Promise<IncidentAiReview> {
  return (await request<{ data: IncidentAiReview }>(`/v1/officer/incidents/${encodeURIComponent(id)}/ai-review`, {
    method: 'POST', headers: officerHeaders(), body: '{}',
  })).data;
}

export async function decideIncidentCategory(id: string, category: Incident['category'], reviewId: string | null): Promise<Incident> {
  return (await request<{ data: Incident }>(`/v1/officer/incidents/${encodeURIComponent(id)}/category`, {
    method: 'POST', headers: officerHeaders(), body: JSON.stringify({ category, reviewId }),
  })).data;
}

export async function getAppRating(): Promise<AppRating | null> {
  return (await request<{ data: AppRating | null }>('/v1/citizen/app-rating', { headers: citizenHeaders() })).data;
}

export async function saveAppRating(score: number, comment: string): Promise<AppRating> {
  return (await request<{ data: AppRating }>('/v1/citizen/app-rating', {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ score, comment: comment.trim() || null }),
  })).data;
}

export async function createSosRating(receiptCode: string, score: number, comment: string): Promise<SatisfactionRating> {
  return (await request<{ data: SatisfactionRating }>(`/v1/citizen/sos/${encodeURIComponent(receiptCode)}/rating`, {
    method: 'POST', headers: citizenHeaders(), body: JSON.stringify({ score, comment: comment.trim() || null }),
  })).data;
}
