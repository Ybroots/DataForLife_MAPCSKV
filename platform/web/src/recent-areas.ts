// Danh sách địa bàn đã xem gần đây, chỉ lưu trong thiết bị của người dùng (không gửi lên máy chủ).
export interface RecentArea { code: string; name: string }

const KEY = 'cskv-recent-areas-v1';
export const MAX_RECENT_AREAS = 4;

function isRecentArea(value: unknown): value is RecentArea {
  if (typeof value !== 'object' || value === null) return false;
  const { code, name } = value as Record<string, unknown>;
  return typeof code === 'string' && code.length > 0 && code.length <= 32 && typeof name === 'string' && name.length > 0 && name.length <= 120;
}

export function readRecentAreas(storage: Pick<Storage, 'getItem'> | null = safeStorage()): RecentArea[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentArea).slice(0, MAX_RECENT_AREAS) : [];
  } catch {
    return [];
  }
}

/** Đưa địa bàn lên đầu danh sách, bỏ trùng mã, giữ tối đa MAX_RECENT_AREAS mục. Trả về danh sách mới. */
export function rememberArea(area: RecentArea, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): RecentArea[] {
  const next = [{ code: area.code, name: area.name }, ...readRecentAreas(storage).filter(item => item.code !== area.code)].slice(0, MAX_RECENT_AREAS);
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* bộ nhớ bị chặn: vẫn dùng danh sách trong phiên */ }
  return next;
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
