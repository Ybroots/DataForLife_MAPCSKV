import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, FileText, Globe, Info, KeyRound, LocateFixed, MapPin, OctagonAlert, ShieldAlert, Siren, Star, TriangleAlert, X } from 'lucide-react';
import { TOAST_EVENT, type ToastDetail, type ToastTopic } from '../toast';

interface Item extends ToastDetail { id: number }

const MAX_VISIBLE = 3;
const DURATION: Record<ToastDetail['kind'], number> = { success: 4200, info: 4200, warning: 6000, error: 6500 };

const TOPIC_ICON: Record<ToastTopic, typeof Info> = {
  report: FileText, sos: Siren, account: KeyRound, location: LocateFixed, alert: ShieldAlert,
  rating: Star, notify: Bell, map: MapPin, language: Globe,
};

function iconFor(item: Item) {
  if (item.kind === 'error') return OctagonAlert;
  if (item.kind === 'warning') return TriangleAlert;
  if (item.topic === 'language' || item.topic === 'map') return TOPIC_ICON[item.topic];
  return item.kind === 'success' && item.topic === 'account' ? CheckCircle2 : TOPIC_ICON[item.topic];
}

/** Dãy popup phản hồi tức thời theo từng chức năng (phản ánh, SOS, tài khoản, vị trí, cảnh báo, đánh giá, thông báo). */
export function AppToasts() {
  const [items, setItems] = useState<Item[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.title) return;
      if (detail.kind === 'error') navigator.vibrate?.([30, 40, 30]); else if (detail.kind === 'success' || detail.kind === 'warning') navigator.vibrate?.(14);
      setItems((current) => {
        // Cùng nội dung đang hiện: không chồng thêm.
        if (current.some((item) => item.title === detail.title && item.message === detail.message)) return current;
        const id = ++counter.current;
        timers.current.set(id, window.setTimeout(() => dismiss(id), DURATION[detail.kind]));
        const next = [...current, { ...detail, id }];
        while (next.length > MAX_VISIBLE) { const old = next.shift(); if (old) { const t = timers.current.get(old.id); if (t !== undefined) window.clearTimeout(t); timers.current.delete(old.id); } }
        return next;
      });
    };
    window.addEventListener(TOAST_EVENT, onToast);
    const pending = timers.current;
    return () => { window.removeEventListener(TOAST_EVENT, onToast); pending.forEach((timer) => window.clearTimeout(timer)); pending.clear(); };
  }, [dismiss]);

  if (items.length === 0) return null;
  return (
    <div className="app-toasts" role="region" aria-label="Thông báo">
      {items.map((item) => {
        const Icon = iconFor(item);
        return (
          <div key={item.id} className={`app-toast ${item.kind} ${item.topic}`} role={item.kind === 'error' || item.kind === 'warning' ? 'alert' : 'status'}>
            <span className="app-toast-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="app-toast-copy"><strong>{item.title}</strong>{item.message && <small>{item.message}</small>}</span>
            <button type="button" onClick={() => dismiss(item.id)} aria-label="Đóng thông báo"><X size={16} aria-hidden="true" /></button>
          </div>
        );
      })}
    </div>
  );
}
