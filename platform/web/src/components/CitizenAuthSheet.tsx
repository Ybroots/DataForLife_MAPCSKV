import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LogIn, UserRoundCheck, UserRoundPlus, X } from 'lucide-react';
import { ApiError, registerCitizen, signInCitizen } from '../api';
import type { CitizenSession } from '../types';
import { PASSWORD_RECOVERY_ENABLED } from '../password-recovery';
import { EmailVerifyStep, ForgotPasswordForm, RecoveryCodeNotice } from './CitizenRecovery';

interface CitizenAuthSheetProps {
  open: boolean;
  action: string;
  onClose: () => void;
  onSuccess: (session: CitizenSession) => void;
}

export function CitizenAuthSheet({ open, action, onClose, onSuccess }: CitizenAuthSheetProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  // Mã khôi phục vừa được cấp: giữ phiên đăng ký lại cho đến khi người dân xác nhận đã lưu mã.
  const [recovery, setRecovery] = useState<{ code: string; reason: 'register' | 'reset'; session?: CitizenSession; emailSent?: boolean; emailFailed?: boolean } | null>(null);
  // Đăng ký có nhập email: sau bước mã khôi phục là bước nhập mã xác minh gửi về email.
  const [emailStep, setEmailStep] = useState<CitizenSession | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sheetRef = useRef<HTMLElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => (mode === 'register' ? nameRef.current : phoneRef.current)?.focus({ preventScroll: true }), 180);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mode, open]);

  if (!open) return null;

  const finishRecovery = () => {
    const pending = recovery;
    setRecovery(null);
    if (pending?.reason === 'register' && pending.session) {
      if (pending.emailSent) setEmailStep(pending.session); else onSuccess(pending.session);
    } else setMode('login');
  };
  const finishEmailStep = () => {
    const session = emailStep;
    setEmailStep(null);
    setEmail('');
    if (session) onSuccess(session);
  };
  // Đóng giữa chừng khi vừa đăng ký: tài khoản đã tạo và đã đăng nhập, nên vẫn báo đăng nhập thành công.
  const dismiss = () => {
    if (emailStep) { finishEmailStep(); return; }
    if (recovery?.reason === 'register' && recovery.session) { setRecovery(null); setEmail(''); onSuccess(recovery.session); return; }
    setRecovery(null);
    onClose();
  };

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') dismiss();
    if (event.key !== 'Tab' || !sheetRef.current) return;
    const items = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
    if (!items.length) return;
    const first = items[0]!; const last = items.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    const normalizedPhone = phone.replace(/\s/g, '');
    if (!/^0\d{9}$/.test(normalizedPhone)) { setError('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'); return; }
    if (mode === 'register' && (displayName.trim().length < 2 || displayName.trim().length > 100)) { setError('Họ tên phải có từ 2 đến 100 ký tự.'); return; }
    if (mode === 'register' && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) { setError('Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.'); return; }
    if (!password) { setError('Vui lòng nhập mật khẩu.'); return; }
    if (mode === 'register' && password !== passwordConfirmation) { setError('Mật khẩu nhập lại chưa khớp.'); return; }
    if (mode === 'register' && PASSWORD_RECOVERY_ENABLED && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Địa chỉ email chưa hợp lệ. Bạn có thể để trống và thêm sau trong mục Tài khoản.'); return; }
    setSubmitting(true); setError('');
    try {
      if (mode === 'register') {
        const trimmedEmail = PASSWORD_RECOVERY_ENABLED ? email.trim() : '';
        const registered = await registerCitizen(normalizedPhone, displayName.trim(), password, trimmedEmail || undefined);
        const session = { id: registered.id, displayName: registered.displayName };
        const emailSent = registered.emailVerification === 'sent';
        const emailFailed = Boolean(trimmedEmail) && !emailSent;
        if (registered.recoveryCode && PASSWORD_RECOVERY_ENABLED) setRecovery({ code: registered.recoveryCode, reason: 'register', session, emailSent, emailFailed });
        else if (emailSent) setEmailStep(session);
        else { setEmail(''); onSuccess(session); }
      } else {
        onSuccess(await signInCitizen(normalizedPhone, password));
      }
    }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống đăng nhập.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="citizen-auth-layer">
      <button className="citizen-auth-scrim" type="button" onClick={dismiss} aria-label="Đóng đăng nhập" />
      <section ref={sheetRef} className="citizen-auth-sheet" role="dialog" aria-modal="true" aria-labelledby="citizen-auth-sheet-title" tabIndex={-1} onKeyDown={handleKeys}>
        <span className="citizen-auth-grip" aria-hidden="true" />
        <header>
          <span className="citizen-auth-mark" aria-hidden="true"><UserRoundCheck size={26} /></span>
          <div><small>TÀI KHOẢN NGƯỜI DÂN</small><h2 id="citizen-auth-sheet-title">{emailStep ? 'Xác minh email' : recovery ? 'Lưu mã khôi phục' : mode === 'forgot' ? 'Quên mật khẩu' : mode === 'login' ? `Đăng nhập để ${action}` : 'Tạo tài khoản mới'}</h2></div>
          <button type="button" onClick={dismiss} aria-label="Đóng"><X size={21} aria-hidden="true" /></button>
        </header>
        {recovery && <RecoveryCodeNotice
          code={recovery.code}
          heading={recovery.reason === 'register' ? 'Tài khoản đã được tạo' : 'Đã đặt lại mật khẩu'}
          intro={recovery.reason === 'register'
            ? `Đây là mã khôi phục mật khẩu của bạn. Nếu sau này quên mật khẩu, bạn dùng mã này cùng số điện thoại để đặt lại. ${recovery.emailFailed ? 'Chưa gửi được mã xác minh tới email bạn nhập; bạn có thể thêm email lại trong mục Tài khoản.' : recovery.emailSent ? 'Bước tiếp theo: xác minh email.' : 'Bạn cũng nên thêm email trong mục Tài khoản để tự lấy lại mật khẩu qua email.'}`
            : 'Mật khẩu mới đã có hiệu lực và các máy khác đã bị đăng xuất. Mã khôi phục cũ không còn dùng được, đây là mã mới của bạn.'}
          doneLabel={recovery.reason === 'register' ? (recovery.emailSent ? 'Tiếp tục: xác minh email' : 'Tiếp tục') : 'Đăng nhập bằng mật khẩu mới'}
          onDone={finishRecovery}
        />}
        {emailStep && <EmailVerifyStep onDone={finishEmailStep} />}
        {!recovery && !emailStep && mode === 'forgot' && <ForgotPasswordForm
          variant="sheet"
          initialPhone={phone}
          onBack={() => { setMode('login'); setError(''); }}
          onReset={(code, resetPhone) => { setPhone(resetPhone); setPassword(''); setRecovery({ code, reason: 'reset' }); }}
          onEmailReset={(resetPhone) => { setPhone(resetPhone); setPassword(''); setMode('login'); setNotice('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'); }}
        />}
        {!recovery && !emailStep && mode !== 'forgot' && <div className="citizen-auth-modes" role="tablist" aria-label="Chọn hình thức xác thực">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>Đăng ký</button>
        </div>}
        {!recovery && !emailStep && mode !== 'forgot' && <form className="citizen-auth-form" onSubmit={submit} noValidate>
          {mode === 'register' && <label htmlFor="auth-sheet-name">Họ và tên
            <input ref={nameRef} id="auth-sheet-name" name="displayName" type="text" autoComplete="name" minLength={2} maxLength={100} placeholder="Nguyễn Văn An" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required />
          </label>}
          <label htmlFor="auth-sheet-phone">Số điện thoại
            <input ref={phoneRef} id="auth-sheet-phone" name="username" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="0912345678" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^0-9 ]/g, '')); setError(''); }} aria-invalid={Boolean(error)} required />
          </label>
          <div className="citizen-auth-password-group">
            <label htmlFor="auth-sheet-password">Mật khẩu</label>
            <span className="citizen-password-field"><input id="auth-sheet-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'Ít nhất 10 ký tự, gồm chữ và số' : undefined} value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
          </div>
          {mode === 'login' && <button className="citizen-forgot-link" type="button" onClick={() => { setMode('forgot'); setError(''); }}>Quên mật khẩu?</button>}
          {mode === 'register' && <label htmlFor="auth-sheet-password-confirmation">Nhập lại mật khẩu
            <input id="auth-sheet-password-confirmation" name="passwordConfirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => { setPasswordConfirmation(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required />
          </label>}
          {mode === 'register' && PASSWORD_RECOVERY_ENABLED && <label htmlFor="auth-sheet-email">Email
            <input id="auth-sheet-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="Không bắt buộc, ví dụ ten@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} />
          </label>}
          {notice && <p className="recovery-ok" role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          <button className="citizen-auth-submit" type="submit" disabled={submitting}>
            {mode === 'login' ? <LogIn size={19} aria-hidden="true" /> : <UserRoundPlus size={19} aria-hidden="true" />}
            {submitting ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
          </button>
          <small className="citizen-auth-disclosure">Chưa kết nối hoặc xác minh qua VNeID chính thức.</small>
        </form>}
      </section>
    </div>
  );
}
