/**
 * Thông báo nổi (popup) ngắn trong ứng dụng, mỗi chức năng một biểu tượng riêng.
 * Gọi showToast từ bất kỳ đâu; AppToasts (gắn một lần trong App) hiển thị.
 * Khác với thông báo đẩy của hệ thống (push-notifications.ts): đây chỉ là phản hồi tức thời khi người dân vừa thao tác.
 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error';
export type ToastTopic = 'report' | 'sos' | 'account' | 'location' | 'alert' | 'rating' | 'notify' | 'map' | 'language';

export interface ToastDetail {
  kind: ToastKind;
  topic: ToastTopic;
  title: string;
  message?: string;
}

export const TOAST_EVENT = 'cskv:toast';

export function showToast(detail: ToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
