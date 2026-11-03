import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { MemoryMailer } from '../src/mailer.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const baseOptions = { corsOrigin: 'http://localhost:5173', citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (condition()) return true; await sleep(25); }
  return condition();
}
const codeIn = (text: string) => /(\d{6})/.exec(text)![1]!;

describe('email recovery without a configured mail service', () => {
  it('reports email as unavailable instead of pretending to send', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), baseOptions);
    const options = await app.inject({ method: 'GET', url: '/v1/auth/citizen/recovery-options' });
    expect(options.json().data.email).toBe(false);
    const request = await app.inject({ method: 'POST', url: '/v1/auth/citizen/forgot-password/email', payload: { username: '0911222333' } });
    expect(request.statusCode).toBe(503);
    expect(request.json().error).toBe('EMAIL_NOT_CONFIGURED');
  });
});

describe('email recovery', () => {
  it('verifies an email, sends a reset code only to verified emails, and resets the password once', async () => {
    const mailer = new MemoryMailer();
    const repository = new FixtureDirectoryRepository();
    app = await buildApp(repository, { ...baseOptions, mailer });
    const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers });
    const get = (url: string, headers: Record<string, string> = {}) => app!.inject({ method: 'GET', url, headers });

    const registered = await post('/v1/auth/citizen/register', { username: '0911222333', displayName: 'Người dân mới', password: 'MatKhauCu12345' });
    const cookie = String(registered.headers['set-cookie']).split(';')[0]!;
    const headers = { cookie };
    await post('/v1/auth/citizen/register', { username: '0911222444', displayName: 'Người dân hai', password: 'MatKhauCu12345' });

    expect((await post('/v1/auth/citizen/email', { email: 'an@example.com', currentPassword: 'MatKhauCu12345' })).statusCode).toBe(401);
    expect((await post('/v1/auth/citizen/email', { email: 'abc', currentPassword: 'MatKhauCu12345' }, headers)).statusCode).toBe(400);
    expect((await post('/v1/auth/citizen/email', { email: 'an@example.com', currentPassword: 'SaiMatKhau12345' }, headers)).statusCode).toBe(401);
    const added = await post('/v1/auth/citizen/email', { email: ' An@Example.com ', currentPassword: 'MatKhauCu12345' }, headers);
    expect(added.statusCode).toBe(202);
    expect(added.json().data.email).toBe('a***@example.com');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('an@example.com');

    // Chưa xác minh thì chưa dùng được để đặt lại mật khẩu.
    expect((await post('/v1/auth/citizen/forgot-password/email', { username: '0911222333' })).statusCode).toBe(202);
    expect(await waitFor(() => mailer.sent.length > 1, 400)).toBe(false);

    const verifyCode = codeIn(mailer.sent[0]!.text);
    expect((await post('/v1/auth/citizen/email/verify', { code: verifyCode === '000000' ? '111111' : '000000' }, headers)).statusCode).toBe(400);
    expect((await post('/v1/auth/citizen/email/verify', { code: verifyCode }, headers)).statusCode).toBe(200);
    expect((await post('/v1/auth/citizen/email/verify', { code: verifyCode }, headers)).statusCode).toBe(400);
    expect((await get('/v1/auth/citizen/email', headers)).json().data).toEqual({ available: true, email: 'a***@example.com', verified: true });

    const sentBefore = mailer.sent.length;
    const known = await post('/v1/auth/citizen/forgot-password/email', { username: '0911222333' });
    const unknown = await post('/v1/auth/citizen/forgot-password/email', { username: '0999888777' });
    const withoutEmail = await post('/v1/auth/citizen/forgot-password/email', { username: '0911222444' });
    expect([known.statusCode, unknown.statusCode, withoutEmail.statusCode]).toEqual([202, 202, 202]);
    expect(known.json()).toEqual(unknown.json());
    expect(known.json()).toEqual(withoutEmail.json());
    expect(await waitFor(() => mailer.sent.length === sentBefore + 1)).toBe(true);
    expect(await waitFor(() => mailer.sent.length > sentBefore + 1, 400)).toBe(false);
    const resetCode = codeIn(mailer.sent[sentBefore]!.text);
    expect((await post('/v1/auth/citizen/forgot-password/email', { username: '123' })).statusCode).toBe(400);

    const confirm = (code: string, newPassword = 'MatKhauMoi67890', username = '0911222333') =>
      post('/v1/auth/citizen/forgot-password/email-confirm', { username, code, newPassword });
    expect((await confirm(resetCode, 'ngan1')).statusCode).toBe(400);
    const wrong = resetCode === '000000' ? '111111' : '000000';
    const rejected = await confirm(wrong);
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error).toBe('RESET_CODE_INVALID');
    const stranger = await confirm('123456', 'MatKhauMoi67890', '0999888777');
    expect(stranger.statusCode).toBe(401);
    expect(stranger.json().message).toBe(rejected.json().message);

    const ok = await confirm(resetCode);
    expect(ok.statusCode).toBe(200);
    const login = (password: string) => post('/v1/auth/citizen/login', { username: '0911222333', password });
    expect((await login('MatKhauCu12345')).statusCode).toBe(401);
    expect((await login('MatKhauMoi67890')).statusCode).toBe(200);
    expect((await get('/v1/auth/citizen/session', headers)).statusCode).toBe(401);
    expect((await confirm(resetCode, 'MatKhauKhac12345')).statusCode).toBe(401);
    const events = repository.citizenAccountEvents.map((event) => event.eventType);
    expect(events).toContain('email_verified');
    expect(events).toContain('password_reset_email');
  });

  it('kills a reset code after 5 wrong attempts and rate-limits reset requests per phone', async () => {
    const mailer = new MemoryMailer();
    const repository = new FixtureDirectoryRepository();
    app = await buildApp(repository, { ...baseOptions, mailer });
    const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      app!.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers });
    const registered = await post('/v1/auth/citizen/register', { username: '0911222555', displayName: 'Người dân ba', password: 'MatKhauCu12345' });
    const cookie = String(registered.headers['set-cookie']).split(';')[0]!;
    await post('/v1/auth/citizen/email', { email: 'ba@example.com', currentPassword: 'MatKhauCu12345' }, { cookie });
    await post('/v1/auth/citizen/email/verify', { code: codeIn(mailer.sent[0]!.text) }, { cookie });

    await post('/v1/auth/citizen/forgot-password/email', { username: '0911222555' });
    expect(await waitFor(() => mailer.sent.length === 2)).toBe(true);
    const code = codeIn(mailer.sent[1]!.text);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/v1/auth/citizen/forgot-password/email-confirm', { username: '0911222555', code: wrong, newPassword: 'MatKhauMoi67890' });
    }
    // Đã khóa theo số điện thoại và IP; từ IP khác mã đúng cũng không còn dùng được vì quá số lần thử.
    const fromElsewhere = await app.inject({ method: 'POST', url: '/v1/auth/citizen/forgot-password/email-confirm', remoteAddress: '10.9.9.9', payload: { username: '0911222555', code, newPassword: 'MatKhauMoi67890' } });
    expect(fromElsewhere.statusCode).toBe(401);

    let last = 0;
    for (let index = 0; index < 4; index += 1) last = (await post('/v1/auth/citizen/forgot-password/email', { username: '0911222555' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('registration with an optional email', () => {
  it('sends a verification code for a valid email, rejects a malformed one, and still registers without a mail service', async () => {
    const mailer = new MemoryMailer();
    app = await buildApp(new FixtureDirectoryRepository(), { ...baseOptions, mailer });
    const register = (phone: string, email?: unknown, remoteAddress = '127.0.0.1') => app!.inject({
      method: 'POST', url: '/v1/auth/citizen/register', remoteAddress,
      payload: { username: phone, displayName: 'Người dân mới', password: 'MatKhauCu12345', ...(email === undefined ? {} : { email }) },
    });

    const plain = await register('0911000001');
    expect(plain.statusCode).toBe(201);
    expect(plain.json().data.emailVerification).toBeUndefined();
    expect((await register('0911000002', '   ')).json().data.emailVerification).toBeUndefined();

    const malformed = await register('0911000003', 'khong-phai-email');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toBe('INVALID_EMAIL');
    expect((await register('0911000003')).statusCode).toBe(201);

    const withEmail = await register('0911000004', ' Dan.Moi@Example.com ');
    expect(withEmail.statusCode).toBe(201);
    expect(withEmail.json().data.emailVerification).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('dan.moi@example.com');
    const cookie = String(withEmail.headers['set-cookie']).split(';')[0]!;
    const verified = await app.inject({ method: 'POST', url: '/v1/auth/citizen/email/verify', headers: { cookie }, payload: { code: codeIn(mailer.sent[0]!.text) } });
    expect(verified.statusCode).toBe(200);

    // Tối đa 3 thư xác minh mỗi giờ cho cùng một địa chỉ (chống dùng form đăng ký để gửi thư rác).
    for (let index = 0; index < 4; index += 1) await register(`091100010${index}`, 'nan.nhan@example.com', `10.1.1.${index + 1}`);
    expect(mailer.sent.filter((mail) => mail.to === 'nan.nhan@example.com')).toHaveLength(3);

    const noMailService = await buildApp(new FixtureDirectoryRepository(), baseOptions);
    try {
      const registered = await noMailService.inject({ method: 'POST', url: '/v1/auth/citizen/register', payload: { username: '0911000005', displayName: 'Người dân mới', password: 'MatKhauCu12345', email: 'a@b.vn' } });
      expect(registered.statusCode).toBe(201);
      expect(registered.json().data.emailVerification).toBe('unavailable');
    } finally { await noMailService.close(); }
  });
});
