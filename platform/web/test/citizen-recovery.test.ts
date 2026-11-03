import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../src/native-api', () => ({ apiFetch }));

import { ApiError, confirmPasswordResetEmail, createCitizenRecoveryCode, getCitizenRecoveryOptions, issueCitizenResetCode, registerCitizen, requestCitizenEmailVerification, requestPasswordResetEmail, resetCitizenPassword, verifyCitizenEmail } from '../src/api';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => apiFetch.mockReset());

describe('citizen password recovery client', () => {
  it('sends phone, recovery code and new password, and returns the rotated code', async () => {
    apiFetch.mockResolvedValue(reply({ data: { recoveryCode: 'ABCD-EFGH-JKMN-PQRS' } }));
    await expect(resetCitizenPassword('0911222333', 'WXYZ23456789ABCD', 'MatKhauMoi67890')).resolves.toEqual({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS' });
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/auth/citizen/forgot-password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ username: '0911222333', recoveryCode: 'WXYZ23456789ABCD', newPassword: 'MatKhauMoi67890' });
    expect(init.credentials).toBe('include');
  });

  it('turns a failed recovery into an ApiError with the server message', async () => {
    apiFetch.mockResolvedValue(reply({ error: 'RECOVERY_FAILED', message: 'Số điện thoại hoặc mã khôi phục không đúng.' }, 401));
    const failure = await resetCitizenPassword('0911222333', 'AAAABBBBCCCCDDDD', 'MatKhauMoi67890').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe('Số điện thoại hoặc mã khôi phục không đúng.');
  });

  it('regenerates the code with the current password and reads the code returned at registration', async () => {
    apiFetch.mockResolvedValueOnce(reply({ data: { recoveryCode: 'AAAA-BBBB-CCCC-DDDD' } }));
    await expect(createCitizenRecoveryCode('MatKhauCu12345')).resolves.toEqual({ recoveryCode: 'AAAA-BBBB-CCCC-DDDD' });
    expect(JSON.parse(String((apiFetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ currentPassword: 'MatKhauCu12345' });
    apiFetch.mockResolvedValueOnce(reply({ data: { id: 'citizen-1', displayName: 'An', recoveryCode: 'EEEE-FFFF-GGGG-HHHH' } }, 201));
    expect((await registerCitizen('0911222333', 'An', 'MatKhauCu12345')).recoveryCode).toBe('EEEE-FFFF-GGGG-HHHH');
  });

  it('sends the optional email at registration only when one is given', async () => {
    apiFetch.mockResolvedValueOnce(reply({ data: { id: 'citizen-1', displayName: 'An', recoveryCode: 'AAAA-BBBB-CCCC-DDDD', emailVerification: 'sent' } }, 201));
    const withEmail = await registerCitizen('0911222333', 'An', 'MatKhauCu12345', 'an@example.com');
    expect(withEmail.emailVerification).toBe('sent');
    expect(JSON.parse(String((apiFetch.mock.calls.at(-1) as [string, RequestInit])[1].body))).toEqual({ username: '0911222333', displayName: 'An', password: 'MatKhauCu12345', email: 'an@example.com' });

    apiFetch.mockResolvedValueOnce(reply({ data: { id: 'citizen-2', displayName: 'Bình' } }, 201));
    await registerCitizen('0911222444', 'Bình', 'MatKhauCu12345');
    expect(JSON.parse(String((apiFetch.mock.calls.at(-1) as [string, RequestInit])[1].body))).toEqual({ username: '0911222444', displayName: 'Bình', password: 'MatKhauCu12345' });
  });

  it('lets an officer request a reset code only with identity confirmed', async () => {
    apiFetch.mockResolvedValue(reply({ data: { recoveryCode: 'ABCD-EFGH-JKMN-PQRS', expiresAt: '2026-11-04T03:00:00.000Z', displayName: 'An', phone: '0911222333' } }, 201));
    const issued = await issueCitizenResetCode('0911222333');
    expect(issued.recoveryCode).toBe('ABCD-EFGH-JKMN-PQRS');
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/officer/citizen-accounts/reset-code');
    expect(JSON.parse(String(init.body))).toEqual({ phone: '0911222333', verified: true });
  });

  it('calls the email recovery endpoints with the right payloads', async () => {
    apiFetch.mockResolvedValueOnce(reply({ data: { email: true } }));
    await expect(getCitizenRecoveryOptions()).resolves.toEqual({ email: true });

    apiFetch.mockResolvedValueOnce(reply({ data: { sent: true, email: 'a***@example.com' } }, 202));
    await expect(requestCitizenEmailVerification('an@example.com', 'MatKhauCu12345')).resolves.toEqual({ email: 'a***@example.com' });
    let [url, init] = apiFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/auth/citizen/email');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'an@example.com', currentPassword: 'MatKhauCu12345' });

    apiFetch.mockResolvedValueOnce(reply({ data: { email: 'a***@example.com', verified: true } }));
    await expect(verifyCitizenEmail('123456')).resolves.toEqual({ email: 'a***@example.com', verified: true });
    [url, init] = apiFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/auth/citizen/email/verify');
    expect(JSON.parse(String(init.body))).toEqual({ code: '123456' });

    apiFetch.mockResolvedValueOnce(reply({ data: { sent: true } }, 202));
    await requestPasswordResetEmail('0911222333');
    [url, init] = apiFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/auth/citizen/forgot-password/email');
    expect(JSON.parse(String(init.body))).toEqual({ username: '0911222333' });

    apiFetch.mockResolvedValueOnce(reply({ data: { ok: true } }));
    await confirmPasswordResetEmail('0911222333', '123456', 'MatKhauMoi67890');
    [url, init] = apiFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/auth/citizen/forgot-password/email-confirm');
    expect(JSON.parse(String(init.body))).toEqual({ username: '0911222333', code: '123456', newPassword: 'MatKhauMoi67890' });

    apiFetch.mockResolvedValueOnce(reply({ error: 'EMAIL_NOT_CONFIGURED', message: 'Chức năng email chưa được kết nối trên máy chủ này.' }, 503));
    await expect(requestPasswordResetEmail('0911222333')).rejects.toMatchObject({ status: 503 });
  });
});
