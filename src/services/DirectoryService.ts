/**
 * DirectoryService — lấy danh bạ đơn vị từ API Postgres
 * Thay thế CommuneService + ContactService + ContactCombinedService cũ (Firestore).
 *
 * Nguồn dữ liệu: GET /v1/directory/units
 * Không đọc/ghi Firestore.
 */

import { apiRequest } from './apiClient';
import type { PublicUnitContact, AreaOverview, AreaSummary, LookupEnvelope, Hotline } from '../models/ApiTypes';

// ─── Danh bạ đơn vị ──────────────────────────────────────────────────────────

/**
 * Lấy toàn bộ danh bạ đơn vị công khai.
 * Tương đương getAllContactsWithCommunes() cũ nhưng từ API thật.
 */
export async function listUnitContacts(): Promise<PublicUnitContact[]> {
  const payload = await apiRequest<{ data: PublicUnitContact[] }>('/v1/directory/units');
  return payload.data;
}

// ─── Tra cứu địa bàn ─────────────────────────────────────────────────────────

/**
 * Tra cứu địa bàn + liên hệ theo tọa độ GPS.
 * Trả về polygon ranh giới, danh sách liên hệ và hotline.
 */
export async function lookupByLocation(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<LookupEnvelope> {
  return apiRequest<LookupEnvelope>(
    `/v1/lookup/by-location?lat=${latitude}&lng=${longitude}`,
    { signal },
  );
}

/**
 * Tra cứu địa bàn + liên hệ theo mã địa bàn (mã xã/phường).
 */
export async function lookupByCode(code: string, signal?: AbortSignal): Promise<LookupEnvelope> {
  return apiRequest<LookupEnvelope>(
    `/v1/lookup/by-code/${encodeURIComponent(code)}`,
    { signal },
  );
}

// ─── Tìm kiếm ────────────────────────────────────────────────────────────────

/**
 * Tìm kiếm địa bàn theo từ khóa (tên xã/phường/quận).
 */
export async function searchAreas(query: string, signal?: AbortSignal): Promise<AreaSummary[]> {
  const payload = await apiRequest<{ data: AreaSummary[] }>(
    `/v1/areas?query=${encodeURIComponent(query)}&limit=10`,
    { signal },
  );
  return payload.data;
}

// ─── Hotlines ────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách số hotline (34 số theo yêu cầu dự án).
 */
export async function listHotlines(signal?: AbortSignal): Promise<Hotline[]> {
  const payload = await apiRequest<{ data: Hotline[] }>('/v1/hotlines', { signal });
  return payload.data;
}

// ─── Tổng quan ───────────────────────────────────────────────────────────────

/**
 * Tổng quan tỉnh: số địa bàn, đầu mối, hotline.
 */
export async function getAreaOverview(signal?: AbortSignal): Promise<AreaOverview> {
  const payload = await apiRequest<{ data: AreaOverview }>('/v1/areas/overview', { signal });
  return payload.data;
}
