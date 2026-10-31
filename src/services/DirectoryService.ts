/**
 * DirectoryService — đọc dữ liệu công khai từ API Postgres (bandosocskv.com).
 * Không đọc/ghi Firestore. Chỉ GET, không tạo dữ liệu.
 */

import { apiRequest } from './apiClient';
import type {
  AreaOverview,
  AreaSummary,
  Hotline,
  LookupEnvelope,
  PublicUnitContact,
} from '../models/ApiTypes';

/** Đầu mối cấp đơn vị (phòng, thanh tra, đồn...). */
export async function listUnitContacts(signal?: AbortSignal): Promise<PublicUnitContact[]> {
  const payload = await apiRequest<{ data: PublicUnitContact[] }>('/v1/directory/units', { signal });
  return payload.data;
}

/** Tra cứu địa bàn + đầu mối theo mã địa bàn (mã xã/phường). */
export function lookupByCode(code: string, signal?: AbortSignal): Promise<LookupEnvelope> {
  return apiRequest<LookupEnvelope>(`/v1/lookup/by-code/${encodeURIComponent(code)}`, { signal });
}

/** Tra cứu địa bàn theo tọa độ GPS. 404 LOCATION_OUTSIDE_COVERAGE nếu ngoài vùng có dữ liệu. */
export function lookupByLocation(latitude: number, longitude: number, signal?: AbortSignal): Promise<LookupEnvelope> {
  return apiRequest<LookupEnvelope>(`/v1/lookup/by-location?lat=${latitude}&lng=${longitude}`, { signal });
}

/** Tìm địa bàn theo từ khóa (tối đa 10 kết quả). */
export async function searchAreas(query: string, signal?: AbortSignal): Promise<AreaSummary[]> {
  const payload = await apiRequest<{ data: AreaSummary[] }>(
    `/v1/areas?query=${encodeURIComponent(query)}&limit=10`,
    { signal },
  );
  return payload.data;
}

/** Hotline công khai. */
export async function listHotlines(signal?: AbortSignal): Promise<Hotline[]> {
  const payload = await apiRequest<{ data: Hotline[] }>('/v1/hotlines', { signal });
  return payload.data;
}

/** Danh sách 124 địa bàn (kèm ranh giới — payload lớn, API cache 5 phút). */
export async function getAreaOverview(signal?: AbortSignal): Promise<AreaOverview> {
  const payload = await apiRequest<{ data: AreaOverview }>('/v1/areas/overview', { signal });
  return payload.data;
}
