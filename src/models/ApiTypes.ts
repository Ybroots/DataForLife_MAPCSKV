/**
 * Types cho dữ liệu trả về từ API bandosocskv.com
 * Đồng bộ với platform/web/src/types.ts (phần public-facing)
 */

// ─── Danh bạ đơn vị công khai ───────────────────────────────────────────────

/** Một đầu mối liên hệ trong danh bạ đơn vị */
export interface PublicUnitContact {
  unitCode: string;
  unitName: string;
  unitType: string;
  /** Tên cán bộ phụ trách (đã ẩn tên riêng theo cấu hình) */
  chiefLabel?: string | null;
  /** Số điện thoại đơn vị (hiển thị dạng icon/link, không text thuần) */
  phone?: string | null;
  address?: string | null;
  localityCode?: string | null;
  localityName?: string | null;
  districtName?: string | null;
}

// ─── Kết quả tra cứu theo vị trí / mã địa bàn ───────────────────────────────

export interface LookupEnvelope {
  locality?: LocalityResult | null;
  contacts?: PublicUnitContact[];
  hotlines?: Hotline[];
  /** GeoJSON polygon ranh giới địa bàn */
  boundary?: GeoJsonPolygon | null;
  meta?: {
    dataSource: 'postgres' | 'fixture';
    localityCode?: string | null;
  };
}

export interface LocalityResult {
  code: string;
  name: string;
  type: string;
  districtName?: string | null;
  provinceName?: string | null;
  population?: number | null;
  areaKm2?: number | null;
  address?: string | null;
  stationAddress?: string | null;
}

export interface Hotline {
  id: string;
  label: string;
  phone: string;
  category: string;
  localityCode?: string | null;
}

export interface GeoJsonPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

// ─── Tổng quan tỉnh ──────────────────────────────────────────────────────────

export interface AreaOverview {
  totalLocalities: number;
  totalContacts: number;
  totalHotlines: number;
  totalUnits: number;
  provinceName: string;
  updatedAt?: string | null;
}

export interface AreaSummary {
  code: string;
  name: string;
  type: string;
  districtName?: string | null;
}

// ─── Phiên đăng nhập ─────────────────────────────────────────────────────────

export interface CitizenSession {
  id: string;
  username: string;
  displayName: string;
  role: 'citizen';
  createdAt: string;
}

export interface OfficerSession {
  id: string;
  username: string;
  displayName: string;
  role: 'officer' | 'supervisor' | 'admin';
  localityCode?: string | null;
  unitCode?: string | null;
}
