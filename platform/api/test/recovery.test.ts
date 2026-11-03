import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { hashPassword } from '../src/password.js';
import { generateRecoveryCode, normalizeRecoveryCode } from '../src/recovery-code.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/;

describe('recovery code format', () => {
  it('generates readable codes and normalises what people type', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(CODE_PATTERN);
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode('abc')).toBeNull();
    expect(normalizeRecoveryCode('0000-1111-OOOO-IIII')).toBeNull();
    expect(normalizeRecoveryCode(12345)).toBeNull();
  });
});

describe('citizen password recovery', () => {
  const start = () => buildApp(new FixtureDirectoryRepository(), {
    corsOrigin: 'http://localhost:5173',
    citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
  });
  const post = (a: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers });

  it('issues a code at registration, resets with it once, revokes old sessions and rotates the code', async () => {
    app = await start();
    const register = await post(app, '/v1/auth/citizen/register', { username: '0911222333', displayName: 'Người dân mới', password: 'MatKhauCu12345' });
    expect(register.statusCode).toBe(201);
    const code = register.json().data.recoveryCode as string;
    expect(code).toMatch(CODE_PATTERN);
    const oldCookie = String(register.headers['set-cookie']).split(';')[0]!;
    const session = (cookie: string) => app!.inject({ method: 'GET', url: '/v1/auth/citizen/session', headers: { cookie } });
    expect((await session(oldCookie)).statusCode).toBe(200);

    const reset = (recoveryCode: string, newPassword = 'MatKhauMoi67890', username = '0911222333') =>
      post(app!, '/v1/auth/citizen/forgot-password', { username, recoveryCode, newPassword });
    const wrong = await reset('AAAA-BBBB-CCCC-DDDD');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('RECOVERY_FAILED');
    const unknown = await reset(code, 'MatKhauMoi67890', '0999888777');
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
    expect((await reset(code, 'ngan1')).statusCode).toBe(400);
    expect((await reset('abc')).statusCode).toBe(400);

    const ok = await reset(` ${code.toLowerCase().replace(/-/g, ' ')} `);
    expect(ok.statusCode).toBe(200);
    const nextCode = ok.json().data.recoveryCode as string;
    expect(nextCode).toMatch(CODE_PATTERN);
    expect(nextCode).not.toBe(code);

    const login = (password: string) => post(app!, '/v1/auth/citizen/login', { username: '0911222333', password });
    expect((await login('MatKhauCu12345')).statusCode).toBe(401);
    expect((await login('MatKhauMoi67890')).statusCode).toBe(200);
    expect((await session(oldCookie)).statusCode).toBe(401);
    expect((await reset(code, 'MatKhauKhac12345')).statusCode).toBe(401);
  });

  it('lets a signed-in citizen regenerate the code, which invalidates the previous one', async () => {
    app = await start();
    const register = await post(app, '/v1/auth/citizen/register', { username: '0911222444', displayName: 'Người dân hai', password: 'MatKhauCu12345' });
    const code = register.json().data.recoveryCode as string;
    const cookie = String(register.headers['set-cookie']).split(';')[0]!;
    expect((await post(app, '/v1/auth/citizen/recovery-code', { currentPassword: 'MatKhauCu12345' })).statusCode).toBe(401);
    expect((await post(app, '/v1/auth/citizen/recovery-code', { currentPassword: 'SaiMatKhau12345' }, { cookie })).statusCode).toBe(401);
    const regenerated = await post(app, '/v1/auth/citizen/recovery-code', { currentPassword: 'MatKhauCu12345' }, { cookie });
    expect(regenerated.statusCode).toBe(200);
    expect(String(regenerated.headers['cache-control'])).toContain('no-store');
    expect(regenerated.json().data.recoveryCode).toMatch(CODE_PATTERN);
    const stale = await post(app, '/v1/auth/citizen/forgot-password', { username: '0911222444', recoveryCode: code, newPassword: 'MatKhauMoi67890' });
    expect(stale.statusCode).toBe(401);
  });

  it('rate-limits wrong recovery codes without locking normal sign-in', async () => {
    app = await start();
    const register = await post(app, '/v1/auth/citizen/register', { username: '0911222555', displayName: 'Người dân ba', password: 'MatKhauCu12345' });
    expect(register.statusCode).toBe(201);
    let last = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = (await post(app, '/v1/auth/citizen/forgot-password', { username: '0911222555', recoveryCode: 'AAAA-BBBB-CCCC-DDDD', newPassword: 'MatKhauMoi67890' })).statusCode;
    }
    expect(last).toBe(429);
    expect((await post(app, '/v1/auth/citizen/login', { username: '0911222555', password: 'MatKhauCu12345' })).statusCode).toBe(200);
  });
});

describe('officer-assisted password reset', () => {
  it('lets an officer issue a one-time, expiring code that the citizen uses on the forgot-password screen, and audits both steps', async () => {
    const repository = new FixtureDirectoryRepository();
    app = await buildApp(repository, {
      corsOrigin: 'http://localhost:5173',
      allowTestAuthHeaders: true,
      citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
    });
    const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers });
    const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
    await post('/v1/auth/citizen/register', { username: '0911222666', displayName: 'Người dân bốn', password: 'MatKhauCu12345' });
    const issue = (payload: unknown, headers: Record<string, string> = officer) => post('/v1/officer/citizen-accounts/reset-code', payload, headers);

    expect((await issue({ phone: '0911222666', verified: true }, {})).statusCode).toBe(401);
    expect((await issue({ phone: '123', verified: true })).statusCode).toBe(400);
    const unverified = await issue({ phone: '0911222666' });
    expect(unverified.statusCode).toBe(400);
    expect(unverified.json().error).toBe('IDENTITY_NOT_CONFIRMED');
    expect((await issue({ phone: '0999888777', verified: true })).statusCode).toBe(404);

    const issued = await issue({ phone: '0911222666', verified: true });
    expect(issued.statusCode).toBe(201);
    const code = issued.json().data.recoveryCode as string;
    expect(code).toMatch(CODE_PATTERN);
    expect(Math.abs(Date.parse(issued.json().data.expiresAt) - Date.now() - 24 * 60 * 60_000)).toBeLessThan(60_000);

    const reset = (recoveryCode: string, newPassword = 'MatKhauMoi67890') =>
      post('/v1/auth/citizen/forgot-password', { username: '0911222666', recoveryCode, newPassword });
    expect((await reset(code)).statusCode).toBe(200);
    expect((await post('/v1/auth/citizen/login', { username: '0911222666', password: 'MatKhauMoi67890' })).statusCode).toBe(200);
    expect((await reset(code, 'MatKhauKhac12345')).statusCode).toBe(401);

    const events = repository.citizenAccountEvents.map((event) => event.eventType);
    expect(events).toContain('assisted_reset_issued');
    expect(events).toContain('password_reset_assisted');
    expect(repository.citizenAccountEvents.find((event) => event.eventType === 'assisted_reset_issued')?.actorId).toBe('officer-demo-xuan-huong');
  });

  it('rejects an expired officer code', async () => {
    const repository = new FixtureDirectoryRepository();
    app = await buildApp(repository, { corsOrigin: 'http://localhost:5173', citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters' });
    await app.inject({ method: 'POST', url: '/v1/auth/citizen/register', payload: { username: '0911222777', displayName: 'Người dân năm', password: 'MatKhauCu12345' } });
    const code = 'ABCD-EFGH-JKMN-PQRS';
    await repository.issueCitizenAssistedResetCode('0911222777', 'officer-demo-xuan-huong', await hashPassword(code.replace(/-/g, '')), new Date(Date.now() - 1_000).toISOString());
    const expired = await app.inject({ method: 'POST', url: '/v1/auth/citizen/forgot-password', payload: { username: '0911222777', recoveryCode: code, newPassword: 'MatKhauMoi67890' } });
    expect(expired.statusCode).toBe(401);
  });
});
