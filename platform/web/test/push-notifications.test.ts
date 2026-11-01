import { describe, expect, it } from 'vitest';
import {
  followArea, MAX_FOLLOWED_AREAS, parsePushTarget, pushSupported, readPushPrefs, unfollowArea, writePushPrefs, type PushPrefs,
} from '../src/push-notifications';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    get raw() { return value; },
  };
}

const empty: PushPrefs = { enabled: false, asked: false, areas: [] };

describe('thông báo trên điện thoại: tùy chọn lưu trong thiết bị', () => {
  it('mặc định là chưa hỏi, chưa bật, chưa theo dõi khu vực nào', () => {
    expect(readPushPrefs(memoryStorage())).toEqual(empty);
    expect(readPushPrefs(null)).toEqual(empty);
  });

  it('lưu rồi đọc lại đúng nội dung', () => {
    const storage = memoryStorage();
    const prefs: PushPrefs = { enabled: true, asked: true, areas: [{ code: '24781', name: 'Phường Xuân Hương - Đà Lạt' }] };
    writePushPrefs(prefs, storage);
    expect(readPushPrefs(storage)).toEqual(prefs);
  });

  it('bỏ qua dữ liệu hỏng, không làm ứng dụng lỗi', () => {
    expect(readPushPrefs(memoryStorage('{không phải json'))).toEqual(empty);
    expect(readPushPrefs(memoryStorage('"chuỗi"'))).toEqual(empty);
    expect(readPushPrefs(memoryStorage('{"enabled":"yes","asked":1,"areas":"x"}'))).toEqual(empty);
    const mixed = readPushPrefs(memoryStorage(JSON.stringify({
      enabled: true, asked: true,
      areas: [{ code: '24781', name: 'Hợp lệ' }, { code: 'a', name: 'Mã quá ngắn' }, { code: '24805', name: '' }, { code: "x'; DROP", name: 'Ký tự lạ' }, 7, null],
    })));
    expect(mixed.areas).toEqual([{ code: '24781', name: 'Hợp lệ' }]);
  });

  it('không làm hỏng khi bộ nhớ trình duyệt bị chặn', () => {
    expect(() => writePushPrefs(empty, { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
});

describe('theo dõi khu vực', () => {
  const area = (code: string) => ({ code, name: `Khu vực ${code}` });

  it('đưa khu vực mới lên đầu và không trùng mã', () => {
    let prefs = followArea(empty, area('24781'));
    prefs = followArea(prefs, area('24805'));
    prefs = followArea(prefs, area('24781'));
    expect(prefs.areas.map((item) => item.code)).toEqual(['24781', '24805']);
  });

  it(`giữ tối đa ${MAX_FOLLOWED_AREAS} khu vực, bỏ mục cũ nhất`, () => {
    let prefs = empty;
    for (const code of ['AAA1', 'BBB2', 'CCC3', 'DDD4']) prefs = followArea(prefs, area(code));
    expect(prefs.areas.map((item) => item.code)).toEqual(['DDD4', 'CCC3', 'BBB2']);
  });

  it('bỏ theo dõi đúng khu vực và giữ nguyên các tùy chọn khác', () => {
    const prefs = unfollowArea({ enabled: true, asked: true, areas: [area('24781'), area('24805')] }, '24781');
    expect(prefs).toEqual({ enabled: true, asked: true, areas: [area('24805')] });
  });
});

describe('dữ liệu đi kèm thông báo', () => {
  it('nhận cảnh báo khu vực và cập nhật hồ sơ đúng định dạng', () => {
    expect(parsePushTarget({ type: 'alert', areaCode: '24781', alertId: 'x' })).toEqual({ type: 'alert', areaCode: '24781' });
    expect(parsePushTarget({ type: 'citizen', kind: 'incident', receiptCode: 'PA-2026-AB12CD34' }))
      .toEqual({ type: 'citizen', kind: 'incident', receiptCode: 'PA-2026-AB12CD34' });
    expect(parsePushTarget({ type: 'citizen', kind: 'sos', receiptCode: 'SOS-20261101-AB12CD34' }))
      .toEqual({ type: 'citizen', kind: 'sos', receiptCode: 'SOS-20261101-AB12CD34' });
  });

  it('từ chối mọi dạng khác, kể cả mã có ký tự đặc biệt', () => {
    for (const value of [
      undefined, null, 'chuỗi', 7, {}, { type: 'unknown' },
      { type: 'alert' }, { type: 'alert', areaCode: 'a' }, { type: 'alert', areaCode: '../../x' }, { type: 'alert', areaCode: 7 },
      { type: 'citizen', kind: 'other', receiptCode: 'PA-2026-AB12CD34' },
      { type: 'citizen', kind: 'incident' }, { type: 'citizen', kind: 'incident', receiptCode: 'PA 1&x=2' },
      { type: 'citizen', kind: 'incident', receiptCode: 'x'.repeat(65) },
    ]) expect(parsePushTarget(value), JSON.stringify(value)).toBeNull();
  });

  it('không bật trên web thường hoặc khi build thiếu cấu hình Firebase', () => {
    expect(pushSupported()).toBe(false);
  });
});
