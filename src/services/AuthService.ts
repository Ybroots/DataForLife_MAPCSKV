/**
 * AuthService — xác thực qua API HTTPS
 *
 * Cookie phiên do server set (HttpOnly; Secure; SameSite=Lax).
 * Ghi chú kỹ thuật:
 * - Trong WebView native, cookie thường được giữ tự động qua credentials: 'include'
 * - Nếu kiểm thử thấy cookie bị mất sau khi đóng app, cần dùng Capacitor HTTP plugin
 *   hoặc thiết kế token-based auth riêng cho mobile
 * - Không lưu password, token hoặc session ID vào AsyncStorage dạng plain text
 */

import { apiRequest, isUnauthorized } from './apiClient';
import type { CitizenSession, OfficerSession } from '../models/ApiTypes';

// ─── Cán bộ ──────────────────────────────────────────────────────────────────

/**
 * Đăng nhập cán bộ bằng username + password.
 * Server set cookie phiên HttpOnly.
 */
export async function signInOfficer(
  username: string,
  password: string,
): Promise<OfficerSession> {
  const payload = await apiRequest<{ data: OfficerSession }>('/v1/auth/officer/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return payload.data;
}

/**
 * Kiểm tra phiên cán bộ còn hiệu lực.
 * Dùng khi app khởi động để restore trạng thái đăng nhập.
 */
export async function getOfficerSession(): Promise<OfficerSession | null> {
  try {
    const payload = await apiRequest<{ data: OfficerSession }>('/v1/auth/officer/session');
    return payload.data;
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
}

/** Đăng xuất cán bộ — server invalidate cookie */
export async function signOutOfficer(): Promise<void> {
  await apiRequest<void>('/v1/auth/officer/logout', { method: 'POST' });
}

// ─── Công dân ─────────────────────────────────────────────────────────────────

/**
 * Đăng nhập công dân (tên đăng nhập là số điện thoại 10 số) bằng mật khẩu.
 * VNeID chính thức chưa được kết nối; đây không phải xác thực VNeID.
 */
export async function signInCitizen(
  username: string,
  password: string,
): Promise<CitizenSession> {
  const payload = await apiRequest<{ data: CitizenSession }>('/v1/auth/citizen/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return payload.data;
}

/**
 * Đăng ký tài khoản công dân mới.
 */
export async function registerCitizen(
  username: string,
  displayName: string,
  password: string,
): Promise<CitizenSession> {
  const payload = await apiRequest<{ data: CitizenSession }>('/v1/auth/citizen/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password }),
  });
  return payload.data;
}

/**
 * Kiểm tra phiên công dân còn hiệu lực.
 */
export async function getCitizenSession(): Promise<CitizenSession | null> {
  try {
    const payload = await apiRequest<{ data: CitizenSession }>('/v1/auth/citizen/session');
    return payload.data;
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
}

/** Đăng xuất công dân */
export async function signOutCitizen(): Promise<void> {
  await apiRequest<void>('/v1/auth/citizen/logout', { method: 'POST' });
}
