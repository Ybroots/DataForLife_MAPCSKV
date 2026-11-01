import { useEffect } from 'react';
import { BellRing, X } from 'lucide-react';
import type { PushEventDetail } from '../push-notifications';

interface Props {
  toast: PushEventDetail | null;
  onOpen: (toast: PushEventDetail) => void;
  onClose: () => void;
}

/** Biểu ngữ đầu màn hình khi có thông báo tới đúng lúc ứng dụng đang mở (hệ thống không tự hiện thông báo lúc này). */
export function PushToast({ toast, onOpen, onClose }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, 9000);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className="push-toast" role="status" aria-live="polite">
      <button className="push-toast-body" type="button" onClick={() => { if (toast.target) onOpen(toast); onClose(); }}>
        <span className="push-toast-icon" aria-hidden="true"><BellRing size={20} /></span>
        <span><strong>{toast.title || 'Thông báo mới'}</strong>{toast.body && <small>{toast.body}</small>}</span>
      </button>
      <button className="push-toast-x" type="button" onClick={onClose} aria-label="Đóng thông báo"><X size={18} aria-hidden="true" /></button>
    </div>
  );
}
