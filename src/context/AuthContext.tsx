/**
 * AuthContext — quản lý trạng thái đăng nhập dùng API thật
 *
 * Thay thế phiên bản cũ chỉ có boolean isLoggedIn.
 * Phiên bản mới:
 * - Lưu thông tin user (role, displayName) từ server
 * - Restore phiên khi app khởi động (kiểm tra cookie còn hiệu lực)
 * - Hỗ trợ cả citizen và officer login
 * - Xử lý lỗi mạng và trạng thái loading
 */

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import {
  signInOfficer,
  signInCitizen,
  signOutOfficer,
  signOutCitizen,
  getOfficerSession,
  getCitizenSession,
} from '../services/AuthService';
import type { CitizenSession, OfficerSession } from '../models/ApiTypes';

export type UserSession =
  | ({ kind: 'officer' } & OfficerSession)
  | ({ kind: 'citizen' } & CitizenSession);

interface AuthContextType {
  /** null = chưa đăng nhập, undefined = đang kiểm tra */
  session: UserSession | null | undefined;
  /** Tiện ích: true nếu đã đăng nhập */
  isLoggedIn: boolean;
  /** Tiện ích: true nếu đang restore phiên lúc khởi động */
  isLoading: boolean;

  /** Đăng nhập cán bộ */
  loginOfficer: (username: string, password: string) => Promise<void>;
  /** Đăng nhập công dân */
  loginCitizen: (username: string, password: string) => Promise<void>;
  /** Đăng xuất (tự phát hiện role từ session) */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);

  const isLoggedIn = session != null;
  const isLoading = session === undefined;

  // ── Restore phiên khi app khởi động ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        // Thử officer trước, rồi citizen
        const officer = await getOfficerSession();
        if (cancelled) return;
        if (officer) {
          setSession({ kind: 'officer', ...officer });
          return;
        }

        const citizen = await getCitizenSession();
        if (cancelled) return;
        if (citizen) {
          setSession({ kind: 'citizen', ...citizen });
          return;
        }

        setSession(null);
      } catch {
        if (!cancelled) setSession(null);
      }
    }

    restoreSession();
    return () => { cancelled = true; };
  }, []);

  // ── Đăng nhập cán bộ ─────────────────────────────────────────────────────
  const loginOfficer = async (username: string, password: string) => {
    const result = await signInOfficer(username, password);
    setSession({ kind: 'officer', ...result });
  };

  // ── Đăng nhập công dân ───────────────────────────────────────────────────
  const loginCitizen = async (username: string, password: string) => {
    const result = await signInCitizen(username, password);
    setSession({ kind: 'citizen', ...result });
  };

  // ── Đăng xuất ────────────────────────────────────────────────────────────
  const logout = async () => {
    try {
      if (session?.kind === 'officer') {
        await signOutOfficer();
      } else if (session?.kind === 'citizen') {
        await signOutCitizen();
      }
    } finally {
      // Luôn clear local state dù API lỗi
      setSession(null);
    }
  };

  return (
    <AuthContext.Provider value={{ session, isLoggedIn, isLoading, loginOfficer, loginCitizen, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
