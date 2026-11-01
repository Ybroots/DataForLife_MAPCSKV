import { useEffect, useRef } from 'react';
import { Hammer, X } from 'lucide-react';

export interface FeatureNoticeContent {
  title: string;
  /** Mặc định: câu thông báo chức năng đang phát triển. */
  message?: string;
  hint?: string;
}

export const IN_DEVELOPMENT_MESSAGE = 'Chức năng này đang trong quá trình phát triển và hoàn thiện, sẽ sớm có trong phiên bản tới.';

interface Props {
  notice: FeatureNoticeContent | null;
  onClose: () => void;
}

/** Hộp thông báo dạng tờ trượt dưới cùng: dùng cho tính năng chưa sẵn sàng (chỉ đường, trợ lý AI...). */
export function FeatureNotice({ notice, onClose }: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!notice) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    buttonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [notice, onClose]);

  if (!notice) return null;
  return (
    <div className="feature-notice-layer">
      <button className="feature-notice-scrim" type="button" tabIndex={-1} onClick={onClose} aria-label="Đóng thông báo" />
      <section className="feature-notice" role="dialog" aria-modal="true" aria-labelledby="feature-notice-title" aria-describedby="feature-notice-message">
        <span className="feature-notice-icon" aria-hidden="true"><Hammer size={26} /></span>
        <h2 id="feature-notice-title">{notice.title}</h2>
        <p id="feature-notice-message">{notice.message ?? IN_DEVELOPMENT_MESSAGE}</p>
        {notice.hint && <p className="feature-notice-hint">{notice.hint}</p>}
        <button ref={buttonRef} className="feature-notice-ok" type="button" onClick={onClose}>Đã hiểu</button>
        <button className="feature-notice-x" type="button" onClick={onClose} aria-label="Đóng thông báo"><X size={20} aria-hidden="true" /></button>
      </section>
    </div>
  );
}
