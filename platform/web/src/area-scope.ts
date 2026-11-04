import type { AreaLookup, ServiceArea } from './types';
import { pointInBoundary } from './citizen-map-points';

/**
 * Cán bộ CSKV chỉ phụ trách một khu vực: thu hẹp địa bàn về đúng khu vực đó (ranh, nhãn, vùng làm mờ).
 * Không truyền mã khu vực (chỉ huy, cán bộ chưa gắn khu vực) thì giữ nguyên toàn địa bàn.
 */
export function scopeAreaToZone(area: AreaLookup, zoneCode: string | null | undefined): AreaLookup {
  if (!zoneCode) return area;
  const zone = area.serviceAreas.find((candidate) => candidate.code === zoneCode);
  return zone ? { ...area, boundary: zone.boundary, serviceAreas: [zone] } : area;
}

export function zoneBoundaryOf(area: AreaLookup | null, zoneCode: string | null | undefined): ServiceArea['boundary'] | null {
  if (!area || !zoneCode) return null;
  return area.serviceAreas.find((candidate) => candidate.code === zoneCode)?.boundary ?? null;
}

/** Giữ lại các điểm nằm trong khu vực; không có ranh (không giới hạn) thì giữ tất cả. Điểm chưa có vị trí bị loại khi có giới hạn. */
export function filterPointsInZone<T extends { latitude: number | null; longitude: number | null }>(
  items: readonly T[], boundary: ServiceArea['boundary'] | null,
): T[] {
  if (!boundary) return [...items];
  return items.filter((item) => item.latitude !== null && item.longitude !== null && pointInBoundary(item.longitude, item.latitude, boundary));
}
