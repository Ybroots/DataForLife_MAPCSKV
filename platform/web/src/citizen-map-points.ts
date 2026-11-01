import type { AreaLookup, PublicAlert, ServiceArea } from './types';

export interface CitizenMapPoint {
  id: string;
  kind: 'station' | 'officer' | 'alert';
  serviceAreaCode: string;
  name: string;
  detail: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  demo: boolean;
}

// Polygon membership is for display only, never for operational dispatch.
function ringContains(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i]!;
    const [px, py] = ring[j]!;
    if (x === undefined || y === undefined || px === undefined || py === undefined) continue;
    const cross = (longitude - x) * (py - y) - (latitude - y) * (px - x);
    if (Math.abs(cross) < 1e-12 && longitude >= Math.min(x, px) && longitude <= Math.max(x, px)
      && latitude >= Math.min(y, py) && latitude <= Math.max(y, py)) return true;
    if ((y > latitude) !== (py > latitude) && longitude < (px - x) * (latitude - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export function pointInBoundary(longitude: number, latitude: number, boundary: ServiceArea['boundary']): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates as number[][][]] : boundary.coordinates as number[][][][];
  return polygons.some(([outer, ...holes]) => outer && ringContains(longitude, latitude, outer)
    && !holes.some((hole) => ringContains(longitude, latitude, hole)));
}

function demoStationPosition(zone: ServiceArea) {
  // Separate demo pins geographically; never shift existing officer markers in screen pixels.
  for (const distance of [0.006, 0.003, 0.001, 0.0003]) {
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      const latitude = zone.center.latitude + Math.sin(angle) * distance;
      const longitude = zone.center.longitude + Math.cos(angle) * distance;
      if (pointInBoundary(longitude, latitude, zone.boundary)) return { latitude, longitude };
    }
  }
  return zone.center;
}

/** Các địa bàn trình diễn có khu vực bên trong, kèm tên gọi dùng trong nhãn điểm tiếp dân. */
export const PILOT_AREA_LABELS: Readonly<Record<string, string>> = {
  '24781': 'Xuân Hương',
  '24805': 'Xuân Trường',
  '24778': 'Lâm Viên',
};

/** 'former_wards': khu vực tái dựng từ phường cũ; 'geometric': khu vực chia minh họa theo hình học. */
export function zoneReferenceKind(area: Pick<AreaLookup, 'serviceAreas'> | null): 'former_wards' | 'geometric' | null {
  if (!area?.serviceAreas.length) return null;
  return area.serviceAreas.every((zone) => zone.legacyWardCode) ? 'former_wards' : 'geometric';
}

/** Nhãn ngắn trên pin CSKV: "P.3" cho phường cũ, "K2" cho khu vực chia minh họa. */
export function zoneBadgeLabel(zone: Pick<ServiceArea, 'code' | 'legacyWardCode'>): string {
  if (zone.legacyWardCode) return `P.${zone.legacyWardCode}`;
  return zone.code.split('-').pop() ?? zone.code;
}

function zoneLongLabel(zone: ServiceArea): string {
  return zone.legacyWardCode ? `P.${zone.legacyWardCode} cũ` : zone.name;
}

export function buildCitizenMapPoints(area: AreaLookup | null): CitizenMapPoint[] {
  // Dữ liệu trình diễn chỉ dành cho các địa bàn thí điểm, không áp cho phường khác được tra cứu.
  const wardLabel = area ? PILOT_AREA_LABELS[area.code] : undefined;
  if (!area || !wardLabel || !area.serviceAreas.length) return [];
  const withPhone = area.directory.filter((entry) => entry.phone.trim());
  // Pin CSKV đại diện cho cảnh sát khu vực: ưu tiên đầu mối loại "officer" nếu địa bàn có.
  const officers = withPhone.filter((entry) => entry.entryType === 'officer');
  const contacts = officers.length ? officers : withPhone;
  const points: CitizenMapPoint[] = [];
  area.serviceAreas.forEach((zone, index) => {
    const contact = contacts.length ? contacts[index % contacts.length] : null;
    points.push({
      id: `officer:${zone.code}`, kind: 'officer', serviceAreaCode: zone.code,
      name: `${contact?.displayName ?? 'Đầu mối CSKV'} · ${zoneLongLabel(zone)}`,
      detail: 'Liên hệ công khai của phường; vị trí pin minh họa.',
      phone: contact?.phone ?? null, ...zone.center, demo: true,
    });
    // Xuân Hương giữ trụ sở chính ở Phường 3 cũ; địa bàn khác dùng khu đầu tiên.
    const isMain = area.code === '24781' ? zone.legacyWardCode === '3' && Boolean(area.station) : index === 0 && Boolean(area.station);
    const mainPosition = { latitude: 11.9327, longitude: 108.4426 };
    const position = isMain && area.code === '24781' && pointInBoundary(mainPosition.longitude, mainPosition.latitude, zone.boundary)
      ? mainPosition : demoStationPosition(zone);
    const receptionName = zone.legacyWardCode
      ? `Điểm tiếp dân Công an ${wardLabel} · Khu P.${zone.legacyWardCode}`
      : `Điểm tiếp dân Công an ${wardLabel} · ${zone.name}`;
    const receptionDetail = zone.legacyWardCode
      ? `Điểm tiếp dân giả định trong khu Phường ${zone.legacyWardCode} cũ, chưa có địa chỉ chính thức.`
      : `Điểm tiếp dân giả định trong ${zone.name}, chưa có địa chỉ chính thức.`;
    points.push({
      id: `station:${zone.code}`, kind: 'station', serviceAreaCode: zone.code,
      name: isMain ? area.station!.name : receptionName,
      detail: isMain ? area.station!.address ?? `Phường ${wardLabel} – Đà Lạt` : receptionDetail,
      phone: contact?.phone ?? null, ...position, demo: true,
    });
  });
  return points;
}

export function buildPublicAlertPoints(area: AreaLookup | null, alerts: PublicAlert[]): CitizenMapPoint[] {
  if (!area) return [];
  return alerts.flatMap((alert) => {
    if (alert.areaCode !== area.code || alert.latitude === null || alert.longitude === null) return [];
    const zone = area.serviceAreas.find(candidate => pointInBoundary(alert.longitude!, alert.latitude!, candidate.boundary));
    return [{ id: `alert:${alert.id}`, kind: 'alert' as const, serviceAreaCode: zone?.code ?? area.code,
      name: alert.title, detail: alert.summary, phone: null,
      latitude: alert.latitude, longitude: alert.longitude, demo: false }];
  });
}

export function pointsWithinZone(points: CitizenMapPoint[], zone: ServiceArea): CitizenMapPoint[] {
  return points.filter((point) => pointInBoundary(point.longitude, point.latitude, zone.boundary));
}
