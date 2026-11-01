import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';

interface TourStep {
  target: string | null;
  title: string;
  body: string;
}

const steps: TourStep[] = [
  { target: null, title: 'Làm quen nhanh trong 1 phút', body: 'Xem 6 điểm chính để tra cứu địa bàn, gửi phản ánh và tìm hỗ trợ. Bạn vẫn dùng được ứng dụng trong lúc xem.' },
  { target: '[data-tour="feature-menu"]', title: 'Menu Tính năng', body: 'Mở danh sách đầy đủ: cảnh báo, phản ánh, đánh giá, trợ lý.' },
  { target: '#map-panel', title: 'Bản đồ toàn tỉnh', body: 'Chạm ranh giới hoặc chọn xã/phường để mở danh bạ đúng địa bàn.' },
  { target: '[data-tour="sos"]', title: 'SOS khẩn cấp', body: 'Giữ nút đủ 3 giây để gửi kèm vị trí, thả sớm để hủy. Chỉ dùng khi thật sự cần.' },
  { target: '[data-tour="location"]', title: 'Vị trí của bạn', body: 'Đưa bản đồ về nơi bạn đang đứng. Cho phép định vị khi được hỏi.' },
  { target: '[data-tour="account"]', title: 'Tài khoản', body: 'Xem phản ánh đã gửi, đăng nhập và mở lại hướng dẫn này bất cứ lúc nào.' },
];

interface Rect { top: number; left: number; width: number; height: number }

export function CitizenOnboardingTour({ open, onClose }: { open: boolean; onClose: (completed: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (open) setStep(0); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const selector = steps[step]?.target;
      // Account has desktop and mobile controls; highlight the visible one.
      const node = selector ? [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && window.getComputedStyle(candidate).visibility !== 'hidden';
      }) : null;
      if (!node) { setRect(null); return; }
      const bounds = node.getBoundingClientRect();
      const top = Math.max(8, bounds.top - 6);
      const left = Math.max(8, bounds.left - 6);
      setRect({
        top,
        left,
        width: Math.max(0, Math.min(bounds.width + 12, window.innerWidth - left - 8)),
        height: Math.max(0, Math.min(bounds.height + 12, window.innerHeight - top - 8)),
      });
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const timer = window.setTimeout(update, 80);
    const targetRefresh = window.setInterval(update, 320);
    update();
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.clearTimeout(timer); window.clearInterval(targetRefresh); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open, step]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(false); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose, open]);

  if (!open) return null;
  const current = steps[step]!;
  const last = step === steps.length - 1;
  const onTop = !rect || rect.top > window.innerHeight * 0.5;

  return <section className={onTop ? 'citizen-tour tour-top' : 'citizen-tour'} role="region" aria-label="Hướng dẫn nhanh" aria-live="polite">
    {rect && <div className="tour-spotlight" style={rect} />}
    <div className="tour-card" ref={cardRef}>
      <header>
        <small>{step + 1}/{steps.length}</small>
        <button type="button" onClick={() => onClose(false)} aria-label="Bỏ qua hướng dẫn"><X /></button>
      </header>
      <h2 id="tour-title">{current.title}</h2>
      <p id="tour-description">{current.body}</p>
      <footer>
        {step === 0 && <button type="button" className="tour-back" onClick={() => onClose(false)}>Bỏ qua</button>}
        <button type="button" className="tour-next" onClick={() => last ? onClose(true) : setStep((value) => value + 1)}>{last ? <><Check /> Hoàn tất</> : <>{step === 0 ? 'Bắt đầu khám phá' : 'Tiếp theo'} <ArrowRight /></>}</button>
      </footer>
    </div>
  </section>;
}
