import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, FileWarning, HelpCircle, KeyRound, LifeBuoy, LogOut, Mail, Star, UserRoundCheck } from 'lucide-react';
import { showToast } from '../toast';
import { ApiError, changeCitizenPassword, createCitizenRecoveryCode, getCitizenEmailStatus, requestCitizenEmailVerification, verifyCitizenEmail, type CitizenEmailStatus } from '../api';
import type { CitizenSession } from '../types';
import { PASSWORD_RECOVERY_ENABLED } from '../password-recovery';
import { RecoveryCodeNotice } from './CitizenRecovery';

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
      showToast({ kind: 'success', topic: 'account', title: 'Đã đổi mật khẩu' });
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

/** Tạo (hoặc tạo lại) mã khôi phục mật khẩu. Tài khoản cũ chưa có mã cần tạo ở đây; tạo lại thì mã cũ hết hiệu lực. */
function RecoveryCodeSection() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const current = String(new FormData(form).get('currentPassword') ?? '');
    setBusy(true); setError('');
    try {
      const result = await createCitizenRecoveryCode(current);
      form.reset();
      setCode(result.recoveryCode);
      showToast({ kind: 'warning', topic: 'account', title: 'Đã tạo mã khôi phục mới', message: 'Hãy lưu mã trước khi đóng.' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Chưa tạo được mã khôi phục. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  return <details className="account-password">
    <summary><span><LifeBuoy /></span><strong>Mã khôi phục mật khẩu</strong><ChevronRight /></summary>
    {code
      ? <RecoveryCodeNotice code={code} heading="Mã khôi phục mới của bạn" intro="Mã cũ (nếu có) không còn dùng được. Hãy lưu mã mới trước khi đóng." doneLabel="Xong, ẩn mã" onDone={() => setCode(null)} />
      : <form onSubmit={(event) => void submit(event)}>
        <p className="recovery-lead">Nhập mật khẩu hiện tại để tạo mã mới (mã cũ hết hiệu lực).</p>
        <label>Mật khẩu hiện tại<input name="currentPassword" type="password" autoComplete="current-password" required minLength={8} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo mã khôi phục'}</button>
      </form>}
  </details>;
}

/** Email khôi phục: thêm email, nhận mã 6 số để xác minh. Có email đã xác minh thì quên mật khẩu tự lấy lại được qua email. */
function EmailRecoverySection() {
  const [status, setStatus] = useState<CitizenEmailStatus | null>(null);
  const [step, setStep] = useState<'view' | 'code'>('view');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const refresh = () => { getCitizenEmailStatus().then(setStatus).catch(() => setStatus({ available: false, email: null, verified: false })); };
  useEffect(refresh, []);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMessage(null);
    try {
      const result = await requestCitizenEmailVerification(String(data.get('email') ?? ''), String(data.get('currentPassword') ?? ''));
      form.reset();
      setPendingEmail(result.email);
      setStep('code');
      showToast({ kind: 'info', topic: 'account', title: 'Đã gửi mã xác minh', message: result.email });
      setMessage({ ok: true, text: `Đã gửi mã 6 số tới ${result.email}. Mã có hiệu lực 15 phút, hãy kiểm tra cả thư rác.` });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.message : 'Chưa gửi được mã. Vui lòng thử lại.' });
    } finally { setBusy(false); }
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '').trim();
    setBusy(true); setMessage(null);
    try {
      await verifyCitizenEmail(code);
      form.reset();
      setStep('view');
      setMessage({ ok: true, text: 'Đã xác minh email. Từ nay bạn có thể lấy lại mật khẩu qua email này.' });
      showToast({ kind: 'success', topic: 'account', title: 'Đã xác minh email' });
      refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.message : 'Chưa xác minh được. Vui lòng thử lại.' });
    } finally { setBusy(false); }
  }

  return <details className="account-password">
    <summary><span><Mail /></span><strong>Email khôi phục mật khẩu</strong><ChevronRight /></summary>
    {status && <p className="recovery-lead">
      {status.verified && status.email ? `Email khôi phục: ${status.email} (đã xác minh).` : status.email ? `Email ${status.email} chưa được xác minh.` : 'Bạn chưa thêm email khôi phục.'}
      {!status.available && ' Gửi email chưa được kết nối trên hệ thống này, nên chưa thêm được email.'}
    </p>}
    {status?.available && step === 'view' && <form onSubmit={(event) => void requestCode(event)}>
      <label>{status.verified ? 'Đổi sang email khác' : 'Địa chỉ email'}<input name="email" type="email" autoComplete="email" required placeholder="ten@example.com" /></label>
      <label>Mật khẩu hiện tại<input name="currentPassword" type="password" autoComplete="current-password" required minLength={8} /></label>
      <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi mã xác minh'}</button>
    </form>}
    {status?.available && step === 'code' && <form onSubmit={(event) => void confirmCode(event)}>
      <label>Mã 6 số trong email {pendingEmail}<input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" placeholder="123456" /></label>
      <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang xác minh…' : 'Xác minh email'}</button>
      <button className="recovery-back" type="button" onClick={() => { setStep('view'); setMessage(null); }}>Nhập lại email</button>
    </form>}
    {message && <p className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
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
    {session && PASSWORD_RECOVERY_ENABLED && <EmailRecoverySection />}
    {session && PASSWORD_RECOVERY_ENABLED && <RecoveryCodeSection />}
    {session && <button className="account-logout-button" type="button" onClick={onLogout}><LogOut /> Đăng xuất tài khoản</button>}
  </section>;
}
