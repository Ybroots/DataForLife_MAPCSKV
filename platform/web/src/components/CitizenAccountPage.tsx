import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, FileWarning, HelpCircle, KeyRound, LogOut, Star, UserRoundCheck } from 'lucide-react';
import { ApiError, changeCitizenPassword } from '../api';
import type { CitizenSession } from '../types';

interface CitizenAccountPageProps {
  session: CitizenSession | null;
  areaName: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onNavigate: (feature: 'reports' | 'feedback') => void;
  onStartTour: () => void;
}

function ChangePasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (message) statusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [message]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = String(data.get('currentPassword') ?? '');
    const next = String(data.get('newPassword') ?? '');
    if (next !== String(data.get('confirmPassword') ?? '')) { setMessage({ ok: false, text: 'Mật khẩu nhập lại chưa khớp.' }); return; }
    setBusy(true); setMessage(null);
    try {
      await changeCitizenPassword(current, next);
      form.reset();
      setMessage({ ok: true, text: 'Đã đổi mật khẩu.' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.message : 'Chưa đổi được mật khẩu. Vui lòng thử lại.' });
    } finally { setBusy(false); }
  }
  return <details className="account-password">
    <summary><span><KeyRound /></span><strong>Đổi mật khẩu</strong><ChevronRight /></summary>
    <form onSubmit={(event) => void submit(event)}>
      <label>Mật khẩu hiện tại<input name="currentPassword" type="password" autoComplete="current-password" required minLength={8} /></label>
      <label>Mật khẩu mới<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} placeholder="Ít nhất 10 ký tự, gồm chữ và số" /></label>
      <label>Nhập lại mật khẩu mới<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} /></label>
      {message && <p ref={statusRef} className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
      <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu mật khẩu mới'}</button>
    </form>
  </details>;
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
    {session && <ChangePasswordForm />}
    {session && <button className="account-logout-button" type="button" onClick={onLogout}><LogOut /> Đăng xuất tài khoản</button>}
  </section>;
}
