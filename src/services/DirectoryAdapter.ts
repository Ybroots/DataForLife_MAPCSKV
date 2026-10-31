/**
 * DirectoryAdapter — chuyển dữ liệu API thật sang ContactWithCommune để ContactsScreen dùng.
 *
 * Quy tắc: không bịa dữ liệu. Trường API không có thì để null/rỗng (UI hiển thị "đang cập nhật"),
 * tuyệt đối không dùng 0 hoặc giá trị mặc định thay cho số liệu thật.
 *
 * Phân nhóm hiển thị (cap): 3 = cấp tỉnh (hotline), 1 = cấp phòng (đơn vị từ /v1/directory/units),
 * 2 = xã/phường/đặc khu/đồn (124 địa bàn và các đồn).
 */

import type { AreaLookup, AreaOverview, DirectoryEntry, Hotline, PublicUnitContact } from '../models/ApiTypes';
import type { Commune } from '../models/Commune';
import type { ContactWithCommune } from '../models/ContactWithCommune';

export const CAP_PHONG = 1;
export const CAP_XA = 2;
export const CAP_TINH = 3;

function baseCommune(code: string, name: string, cap: number, extra: Partial<Commune> = {}): Commune {
  return {
    id: code,
    ma_xa: code,
    ten_xa: name,
    name,
    loai: '',
    cap,
    ma_tinh: '',
    ten_tinh: '',
    dan_so: null,
    dtich_km2: null,
    matdo_km2: null,
    address: '',
    tru_so: '',
    sap_nhap: '',
    ...extra,
  };
}

/** "Đồn Công an KCN ..." thuộc nhóm xã/phường/đồn; các đơn vị còn lại là cấp phòng. */
export function unitCap(unitName: string): number {
  return unitName.trim().toLowerCase().startsWith('đồn') ? CAP_XA : CAP_PHONG;
}

/** displayName đã có thể chứa chức danh ("A - Trưởng phòng"); chỉ thêm roleTitle nếu chưa có. */
export function entryLabel(entry: Pick<DirectoryEntry, 'displayName' | 'roleTitle'>): string {
  const name = entry.displayName.trim();
  const role = entry.roleTitle?.trim();
  if (!role || name.toLowerCase().includes(role.toLowerCase())) return name;
  return `${name} - ${role}`;
}

export function adaptUnitContact(unit: PublicUnitContact): ContactWithCommune {
  return {
    id: unit.id,
    ma_xa: unit.unitCode,
    ten_xa: unit.unitName,
    fullName: entryLabel(unit),
    mobile: unit.phone || null,
    communeInfo: baseCommune(unit.unitCode, unit.unitName, unitCap(unit.unitName), {
      address: unit.address ?? '',
      tru_so: unit.address ?? '',
    }),
  };
}

export function adaptUnitContacts(units: PublicUnitContact[]): ContactWithCommune[] {
  return units.map(adaptUnitContact);
}

/** Mỗi hotline là một liên hệ; nhóm theo categoryCode, tên nhóm là categoryLabel. */
export function adaptHotlines(hotlines: Hotline[]): ContactWithCommune[] {
  return hotlines.map((hotline) => {
    const code = `HOTLINE-${hotline.categoryCode}`;
    return {
      id: hotline.id,
      ma_xa: code,
      ten_xa: hotline.categoryLabel,
      fullName: hotline.label,
      mobile: hotline.phone || null,
      communeInfo: baseCommune(code, hotline.categoryLabel, CAP_TINH),
    };
  });
}

/** Mục giữ chỗ cho từng địa bàn; đầu mối được tải khi người dùng mở rộng (adaptAreaLookup). */
export function adaptAreaPlaceholders(overview: AreaOverview): ContactWithCommune[] {
  return overview.features.map(({ properties }) => ({
    id: `area:${properties.code}`,
    ma_xa: properties.code,
    ten_xa: properties.name,
    fullName: '',
    mobile: null,
    placeholder: true,
    communeInfo: baseCommune(properties.code, properties.name, CAP_XA, {
      loai: properties.localityType ?? '',
      ten_tinh: properties.provinceName ?? '',
    }),
  }));
}

/** Thông tin địa bàn từ lookup: số liệu thật hoặc null, không dùng 0. */
export function communeFromLookup(area: AreaLookup): Commune {
  const address = area.station?.address ?? '';
  return baseCommune(area.code, area.name, CAP_XA, {
    loai: area.localityType ?? '',
    ten_tinh: area.provinceName ?? '',
    dan_so: area.population,
    dtich_km2: area.areaKm2,
    matdo_km2: area.densityPerKm2,
    address,
    tru_so: address,
  });
}

/** Đầu mối của một địa bàn (không gồm mục giữ chỗ). Rỗng nếu địa bàn chưa có đầu mối công khai. */
export function adaptAreaLookup(area: AreaLookup): ContactWithCommune[] {
  const commune = communeFromLookup(area);
  return area.directory.map((entry) => ({
    id: entry.id,
    ma_xa: area.code,
    ten_xa: area.name,
    fullName: entryLabel(entry),
    mobile: entry.phone || null,
    communeInfo: commune,
  }));
}
