import { describe, expect, it } from 'vitest';
import { translateText } from '../src/i18n';
import { EN_PATTERNS, EN_TEXT } from '../src/i18n-en';

describe('chuyển ngôn ngữ Tiếng Việt / English', () => {
  it('dịch câu cố định, bỏ qua khoảng trắng thừa', () => {
    expect(translateText('Gửi phản ánh')).toBe('Send report');
    expect(translateText('  Danh bạ   địa bàn \n')).toBe('Area directory');
  });

  it('dịch câu có phần thay đổi và dịch tiếp phần bên trong nếu có trong bảng', () => {
    expect(translateText('Đăng nhập để gửi phản ánh')).toBe('Sign in to send a report');
    expect(translateText('Giữ thêm 2 giây')).toBe('Hold 2 more seconds');
    expect(translateText('103.178 người')).toBe('103.178 people');
    expect(translateText('Thông báo, 3 chưa đọc')).toBe('Notifications, 3 unread');
  });

  it('không đụng tên địa danh, nội dung cán bộ viết và câu thường có chữ "người" ở cuối', () => {
    expect(translateText('Xuân Hương - Đà Lạt')).toBeNull();
    expect(translateText('Nhắc nhở mọi người')).toBeNull();
    expect(translateText('')).toBeNull();
  });

  it('bảng dịch không chứa chữ của cổng cán bộ (bản Android chỉ dành cho người dân)', () => {
    const all = [...Object.keys(EN_TEXT), ...EN_PATTERNS.map(([vi]) => vi)].join('\n');
    for (const needle of ['Cán bộ Công an', 'Cổng nghiệp vụ', 'portal=police', 'Đăng nhập CSKV']) expect(all).not.toContain(needle);
  });

  it('mỗi mẫu tiếng Anh dùng đúng các chỗ trống của mẫu tiếng Việt', () => {
    for (const [vi, en] of EN_PATTERNS) {
      const slots = (text: string) => [...text.matchAll(/\{(\d+)#?\}/g)].map((m) => m[1]).sort().join(',');
      expect(slots(en), vi).toBe(slots(vi));
    }
  });
});
