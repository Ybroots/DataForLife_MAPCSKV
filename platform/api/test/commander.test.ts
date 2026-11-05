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

describe('SOS uses the phone of the citizen account', () => {
  it('takes the phone from a phone-number username and titles the request "SOS - tên - SĐT"', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), {
      corsOrigin: 'http://localhost:5173',
      allowTestAuthHeaders: true,
      officerSessionSecret: 'test-session-secret-with-more-than-32-characters',
      citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
      citizenCredentials: [{ username: '0912345678', password: 'Citizen@Test2026', citizenId: 'citizen-phone-001', displayName: 'Nguyễn Văn An' }],
    });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: '0912345678', password: 'Citizen@Test2026' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    const session = await app.inject({ method: 'GET', url: '/v1/auth/citizen/session', headers: { cookie } });
    expect(session.json().data).toMatchObject({ id: 'citizen-phone-001', phone: '0912345678' });
    const created = await app.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: { cookie },
      payload: { idempotencyKey: 'account-phone-sos-1', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() },
    });
    expect(created.statusCode).toBe(201);
    const queue = await app.inject({ method: 'GET', url: '/v1/officer/queue?kind=sos', headers: officer });
    const item = queue.json().data.find((row: { id: string }) => row.id === created.json().data.id);
    expect(item).toMatchObject({ reporterPhone: '0912345678' });
    expect(item.title).toBe('SOS - Người dân - 0912345678');
  });
});

describe('SOS alarm data', () => {
  it('refuses an SOS without a call-back phone number', async () => {
    const a = await newApp();
    const base = { idempotencyKey: 'commander-sos-nophone-1', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() };
    const missing = await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: base });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('SOS_PHONE_REQUIRED');
    expect((await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: { ...base, contactPhone: '' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: { ...base, contactPhone: '0911222333' } })).statusCode).toBe(201);
  });

  it('gives officer and commander the reporter phone and area, without needing the receipt code', async () => {
    const a = await newApp();
    const created = await a.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizen,
      payload: { idempotencyKey: 'commander-sos-key-001', category: 'security', contactPhone: '0911555001', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() },
    });
    expect(created.statusCode).toBe(201);
    for (const headers of [officer, commander]) {
      const queue = await a.inject({ method: 'GET', url: '/v1/officer/queue?kind=sos', headers });
      expect(queue.statusCode).toBe(200);
      const item = queue.json().data.find((row: { id: string }) => row.id === created.json().data.id);
      expect(item).toMatchObject({ kind: 'sos', reporterPhone: '0911555001', localityName: expect.any(String) });
    }
  });
});

describe('officer edits and removes a public alert', () => {
  const now = Date.now();
  const alertBody = {
    title: 'Mật độ giao thông tăng', summary: 'Khu vực chợ đông phương tiện, hạn chế đi qua.', category: 'traffic', riskLevel: 'medium',
    latitude: 11.944, longitude: 108.441, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 4 * 3_600_000).toISOString(),
  };

  it('updates fields and position, then the cancelled alert leaves the public list', async () => {
    const a = await newApp();
    const created = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: alertBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const edited = await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: { title: 'Kẹt xe khu vực chợ', riskLevel: 'high', latitude: 11.9455, longitude: 108.4425 } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({ id, title: 'Kẹt xe khu vực chợ', riskLevel: 'high', latitude: 11.9455, longitude: 108.4425, summary: alertBody.summary });
    const listed = await a.inject({ method: 'GET', url: '/v1/public/alerts' });
    expect(listed.json().data.find((item: { id: string }) => item.id === id)?.title).toBe('Kẹt xe khu vực chợ');

    expect((await a.inject({ method: 'POST', url: `/v1/officer/alerts/${id}/cancel`, headers: officer })).statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: '/v1/public/alerts' })).json().data.some((item: { id: string }) => item.id === id)).toBe(false);
    expect((await a.inject({ method: 'POST', url: `/v1/officer/alerts/${id}/cancel`, headers: officer })).statusCode).toBe(404);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: { title: 'Sửa sau khi gỡ' } })).statusCode).toBe(404);
  });

  it('creates an alert without any time and keeps it until it is removed by hand', async () => {
    const a = await newApp();
    const { startsAt: _s, endsAt: _e, ...noTimes } = alertBody;
    const created = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: noTimes });
    expect(created.statusCode).toBe(201);
    const alert = created.json().data;
    expect(Date.parse(alert.endsAt)).toBeGreaterThan(Date.now() + 5 * 365 * 86_400_000);
    expect((await a.inject({ method: 'GET', url: '/v1/public/alerts' })).json().data.some((item: { id: string }) => item.id === alert.id)).toBe(true);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${alert.id}`, headers: officer, payload: { title: 'Cảnh báo vẫn còn hiệu lực' } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: `/v1/officer/alerts/${alert.id}/cancel`, headers: officer })).statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: '/v1/public/alerts' })).json().data.some((item: { id: string }) => item.id === alert.id)).toBe(false);
  });

  it('removes an alert when the app posts with a JSON content-type but no body', async () => {
    const a = await newApp();
    const id = (await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: alertBody })).json().data.id as string;
    const removed = await a.inject({ method: 'POST', url: `/v1/officer/alerts/${id}/cancel`, headers: { ...officer, 'content-type': 'application/json' } });
    expect(removed.statusCode).toBe(204);
    const broken = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: { ...officer, 'content-type': 'application/json' }, payload: '{khong-phai-json' });
    expect(broken.statusCode).toBe(400);
  });

  it('rejects an empty or invalid edit, and the commander can edit and remove', async () => {
    const a = await newApp();
    const id = (await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: alertBody })).json().data.id as string;
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: {} })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: { title: 'ngắn' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: { latitude: 11.9 } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: officer, payload: { endsAt: new Date(now - 3_600_000).toISOString() } })).statusCode).toBe(400);
    const edited = await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, headers: commander, payload: { title: 'Chỉ huy sửa cảnh báo' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.title).toBe('Chỉ huy sửa cảnh báo');
    expect((await a.inject({ method: 'POST', url: `/v1/officer/alerts/${id}/cancel`, headers: commander })).statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: '/v1/public/alerts' })).json().data.some((item: { id: string }) => item.id === id)).toBe(false);
    const published = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: commander, payload: alertBody });
    expect(published.statusCode).toBe(201);
    expect((await a.inject({ method: 'PATCH', url: `/v1/officer/alerts/${id}`, payload: { title: 'Không đăng nhập' } })).statusCode).toBe(401);
  });
});
