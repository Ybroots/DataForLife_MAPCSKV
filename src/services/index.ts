/**
 * Entry point cho services.
 * Phiên bản 2.x: dùng API HTTPS (bandosocskv.com) thay Firestore.
 *
 * Các file Firestore cũ (CommuneService, ContactService, ContactCombinedService)
 * vẫn còn trong thư mục nhưng không được export ra ngoài.
 */

// ─── API services mới ─────────────────────────────────────────────────────────
export * from './apiClient';
export * from './DirectoryService';
export * from './AuthService';
export * from './LocationService';

// ─── Re-export tương thích ngược để các màn hình cũ không bị lỗi compile ─────
// TODO: Xóa sau khi ContactsScreen được viết lại hoàn toàn
export { getAllContactsWithCommunes, loadAreaContacts, deleteContact } from './ContactCombinedService';

