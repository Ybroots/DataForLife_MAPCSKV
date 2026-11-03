import { useEffect, useRef, useState } from 'react';
import { BellRing, Hammer, MapPin, Plus, X } from 'lucide-react';
import { showToast } from '../toast';
import { getPushStatus } from '../api';
import { IN_DEVELOPMENT_MESSAGE } from './FeatureNotice';
import {
  currentPermission, disablePush, enablePush, followArea, MAX_FOLLOWED_AREAS, pushSupported, syncPushDevice, unfollowArea,
  type FollowedArea, type PushPrefs,
} from '../push-notifications';

interface Props {
  open: boolean;
  /** Lần đầu hỏi ngay sau khi chọn địa bàn: có thêm nút "Để sau". */
  intro: boolean;
  currentArea: FollowedArea | null;
  prefs: PushPrefs;
  onPrefsChange: (prefs: PushPrefs) => void;
  onClose: () => void;
}

type ServerState = 'checking' | 'ready' | 'off' | 'unknown';
type Permission = 'granted' | 'denied' | 'prompt' | 'unknown';

const DENIED_HELP = 'Thông báo đang bị tắt trong điện thoại. Vào Cài đặt › Ứng dụng › Bản đồ số Cảnh sát khu vực › Thông báo để bật, rồi quay lại đây.';

/** Hộp thoại dạng tờ trượt: bật/tắt thông báo ngoài màn hình và chọn khu vực nhận cảnh báo. */
export function NotificationSettings({ open, intro, currentArea, prefs, onPrefsChange, onClose }: Props) {
  const supported = pushSupported();
  const [server, setServer] = useState<ServerState>('checking');
  const [permission, setPermission] = useState<Permission>('unknown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !supported) return;
    const controller = new AbortController();
    setServer('checking'); setMessage('');
    void getPushStatus(controller.signal).then((status) => setServer(status.enabled ? 'ready' : 'off')).catch(() => { if (!controller.signal.aborted) setServer('unknown'); });
    void currentPermission().then(setPermission);
    return () => controller.abort();
  }, [open, supported]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);

  if (!open) return null;

  const active = prefs.enabled && permission !== 'denied';
  const apply = (next: PushPrefs) => { onPrefsChange(next); void syncPushDevice(); };

  const turnOn = async () => {
    setBusy(true); setMessage('');
    const result = await enablePush();
    if (result === 'enabled') {
      setPermission('granted');
      // Lần đầu bật: tự theo dõi địa bàn đang xem để có cảnh báo ngay, người dùng chỉnh lại được bên dưới.
      let next: PushPrefs = { ...prefs, enabled: true, asked: true };
      if (next.areas.length === 0 && currentArea) next = followArea(next, currentArea);
      apply(next);
      showToast({ kind: 'success', topic: 'notify', title: 'Đã bật thông báo' });
    } else if (result === 'denied') {
      setPermission('denied'); setMessage(DENIED_HELP);
    } else {
      setMessage('Chưa bật được thông báo. Hãy kiểm tra kết nối mạng rồi thử lại.');
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true); setMessage('');
    await disablePush();
    onPrefsChange({ ...prefs, enabled: false });
    showToast({ kind: 'info', topic: 'notify', title: 'Đã tắt thông báo' });
    setBusy(false);
  };

  const follow = () => { if (currentArea) { apply(followArea(prefs, currentArea)); showToast({ kind: 'success', topic: 'alert', title: 'Đang theo dõi cảnh báo', message: currentArea.name }); } };
  const unfollow = (code: string) => apply(unfollowArea(prefs, code));
  const canFollow = active && currentArea !== null && !prefs.areas.some((area) => area.code === currentArea.code);
  const atLimit = prefs.areas.length >= MAX_FOLLOWED_AREAS;
  const unavailable = !supported || server === 'off';

  return (
    <div className="feature-notice-layer">
      <button className="feature-notice-scrim" type="button" tabIndex={-1} onClick={onClose} aria-label="Đóng cài đặt thông báo" />
      <section className="feature-notice notify-sheet" role="dialog" aria-modal="true" aria-labelledby="notify-title" aria-describedby="notify-desc">
        <span className="feature-notice-icon" aria-hidden="true">{unavailable ? <Hammer size={26} /> : <BellRing size={26} />}</span>
        <h2 id="notify-title">{intro ? 'Nhận thông báo về an ninh khu vực?' : 'Thông báo trên điện thoại'}</h2>
        <p id="notify-desc">
          {unavailable
            ? IN_DEVELOPMENT_MESSAGE
            : 'Nhận cảnh báo khu vực và cập nhật xử lý phản ánh, SOS ngay trên màn hình điện thoại, kể cả khi bạn không mở ứng dụng.'}
        </p>

        {!unavailable && <>
          <div className="notify-row">
            <span><strong>Nhận thông báo</strong><small>{active ? 'Đang bật' : permission === 'denied' ? 'Đang bị tắt trong điện thoại' : 'Đang tắt'}</small></span>
            <button type="button" role="switch" aria-checked={active} aria-label="Nhận thông báo" className="notify-switch" disabled={busy || server === 'checking'} onClick={() => void (active ? turnOff() : turnOn())}><i aria-hidden="true" /></button>
          </div>
          {message && <p className="notify-message" role="alert">{message}</p>}
          {!message && permission === 'denied' && <p className="notify-message">{DENIED_HELP}</p>}

          {active && <div className="notify-areas">
            <h3>Khu vực nhận cảnh báo</h3>
            <ul>{prefs.areas.map((area) => <li key={area.code}>
              <MapPin size={16} aria-hidden="true" /><span>{area.name}</span>
              <button type="button" aria-label={`Bỏ theo dõi ${area.name}`} onClick={() => unfollow(area.code)}><X size={16} aria-hidden="true" /></button>
            </li>)}</ul>
            {canFollow && <button className="notify-follow" type="button" disabled={atLimit} onClick={follow}><Plus size={16} aria-hidden="true" />Theo dõi {currentArea.name}</button>}
            {canFollow && atLimit && <p className="notify-hint">Tối đa {MAX_FOLLOWED_AREAS} khu vực. Bỏ bớt một khu vực để thêm khu vực mới.</p>}
          </div>}

        </>}

        <button ref={closeRef} className="feature-notice-ok" type="button" onClick={onClose}>{intro && !active ? 'Để sau' : 'Xong'}</button>
        <button className="feature-notice-x" type="button" onClick={onClose} aria-label="Đóng cài đặt thông báo"><X size={20} aria-hidden="true" /></button>
      </section>
    </div>
  );
}
