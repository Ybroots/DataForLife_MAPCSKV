/**
 * Kiểu dữ liệu trả về từ API bandosocskv.com.
 * PHẢI khớp platform/web/src/types.ts và platform/api (nguồn sự thật). Đã đối chiếu với
 * GET /v1/directory/units, /v1/areas, /v1/lookup/by-code, /v1/hotlines, /v1/areas/overview
 * và các route /v1/auth/*. Không thêm trường mà API không trả về.
 */

export interface AreaSummary {
  code: string;
  name: string;
  localityType: string | null;
  provinceName: string | null;
}

/** Một đầu mối liên hệ (cán bộ hoặc số của đơn vị). */
export interface DirectoryEntry {
  id: string;
  displayName: string;
  rank: string | null;
  roleTitle: string | null;
  phone: string;
  entryType: 'officer' | 'unit_contact';
}

/** GET /v1/directory/units — đầu mối cấp đơn vị (phòng, thanh tra, đồn...). */
export interface PublicUnitContact extends DirectoryEntry {
  unitCode: string;
  unitName: string;
  address: string | null;
}

export interface Hotline {
  id: string;
  categoryCode: string;
  categoryLabel: string;
  label: string;
  phone: string;
}

export interface Station {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: 'address_only' | 'surveyed' | 'official_coordinate' | 'area_centroid';
}

/** GET /v1/lookup/by-code/:code và /v1/lookup/by-location (phần `data`). */
export interface AreaLookup extends AreaSummary {
  population: number | null;
  areaKm2: number | null;
  densityPerKm2: number | null;
  center: { latitude: number; longitude: number } | null;
  station: Station | null;
  directory: DirectoryEntry[];
}

export interface LookupEnvelope {
  data: AreaLookup;
  meta: { dataSource: 'postgres' | 'fixture' };
}

/** GET /v1/areas/overview (phần `data`): 124 địa bàn, mỗi địa bàn có ranh giới. */
export interface AreaOverview {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id: string; properties: AreaSummary }>;
}

/** POST /v1/auth/citizen/login | register, GET /v1/auth/citizen/session. */
export interface CitizenSession {
  id: string;
  displayName: string;
}

/** POST /v1/auth/officer/login, GET /v1/auth/officer/session. */
export interface OfficerSession {
  id: string;
  actorType: 'officer' | 'supervisor';
  displayName: string;
  localityCode: string | null;
}
