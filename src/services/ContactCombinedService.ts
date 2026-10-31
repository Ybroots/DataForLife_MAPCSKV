/**
 * Danh bạ từ API HTTPS (bandosocskv.com), không dùng Firestore.
 *
 * getAllContactsWithCommunes(): hotline (cấp tỉnh) + đơn vị (cấp phòng/đồn) + 124 địa bàn dạng
 * giữ chỗ. Đầu mối của từng địa bàn được tải khi mở rộng bằng loadAreaContacts().
 * Mọi yêu cầu phải thành công; nếu một nguồn lỗi thì báo lỗi thay vì hiện danh sách thiếu.
 */

import { getAreaOverview, listHotlines, listUnitContacts, lookupByCode } from './DirectoryService';
import { adaptAreaLookup, adaptAreaPlaceholders, adaptHotlines, adaptUnitContacts } from './DirectoryAdapter';
import type { ContactWithCommune } from '../models/ContactWithCommune';

export async function getAllContactsWithCommunes(): Promise<ContactWithCommune[]> {
  const [hotlines, units, overview] = await Promise.all([
    listHotlines(),
    listUnitContacts(),
    getAreaOverview(),
  ]);
  return [...adaptHotlines(hotlines), ...adaptUnitContacts(units), ...adaptAreaPlaceholders(overview)];
}

/** Đầu mối của một địa bàn (mã xã/phường). */
export async function loadAreaContacts(code: string, signal?: AbortSignal): Promise<ContactWithCommune[]> {
  const envelope = await lookupByCode(code, signal);
  return adaptAreaLookup(envelope.data);
}

/** Ứng dụng công khai không có quyền xóa dữ liệu; giữ hàm để không vỡ import cũ. */
export async function deleteContact(_id: string): Promise<void> {
  throw new Error('Không có quyền xóa liên hệ từ ứng dụng này.');
}
