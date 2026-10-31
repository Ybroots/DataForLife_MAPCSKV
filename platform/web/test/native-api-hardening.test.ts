import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { apiFetch, MAX_NATIVE_BODY_CHARS } from '../src/native-api';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() }, CapacitorHttp: { request: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

function native() {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.stubEnv('VITE_API_BASE_URL', 'https://bandosocskv.com/api');
}
const url = 'https://bandosocskv.com/api/v1/citizen/incidents';

describe('Android API transport hardening', () => {
  it('reports transport failures as TypeError like fetch(), keeping the cause', async () => {
    native();
    const cause = new Error('Unable to resolve host');
    vi.mocked(CapacitorHttp.request).mockRejectedValue(cause);
    const failure = await apiFetch(url).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).cause).toBe(cause);
  });
  it('does not turn an abort into a network error', async () => {
    native();
    const controller = new AbortController();
    vi.mocked(CapacitorHttp.request).mockReturnValue(new Promise(() => undefined) as ReturnType<typeof CapacitorHttp.request>);
    const pending = apiFetch(url, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses bodies it cannot carry instead of silently dropping them', async () => {
    native();
    await expect(apiFetch(url, { method: 'POST', body: new Blob(['x']) })).rejects.toThrow('không được hỗ trợ');
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
  it('refuses bodies larger than the bridge limit with a user-readable message', async () => {
    native();
    await expect(apiFetch(url, { method: 'POST', body: 'x'.repeat(MAX_NATIVE_BODY_CHARS + 1) })).rejects.toThrow('quá lớn');
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
  it('sends a non-JSON text body as text', async () => {
    native();
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ data: {}, status: 200, headers: {}, url: '' });
    await apiFetch(url, { method: 'POST', body: 'plain text' });
    expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({ data: 'plain text' }));
  });
  it('fits a 20 MB video encoded as base64 within the limit', () => {
    expect(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4096).toBeLessThan(MAX_NATIVE_BODY_CHARS);
  });
});
