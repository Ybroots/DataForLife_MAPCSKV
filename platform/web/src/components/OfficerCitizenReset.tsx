import { FormEvent, useState } from 'react';
import { Check, Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { ApiError, issueCitizenResetCode, type CitizenResetCode } from '../api';
import { copyText } from './CitizenRecovery';

/** Cán bộ cấp mã đặt lại mật khẩu cho người dân đã mất mã khôi phục. */
export function OfficerCitizenReset() {
  const [phone, setPhone] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CitizenResetCode | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = phone.replace(/\s/g, '');
    if (!/^0\d{9}$/.test(normalized)) { setError('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'); return; }
    if (!verified) { setError('Cần xác nhận đã kiểm tra danh tính người dân.'); return; }
    setBusy(true); setError('');
    try {
      setResult(await issueCitizenResetCode(normalized));
      setCopied(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Không thể kết nối hệ thống.');
    } finally { setBusy(false); }
  };

  const reset = () => { setResult(null); setPhone(''); setVerified(false); setError(''); };

  if (result) {
    return (
      <div className="operations-form citizen-reset-result">
        <div className="operations-intro"><KeyRound size={24} /><div><h3>Đã cấp mã đặt lại mật khẩu</h3><p>{result.displayName} · {result.phone}</p></div></div>
        <strong className="recovery-code-value" aria-label={`Mã: ${result.recoveryCode.split('').join(' ')}`}>{result.recoveryCode}</strong>
        <button className="recovery-copy" type="button" onClick={() => { void copyText(result.recoveryCode).then(setCopied); }}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />} {copied ? 'Đã sao chép' : 'Sao chép mã'}
        </button>
        <p className="recovery-lead">Đưa mã này cho người dân. Họ mở app, chọn <strong>Quên mật khẩu?</strong>, nhập số điện thoại, mã này và mật khẩu mới. Mã có hiệu lực đến {new Date(result.expiresAt).toLocaleString('vi-VN')} và chỉ dùng được một lần.</p>
        <p className="recovery-warning"><ShieldAlert size={16} aria-hidden="true" /> Mã chỉ hiện một lần trên màn hình này. Lần cấp này đã được ghi nhật ký kèm tài khoản cán bộ của bạn.</p>
        <button className="ops-submit" type="button" onClick={reset}>Cấp mã cho người khác</button>
      </div>
    );
  }

  return (
    <form className="operations-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="operations-intro"><KeyRound size={24} /><div><h3>Cấp lại mật khẩu cho người dân</h3><p>Dùng khi người dân quên mật khẩu và mất cả mã khôi phục. Chỉ cấp sau khi đã xác minh danh tính (gặp trực tiếp hoặc gọi điện).</p></div></div>
      <label>Số điện thoại tài khoản người dân
        <input name="phone" type="tel" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="0912345678" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^0-9 ]/g, '')); setError(''); }} />
      </label>
      <label className="recovery-confirm"><input type="checkbox" checked={verified} onChange={(event) => { setVerified(event.target.checked); setError(''); }} /> Tôi đã kiểm tra danh tính người dân sở hữu số điện thoại này</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="ops-submit" type="submit" disabled={busy}><KeyRound size={17} /> {busy ? 'Đang cấp mã…' : 'Cấp mã đặt lại'}</button>
    </form>
  );
}
