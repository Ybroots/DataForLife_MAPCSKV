import { describe, expect, it } from 'vitest';
import { MAX_RECENT_AREAS, readRecentAreas, rememberArea } from '../src/recent-areas';
import { stationDirectionsUrl } from '../src/directions';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_k: string, v: string) => { value = v; }, get raw() { return value; } };
}

describe('địa bàn xem gần đây', () => {
  it('đưa mục mới lên đầu, bỏ trùng mã và giới hạn số lượng', () => {
    const storage = memoryStorage();
    for (let i = 1; i <= MAX_RECENT_AREAS + 2; i += 1) rememberArea({ code: `c${i}`, name: `Phường ${i}` }, storage);
    rememberArea({ code: 'c4', name: 'Phường 4' }, storage);
    const list = readRecentAreas(storage);
    expect(list).toHaveLength(MAX_RECENT_AREAS);
    expect(list[0]).toEqual({ code: 'c4', name: 'Phường 4' });
    expect(new Set(list.map(item => item.code)).size).toBe(list.length);
  });

  it('bỏ qua dữ liệu hỏng hoặc sai kiểu thay vì làm hỏng ứng dụng', () => {
    expect(readRecentAreas(memoryStorage('không phải json'))).toEqual([]);
    expect(readRecentAreas(memoryStorage('{"a":1}'))).toEqual([]);
    expect(readRecentAreas(memoryStorage('[{"code":1,"name":"x"},{"code":"ok","name":"Xuân Hương"},null]'))).toEqual([{ code: 'ok', name: 'Xuân Hương' }]);
  });

  it('vẫn chạy khi không có bộ nhớ hoặc bộ nhớ ném lỗi', () => {
    expect(readRecentAreas(null)).toEqual([]);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readRecentAreas(throwing)).toEqual([]);
    expect(rememberArea({ code: 'a', name: 'A' }, throwing)).toEqual([{ code: 'a', name: 'A' }]);
  });
});

describe('chỉ đường tới trụ sở', () => {
  const station = (patch: Record<string, unknown>) => ({ station: { name: 'CA', address: '1 Phan Đình Phùng', latitude: null, longitude: null, locationSource: 'address_only', ...patch } }) as never;

  it('ưu tiên tọa độ, sau đó địa chỉ, và null khi không có gì', () => {
    expect(stationDirectionsUrl(station({ latitude: 11.94, longitude: 108.44 }))).toBe('https://www.google.com/maps/dir/?api=1&destination=11.94%2C108.44');
    expect(stationDirectionsUrl(station({}))).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('1 Phan Đình Phùng')}`);
    expect(stationDirectionsUrl(station({ address: null }))).toBeNull();
    expect(stationDirectionsUrl({ station: null })).toBeNull();
  });
});
