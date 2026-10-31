import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** Largest JSON body (characters) sent over the native bridge. A 20 MB video encoded as base64 is about 26.7 million characters. */
export const MAX_NATIVE_BODY_CHARS = 30 * 1024 * 1024;

/** The native transport only carries JSON/text bodies. Anything else must fail loudly instead of being dropped. */
function nativeBody(body: BodyInit | null | undefined): { data?: unknown } {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'string') throw new Error('Nội dung gửi không được hỗ trợ trên ứng dụng Android.');
  if (body.length > MAX_NATIVE_BODY_CHARS) throw new Error('Tệp quá lớn để gửi từ ứng dụng. Hãy chọn tệp nhỏ hơn.');
  try { return { data: JSON.parse(body) as unknown }; } catch { return { data: body }; }
}

/** The cookie jar belongs to Android's native transport; no session tokens enter JS storage. */
export async function apiFetch(url: string, init: RequestInit = {}, binary = false): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(url, init);
  const endpoint = new URL(url);
  const allowed = new URL(import.meta.env.VITE_API_BASE_URL || 'https://bandosocskv.com/api');
  const qa = import.meta.env.MODE === 'android-qa' && endpoint.hostname === '10.0.2.2';
  if ((!qa && endpoint.protocol !== 'https:') || endpoint.origin !== allowed.origin || !endpoint.pathname.startsWith(`${allowed.pathname.replace(/\/$/, '')}/`)) {
    throw new Error('Địa chỉ hệ thống không hợp lệ.');
  }
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const pending = CapacitorHttp.request({
    url: endpoint.toString(), method: init.method || 'GET',
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    ...nativeBody(init.body),
    responseType: binary ? 'arraybuffer' : 'json',
    connectTimeout: 15_000, readTimeout: 60_000, disableRedirects: true,
  });
  // Aborting prevents a stale UI result. A sent mutation may still complete on the server:
  // existing incident/SOS idempotency keys remain the protection against duplicate submissions.
  const result = await new Promise<Awaited<typeof pending>>((resolve, reject) => {
    const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
    init.signal?.addEventListener('abort', aborted, { once: true });
    // Match fetch(): transport failures (offline, DNS, timeout) surface as TypeError so existing UI fallbacks apply.
    pending.then(resolve, (error: unknown) => reject(new TypeError('Network request failed', { cause: error })))
      .finally(() => init.signal?.removeEventListener('abort', aborted));
  });
  // Cookies are handled natively. Never expose Set-Cookie to the JS response wrapper.
  const headers = Object.fromEntries(Object.entries(result.headers).filter(([name]) => name.toLowerCase() !== 'set-cookie'));
  let body: BodyInit | null = null;
  if (result.status !== 204 && result.status !== 304) {
    if (binary && result.status >= 200 && result.status < 300) {
      body = Uint8Array.from(atob(String(result.data)), character => character.charCodeAt(0));
    } else body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  }
  return new Response(body, { status: result.status, headers });
}
