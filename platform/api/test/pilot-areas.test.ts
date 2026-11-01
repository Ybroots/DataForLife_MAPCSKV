import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { geometryContains } from '../src/fixture-pilot-areas.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function pilotApp() {
  app = await buildApp(new FixtureDirectoryRepository({ pilotAreas: true }));
  return app;
}

describe('ba địa bàn trình diễn (Xuân Hương, Xuân Trường, Lâm Viên)', () => {
  it('toàn tỉnh có đúng ba địa bàn và chế độ mặc định không đổi', async () => {
    const overview = (await (await pilotApp()).inject({ method: 'GET', url: '/v1/areas/overview' })).json().data;
    expect(overview.features.map((f: { properties: { code: string } }) => f.properties.code)).toEqual(['24781', '24805', '24778']);
    const plain = await buildApp(new FixtureDirectoryRepository());
    expect((await plain.inject({ method: 'GET', url: '/v1/areas/overview' })).json().data.features).toHaveLength(1);
    await plain.close();
  });

  it.each([['24781', 5], ['24805', 4], ['24778', 3]])('địa bàn %s có %i khu vực phủ kín ranh, không chồng lấn', async (code, zones) => {
    const area = (await (await pilotApp()).inject({ method: 'GET', url: `/v1/lookup/by-code/${code}` })).json().data;
    expect(area.serviceAreas).toHaveLength(zones);
    expect(new Set(area.serviceAreas.map((z: { code: string }) => z.code)).size).toBe(zones);
    expect(area.serviceAreas.every((z: { isDemo: boolean; provenanceStatus: string }) => z.isDemo && z.provenanceStatus === 'reference_reconstructed')).toBe(true);
    // Điểm đại diện của mỗi khu nằm trong khu đó và trong ranh phường, và không nằm trong khu khác.
    for (const zone of area.serviceAreas) {
      const { longitude, latitude } = zone.center;
      expect(geometryContains(area.boundary, longitude, latitude)).toBe(true);
      expect(area.serviceAreas.filter((other: { boundary: never }) => geometryContains(other.boundary, longitude, latitude))).toHaveLength(1);
    }
    // Mỗi khu có một cảnh sát khu vực minh họa, cộng một đầu mối chung.
    expect(area.directory.filter((entry: { entryType: string }) => entry.entryType === 'officer')).toHaveLength(zones);
    expect(area.directory).toHaveLength(zones + 1);
  });

  it('tra cứu theo vị trí đánh dấu đúng khu vực đang đứng và từ chối điểm ngoài ba phường', async () => {
    const server = await pilotApp();
    const base = (await server.inject({ method: 'GET', url: '/v1/lookup/by-code/24805' })).json().data;
    const target = base.serviceAreas[2];
    const hit = (await server.inject({ method: 'GET', url: `/v1/lookup/by-location?lat=${target.center.latitude}&lng=${target.center.longitude}` })).json().data;
    expect(hit.code).toBe('24805');
    expect(hit.serviceAreas.filter((z: { selected: boolean }) => z.selected).map((z: { code: string }) => z.code)).toEqual([target.code]);
    expect((await server.inject({ method: 'GET', url: '/v1/lookup/by-location?lat=10.5&lng=106.5' })).statusCode).toBe(404);
  });

  it('tìm kiếm theo tên hoặc mã', async () => {
    const server = await pilotApp();
    expect((await server.inject({ method: 'GET', url: '/v1/areas?query=Lâm Viên' })).json().data.map((a: { code: string }) => a.code)).toEqual(['24778']);
    expect((await server.inject({ method: 'GET', url: '/v1/areas?query=24805' })).json().data.map((a: { code: string }) => a.code)).toEqual(['24805']);
  });
});
