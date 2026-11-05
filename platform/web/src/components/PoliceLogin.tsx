import { FormEvent, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LogIn, ShieldCheck, X } from 'lucide-react';
import { ApiError, signInOfficer } from '../api';
import type { WorkflowActor } from '../types';
import directoryLogoUrl from '../../../../assets/images/logo-transparent.png';

interface PoliceLoginCardProps {
  onSuccess: (actor: WorkflowActor) => void;
  onCancel: () => void;
  showClose?: boolean;
}

function PoliceLoginCard({ onSuccess, onCancel, showClose = true }: PoliceLoginCardProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    usernameRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const actor = await signInOfficer(username, password);
      setError('');
      onSuccess(actor);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống xác thực.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="police-login-card" aria-labelledby="police-login-title">
      <header className="police-login-card-header">
        <span className="police-login-emblem"><ShieldCheck size={24} aria-hidden="true" /></span>
        <div>
          <p>Cổng cán bộ địa bàn</p>
          <h1 id="police-login-title">Đăng nhập CSKV</h1>
        </div>
        {showClose && (
          <button type="button" onClick={onCancel} aria-label="Đóng cửa sổ đăng nhập">
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </header>

      <form className="police-login-form" onSubmit={submit} noValidate>
        <label htmlFor="police-username">Tên đăng nhập
          <input
            ref={usernameRef}
            id="police-username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => { setUsername(event.target.value); setError(''); }}
            aria-invalid={Boolean(error)}
            required
          />
        </label>
        <div className="police-login-field">
          <label htmlFor="police-password">Mật khẩu</label>
          <span className="police-password-field">
            <input
              id="police-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'police-login-error' : undefined}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </span>
        </div>
        {error && <p className="police-login-error" id="police-login-error" role="alert">{error}</p>}
        <button className="police-login-submit" type="submit" disabled={submitting}>
          <LogIn size={19} aria-hidden="true" /> {submitting ? 'Đang xác thực…' : 'Đăng nhập vào cổng CSKV'}
        </button>
      </form>
    </section>
  );
}

interface PoliceLoginDialogProps {
  open: boolean;
  onSuccess: (actor: WorkflowActor) => void;
  onClose: () => void;
}

export function PoliceLoginDialog({ open, onSuccess, onClose }: PoliceLoginDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="police-login-layer">
      <button className="police-login-scrim" type="button" onClick={onClose} aria-label="Đóng cửa sổ đăng nhập" />
      <div ref={dialogRef} className="police-login-dialog" role="dialog" aria-modal="true" aria-labelledby="police-login-title">
        <PoliceLoginCard onSuccess={onSuccess} onCancel={onClose} />
      </div>
    </div>
  );
}

interface PoliceLoginScreenProps {
  onSuccess: (actor: WorkflowActor) => void;
  /** Bỏ trống ở app dành cho cán bộ: không có màn hình người dân để quay lại. */
  onBack?: () => void;
}

export function PoliceLoginScreen({ onSuccess, onBack }: PoliceLoginScreenProps) {
  return (
    <main className="police-login-screen">
      <a className="police-login-brand" href="./" onClick={(event) => { event.preventDefault(); onBack?.(); }}>
        <img src={directoryLogoUrl} alt="" width="44" height="44" />
        <span><strong>Công an tỉnh Lâm Đồng</strong><small>Cổng CSKV</small></span>
      </a>
      <PoliceLoginCard onSuccess={onSuccess} onCancel={onBack ?? (() => undefined)} showClose={false} />
      {onBack && <button className="police-login-back" type="button" onClick={onBack}>Quay lại bản đồ người dân</button>}
    </main>
  );
}
