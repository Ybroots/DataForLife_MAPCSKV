/**
 * Bản nháp phản ánh lưu ngay trên điện thoại: nếu app bị tắt giữa chừng (sang chụp ảnh, chọn tệp, hết pin, hệ thống thu hồi bộ nhớ)
 * thì lần sau người dân không phải gõ lại. Chỉ lưu chữ người dân đã gõ; không lưu ảnh/video, vị trí và ô xác nhận.
 * Xóa khi gửi xong, khi người dân bấm "Xóa bản nháp", khi đăng xuất, hoặc sau 3 ngày.
 */
const KEY = 'cskv-report-draft-v1';
const MAX_AGE_MS = 3 * 24 * 60 * 60_000;

export interface ReportDraft {
  category: string;
  summary: string;
  description: string;
  locationNote: string;
  contactPhone: string;
  savedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function isBlankDraft(draft: Pick<ReportDraft, 'summary' | 'description' | 'locationNote' | 'contactPhone'>): boolean {
  return !draft.summary.trim() && !draft.description.trim() && !draft.locationNote.trim() && !draft.contactPhone.trim();
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

export function loadReportDraft(storage: StorageLike | null = defaultStorage(), now = Date.now()): ReportDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportDraft> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number') { storage.removeItem(KEY); return null; }
    if (now - parsed.savedAt > MAX_AGE_MS || parsed.savedAt > now + 60_000) { storage.removeItem(KEY); return null; }
    const draft: ReportDraft = {
      category: text(parsed.category, 40),
      summary: text(parsed.summary, 180),
      description: text(parsed.description, 4000),
      locationNote: text(parsed.locationNote, 500),
      contactPhone: text(parsed.contactPhone, 20),
      savedAt: parsed.savedAt,
    };
    return isBlankDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function saveReportDraft(draft: Omit<ReportDraft, 'savedAt'>, storage: StorageLike | null = defaultStorage(), now = Date.now()): void {
  if (!storage) return;
  try {
    if (isBlankDraft(draft)) { storage.removeItem(KEY); return; }
    storage.setItem(KEY, JSON.stringify({ ...draft, savedAt: now }));
  } catch { /* hết dung lượng hoặc bị chặn: bỏ qua, không làm hỏng việc đang gõ */ }
}

export function clearReportDraft(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(KEY); } catch { /* bỏ qua */ }
}
