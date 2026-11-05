import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, MapPin, UserCog } from 'lucide-react';
import { ApiError, listManagedOfficers, setManagedOfficerPassword, updateManagedOfficer } from '../api';
import { areaCodeFromSelect, isValidOfficerPassword, isValidOfficerUsername, MIN_OFFICER_PASSWORD_LENGTH, OFFICER_USERNAME_HINT } from '../officer-accounts';
import type { ManagedOfficer } from '../types';

type Mode = 'username' | 'password' | 'area';
const messageOf = (cause: unknown, fallback: string) => (cause instanceof ApiError ? cause.message : fallback);

interface RowProps {
  officer: ManagedOfficer;
  areas: Array<{ code: string; name: string }>;
  onChanged: (officer: ManagedOfficer, notice: string) => void;
}

function OfficerAccountRow({ officer, areas, onChanged }: RowProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState(officer.username);
  const [password, setPassword] = useState('');
  const [areaCode, setAreaCode] = useState(officer.serviceArea?.code ?? '');
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = (next: Mode | null) => {
    setMode(next); setError(''); setPassword(''); setGenerated(null); setCopied(false);
    setUsername(officer.username); setAreaCode(officer.serviceArea?.code ?? '');
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(messageOf(cause, 'Chưa lưu được thay đổi. Vui lòng thử lại.')); } finally { setBusy(false); }
  };

  const saveUsername = (event: FormEvent) => {
    event.preventDefault();
    const value = username.trim();
    if (!isValidOfficerUsername(value)) { setError(`Tên đăng nhập: ${OFFICER_USERNAME_HINT}`); return; }
    if (value === officer.username) { setError('Tên đăng nhập chưa thay đổi.'); return; }
    void run(async () => {
      const updated = await updateManagedOfficer(officer.id, { username: value });
      setMode(null);
      onChanged(updated, `Đã đổi tên đăng nhập của ${updated.displayName}.`);
    });
  };

  const saveArea = (event: FormEvent) => {
    event.preventDefault();
    if ((officer.serviceArea?.code ?? '') === areaCode) { setError('Khu vực chưa thay đổi.'); return; }
    void run(async () => {
      const updated = await updateManagedOfficer(officer.id, { serviceAreaCode: areaCodeFromSelect(areaCode) });
      setMode(null);
      onChanged(updated, `Đã đổi khu vực của ${updated.displayName}.`);
    });
  };

  const savePassword = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidOfficerPassword(password)) { setError(`Mật khẩu cần ít nhất ${MIN_OFFICER_PASSWORD_LENGTH} ký tự.`); return; }
    void run(async () => {
      const result = await setManagedOfficerPassword(officer.id, { password });
      setPassword(''); setMode(null);
      onChanged(result.officer, `Đã đặt mật khẩu mới cho ${result.officer.displayName}.`);
    });
  };

  const generatePassword = () => void run(async () => {
    const result = await setManagedOfficerPassword(officer.id, { generate: true });
    setPassword(''); setCopied(false); setGenerated(result.generatedPassword);
    onChanged(result.officer, `Đã tạo mật khẩu mới cho ${result.officer.displayName}.`);
  });

  const copyGenerated = async () => {
    if (!generated) return;
    try { await navigator.clipboard.writeText(generated); setCopied(true); } catch { setError('Không sao chép tự động được. Hãy bôi đen mật khẩu và sao chép thủ công.'); }
  };

  return <li className="officer-account-row">
    <div className="officer-account-summary">
      <strong>{officer.displayName}</strong>
      <span>Tên đăng nhập: <code>{officer.username}</code></span>
      <span className="officer-account-area"><MapPin size={14} aria-hidden="true" />{officer.serviceArea?.name ?? 'Chưa gắn khu vực (thấy cả phường)'}</span>
    </div>
    <div className="officer-account-actions" role="group" aria-label={`Quản lý tài khoản ${officer.displayName}`}>
      <button type="button" className={mode === 'username' ? 'active' : ''} onClick={() => open(mode === 'username' ? null : 'username')}><UserCog size={15} aria-hidden="true" /> Đổi tên đăng nhập</button>
      <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => open(mode === 'password' ? null : 'password')}><KeyRound size={15} aria-hidden="true" /> Đặt mật khẩu</button>
      <button type="button" className={mode === 'area' ? 'active' : ''} onClick={() => open(mode === 'area' ? null : 'area')}><MapPin size={15} aria-hidden="true" /> Đổi khu vực</button>
    </div>

    {mode === 'username' && <form className="officer-account-form" onSubmit={saveUsername}>
      <label><span>Tên đăng nhập mới</span>
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu tên đăng nhập'}</button>
    </form>}

    {mode === 'password' && <div className="officer-account-form">
      <form onSubmit={savePassword}>
        <label><span>Mật khẩu mới (tối thiểu {MIN_OFFICER_PASSWORD_LENGTH} ký tự)</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={MIN_OFFICER_PASSWORD_LENGTH} maxLength={200} />
        </label>
        <button type="submit" disabled={busy || password.length === 0}>{busy ? 'Đang lưu…' : 'Đặt mật khẩu'}</button>
      </form>
      <button type="button" className="secondary" onClick={generatePassword} disabled={busy}>Tạo mật khẩu</button>
      {generated && <div className="officer-generated-password" role="status">
        <span>Mật khẩu mới (chỉ hiện một lần, hãy sao chép ngay):</span>
        <code>{generated}</code>
        <button type="button" onClick={() => void copyGenerated()}><Copy size={15} aria-hidden="true" /> {copied ? 'Đã sao chép' : 'Sao chép'}</button>
      </div>}
    </div>}

    {mode === 'area' && <form className="officer-account-form" onSubmit={saveArea}>
      <label><span>Khu vực phụ trách</span>
        <select value={areaCode} onChange={(event) => setAreaCode(event.target.value)}>
          <option value="">Chưa gắn khu vực (thấy cả phường)</option>
          {areas.map((area) => <option key={area.code} value={area.code}>{area.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu khu vực'}</button>
    </form>}

    {error && <p className="ops-error" role="alert">{error}</p>}
  </li>;
}

/** Chỉ huy quản lý tài khoản cán bộ cùng phường: tên đăng nhập, mật khẩu, khu vực. Không xử lý được hồ sơ. */
export function CommanderOfficerAccounts({ areas, onChanged }: { areas: Array<{ code: string; name: string }>; onChanged: () => void }) {
  const [officers, setOfficers] = useState<ManagedOfficer[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    setError('');
    listManagedOfficers().then(setOfficers).catch((cause) => { setOfficers(null); setError(messageOf(cause, 'Chưa tải được danh sách tài khoản cán bộ.')); });
  }, []);
  useEffect(load, [load]);

  const handleChanged = (updated: ManagedOfficer, message: string) => {
    setOfficers((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? current);
    setNotice(message);
    onChanged();
  };

  return <section className="officer-accounts" aria-labelledby="officer-accounts-title">
    <h3 id="officer-accounts-title">Tài khoản cán bộ</h3>
    {notice && <p className="officer-account-notice" role="status">{notice}</p>}
    {error && <p className="ops-error" role="alert">{error}</p>}
    {!error && officers === null && <p className="workflow-empty" role="status">Đang tải…</p>}
    {officers !== null && officers.length === 0 && <p className="workflow-empty">Chưa có tài khoản cán bộ nào trong phường.</p>}
    <ul className="officer-account-list">
      {officers?.map((officer) => <OfficerAccountRow key={officer.id} officer={officer} areas={areas} onChanged={handleChanged} />)}
    </ul>
  </section>;
}
