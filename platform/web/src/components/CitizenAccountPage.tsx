import { ChevronRight, FileWarning, HelpCircle, LogOut, Star, UserRoundCheck } from 'lucide-react';
import type { CitizenSession } from '../types';

interface CitizenAccountPageProps {
  session: CitizenSession | null;
  areaName: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onNavigate: (feature: 'reports' | 'feedback') => void;
  onStartTour: () => void;
}

export function CitizenAccountPage({ session, areaName, onLogin, onLogout, onNavigate, onStartTour }: CitizenAccountPageProps) {
  return <section className="citizen-account-page" aria-labelledby="citizen-account-title">
    <div className="account-hero">
      <span className="account-avatar"><UserRoundCheck /></span>
      <div><h1 id="citizen-account-title">{session?.displayName ?? 'Chưa đăng nhập'}</h1>{areaName && <span>Đang xem: {areaName}</span>}</div>
    </div>

    {!session && <button className="account-login-button" type="button" onClick={onLogin}><UserRoundCheck aria-hidden="true" /> Đăng nhập hoặc đăng ký <ChevronRight /></button>}

    <nav className="account-actions" aria-label="Tiện ích tài khoản">
      <button type="button" onClick={() => onNavigate('reports')}><span><FileWarning /></span><div><strong>Phản ánh của tôi</strong></div><ChevronRight /></button>
      <button type="button" onClick={() => onNavigate('feedback')}><span><Star /></span><div><strong>Đánh giá hài lòng</strong></div><ChevronRight /></button>
      <button type="button" onClick={onStartTour}><span><HelpCircle /></span><div><strong>Hướng dẫn sử dụng</strong></div><ChevronRight /></button>
    </nav>
    {session && <button className="account-logout-button" type="button" onClick={onLogout}><LogOut /> Đăng xuất tài khoản</button>}
  </section>;
}
