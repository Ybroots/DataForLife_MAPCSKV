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
    idempotencyKey: key, contactPhone: '0911222333', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString(),
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
        attachments: [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 68, dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=' }],
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

describe('malformed input is a client error, never a 500', () => {
  it('rejects broken JSON, wrong content type and NUL characters with 4xx', async () => {
    app = await authApp(() => 5_000_000);
    const post = (payload: string, contentType: string) => app!.inject({
      method: 'POST', url: '/v1/auth/citizen/login', payload, headers: { 'content-type': contentType },
    });
    expect((await post('{bad', 'application/json')).statusCode).toBe(400);
    expect((await post('', 'application/json')).statusCode).toBe(400);
    expect((await post('a=b', 'application/x-www-form-urlencoded')).statusCode).toBe(415);
    expect((await post('{"__proto__":{"admin":true}}', 'application/json')).statusCode).toBe(400);
    const nul = await post(JSON.stringify({ username: 'citizen.test', password: 'abc\u0000defghij' }), 'application/json');
    expect(nul.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/areas?query=%00' })).statusCode).toBe(400);
  });

  it('returns 413 for a body above the size limit', async () => {
    app = await authApp(() => 5_100_000);
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/login', headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'x'.repeat(31 * 1024 * 1024), password: 'y' }),
    });
    expect(response.statusCode).toBe(413);
  });
});

describe('attachment content must match its declared type', () => {
  const headers = { 'x-citizen-id': 'citizen-media-001' };
  const base = {
    clientRequestId: 'req-media-0001', category: 'public_order', summary: 'Kiểm tra tệp đính kèm', description: 'Mô tả đủ dài cho phản ánh kiểm thử.',
    latitude: 11.944, longitude: 108.441,
  };
  it('refuses an HTML file declared as PNG but accepts a real PNG and a report without media', async () => {
    app = await authApp(() => 6_000_000);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const fake = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers, payload: {
      ...base, attachments: [{ fileName: 'x.png', mimeType: 'image/png', sizeBytes: html.length, dataBase64: html.toString('base64') }] } });
    expect(fake.statusCode).toBe(400);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=', 'base64');
    const real = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers, payload: {
      ...base, clientRequestId: 'req-media-0002', attachments: [{ fileName: 'x.png', mimeType: 'image/png', sizeBytes: png.length, dataBase64: png.toString('base64') }] } });
    expect(real.statusCode).toBe(201);
    const none = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers, payload: { ...base, clientRequestId: 'req-media-0003', attachments: [] } });
    expect(none.statusCode).toBe(201);
  });
});

describe('change password', () => {
  it('lets a registered citizen change the password, rejects wrong/weak/unchanged and refuses admin-managed accounts', async () => {
    app = await authApp(() => 7_000_000);
    const register = await app.inject({ method: 'POST', url: '/v1/auth/citizen/register', payload: { username: '0911222333', displayName: 'Người dân mới', password: 'MatKhauCu12345' } });
    expect(register.statusCode).toBe(201);
    const cookie = String(register.headers['set-cookie']).split(';')[0]!;
    const change = (currentPassword: string, newPassword: string, headers: Record<string, string> = { cookie }) =>
      app!.inject({ method: 'POST', url: '/v1/auth/citizen/change-password', headers, payload: { currentPassword, newPassword } });
    expect((await change('MatKhauCu12345', 'MatKhauMoi67890', {})).statusCode).toBe(401);
    expect((await change('SaiMatKhau12345', 'MatKhauMoi67890')).statusCode).toBe(401);
    expect((await change('MatKhauCu12345', 'ngan1')).statusCode).toBe(400);
    expect((await change('MatKhauCu12345', 'chiCoChuCaiThoi')).statusCode).toBe(400);
    expect((await change('MatKhauCu12345', 'MatKhauCu12345')).statusCode).toBe(400);
    expect((await change('MatKhauCu12345', 'MatKhauMoi67890')).statusCode).toBe(204);
    const login = (password: string) => app!.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: '0911222333', password } });
    expect((await login('MatKhauCu12345')).statusCode).toBe(401);
    expect((await login('MatKhauMoi67890')).statusCode).toBe(200);
    // tài khoản cấu hình bằng biến môi trường: phải đổi ở máy chủ
    const configured = await app.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: 'citizen.test', password: 'Citizen@Test2026' } });
    const configuredCookie = String(configured.headers['set-cookie']).split(';')[0]!;
    const refused = await change('Citizen@Test2026', 'MatKhauMoi67890', { cookie: configuredCookie });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('PASSWORD_MANAGED_BY_ADMIN');
  });
  it('requires an officer session', async () => {
    app = await authApp(() => 7_100_000);
    const response = await app.inject({ method: 'POST', url: '/v1/auth/officer/change-password', payload: { currentPassword: 'x'.repeat(10), newPassword: 'MatKhauMoi67890' } });
    expect(response.statusCode).toBe(401);
  });
});

describe('password hashing capacity', () => {
  it('fails fast with PasswordBusyError instead of queueing without limit', async () => {
    process.env.API_HASH_QUEUE = '10';
    const { hashPassword, PasswordBusyError } = await import('../src/password.js');
    const outcomes = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => hashPassword(`MatKhau${i}12345`)));
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBeGreaterThanOrEqual(14);
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((o) => o.reason instanceof PasswordBusyError)).toBe(true);
    // quá tải khi kiểm tra mật khẩu đúng phải báo bận, không được trả "sai mật khẩu"
    const { verifyPassword } = await import('../src/password.js');
    const hash = await hashPassword('MatKhauDung12345');
    const checks = await Promise.allSettled(Array.from({ length: 40 }, () => verifyPassword('MatKhauDung12345', hash)));
    expect(checks.some((o) => o.status === 'fulfilled' && o.value === false)).toBe(false);
    expect(checks.filter((o) => o.status === 'rejected').every((o) => (o as PromiseRejectedResult).reason instanceof PasswordBusyError)).toBe(true);
    // sau khi hàng chờ trống thì hoạt động bình thường
    await expect(hashPassword('MatKhauSauKhiRanh12')).resolves.toMatch(/^scrypt-v1\$/);
    delete process.env.API_HASH_QUEUE;
  });
});
