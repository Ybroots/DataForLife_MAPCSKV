import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { periodBounds } from '../src/commander-routes.js';
import { areaScopeOf, assertCaseInArea, WorkflowError } from '../src/workflow.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const citizen = { 'x-citizen-id': 'citizen-commander-001' };
const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
const commander = { 'x-officer-id': 'supervisor-demo-xuan-huong' };
const attachments = [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 68, dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=' }];

async function newApp() {
  app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://x', allowTestAuthHeaders: true });
  return app;
}

async function createIncident(a: FastifyInstance, id: string) {
  const r = await a.inject({
    method: 'POST', url: '/v1/citizen/incidents', headers: citizen,
    payload: { clientRequestId: id, category: 'other', summary: 'Phản ánh kiểm thử chỉ huy', description: 'Nội dung phản ánh đủ dài để qua kiểm tra đầu vào.', latitude: 11.944, longitude: 108.441, attachments },
  });
  expect(r.statusCode).toBe(201);
  return r.json().data as { id: string; receiptCode: string };
}

describe('commander is read-only', () => {
  it('can read the queue, the case and the actor list', async () => {
    const a = await newApp();
    const incident = await createIncident(a, 'commander-read-0001');
    expect((await a.inject({ method: 'GET', url: '/v1/officer/queue', headers: commander })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/v1/officer/incidents/${incident.id}`, headers: commander })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/v1/officer/actors', headers: commander })).statusCode).toBe(200);
  });

  it('cannot change a case: transitions are forbidden, the officer still can', async () => {
    const a = await newApp();
    const incident = await createIncident(a, 'commander-write-0001');
    const denied = await a.inject({
      method: 'POST', url: `/v1/officer/incidents/${incident.id}/transitions`, headers: commander,
      payload: { toStatus: 'received', note: 'Chỉ huy không được phép xử lý trực tiếp hồ sơ.' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await a.inject({
      method: 'POST', url: `/v1/officer/incidents/${incident.id}/transitions`, headers: officer,
      payload: { toStatus: 'received', note: 'Cán bộ khu vực tiếp nhận hồ sơ theo quy trình.' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('commander area overview endpoint', () => {
  it('requires a session', async () => {
    const a = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/area-officers' })).statusCode).toBe(401);
  });

  it('is only available to the commander', async () => {
    const a = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/area-officers', headers: officer })).statusCode).toBe(403);
    const ok = await a.inject({ method: 'GET', url: '/v1/commander/area-officers?period=month&date=2026-11-04', headers: commander });
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().data)).toBe(true);
  });

  it('rejects an invalid period or date', async () => {
    const a = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/area-officers?period=week', headers: commander })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/v1/commander/area-officers?date=2026-13-45', headers: commander })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/v1/commander/area-officers?date=hom-nay', headers: commander })).statusCode).toBe(400);
  });
});

describe('periodBounds', () => {
  it('uses Vietnam local midnight (UTC+7) for day, month and year', () => {
    expect(periodBounds('day', '2026-11-04')).toEqual({ from: '2026-11-03T17:00:00.000Z', to: '2026-11-04T17:00:00.000Z' });
    expect(periodBounds('month', '2026-11-04')).toEqual({ from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' });
    expect(periodBounds('year', '2026-11-04')).toEqual({ from: '2025-12-31T17:00:00.000Z', to: '2026-12-31T17:00:00.000Z' });
  });

  it('rolls over month and year boundaries', () => {
    expect(periodBounds('day', '2026-12-31').to).toBe('2026-12-31T17:00:00.000Z');
    expect(periodBounds('month', '2026-12-15').to).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('area scoping helpers', () => {
  it('scopes only officers that have an area; the commander is never scoped', () => {
    expect(areaScopeOf('officer', 'area-1')).toBe('area-1');
    expect(areaScopeOf('officer', null)).toBeNull();
    expect(areaScopeOf('supervisor', 'area-1')).toBeNull();
  });

  it('refuses a case that belongs to another area and allows own or unscoped', () => {
    expect(() => assertCaseInArea('area-1', 'area-2', 'hồ sơ')).toThrow(WorkflowError);
    expect(() => assertCaseInArea('area-1', null, 'hồ sơ')).toThrow(WorkflowError);
    expect(() => assertCaseInArea('area-1', 'area-1', 'hồ sơ')).not.toThrow();
    expect(() => assertCaseInArea(null, 'area-2', 'hồ sơ')).not.toThrow();
  });
});

describe('logout revokes the session cookie', () => {
  const secrets = {
    officerSessionSecret: 'test-session-secret-with-more-than-32-characters',
    officerCredentials: [{ username: 'cskv.test', password: 'Officer@Test2026', actorId: 'officer-demo-xuan-huong' }],
    citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
    citizenCredentials: [{ username: 'citizen.test', password: 'Citizen@Test2026', citizenId: 'citizen-test-001', displayName: 'Người dân kiểm thử' }],
  };

  it('rejects a replayed officer cookie after logout', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', ...secrets });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/officer/login', payload: { username: 'cskv.test', password: 'Officer@Test2026' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url: '/v1/officer/queue', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/officer/logout', headers: { cookie } })).statusCode).toBeLessThan(300);
    expect((await app.inject({ method: 'GET', url: '/v1/officer/queue', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rejects a replayed citizen cookie after logout', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', ...secrets });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: 'citizen.test', password: 'Citizen@Test2026' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url: '/v1/citizen/incidents', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/citizen/logout', headers: { cookie } })).statusCode).toBeLessThan(300);
    expect((await app.inject({ method: 'GET', url: '/v1/citizen/incidents', headers: { cookie } })).statusCode).toBe(401);
  });
});
