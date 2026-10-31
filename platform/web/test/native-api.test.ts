import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { apiFetch } from '../src/native-api';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() }, CapacitorHttp: { request: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Android API transport', () => {
  function native() {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.stubEnv('VITE_API_BASE_URL', 'https://bandosocskv.com/api');
  }
  it('keeps the browser fetch and same-origin session behavior intact', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const browser = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', browser);
    await apiFetch('/api/v1/areas', { credentials: 'include' });
    expect(browser).toHaveBeenCalledWith('/api/v1/areas', { credentials: 'include' });
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
  it.each(['http://bandosocskv.com/api/v1/areas', 'https://evil.example/api/v1/areas', 'https://bandosocskv.com/private'])('rejects unapproved native endpoints: %s', async url => {
    native();
    await expect(apiFetch(url)).rejects.toThrow('không hợp lệ');
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
  it('sends JSON natively without exposing server cookies to JavaScript', async () => {
    native();
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ data: { data: { id: 'test' } }, status: 200, headers: { 'Set-Cookie': 'secret-session', 'Content-Type': 'application/json' }, url: '' });
    const response = await apiFetch('https://bandosocskv.com/api/v1/auth/citizen/login', { method: 'POST', body: JSON.stringify({ username: 'test' }) });
    expect(await response.json()).toEqual({ data: { id: 'test' } });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', data: { username: 'test' }, disableRedirects: true }));
  });
  it('keeps a failed authorization status for the existing auth gates', async () => {
    native();
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ data: { error: 'UNAUTHORIZED' }, status: 401, headers: {}, url: '' });
    expect((await apiFetch('https://bandosocskv.com/api/v1/auth/citizen/session')).status).toBe(401);
  });
  it('supports logout 204 and protected binary attachments', async () => {
    native();
    vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({ data: '', status: 204, headers: {}, url: '' });
    expect((await apiFetch('https://bandosocskv.com/api/v1/auth/citizen/logout', { method: 'POST' })).status).toBe(204);
    vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({ data: 'dGVzdA==', status: 200, headers: { 'Content-Type': 'image/png' }, url: '' });
    expect(await (await apiFetch('https://bandosocskv.com/api/v1/citizen/test', {}, true)).text()).toBe('test');
  });
  it('rejects already-aborted requests before sending', async () => {
    native();
    const controller = new AbortController(); controller.abort();
    await expect(apiFetch('https://bandosocskv.com/api/v1/areas', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
});
