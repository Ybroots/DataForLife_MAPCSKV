/**
 * ContactCombinedService v2 — dùng API HTTPS thay Firestore
 *
 * Giữ nguyên tên hàm export (getAllContactsWithCommunes, deleteContact)
 * để ContactsScreen không cần thay đổi giao diện.
 *
 * Không còn gọi Firestore. Mọi data từ bandosocskv.com/api.
 */

import { listUnitContacts } from './DirectoryService';
import { adaptUnitContacts } from './DirectoryAdapter';
import type { ContactWithCommune } from '../models/ContactWithCommune';

/**
 * Lấy tất cả contacts kèm thông tin commune từ API.
 * Thay thế ContactCombinedService.getAllContactsWithCommunes() cũ.
 */
export async function getAllContactsWithCommunes(): Promise<ContactWithCommune[]> {
  const units = await listUnitContacts();
  return adaptUnitContacts(units);
}

/**
 * Stub: xóa contact.
 * App mobile công khai không có quyền xóa dữ liệu qua API.
 * Hàm này giữ để không vỡ import trong ContactsScreen cũ.
 */
export async function deleteContact(_id: string): Promise<void> {
  throw new Error('Không có quyền xóa liên hệ từ ứng dụng này.');
}
