/**
 * Danh sách phiên đã đăng xuất (theo nonce của phiên), giữ đến lúc phiên tự hết hạn.
 * Lưu trong bộ nhớ của tiến trình, giống việc thu hồi phiên sau khi đặt lại mật khẩu: máy chủ khởi động lại thì danh sách
 * mất, nhưng phiên chỉ sống tối đa 8–12 giờ.
 */
const MAX_ENTRIES = 20_000;
const revoked = new Map<string, number>();

function prune(now: number): void {
  for (const [nonce, expiresAt] of revoked) if (expiresAt <= now) revoked.delete(nonce);
}

export function revokeSessionNonce(nonce: string, expiresAt: number, now = Date.now()): void {
  if (expiresAt <= now) return;
  if (revoked.size >= MAX_ENTRIES) prune(now);
  // Quá đầy mà không có phiên nào hết hạn: bỏ mục cũ nhất để bộ nhớ không tăng vô hạn.
  if (revoked.size >= MAX_ENTRIES) revoked.delete(revoked.keys().next().value as string);
  revoked.set(nonce, expiresAt);
}

export function isSessionNonceRevoked(nonce: string, now = Date.now()): boolean {
  const expiresAt = revoked.get(nonce);
  if (expiresAt === undefined) return false;
  if (expiresAt <= now) { revoked.delete(nonce); return false; }
  return true;
}
