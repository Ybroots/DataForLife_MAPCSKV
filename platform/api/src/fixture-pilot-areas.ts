import fs from 'node:fs';
import type { AreaLookupResponse, DirectoryEntryResponse, GeoJSON, ServiceAreaResponse } from './types.js';

/**
 * Ba địa bàn dùng để trình diễn trong chế độ fixture: Xuân Hương, Xuân Trường và Lâm Viên (Đà Lạt).
 * Ranh giới phường lấy từ map34.json (đã đơn giản hóa); các khu vực bên trong là DỮ LIỆU THAM CHIẾU/MINH HỌA:
 *  - Xuân Hương: tái dựng từ 5 phường cũ (nguồn GADM 2015), như migration 004.
 *  - Xuân Trường, Lâm Viên: chia theo hình học, không phải ranh xã/phường cũ hay ranh phân công CSKV.
 * Số điện thoại và tên cán bộ là giá trị giữ chỗ, không phải đầu mối thật.
 */
interface PilotZoneSource {
  code: string; name: string; legacyWardCode: string | null; groupName: string | null; description: string;
  displayColor: string; areaKm2: number; center: { latitude: number; longitude: number };
  boundary: GeoJSON.MultiPolygon;
}
interface PilotAreaSource {
  code: string; name: string; localityType: string; provinceName: string;
  population: number; areaKm2: number; densityPerKm2: number;
  center: { latitude: number; longitude: number };
  boundary: GeoJSON.MultiPolygon;
  zones: PilotZoneSource[];
}

export const PLACEHOLDER_PHONE = '090 000 0000';

export function loadPilotAreaSources(url = new URL('../fixture-data/pilot-areas.json', import.meta.url)): PilotAreaSource[] {
  const parsed = JSON.parse(fs.readFileSync(url, 'utf8')) as Record<string, PilotAreaSource>;
  return ['24781', '24805', '24778'].map((code) => {
    const area = parsed[code];
    if (!area) throw new Error(`Thiếu dữ liệu địa bàn ${code} trong fixture-data/pilot-areas.json`);
    return area;
  });
}

function ringContains(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i]!;
    const [px, py] = ring[j]!;
    if (x === undefined || y === undefined || px === undefined || py === undefined) continue;
    if ((y > latitude) !== (py > latitude) && longitude < (px - x) * (latitude - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export function geometryContains(boundary: GeoJSON.MultiPolygon | GeoJSON.Polygon, longitude: number, latitude: number): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates as number[][][]] : boundary.coordinates as number[][][][];
  return polygons.some(([outer, ...holes]) => outer !== undefined && ringContains(longitude, latitude, outer)
    && !holes.some((hole) => ringContains(longitude, latitude, hole)));
}

function demoDirectory(source: PilotAreaSource): DirectoryEntryResponse[] {
  const lead: DirectoryEntryResponse = {
    id: `demo-${source.code}-lead`, displayName: 'Đầu mối Công an phường (minh họa)', rank: null,
    roleTitle: 'Liên hệ chung của địa bàn', phone: PLACEHOLDER_PHONE, entryType: 'unit_contact',
  };
  // Mỗi khu vực có một cảnh sát khu vực giữ chỗ, để màn hình bản đồ có số lượng điểm CSKV theo khu giống Xuân Hương.
  const officers = source.zones.map<DirectoryEntryResponse>((zone, index) => ({
    id: `demo-${source.code}-officer-${index + 1}`, displayName: `CSKV số ${index + 1} (minh họa)`, rank: null,
    roleTitle: `Phụ trách ${zone.name}`, phone: PLACEHOLDER_PHONE, entryType: 'officer',
  }));
  return [lead, ...officers];
}

export class PilotArea {
  constructor(private readonly source: PilotAreaSource) {}
  get code() { return this.source.code; }
  get name() { return this.source.name; }
  get localityType() { return this.source.localityType; }
  get provinceName() { return this.source.provinceName; }
  get boundary() { return this.source.boundary; }

  contains(latitude: number, longitude: number): boolean {
    return geometryContains(this.source.boundary, longitude, latitude);
  }

  lookup(position?: { latitude: number; longitude: number }): AreaLookupResponse {
    const source = structuredClone(this.source);
    const selectedCode = position
      ? source.zones.find((zone) => geometryContains(zone.boundary, position.longitude, position.latitude))?.code
      : undefined;
    const serviceAreas: ServiceAreaResponse[] = source.zones.map((zone) => ({
      code: zone.code, name: zone.name, legacyWardCode: zone.legacyWardCode, groupName: zone.groupName,
      description: zone.description, displayColor: zone.displayColor, areaKm2: zone.areaKm2, center: zone.center,
      boundary: zone.boundary, selected: zone.code === selectedCode, isDemo: true, provenanceStatus: 'reference_reconstructed',
    }));
    return {
      code: source.code, name: source.name, localityType: source.localityType, provinceName: source.provinceName,
      population: source.population, areaKm2: source.areaKm2, densityPerKm2: source.densityPerKm2,
      center: source.center, boundary: source.boundary, serviceAreas,
      station: { name: 'Trụ sở Công an phường (dữ liệu minh họa)', address: null, latitude: null, longitude: null, locationSource: 'address_only' },
      directory: demoDirectory(source),
    };
  }
}
