/**
 * DirectoryAdapter — ánh xạ PublicUnitContact từ API mới sang ContactWithCommune (model cũ)
 *
 * Mục đích: cho phép ContactsScreen giữ nguyên logic UI hiện tại
 * trong khi data source đã chuyển hoàn toàn sang API Postgres.
 *
 * Mapping:
 *   unitCode           → ma_xa (mã địa bàn)
 *   unitName           → ten_xa (tên đơn vị)
 *   unitType/group     → communeInfo.cap (loại cấp)
 *   chiefLabel         → fullName (tên cán bộ phụ trách)
 *   phone              → mobile
 *   districtName       → communeInfo.ten_tinh (đơn giản hóa: tỉnh/huyện)
 *
 * Cấp (cap):
 *   'provincial'   → 3 (tỉnh)
 *   'district'     → 1 (phòng/huyện)
 *   'commune'      → 2 (xã/phường)
 *   khác           → 2 (mặc định về xã)
 */

import type { PublicUnitContact } from '../models/ApiTypes';
import type { ContactWithCommune } from '../models/ContactWithCommune';
import type { Commune } from '../models/Commune';

function unitTypeToCap(unitType: string): number {
  const t = unitType.toLowerCase();
  if (t.includes('provincial') || t.includes('tinh') || t.includes('tỉnh')) return 3;
  if (t.includes('district') || t.includes('phong') || t.includes('phòng') || t.includes('huyen') || t.includes('huyện')) return 1;
  return 2; // mặc định cấp xã/phường
}

/**
 * Chuyển một PublicUnitContact sang ContactWithCommune
 */
export function adaptUnitContact(unit: PublicUnitContact): ContactWithCommune {
  const cap = unitTypeToCap(unit.unitType);

  const communeInfo: Commune = {
    id: unit.unitCode,
    ma_xa: unit.unitCode,
    ten_xa: unit.localityName || unit.unitName,
    name: unit.unitName,
    loai: unit.unitType,
    cap,
    ma_tinh: 'LDG', // Lâm Đồng
    ten_tinh: unit.districtName || 'Lâm Đồng',
    dan_so: 0,
    dtich_km2: 0,
    matdo_km2: 0,
    address: unit.address || '',
    tru_so: unit.address || '',
    sap_nhap: '',
  };

  return {
    id: unit.unitCode,
    ma_xa: unit.localityCode || unit.unitCode,
    ten_xa: unit.localityName || unit.unitName,
    fullName: unit.chiefLabel || unit.unitName,
    mobile: unit.phone || null,
    communeInfo,
  };
}

/**
 * Chuyển danh sách PublicUnitContact sang ContactWithCommune[]
 * để ContactsScreen dùng trực tiếp mà không cần thay đổi UI.
 */
export function adaptUnitContacts(units: PublicUnitContact[]): ContactWithCommune[] {
  return units.map(adaptUnitContact);
}
