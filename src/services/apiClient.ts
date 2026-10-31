/**
 * API Client cho mobile app — gọi HTTPS tới bandosocskv.com
 * Thay thế toàn bộ Firestore calls.
 *
 * Lưu ý kỹ thuật:
 * - credentials: 'include' để trình duyệt/WebView giữ cookie session HttpOnly
 * - CORS trên server cần allow origin của app hoặc dùng native HTTP plugin nếu cookie không giữ được
 * - Không nhúng credentials, secret hoặc API key ở đây
 */

const PRODUCTION_API = 'https://bandosocskv.com/api';

/**
 * EXPO_PUBLIC_API_BASE_URL chỉ dùng để thử với API cục bộ/emulator (ví dụ http://10.0.2.2:3001).
 * Bản phát hành (không phải __DEV__) luôn dùng HTTPS production: giá trị khác bị bỏ qua.
 */
function resolveApiBase(): string {
  const override = (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL : undefined)?.trim();
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;
  if (override && (isDev || override.startsWith('https://'))) return override.replace(/\/$/, '');
  return PRODUCTION_API;
}

export const API_BASE_URL = resolveApiBase();

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Core fetch wrapper:
 * - Tự động đặt headers Accept/Content-Type
 * - Gửi cookie session (credentials: 'include')
 * - Timeout mặc định 15 giây
 * - Throw ApiError nếu response không OK
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = 15000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...fetchOptions.headers,
      },
      signal: fetchOptions.signal ?? controller.signal,
    });

    if (response.status === 204) return undefined as T;

    const payload = await response.json();

    if (!response.ok) {
      throw new ApiError(
        payload?.message || 'Không thể kết nối hệ thống.',
        response.status,
        payload?.error || 'REQUEST_FAILED',
      );
    }

    return payload as T;
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Yêu cầu quá thời gian. Vui lòng thử lại.', 0, 'TIMEOUT');
    }
    throw new ApiError(
      'Không thể kết nối mạng. Kiểm tra kết nối Internet.',
      0,
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Kiểm tra lỗi có phải do chưa đăng nhập không */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Kiểm tra lỗi có phải do mất mạng/server không phản hồi không */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}
