import { describe, expect, it } from 'vitest';
import { buildCitizenMapPoints, DEMO_OFFICER_NAMES, pointInBoundary, pointsWithinZone, zoneBadgeLabel, zoneReferenceKind } from '../src/citizen-map-points';
import type { AreaLookup, ServiceArea } from '../src/types';

function square(x: number, y: number, size = 0.01): ServiceArea['boundary'] {
  return { type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] };
}
function zone(code: string, x: number, legacyWardCode: string | null, name = `Khu vực ${code}`): ServiceArea {
  return { code, name, legacyWardCode, groupName: null, description: null, displayColor: '#123456', areaKm2: 1,
    center: { latitude: 11.905, longitude: x + 0.005 }, boundary: square(x, 11.9), selected: false, isDemo: true, provenanceStatus: 'reference_reconstructed' };
}
function area(code: string, zones: ServiceArea[], directory: AreaLookup['directory']): AreaLookup {
  return { code, name: `Địa bàn ${code}`, localityType: 'Phường', provinceName: 'Lâm Đồng', population: null, areaKm2: null, densityPerKm2: null,
    center: null, boundary: null, serviceAreas: zones, station: { name: 'Trụ sở', address: null, latitude: null, longitude: null, locationSource: 'address_only' }, directory } as AreaLookup;
}
const officers = ['A', 'B', 'C'].map((n, i) => ({ id: `o${i}`, displayName: `CSKV ${n}`, rank: null, roleTitle: null, phone: `0900 000 00${i}`, entryType: 'officer' as const }));
const lead = { id: 'lead', displayName: 'Đầu mối chung', rank: null, roleTitle: null, phone: '0900 000 999', entryType: 'unit_contact' as const };

describe('điểm CSKV trình diễn trên bản đồ', () => {
  it('không tạo điểm cho phường không thuộc danh sách thí điểm hoặc không có khu vực', () => {
    expect(buildCitizenMapPoints(area('99999', [zone('X-K1', 108.4, null)], officers))).toEqual([]);
    expect(buildCitizenMapPoints(area('24805', [], officers))).toEqual([]);
    expect(buildCitizenMapPoints(null)).toEqual([]);
  });

  it.each([['24781', 5], ['24805', 4], ['24778', 3]])('địa bàn %s: mỗi khu có đúng một pin CSKV và một điểm tiếp dân nằm trong khu', (code, zones) => {
    const list = Array.from({ length: zones }, (_, i) => code === '24781' ? zone(`XH-P${i + 1}`, 108.4 + i * 0.02, String(i + 1)) : zone(`K${i + 1}`, 108.4 + i * 0.02, null, `Khu vực ${i + 1} · Bắc`));
    const points = buildCitizenMapPoints(area(code, list, [lead, ...officers]));
    expect(points).toHaveLength(zones * 2);
    for (const z of list) {
      const inside = pointsWithinZone(points, z);
      expect(inside.filter((p) => p.kind === 'officer')).toHaveLength(1);
      expect(inside.filter((p) => p.kind === 'station')).toHaveLength(1);
      expect(points.filter((p) => p.serviceAreaCode === z.code)).toHaveLength(2);
    }
    expect(points.every((p) => p.demo)).toBe(true);
  });

  it('chưa có cán bộ trong danh bạ: mỗi khu một tên minh họa riêng, không trùng nhau giữa các khu và giữa ba phường', () => {
    const nameOf = (p: { name: string }): string => p.name.split(' · ')[0] ?? '';
    const all: string[] = [];
    for (const [code, count] of [['24781', 5], ['24805', 4], ['24778', 3]] as const) {
      const list = Array.from({ length: count }, (_, i) => zone(`${code}-K${i + 1}`, 108.4 + i * 0.02, null));
      const names = buildCitizenMapPoints(area(code, list, [lead])).filter((p) => p.kind === 'officer').map(nameOf);
      expect(new Set(names).size).toBe(count);
      expect(names.every((n) => n.startsWith('CSKV ') && DEMO_OFFICER_NAMES.includes(n.slice(5)))).toBe(true);
      all.push(...names);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('có cán bộ trong danh bạ: pin hiện đúng tên và số của cán bộ thật, quay vòng khi ít cán bộ hơn số khu', () => {
    const list = [0, 1, 2, 3].map((i) => zone(`XT-K${i + 1}`, 108.4 + i * 0.02, null));
    const real = ['Nguyễn Văn A', 'Trần Văn B', 'Lê Văn C'].map((n, i) => ({ id: `r${i}`, displayName: n, rank: null, roleTitle: 'Cảnh sát khu vực', phone: `0900 000 10${i}`, entryType: 'officer' as const }));
    const pins = buildCitizenMapPoints(area('24805', list, [lead, ...real])).filter((p) => p.kind === 'officer');
    expect(pins.map((p) => p.name.split(' · ')[0])).toEqual(['CSKV Nguyễn Văn A', 'CSKV Trần Văn B', 'CSKV Lê Văn C', 'CSKV Nguyễn Văn A']);
    expect(pins.map((p) => p.phone)).toEqual(['0900 000 100', '0900 000 101', '0900 000 102', '0900 000 100']);
  });

  it('số điện thoại pin CSKV vẫn là đầu mối công khai, ưu tiên cảnh sát khu vực', () => {
    const list = [0, 1].map((i) => zone(`LV-K${i + 1}`, 108.4 + i * 0.02, null));
    const withOfficers = buildCitizenMapPoints(area('24778', list, [lead, ...officers])).filter((p) => p.kind === 'officer');
    expect(withOfficers.map((p) => p.phone)).toEqual(['0900 000 000', '0900 000 001']);
    const onlyLead = buildCitizenMapPoints(area('24778', list, [lead])).filter((p) => p.kind === 'officer');
    expect(onlyLead.every((p) => p.phone === '0900 000 999')).toBe(true);
  });

  it('nhãn khu vực: phường cũ và khu chia minh họa phân biệt được', () => {
    expect(zoneBadgeLabel({ code: 'XH-P10', legacyWardCode: '10' })).toBe('P.10');
    expect(zoneBadgeLabel({ code: 'XT-K3', legacyWardCode: null })).toBe('K3');
    expect(zoneReferenceKind(area('24781', [zone('XH-P1', 1, '1')], []))).toBe('former_wards');
    expect(zoneReferenceKind(area('24805', [zone('XH-P1', 1, '1'), zone('XT-K1', 2, null)], []))).toBe('geometric');
    expect(zoneReferenceKind(area('24805', [], []))).toBeNull();
  });

  it('pointInBoundary loại trừ lỗ và điểm ngoài ranh', () => {
    const holed: ServiceArea['boundary'] = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]] };
    expect(pointInBoundary(0.5, 0.5, holed)).toBe(true);
    expect(pointInBoundary(2, 2, holed)).toBe(false);
    expect(pointInBoundary(9, 9, holed)).toBe(false);
  });
});
