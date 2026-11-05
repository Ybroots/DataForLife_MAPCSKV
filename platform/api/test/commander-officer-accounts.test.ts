import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { generateReadablePassword } from '../src/generate-password.js';
import { createOfficerSession, revokeOfficerSessions, verifyOfficerSession } from '../src/officer-auth.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const commander = { 'x-officer-id': 'supervisor-demo-xuan-huong' };
const officer = { 'x-officer-id': 'officer-cskv-01' };

async function newApp() {
  const repository = new FixtureDirectoryRepository({ managedOfficers: true });
  app = await buildApp(repository, {
    corsOrigin: 'http://x', allowTestAuthHeaders: true,
    officerSessionSecret: 'test-secret-test-secret-test-secret',
    officerCredentials: [{ username: 'cskv.xuanhuong', password: 'khong-dung-that', actorId: 'officer-demo-xuan-huong' }],
  });
  return { app, repository };
}

const update = (a: FastifyInstance, id: string, payload: unknown, headers: Record<string, string> = commander) =>
  a.inject({ method: 'POST', url: `/v1/commander/officers/${id}/update`, headers, payload: payload as object });
const setPassword = (a: FastifyInstance, id: string, payload: unknown, headers: Record<string, string> = commander) =>
  a.inject({ method: 'POST', url: `/v1/commander/officers/${id}/password`, headers, payload: payload as object });

describe('commander manages officer accounts: access', () => {
  it('requires a session', async () => {
    const { app: a } = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/officers' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/v1/commander/officers/officer-cskv-01/update', payload: { username: 'moi.canbo' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/v1/commander/officers/officer-cskv-01/password', payload: { generate: true } })).statusCode).toBe(401);
  });

  it('is refused for officers on all three routes', async () => {
    const { app: a } = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/officers', headers: officer })).statusCode).toBe(403);
    expect((await update(a, 'officer-cskv-02', { username: 'hack.canbo' }, officer)).statusCode).toBe(403);
    expect((await setPassword(a, 'officer-cskv-02', { generate: true }, officer)).statusCode).toBe(403);
  });

  it('lists only officers of the same ward, without passwords', async () => {
    const { app: a } = await newApp();
    const response = await a.inject({ method: 'GET', url: '/v1/commander/officers', headers: commander });
    expect(response.statusCode).toBe(200);
    const rows = response.json().data as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.id)).toEqual(['officer-cskv-01', 'officer-cskv-02']);
    expect(rows[0]).toMatchObject({ username: 'canbo01', serviceArea: { code: 'XH-P1' } });
    expect(JSON.stringify(rows)).not.toMatch(/password|hash|scrypt/i);
  });

  it('cannot touch the commander account or an officer of another ward', async () => {
    const { app: a } = await newApp();
    expect((await update(a, 'supervisor-demo-xuan-huong', { username: 'chi.huy.moi' })).statusCode).toBe(403);
    expect((await setPassword(a, 'supervisor-demo-xuan-huong', { generate: true })).statusCode).toBe(403);
    expect((await update(a, 'officer-other-ward', { username: 'phuong.khac' })).statusCode).toBe(404);
    expect((await setPassword(a, 'officer-other-ward', { generate: true })).statusCode).toBe(404);
    expect((await update(a, 'khong-co-ai', { username: 'ten.moi' })).statusCode).toBe(404);
  });

  it('keeps the commander read-only for cases', async () => {
    const { app: a } = await newApp();
    const denied = await a.inject({
      method: 'POST', url: '/v1/officer/incidents/00000000-0000-4000-8000-000000000000/transitions', headers: commander,
      payload: { toStatus: 'received', note: 'Chỉ huy không được xử lý hồ sơ.' },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('commander manages officer accounts: username', () => {
  it('renames an officer and the old name is free again', async () => {
    const { app: a } = await newApp();
    const ok = await update(a, 'officer-cskv-01', { username: 'thanh.p1' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ id: 'officer-cskv-01', username: 'thanh.p1' });
    expect((await update(a, 'officer-cskv-02', { username: 'canbo01' })).statusCode).toBe(200);
  });

  it('rejects names that are taken, including the server-configured account', async () => {
    const { app: a } = await newApp();
    expect((await update(a, 'officer-cskv-01', { username: 'canbo02' })).statusCode).toBe(409);
    expect((await update(a, 'officer-cskv-01', { username: 'canbo99' })).statusCode).toBe(409);
    expect((await update(a, 'officer-cskv-01', { username: 'cskv.xuanhuong' })).statusCode).toBe(409);
  });

  it('rejects invalid usernames', async () => {
    const { app: a } = await newApp();
    for (const username of ['ab', 'Canbo.Hoa', 'có dấu', 'có khoảng trắng', 'a'.repeat(101), '', 123]) {
      expect((await update(a, 'officer-cskv-01', { username })).statusCode, String(username)).toBe(400);
    }
    expect((await update(a, 'officer-cskv-01', {})).statusCode).toBe(400);
  });

  it('keeping the same name is not a conflict and logs nothing', async () => {
    const { app: a, repository } = await newApp();
    expect((await update(a, 'officer-cskv-01', { username: 'canbo01' })).statusCode).toBe(200);
    expect(repository.officerAccountAudit).toHaveLength(0);
  });
});

describe('commander manages officer accounts: service area', () => {
  it('moves an officer to another area and back to "all ward"', async () => {
    const { app: a } = await newApp();
    const moved = await update(a, 'officer-cskv-01', { serviceAreaCode: 'XH-P3' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.serviceArea).toMatchObject({ code: 'XH-P3' });
    const cleared = await update(a, 'officer-cskv-01', { serviceAreaCode: null });
    expect(cleared.json().data.serviceArea).toBeNull();
  });

  it('rejects an area outside the ward', async () => {
    const { app: a } = await newApp();
    expect((await update(a, 'officer-cskv-01', { serviceAreaCode: 'XH-KHONG-CO' })).statusCode).toBe(400);
  });
});

describe('commander manages officer accounts: password', () => {
  it('sets a typed password that works at login, and does not echo it back', async () => {
    const { app: a } = await newApp();
    const response = await setPassword(a, 'officer-cskv-01', { password: 'MatKhau-Moi-2026' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('MatKhau-Moi-2026');
    expect(response.json().generatedPassword).toBeUndefined();
    const login = await a.inject({ method: 'POST', url: '/v1/auth/officer/login', payload: { username: 'canbo01', password: 'MatKhau-Moi-2026' } });
    expect(login.statusCode).toBe(200);
  });

  it('generates a readable password once, and it works at login', async () => {
    const { app: a } = await newApp();
    const response = await setPassword(a, 'officer-cskv-02', { generate: true });
    expect(response.statusCode).toBe(200);
    const generated = response.json().generatedPassword as string;
    expect(generated).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
    const login = await a.inject({ method: 'POST', url: '/v1/auth/officer/login', payload: { username: 'canbo02', password: generated } });
    expect(login.statusCode).toBe(200);
  });

  it('rejects short passwords and ambiguous requests', async () => {
    const { app: a } = await newApp();
    expect((await setPassword(a, 'officer-cskv-01', { password: 'ngan7ky' })).statusCode).toBe(400);
    expect((await setPassword(a, 'officer-cskv-01', {})).statusCode).toBe(400);
    expect((await setPassword(a, 'officer-cskv-01', { password: 'MatKhau-Moi-2026', generate: true })).statusCode).toBe(400);
  });

  it('generated passwords never contain look-alike characters', () => {
    for (let index = 0; index < 500; index += 1) {
      const password = generateReadablePassword();
      expect(password).toHaveLength(12);
      expect(password).not.toMatch(/[01lIOo]/);
      expect(password).toMatch(/[A-Za-z]/);
      expect(password).toMatch(/\d/);
    }
  });
});

describe('commander manages officer accounts: audit and sessions', () => {
  it('records who changed what, never the password', async () => {
    const { app: a, repository } = await newApp();
    await update(a, 'officer-cskv-01', { username: 'thanh.p1', serviceAreaCode: 'XH-P2' });
    await setPassword(a, 'officer-cskv-01', { password: 'MatKhau-Moi-2026' });
    expect(repository.officerAccountAudit.map((entry) => entry.action)).toEqual(['username_changed', 'service_area_changed', 'password_set']);
    expect(repository.officerAccountAudit.every((entry) => entry.actorId === 'supervisor-demo-xuan-huong' && entry.targetId === 'officer-cskv-01')).toBe(true);
    expect(JSON.stringify(repository.officerAccountAudit)).not.toContain('MatKhau-Moi-2026');
  });

  it('signs the officer out when the username or password changes, but not for an area change', async () => {
    const { app: a } = await newApp();
    const secret = 'test-secret-test-secret-test-secret';
    // Bộ nhớ thu hồi dùng chung cả tiến trình: cấp phiên sau các lần thu hồi của test trước.
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    await pause();
    const before = createOfficerSession('officer-cskv-02', secret, Date.now());
    expect(verifyOfficerSession(before, secret)).toBe('officer-cskv-02');

    await update(a, 'officer-cskv-02', { serviceAreaCode: 'XH-P3' });
    expect(verifyOfficerSession(before, secret)).toBe('officer-cskv-02');

    await update(a, 'officer-cskv-02', { username: 'hai.moi' });
    expect(verifyOfficerSession(before, secret)).toBeNull();

    await pause();
    const afterRename = createOfficerSession('officer-cskv-02', secret, Date.now());
    expect(verifyOfficerSession(afterRename, secret)).toBe('officer-cskv-02');

    await setPassword(a, 'officer-cskv-02', { generate: true });
    expect(verifyOfficerSession(afterRename, secret)).toBeNull();
  });

  it('revokeOfficerSessions only affects that officer and older sessions', () => {
    const secret = 'test-secret-test-secret-test-secret';
    const now = Date.now();
    const old = createOfficerSession('officer-x-001', secret, now - 10_000);
    const other = createOfficerSession('officer-y-001', secret, now - 10_000);
    revokeOfficerSessions('officer-x-001', now - 5_000);
    const fresh = createOfficerSession('officer-x-001', secret, now);
    expect(verifyOfficerSession(old, secret, now)).toBeNull();
    expect(verifyOfficerSession(fresh, secret, now)).toBe('officer-x-001');
    expect(verifyOfficerSession(other, secret, now)).toBe('officer-y-001');
  });
});
