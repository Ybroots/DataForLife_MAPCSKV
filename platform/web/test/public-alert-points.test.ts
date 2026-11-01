import { describe, expect, it } from 'vitest';
import { buildPublicAlertPoints } from '../src/citizen-map-points';
import type { AreaLookup, PublicAlert } from '../src/types';

const area = { code: '24781', serviceAreas: [] } as unknown as AreaLookup;
const alert = { id: 'test', areaCode: '24781', title: 'Cảnh báo kiểm thử', summary: 'Thông tin công khai',
  latitude: 11.944, longitude: 108.441 } as PublicAlert;

describe('published map alerts', () => {
  it('uses public alert coordinates without generating demo points', () => {
    expect(buildPublicAlertPoints(area, [alert])).toMatchObject([{ id: 'alert:test', demo: false, latitude: 11.944, longitude: 108.441 }]);
    expect(buildPublicAlertPoints(area, [])).toEqual([]);
  });
  it('does not invent coordinates or show alerts from another locality', () => {
    expect(buildPublicAlertPoints(area, [{ ...alert, latitude: null }, { ...alert, areaCode: 'other' }])).toEqual([]);
    expect(buildPublicAlertPoints(null, [alert])).toEqual([]);
  });
});

describe('buildProvinceAlertPoints', () => {
  it('dựng điểm cho mọi cảnh báo có tọa độ khi chưa chọn địa bàn', async () => {
    const { buildProvinceAlertPoints } = await import('../src/citizen-map-points');
    const base = { id: 'a1', areaCode: 'X1', title: 'T', summary: 'S', latitude: 11.9, longitude: 108.4 } as never;
    expect(buildProvinceAlertPoints([base, { ...(base as object), id: 'a2', latitude: null } as never])).toMatchObject([{ id: 'alert:a1', serviceAreaCode: 'X1', kind: 'alert' }]);
  });
});
