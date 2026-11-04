import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, LogIn, ShieldCheck, UserCheck, Users, ArrowRight } from 'lucide-react';
import { ApiError, registerCitizen, signInCitizen, signInOfficer } from '../api';
import type { CitizenSession, WorkflowActor } from '../types';
import { PASSWORD_RECOVERY_ENABLED } from '../password-recovery';
import { EmailVerifyStep, ForgotPasswordForm, RecoveryCodeNotice } from './CitizenRecovery';
import directoryLogoUrl from '../../../../assets/images/logo-transparent.png';

interface LoginScreenProps {
  onEnterAsCitizen: () => void;
  onCitizenLoginSuccess: (session: CitizenSession) => void;
  onOfficerLoginSuccess: (actor: WorkflowActor) => void;
}

export function LoginScreen({ onEnterAsCitizen, onCitizenLoginSuccess, onOfficerLoginSuccess }: LoginScreenProps) {
  const [view, setView] = useState<'roles' | 'citizen-login' | 'citizen-register' | 'citizen-forgot' | 'officer-login'>('roles');
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState<{ code: string; reason: 'register' | 'reset'; session?: CitizenSession; emailSent?: boolean; emailFailed?: boolean } | null>(null);
  const [emailStep, setEmailStep] = useState<CitizenSession | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (view === 'officer-login' || view === 'citizen-login' || view === 'citizen-register') {
      setTimeout(() => usernameRef.current?.focus({ preventScroll: true }), 50);
    }
  }, [view]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (__CITIZEN_ONLY__) return;
    setSubmitting(true);
    try {
      const actor = await signInOfficer(username, password);
      setError('');
      onOfficerLoginSuccess(actor);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống xác thực.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCitizen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    const phone = username.replace(/\s/g, '');
    if (!/^0\d{9}$/.test(phone)) {
      setError('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.');
      return;
    }
    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }
    if (view === 'citizen-register' && (displayName.trim().length < 2 || displayName.trim().length > 100)) {
      setError('Họ tên phải có từ 2 đến 100 ký tự.');
      return;
    }
    if (view === 'citizen-register' && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setError('Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.');
      return;
    }
    if (view === 'citizen-register' && PASSWORD_RECOVERY_ENABLED && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Địa chỉ email chưa hợp lệ. Bạn có thể để trống và thêm sau trong mục Tài khoản.');
      return;
    }
    if (view === 'citizen-register' && password !== passwordConfirmation) {
      setError('Mật khẩu nhập lại chưa khớp.');
      return;
    }
    setSubmitting(true);
    try {
      setError('');
      if (view === 'citizen-register') {
        const trimmedEmail = PASSWORD_RECOVERY_ENABLED ? email.trim() : '';
        const registered = await registerCitizen(phone, displayName.trim(), password, trimmedEmail || undefined);
        const session = { id: registered.id, displayName: registered.displayName };
        const emailSent = registered.emailVerification === 'sent';
        const emailFailed = Boolean(trimmedEmail) && !emailSent;
        // Có mã khôi phục thì giữ lại màn này cho đến khi người dân xác nhận đã lưu mã; sau đó (nếu có email) là bước xác minh email.
        if (registered.recoveryCode && PASSWORD_RECOVERY_ENABLED) setRecovery({ code: registered.recoveryCode, reason: 'register', session, emailSent, emailFailed });
        else if (emailSent) setEmailStep(session);
        else { setEmail(''); onCitizenLoginSuccess(session); }
      } else {
        onCitizenLoginSuccess(await signInCitizen(phone, password));
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống đăng nhập.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToRoles = () => {
    setView('roles'); setError(''); setUsername(''); setDisplayName(''); setPassword(''); setPasswordConfirmation('');
  };

  return (
    <main className="login-screen" aria-label="Chọn vai trò đăng nhập">
      <div className="login-screen-inner">

        <header className="login-brand">
          <div className="login-brand-logo">
            <img src={directoryLogoUrl} alt="Logo Công an Lâm Đồng" width="64" height="64" />
          </div>
          <div className="login-brand-text">
            <strong>Công an tỉnh Lâm Đồng</strong>
            <span>Nền tảng dịch vụ công an địa bàn</span>
          </div>
        </header>

        {view === 'roles' && (
          <>
            <section className="login-role-section" aria-labelledby="role-heading">
              <p id="role-heading" className="login-role-heading">{__CITIZEN_ONLY__ ? 'Bắt đầu sử dụng' : 'Bạn đang truy cập với tư cách?'}</p>
              <div className="login-role-cards">

                <button className="login-role-card citizen" type="button" onClick={onEnterAsCitizen}>
                  <div className="role-card-icon"><Users size={30} aria-hidden="true" /></div>
                  <div className="role-card-body">
                    <strong>Người dân</strong>
                    <span>Tra cứu địa bàn, gửi phản ánh và cầu cứu khẩn cấp</span>
                  </div>
                  <div className="role-card-arrow"><ArrowRight size={20} aria-hidden="true" /></div>
                </button>

                {!__CITIZEN_ONLY__ && <button className="login-role-card officer" type="button" onClick={() => setView('officer-login')}>
                  <div className="role-card-icon"><ShieldCheck size={30} aria-hidden="true" /></div>
                  <div className="role-card-body">
                    <strong>Cán bộ Công an</strong>
                    <span>Cổng cán bộ địa bàn CSKV</span>
                  </div>
                  <div className="role-card-arrow"><ArrowRight size={20} aria-hidden="true" /></div>
                </button>}

              </div>
            </section>

            <div className="login-divider"><span>tài khoản người dân</span></div>

            <div className="login-vneid-section">
              <button className="login-vneid-button" type="button" onClick={() => setView('citizen-login')}>
                <div className="vneid-icon">
                  <UserCheck size={24} aria-hidden="true" />
                </div>
                <div className="vneid-body">
                  <strong>Đăng nhập hoặc đăng ký</strong>
                  <span>Dùng số điện thoại và mật khẩu của hệ thống</span>
                </div>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
              <p className="vneid-notice">
                <UserCheck size={13} aria-hidden="true" />
                Tài khoản được lưu trên hệ thống. VNeID chính thức chưa được kết nối.
              </p>
            </div>
          </>
        )}

        {emailStep && (
          <div className="citizen-inline-login-panel">
            <div className="citizen-inline-login-header">
              <UserCheck size={34} aria-hidden="true" />
              <div><p>TÀI KHOẢN NGƯỜI DÂN</p><h2>Xác minh email</h2></div>
            </div>
            <EmailVerifyStep onDone={() => { const session = emailStep; setEmailStep(null); setEmail(''); onCitizenLoginSuccess(session); }} />
          </div>
        )}

        {recovery && (
          <div className="citizen-inline-login-panel">
            <div className="citizen-inline-login-header">
              <UserCheck size={34} aria-hidden="true" />
              <div><p>TÀI KHOẢN NGƯỜI DÂN</p><h2>Lưu mã khôi phục</h2></div>
            </div>
            <RecoveryCodeNotice
              code={recovery.code}
              heading={recovery.reason === 'register' ? 'Tài khoản đã được tạo' : 'Đã đặt lại mật khẩu'}
              intro={recovery.reason === 'register'
                ? `Đây là mã khôi phục mật khẩu của bạn. Nếu sau này quên mật khẩu, bạn dùng mã này cùng số điện thoại để đặt lại. ${recovery.emailFailed ? 'Chưa gửi được mã xác minh tới email bạn nhập; bạn có thể thêm email lại trong mục Tài khoản.' : recovery.emailSent ? 'Bước tiếp theo: xác minh email.' : 'Bạn cũng nên thêm email trong mục Tài khoản để tự lấy lại mật khẩu qua email.'}`
                : 'Mật khẩu mới đã có hiệu lực và các máy khác đã bị đăng xuất. Mã khôi phục cũ không còn dùng được, đây là mã mới của bạn.'}
              doneLabel={recovery.reason === 'register' ? (recovery.emailSent ? 'Tiếp tục: xác minh email' : 'Tiếp tục') : 'Đăng nhập bằng mật khẩu mới'}
              onDone={() => {
                const pending = recovery;
                setRecovery(null);
                if (pending.reason === 'register' && pending.session) {
                  if (pending.emailSent) setEmailStep(pending.session); else { setEmail(''); onCitizenLoginSuccess(pending.session); }
                }
                else { setView('citizen-login'); setPassword(''); setPasswordConfirmation(''); }
              }}
            />
          </div>
        )}

        {!recovery && !emailStep && view === 'citizen-forgot' && (
          <div className="citizen-inline-login-panel">
            <button className="officer-login-back" type="button" onClick={() => { setView('citizen-login'); setError(''); }}>
              <ArrowLeft size={16} aria-hidden="true" /> Quay lại
            </button>
            <div className="citizen-inline-login-header">
              <UserCheck size={34} aria-hidden="true" />
              <div><p>TÀI KHOẢN NGƯỜI DÂN</p><h2>Quên mật khẩu</h2></div>
            </div>
            <ForgotPasswordForm
              variant="inline"
              initialPhone={username}
              onBack={() => { setView('citizen-login'); setError(''); }}
              onReset={(code, phone) => { setUsername(phone); setRecovery({ code, reason: 'reset' }); }}
              onEmailReset={(phone) => { setUsername(phone); setPassword(''); setView('citizen-login'); setNotice('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'); }}
            />
          </div>
        )}

        {!recovery && !emailStep && (view === 'citizen-login' || view === 'citizen-register') && (
          <div className="citizen-inline-login-panel">
            <button className="officer-login-back" type="button" onClick={backToRoles}>
              <ArrowLeft size={16} aria-hidden="true" /> Quay lại
            </button>
            <div className="citizen-inline-login-header">
              <UserCheck size={34} aria-hidden="true" />
              <div><p>TÀI KHOẢN NGƯỜI DÂN</p><h2>{view === 'citizen-login' ? 'Đăng nhập' : 'Đăng ký tài khoản'}</h2></div>
            </div>
            <div className="citizen-auth-modes" role="tablist" aria-label="Chọn hình thức xác thực">
              <button type="button" role="tab" aria-selected={view === 'citizen-login'} onClick={() => { setView('citizen-login'); setError(''); }}>Đăng nhập</button>
              <button type="button" role="tab" aria-selected={view === 'citizen-register'} onClick={() => { setView('citizen-register'); setError(''); }}>Đăng ký</button>
            </div>
            <form className="officer-login-form" onSubmit={submitCitizen} noValidate>
              {view === 'citizen-register' && <label htmlFor="ls-citizen-name">Họ và tên
                <input id="ls-citizen-name" name="displayName" type="text" autoComplete="name" minLength={2} maxLength={100} placeholder="Nguyễn Văn An" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required />
              </label>}
              <label htmlFor="ls-citizen-phone">Số điện thoại
                <input ref={usernameRef} id="ls-citizen-phone" name="username" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="0912345678" value={username} onChange={(event) => { setUsername(event.target.value.replace(/[^0-9 ]/g, '')); setError(''); }} aria-invalid={Boolean(error)} required />
              </label>
              <div className="officer-password-field">
                <label htmlFor="ls-citizen-password">Mật khẩu</label>
                <span className="officer-password-wrap">
                  <input id="ls-citizen-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={view === 'citizen-register' ? 'new-password' : 'current-password'} placeholder={view === 'citizen-register' ? 'Ít nhất 10 ký tự, gồm chữ và số' : undefined} value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </span>
              </div>
              {view === 'citizen-register' && <label htmlFor="ls-citizen-password-confirmation">Nhập lại mật khẩu
                <input id="ls-citizen-password-confirmation" name="passwordConfirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => { setPasswordConfirmation(event.target.value); setError(''); }} aria-invalid={Boolean(error)} required />
              </label>}
              {view === 'citizen-register' && PASSWORD_RECOVERY_ENABLED && <label htmlFor="ls-citizen-email">Email
                <input id="ls-citizen-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="Không bắt buộc, ví dụ ten@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} />
              </label>}
              {view === 'citizen-login' && <button className="citizen-forgot-link" type="button" onClick={() => { setView('citizen-forgot'); setError(''); setNotice(''); }}>Quên mật khẩu?</button>}
              {notice && <p className="recovery-ok" role="status">{notice}</p>}
              {error && <p className="officer-login-error" role="alert">{error}</p>}
              <button className="citizen-inline-login-submit" type="submit" disabled={submitting}><LogIn size={19} /> {submitting ? 'Đang xử lý…' : view === 'citizen-login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
            </form>
          </div>
        )}

        {!__CITIZEN_ONLY__ && view === 'officer-login' && (
          <div className="officer-login-panel">
            <button
              className="officer-login-back"
              type="button"
              onClick={backToRoles}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Quay lại
            </button>

            <div className="officer-login-header">
              <div className="officer-login-icon"><ShieldCheck size={28} aria-hidden="true" /></div>
              <div>
                <p>Cổng cán bộ địa bàn</p>
                <h2>Đăng nhập CSKV</h2>
              </div>
            </div>

            <p className="officer-login-lead">Chỉ cán bộ đã đăng nhập mới có thể xem hàng đợi SOS và phản ánh của địa bàn.</p>

            <form className="officer-login-form" onSubmit={submit} noValidate>
              <label htmlFor="ls-username">Tên đăng nhập
                <input
                  ref={usernameRef}
                  id="ls-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(''); }}
                  aria-invalid={Boolean(error)}
                  required
                />
              </label>

              <div className="officer-password-field">
                <label htmlFor="ls-password">Mật khẩu</label>
                <span className="officer-password-wrap">
                  <input
                    id="ls-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    aria-invalid={Boolean(error)}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
              </div>

              {error && <p className="officer-login-error" role="alert">{error}</p>}

              <button className="officer-login-submit" type="submit" disabled={submitting}>
                <LogIn size={19} aria-hidden="true" /> {submitting ? 'Đang xác thực…' : 'Đăng nhập vào cổng CSKV'}
              </button>
            </form>
          </div>
        )}

        <footer className="login-footer">
          <p>© 2026 Công an tỉnh Lâm Đồng · Dữ liệu được bảo vệ theo pháp luật</p>
        </footer>

      </div>
    </main>
  );
}
