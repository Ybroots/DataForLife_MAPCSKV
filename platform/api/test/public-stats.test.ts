import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

describe('GET /v1/public/stats', () => {
  it('trả các số đếm công khai không cần đăng nhập, không có dữ liệu mẫu và không lộ thông tin cá nhân', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), {
      corsOrigin: 'http://localhost:5173',
      citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
    });
    const response = await app.inject({ method: 'GET', url: '/v1/public/stats' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age');
    const { data } = response.json() as { data: Record<string, unknown> };
    for (const key of ['pilotAreas', 'officers', 'installs', 'verifiedUsers', 'incidentsReceived', 'incidentsProcessed']) expect(typeof data[key]).toBe('number');
    expect(data.demoData).toBe(false);
    expect(Array.isArray(data.opinions)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/citizen|phone|password/i);
  });
});
