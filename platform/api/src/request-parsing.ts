import type { IncidentAttachmentInput } from './types.js';

/**
 * Đọc và kiểm tra dữ liệu đầu vào của mọi route: một nơi duy nhất cho giới hạn độ dài, tọa độ, số điện thoại, tệp đính kèm.
 * Mỗi hàm trả null (hoặc undefined với trường tùy chọn) khi dữ liệu không hợp lệ; route tự chọn mã lỗi và thông báo.
 */

export const incidentCategories = new Set(['security', 'traffic', 'public_order', 'administrative', 'environment', 'other']);
export const sosCategories = new Set(['security', 'traffic_accident', 'fire_rescue', 'medical', 'other_emergency']);
export const incidentStatuses = new Set(['submitted', 'received', 'assigned', 'verifying', 'processing', 'resolved', 'closed', 'rejected']);
export const sosStatuses = new Set(['triggered', 'dispatched', 'acknowledged', 'responding', 'escalated', 'resolved', 'closed', 'cancelled_by_citizen']);
export const alertCategories = new Set(['security', 'traffic', 'fire_rescue', 'weather', 'other']);
export const alertRiskLevels = new Set(['info', 'medium', 'high']);
export const patrolActions = new Set(['start', 'pause', 'resume', 'checkin', 'complete']);
export const statisticsPeriods = new Set(['day', 'month', 'year']);
const mapPointTypes = new Set(['police_post', 'camera', 'risk_point', 'patrol_checkpoint', 'public_facility']);
const mapPointStatuses = new Set(['active', 'inactive', 'maintenance']);
const mapPointVisibilities = new Set(['officer', 'public']);

export function parseCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function headerIdentity(value: string | string[] | undefined): string | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(normalized)) return null;
  return normalized;
}

export function text(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

export function passwordText(value: unknown, minimum: number, maximum: number): string | null {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum ? value : null;
}

export function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return text(value, 1, maximum) ?? undefined;
}

export function parseAccuracy(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000 ? parsed : undefined;
}

export function parsePhone(value: unknown): string | null | undefined {
  const normalized = optionalText(value, 30);
  if (normalized === null || normalized === undefined) return normalized;
  const compact = normalized.replace(/[\s().-]/g, '');
  if (!/^\+?\d{8,15}$/.test(compact)) return undefined;
  return normalized;
}

export function parseDeviceTimestamp(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const age = now - parsed;
  if (age < -5 * 60_000 || age > 24 * 60 * 60_000) return null;
  return new Date(parsed).toISOString();
}

export function parseOperationalMapPoint(body: Record<string, unknown>) {
  const name = text(body.name, 3, 160);
  const pointType = typeof body.pointType === 'string' && mapPointTypes.has(body.pointType) ? body.pointType : null;
  const description = optionalText(body.description, 1200);
  const contactPhone = parsePhone(body.contactPhone);
  const status = typeof body.status === 'string' && mapPointStatuses.has(body.status) ? body.status : null;
  const visibility = typeof body.visibility === 'string' && mapPointVisibilities.has(body.visibility) ? body.visibility : null;
  const latitude = parseCoordinate(body.latitude, -90, 90);
  const longitude = parseCoordinate(body.longitude, -180, 180);
  if (!name || !pointType || description === undefined || contactPhone === undefined || !status || !visibility || latitude === null || longitude === null) return null;
  return { name, pointType, description, contactPhone, status, visibility, latitude, longitude } as import('./types.js').OperationalMapPointInput;
}

export function parseIncidentAttachments(value: unknown): IncidentAttachmentInput[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const item = value[0];
  if (!item || typeof item !== 'object') return null;
  const candidate = item as Record<string, unknown>;
  const fileName = text(candidate.fileName, 1, 180);
  const mimeType = typeof candidate.mimeType === 'string' && ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(candidate.mimeType)
    ? candidate.mimeType as IncidentAttachmentInput['mimeType']
    : null;
  const sizeBytes = typeof candidate.sizeBytes === 'number' && Number.isInteger(candidate.sizeBytes)
    && candidate.sizeBytes >= 1 && candidate.sizeBytes <= (candidate.mimeType?.toString().startsWith('video/') ? 20 : 5) * 1024 * 1024
    ? candidate.sizeBytes
    : null;
  const dataBase64 = typeof candidate.dataBase64 === 'string' && /^[a-zA-Z0-9+/]+={0,2}$/.test(candidate.dataBase64)
    ? candidate.dataBase64
    : null;
  if (!fileName || !mimeType || !sizeBytes || !dataBase64) return null;
  const decoded = Buffer.from(dataBase64, 'base64');
  if (decoded.length !== sizeBytes) return null;
  if (!matchesDeclaredMedia(decoded, mimeType)) return null;
  return [{ fileName, mimeType, sizeBytes, dataBase64 }];
}

/** Chuỗi thời gian hợp lệ (ISO hoặc bất kỳ dạng Date.parse đọc được) thành ISO UTC; null nếu không đọc được. */
export function parseIsoTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** Kiểm tra byte đầu của tệp khớp loại khai báo, để không nhận tệp HTML/script đội lốt ảnh hoặc video. */
export function matchesDeclaredMedia(data: Buffer, mimeType: IncidentAttachmentInput['mimeType']): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  switch (mimeType) {
    case 'image/jpeg': return startsWith(0xff, 0xd8, 0xff);
    case 'image/png': return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp': return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    case 'video/mp4': return data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp';
    case 'video/webm': return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    default: return false;
  }
}
