import { describe, expect, it } from 'vitest';
import { filterPointsInZone, scopeAreaToZone, zoneBoundaryOf } from '../src/area-scope';
import type { AreaLookup, ServiceArea } from '../src/types';

function square(x: number, y: number, size = 0.01): ServiceArea['boundary'] {
  return { type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] };
}
function zone(code: string, x: number): ServiceArea {
  return { code, name: `Khu vực ${code}`, legacyWardCode: null, groupName: null, description: null, displayColor: '#123456', areaKm2: 1,
    center: { latitude: 11.905, longitude: x + 0.005 }, boundary: square(x, 11.9), selected: false, isDemo: true, provenanceStatus: 'reference_reconstructed' };
}
const zoneA = zone('XH-P1', 108.40);
const zoneB = zone('XH-P2', 108.45);
const wholeArea = { code: '24781', boundary: square(108.40, 11.9, 0.06), serviceAreas: [zoneA, zoneB] } as unknown as AreaLookup;

describe('officer zone scope', () => {
  it('narrows the area to the officer zone only', () => {
    const scoped = scopeAreaToZone(wholeArea, 'XH-P1');
    expect(scoped.serviceAreas.map((item) => item.code)).toEqual(['XH-P1']);
    expect(scoped.boundary).toEqual(zoneA.boundary);
  });

  it('keeps the whole area for the commander or an unknown zone', () => {
    expect(scopeAreaToZone(wholeArea, null)).toBe(wholeArea);
    expect(scopeAreaToZone(wholeArea, 'XH-P9')).toBe(wholeArea);
    expect(zoneBoundaryOf(wholeArea, null)).toBeNull();
    expect(zoneBoundaryOf(wholeArea, 'XH-P2')).toEqual(zoneB.boundary);
  });

  it('keeps only points inside the zone, and everything when there is no limit', () => {
    const items = [
      { id: 'in', latitude: 11.905, longitude: 108.405 },
      { id: 'other-zone', latitude: 11.905, longitude: 108.455 },
      { id: 'no-position', latitude: null, longitude: null },
    ];
    expect(filterPointsInZone(items, zoneA.boundary).map((item) => item.id)).toEqual(['in']);
    expect(filterPointsInZone(items, null)).toHaveLength(3);
  });
});
