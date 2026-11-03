import { FormEvent, useEffect, useState } from 'react';
import { Check, Copy, Hammer, ShieldAlert } from 'lucide-react';
import { PASSWORD_RECOVERY_ENABLED } from '../password-recovery';
import { IN_DEVELOPMENT_MESSAGE } from './FeatureNotice';
import { ApiError, confirmPasswordResetEmail, getCitizenRecoveryOptions, requestPasswordResetEmail, resetCitizenPassword, verifyCitizenEmail } from '../api';

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* thử cách dự phòng bên dưới */ }
  try {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', '');
    area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch { return false; }
}

interface RecoveryCodeNoticeProps {
  code: string;
  heading: string;
  intro: string;
  doneLabel: string;
  onDone: () => void;
}

/** Hiện mã khôi phục đúng một lần. Nút xong chỉ mở khi người dân xác nhận đã lưu mã. */
export function RecoveryCodeNotice({ code, heading, intro, doneLabel, onDone }: RecoveryCodeNoticeProps) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [saved, setSaved] = useState(false);
  return (
    <div className="recovery-notice">
      <h3>{heading}</h3>
      <p>{intro}</p>
      <strong className="recovery-code-value" aria-label={`Mã khôi phục: ${code.split('').join(' ')}`}>{code}</strong>
      <button className="recovery-copy" type="button" onClick={() => { void copyText(code).then((ok) => setCopied(ok ? 'ok' : 'failed')); }}>
        {copied === 'ok' ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {copied === 'ok' ? 'Đã sao chép' : 'Sao chép mã'}
      </button>
      {copied === 'failed' && <small role="status">Chưa sao chép được. Hãy chép mã ra giấy hoặc chụp màn hình.</small>}
      <p className="recovery-warning"><ShieldAlert size={16} aria-hidden="true" /> Mã này chỉ hiện một lần và không thể xem lại. Hãy chép ra giấy hoặc lưu ở nơi an toàn. Ai có mã này và số điện thoại của bạn có thể đặt lại mật khẩu, vì vậy đừng gửi cho người khác.</p>
      <label className="recovery-confirm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> Tôi đã lưu mã khôi phục</label>
      <button className="recovery-done" type="button" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

/** Bước xác minh email ngay sau khi đăng ký có nhập email: nhập mã 6 số vừa gửi; "Để sau" bỏ qua (thêm lại được trong Tài khoản). */
export function EmailVerifyStep({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Mã gồm 6 chữ số trong email.'); return; }
    setBusy(true); setError('');
    try { await verifyCitizenEmail(code); onDone(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Chưa xác minh được. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return (
    <form className="recovery-notice" onSubmit={(event) => void submit(event)} noValidate>
      <h3>Xác minh email</h3>
      <p>Chúng tôi đã gửi mã 6 số tới email bạn vừa nhập (kiểm tra cả thư rác, mã có hiệu lực 15 phút). Nhập mã để sau này tự lấy lại mật khẩu qua email khi quên.</p>
      <label htmlFor="register-email-code">Mã trong email
        <input id="register-email-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, '')); setError(''); }} />
      </label>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="recovery-done" type="submit" disabled={busy}>{busy ? 'Đang xác minh…' : 'Xác minh email'}</button>
      <button className="recovery-back" type="button" onClick={onDone}>Để sau</button>
    </form>
  );
}

interface ResetFormProps {
  initialPhone: string;
  variant: 'sheet' | 'inline';
  onBack: () => void;
}

/** Quên mật khẩu bằng số điện thoại + mã khôi phục. */
function CodeResetForm({ initialPhone, variant, onBack, onReset }: ResetFormProps & { onReset: (newRecoveryCode: string, phone: string) => void }) {
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inline = variant === 'inline';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPhone = phone.replace(/\s/g, '');
    const normalizedCode = code.toUpperCase().replace(/[\s-]/g, '');
    if (!/^0\d{9}$/.test(normalizedPhone)) { setError('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'); return; }
    if (normalizedCode.length !== 16) { setError('Mã khôi phục gồm 16 ký tự chữ và số, ví dụ ABCD-EFGH-JKMN-PQRS.'); return; }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Mật khẩu mới cần ít nhất 10 ký tự, gồm chữ và số.'); return; }
    if (password !== confirmation) { setError('Mật khẩu nhập lại chưa khớp.'); return; }
    setSubmitting(true); setError('');
    try {
      const result = await resetCitizenPassword(normalizedPhone, normalizedCode, password);
      onReset(result.recoveryCode, normalizedPhone);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống. Vui lòng thử lại.');
    } finally { setSubmitting(false); }
  };

  return (
    <form className={inline ? 'officer-login-form recovery-form' : 'citizen-auth-form recovery-form'} onSubmit={(event) => void submit(event)} noValidate>
      <p className="recovery-lead">Quên cả mã khôi phục? Hãy đến Công an khu vực để được hỗ trợ.</p>
      <label htmlFor="forgot-phone">Số điện thoại
        <input id="forgot-phone" name="username" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="0912345678" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^0-9 ]/g, '')); setError(''); }} />
      </label>
      <label htmlFor="forgot-code">Mã khôi phục
        <input id="forgot-code" name="recoveryCode" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} placeholder="ABCD-EFGH-JKMN-PQRS" value={code} onChange={(event) => { setCode(event.target.value); setError(''); }} />
      </label>
      <label htmlFor="forgot-password">Mật khẩu mới
        <input id="forgot-password" name="newPassword" type="password" autoComplete="new-password" placeholder="Ít nhất 10 ký tự, gồm chữ và số" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} />
      </label>
      <label htmlFor="forgot-confirmation">Nhập lại mật khẩu mới
        <input id="forgot-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(''); }} />
      </label>
      {error && <p className={inline ? 'officer-login-error' : undefined} role="alert">{error}</p>}
      <button className={inline ? 'citizen-inline-login-submit' : 'citizen-auth-submit'} type="submit" disabled={submitting}>{submitting ? 'Đang xử lý…' : 'Đặt lại mật khẩu'}</button>
      <button className="recovery-back" type="button" onClick={onBack}>Quay lại đăng nhập</button>
    </form>
  );
}

/** Quên mật khẩu qua email: bước 1 gửi mã 6 số tới email đã xác minh, bước 2 nhập mã và mật khẩu mới. */
function EmailResetForm({ initialPhone, variant, onBack, onDone }: ResetFormProps & { onDone: (phone: string) => void }) {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const inline = variant === 'inline';
  const normalizedPhone = phone.replace(/\s/g, '');

  const request = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!/^0\d{9}$/.test(normalizedPhone)) { setError('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'); return; }
    setSubmitting(true); setError('');
    try {
      await requestPasswordResetEmail(normalizedPhone);
      setStep('confirm');
      setResent(step === 'confirm');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống. Vui lòng thử lại.');
    } finally { setSubmitting(false); }
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const digits = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(digits)) { setError('Mã gồm 6 chữ số trong email.'); return; }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Mật khẩu mới cần ít nhất 10 ký tự, gồm chữ và số.'); return; }
    if (password !== confirmation) { setError('Mật khẩu nhập lại chưa khớp.'); return; }
    setSubmitting(true); setError('');
    try {
      await confirmPasswordResetEmail(normalizedPhone, digits, password);
      onDone(normalizedPhone);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống. Vui lòng thử lại.');
    } finally { setSubmitting(false); }
  };

  const formClass = inline ? 'officer-login-form recovery-form' : 'citizen-auth-form recovery-form';
  const submitClass = inline ? 'citizen-inline-login-submit' : 'citizen-auth-submit';
  const errorNode = error && <p className={inline ? 'officer-login-error' : undefined} role="alert">{error}</p>;

  if (step === 'request') {
    return (
      <form className={formClass} onSubmit={(event) => void request(event)} noValidate>
        <p className="recovery-lead">Mã 6 số sẽ gửi tới email đã xác minh của tài khoản.</p>
        <label htmlFor="forgot-email-phone">Số điện thoại
          <input id="forgot-email-phone" name="username" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="0912345678" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^0-9 ]/g, '')); setError(''); }} />
        </label>
        {errorNode}
        <button className={submitClass} type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi mã qua email'}</button>
        <button className="recovery-back" type="button" onClick={onBack}>Quay lại đăng nhập</button>
      </form>
    );
  }
  return (
    <form className={formClass} onSubmit={(event) => void confirm(event)} noValidate>
      <p className="recovery-lead" role="status">{resent ? 'Đã gửi lại mã. ' : ''}Nếu số điện thoại {normalizedPhone} có email đã xác minh, mã 6 số đã được gửi. Hãy kiểm tra cả thư rác. Mã có hiệu lực 15 phút.</p>
      <label htmlFor="forgot-email-code">Mã trong email
        <input id="forgot-email-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, '')); setError(''); }} />
      </label>
      <label htmlFor="forgot-email-password">Mật khẩu mới
        <input id="forgot-email-password" name="newPassword" type="password" autoComplete="new-password" placeholder="Ít nhất 10 ký tự, gồm chữ và số" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} />
      </label>
      <label htmlFor="forgot-email-confirmation">Nhập lại mật khẩu mới
        <input id="forgot-email-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(''); }} />
      </label>
      {errorNode}
      <button className={submitClass} type="submit" disabled={submitting}>{submitting ? 'Đang xử lý…' : 'Đặt lại mật khẩu'}</button>
      <button className="recovery-back" type="button" disabled={submitting} onClick={() => void request()}>Gửi lại mã</button>
      <button className="recovery-back" type="button" onClick={onBack}>Quay lại đăng nhập</button>
    </form>
  );
}

interface ForgotPasswordFormProps extends ResetFormProps {
  /** Đặt lại bằng mã khôi phục: trả về mã khôi phục mới để hiện cho người dân. */
  onReset: (newRecoveryCode: string, phone: string) => void;
  /** Đặt lại bằng email: không cấp mã mới. */
  onEmailReset: (phone: string) => void;
}

/** Quên mật khẩu: chọn email (nếu máy chủ đã kết nối) hoặc mã khôi phục. */
function ForgotPasswordFormActive({ initialPhone, variant, onBack, onReset, onEmailReset }: ForgotPasswordFormProps) {
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [method, setMethod] = useState<'email' | 'code'>('email');
  useEffect(() => {
    let cancelled = false;
    getCitizenRecoveryOptions()
      .then((options) => { if (!cancelled) { setEmailAvailable(options.email); setMethod(options.email ? 'email' : 'code'); } })
      .catch(() => { if (!cancelled) { setEmailAvailable(false); setMethod('code'); } });
    return () => { cancelled = true; };
  }, []);
  if (emailAvailable === null) return <p className="recovery-lead" role="status">Đang tải…</p>;
  return (
    <div className="recovery-methods">
      <div className="citizen-auth-modes" role="tablist" aria-label="Cách lấy lại mật khẩu">
        <button type="button" role="tab" aria-selected={method === 'email'} disabled={!emailAvailable} onClick={() => setMethod('email')}>Qua email</button>
        <button type="button" role="tab" aria-selected={method === 'code'} onClick={() => setMethod('code')}>Mã khôi phục</button>
      </div>
      {!emailAvailable && <p className="recovery-lead">Gửi mã qua email chưa được kết nối trên hệ thống này. Bạn có thể dùng mã khôi phục, hoặc đến Công an khu vực để được hỗ trợ.</p>}
      {method === 'email' && emailAvailable
        ? <EmailResetForm initialPhone={initialPhone} variant={variant} onBack={onBack} onDone={onEmailReset} />
        : <CodeResetForm initialPhone={initialPhone} variant={variant} onBack={onBack} onReset={onReset} />}
    </div>
  );
}

/** Quên mật khẩu. Đang phát triển: chưa bật thì chỉ hiện thông báo và hướng dẫn liên hệ Công an khu vực. */
export function ForgotPasswordForm(props: ForgotPasswordFormProps) {
  if (PASSWORD_RECOVERY_ENABLED) return <ForgotPasswordFormActive {...props} />;
  return (
    <div className="recovery-notice recovery-in-development" role="status">
      <span className="recovery-dev-icon" aria-hidden="true"><Hammer size={26} /></span>
      <h3>Lấy lại mật khẩu đang phát triển</h3>
      <p>{IN_DEVELOPMENT_MESSAGE}</p>
      <p>Trong thời gian này, nếu quên mật khẩu, vui lòng liên hệ Công an khu vực để được hỗ trợ.</p>
      <button className="recovery-done" type="button" onClick={props.onBack}>Quay lại đăng nhập</button>
    </div>
  );
}
