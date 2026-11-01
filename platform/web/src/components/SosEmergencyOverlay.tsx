import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { BellOff, Eye, MapPin, Siren, UserRoundCheck, Volume2 } from 'lucide-react';
import type { OfficerQueueItem } from '../types';
import { elapsedLabel } from '../officer-alerts';

interface SosEmergencyOverlayProps {
  items: OfficerQueueItem[];
  sirenOn: boolean;
  soundBlocked: boolean;
  soundEnabled: boolean;
  acceptingId: string | null;
  error: string;
  onAccept: (item: OfficerQueueItem) => void;
  onView: (item: OfficerQueueItem) => void;
  onMute: () => void;
  onUnlockSound: () => void;
}

/** Full-screen red alarm shown to the duty officer while an SOS waits for acknowledgement. */
export function SosEmergencyOverlay({
  items, sirenOn, soundBlocked, soundEnabled, acceptingId, error, onAccept, onView, onMute, onUnlockSound,
}: SosEmergencyOverlayProps) {
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const first = items[0];
  const firstId = first?.id;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Move focus to the main action whenever a different SOS comes to the front.
  useEffect(() => {
    if (!firstId) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acceptRef.current?.focus({ preventScroll: true });
    return () => { if (previous && document.contains(previous)) previous.focus({ preventScroll: true }); };
  }, [firstId]);

  if (!first) return null;
  const others = items.slice(1);
  const busy = acceptingId !== null;
  const place = first.serviceAreaName ? `${first.serviceAreaName} · ${first.localityName}` : first.localityName;

  // Keep keyboard focus inside the alarm; Escape only silences it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sirenOn) onMute();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (!focusable.length) return;
    const head = focusable[0]!;
    const tail = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === head) {
      event.preventDefault();
      tail.focus();
    } else if (!event.shiftKey && document.activeElement === tail) {
      event.preventDefault();
      head.focus();
    }
  };

  return (
    <div
      className="sos-emergency-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sos-emergency-title"
      aria-describedby="sos-emergency-detail"
      onKeyDown={onKeyDown}
      onPointerDown={soundBlocked ? onUnlockSound : undefined}
    >
      <div className="sos-emergency-panel" ref={panelRef}>
        <span className="sos-emergency-icon" aria-hidden="true"><Siren size={56} strokeWidth={2.2} /></span>
        <p className="sos-emergency-kicker">Người dân vừa bấm SOS</p>
        <h2 id="sos-emergency-title">SOS KHẨN CẤP</h2>
        <div id="sos-emergency-detail" className="sos-emergency-detail">
          <strong>{first.receiptCode}</strong>
          <span><MapPin size={18} aria-hidden="true" /> {place}</span>
          <span>Gửi {elapsedLabel(first.createdAt, now)} · Chưa cán bộ nào nhận</span>
        </div>
        {others.length > 0 && (
          <p className="sos-emergency-others">
            Còn {others.length} SOS khác đang chờ: {others.slice(0, 3).map((item) => item.receiptCode).join(', ')}{others.length > 3 ? '…' : ''}
          </p>
        )}
        {error && <p className="sos-emergency-error" role="alert">{error}</p>}
        <div className="sos-emergency-actions">
          <button ref={acceptRef} type="button" className="sos-emergency-accept" disabled={busy} onClick={() => onAccept(first)}>
            <UserRoundCheck size={22} aria-hidden="true" />
            {acceptingId === first.id ? 'Đang nhận…' : 'Nhận xử lý ngay'}
          </button>
          <button type="button" className="sos-emergency-view" disabled={busy} onClick={() => onView(first)}>
            <Eye size={20} aria-hidden="true" /> Xem hồ sơ trước
          </button>
        </div>
        <div className="sos-emergency-sound">
          {sirenOn && (
            <button type="button" onClick={onMute}><BellOff size={18} aria-hidden="true" /> Tắt còi</button>
          )}
          {soundBlocked && (
            <button type="button" onClick={onUnlockSound}><Volume2 size={18} aria-hidden="true" /> Bấm để bật còi báo động</button>
          )}
          {!soundEnabled && <span>Còi đang tắt trên máy này (nút “Còi tắt” ở đầu trang).</span>}
        </div>
        <p className="sos-emergency-hint">
          “Nhận xử lý ngay” giao SOS cho bạn và báo cho người dân biết đã có cán bộ nhận. Nếu chỉ xem trước, cảnh báo sẽ hiện lại sau 2 phút khi chưa ai nhận.
        </p>
      </div>
    </div>
  );
}
