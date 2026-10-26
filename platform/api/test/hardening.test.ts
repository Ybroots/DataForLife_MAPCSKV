import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { AttemptWindow } from '../src/rate-limit.js';
import { assertCaseOwnership, WorkflowError } from '../src/workflow.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

function authApp(clock: () => number) {
  return buildApp(new FixtureDirectoryRepository(), {
    corsOrigin: 'http://localhost:5173',
    allowTestAuthHeaders: true,
    officerSessionSecret: 'test-session-secret-with-more-than-32-characters',
    officerCredentials: [{ username: 'cskv.test', password: 'Officer@Test2026', actorId: 'officer-demo-xuan-huong' }],
    citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
    citizenCredentials: [{ username: 'citizen.test', password: 'Citizen@Test2026', citizenId: 'citizen-test-001', displayName: 'Người dân kiểm thử' }],
    limits: { clock },
  });
}

const officerLogin = (a: FastifyInstance, password: string, username = 'cskv.test') =>
  a.inject({ method: 'POST', url: '/v1/auth/officer/login', payload: { username, password } });

describe('login throttling', () => {
  it('locks an account/IP pair after 5 failures, even for the right password, then recovers', async () => {
    let now = 1_000_000;
    app = await authApp(() => now);
    for (let i = 0; i < 5; i += 1) expect((await officerLogin(app, `sai-mat-khau-${i}`)).statusCode).toBe(401);
    const blocked = await officerLogin(app, 'Officer@Test2026');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('LOGIN_RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // other usernames from the same IP are not locked by one account's failures
    expect((await officerLogin(app, 'x-sai-mat-khau', 'khac.tai.khoan')).statusCode).toBe(401);
    now += 15 * 60_000 + 1_000;
    expect((await officerLogin(app, 'Officer@Test2026')).statusCode).toBe(200);
  });

  it('a successful login clears earlier failures', async () => {
    app = await authApp(() => 2_000_000);
    for (let i = 0; i < 4; i += 1) await officerLogin(app, `sai-${i}`);
    expect((await officerLogin(app, 'Officer@Test2026')).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await officerLogin(app, `sai-lai-${i}`)).statusCode).toBe(401);
  });

  it('throttles citizen login the same way', async () => {
    app = await authApp(() => 3_000_000);
    const attempt = (password: string) => app!.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: 'citizen.test', password } });
    for (let i = 0; i < 5; i += 1) expect((await attempt(`sai-mat-khau-${i}`)).statusCode).toBe(401);
    expect((await attempt('Citizen@Test2026')).statusCode).toBe(429);
  });
});

describe('per-account submission limits', () => {
  const headers = { 'x-citizen-id': 'citizen-limit-001' };
  const sos = (key: string) => ({
    idempotencyKey: key, category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString(),
  });

  it('limits distinct SOS per window but never blocks a retry of an accepted one', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://x', allowTestAuthHeaders: true, limits: { sosPerWindow: 3 } });
    const send = (key: string) => app!.inject({ method: 'POST', url: '/v1/citizen/sos', headers, payload: sos(key) });
    for (const key of ['sos-key-0001', 'sos-key-0002', 'sos-key-0003']) expect((await send(key)).statusCode).toBe(201);
    const over = await send('sos-key-0004');
    expect(over.statusCode).toBe(429);
    expect(over.json().message).toContain('112');
    const retry = await send('sos-key-0002');
    expect(retry.statusCode).toBe(201);
    const queue = await app.inject({ method: 'GET', url: '/v1/officer/queue?kind=sos', headers: { 'x-officer-id': 'officer-demo-xuan-huong' } });
    expect(queue.json().data).toHaveLength(3);
  });

  it('limits distinct incident reports per window', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://x', allowTestAuthHeaders: true, limits: { incidentsPerWindow: 2 } });
    const report = (id: string) => app!.inject({
      method: 'POST', url: '/v1/citizen/incidents', headers,
      payload: {
        clientRequestId: id, category: 'other', summary: 'Phản ánh kiểm thử giới hạn',
        description: 'Nội dung đủ dài để vượt kiểm tra đầu vào của phản ánh.', latitude: 11.944, longitude: 108.441,
        attachments: [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 4, dataBase64: 'dGVzdA==' }],
      },
    });
    expect((await report('report-req-0001')).statusCode).toBe(201);
    expect((await report('report-req-0002')).statusCode).toBe(201);
    expect((await report('report-req-0003')).statusCode).toBe(429);
    expect((await report('report-req-0001')).statusCode).toBe(201);
  });
});

describe('case ownership guard', () => {
  it('refuses acting on a colleague\'s case even when the client omits assignedOfficerId', () => {
    expect(() => assertCaseOwnership('officer-b', 'officer-a', undefined, 'SOS')).toThrow(WorkflowError);
    expect(() => assertCaseOwnership('officer-b', 'officer-a', 'officer-b', 'hồ sơ')).toThrow(/khác phụ trách/);
  });
  it('allows the assignee, and the first officer to take an unassigned case', () => {
    expect(() => assertCaseOwnership('officer-a', 'officer-a', undefined, 'SOS')).not.toThrow();
    expect(() => assertCaseOwnership('officer-a', null, 'officer-a', 'hồ sơ')).not.toThrow();
  });
  it('still refuses assigning to somebody else (no handover flow yet)', () => {
    expect(() => assertCaseOwnership('officer-a', 'officer-a', 'officer-b', 'SOS')).toThrow(/Pilot/);
  });
});

describe('AttemptWindow', () => {
  it('expires entries and reports a sensible retry-after', () => {
    let now = 0;
    const window = new AttemptWindow(2, 60_000, () => now);
    window.record('s', 'a'); now += 10_000; window.record('s', 'b');
    expect(window.retryAfterSeconds('s')).toBe(50);
    now += 50_000;
    expect(window.retryAfterSeconds('s')).toBe(0);
  });
});
