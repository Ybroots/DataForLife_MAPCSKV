import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Bot,
  ChevronDown,
  ExternalLink,
  FileWarning,
  HelpCircle,
  LogIn,
  MapPinned,
  Scale,
  ShieldAlert,
  Star,
  X,
} from 'lucide-react';
import { FEATURE_LABELS, type FeatureId } from '../features';

interface FeatureDrawerProps {
  open: boolean;
  activeFeature: FeatureId;
  onClose: () => void;
  onSelect: (feature: FeatureId) => void;
  onStartTour: () => void;
  onOfficerLogin: () => void;
}

const featureItems: Array<{
  id: FeatureId;
  description: string;
  icon: typeof MapPinned;
}> = [
  {
    id: 'directory',
    description: 'Tra cứu địa bàn, trụ sở và đầu mối công khai.',
    icon: MapPinned,
  },
  {
    id: 'alerts',
    description: 'Xem cảnh báo an ninh, trật tự và giao thông theo vị trí.',
    icon: ShieldAlert,
  },
  {
    id: 'reports',
    description: 'Gửi phản ánh kèm vị trí, nhận mã và theo dõi xử lý.',
    icon: FileWarning,
  },
  {
    id: 'feedback',
    description: 'Đánh giá sau khi vụ việc được xác nhận hoàn thành.',
    icon: Star,
  },
  {
    id: 'assistant',
    description: 'Tìm địa bàn, danh bạ và cảnh báo công khai trên bản đồ.',
    icon: Bot,
  },
];

const DRAWER_EXIT_DURATION_MS = 180;

export function FeatureDrawer({ open, activeFeature, onClose, onSelect, onStartTour, onOfficerLogin }: FeatureDrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const exitTimer = window.setTimeout(() => setPresent(false), DRAWER_EXIT_DURATION_MS);
    return () => window.clearTimeout(exitTimer);
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!present) return null;

  const followFeatureLink = (event: MouseEvent<HTMLAnchorElement>, feature: FeatureId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(feature);
  };

  return (
    <div className="feature-drawer-layer" data-state={open ? 'open' : 'closing'}>
      <button className="feature-drawer-scrim" type="button" onClick={onClose} aria-label="Đóng danh sách tính năng" />
      <aside
        id="feature-drawer"
        className="feature-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-labelledby="feature-drawer-title"
      >
        <div className="feature-drawer-header">
          <h2 id="feature-drawer-title">Tính năng</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Đóng danh sách tính năng">
            <X size={21} aria-hidden="true" />
          </button>
        </div>

        <div className="feature-list">
          {featureItems.map((item) => {
            const Icon = item.icon;
            const selected = item.id === activeFeature;
            return (
              <a
                key={item.id}
                className={selected ? 'feature-list-item active' : 'feature-list-item'}
                href={item.id === 'directory' ? './' : `?feature=${item.id}`}
                aria-current={selected ? 'page' : undefined}
                onClick={(event) => followFeatureLink(event, item.id)}
              >
                <span className="feature-list-icon"><Icon size={21} aria-hidden="true" /></span>
                <span className="feature-list-copy">
                  <strong>{FEATURE_LABELS[item.id]}</strong>
                  <small>{item.description}</small>
                </span>
              </a>
            );
          })}
        </div>

        <div className="feature-utilities">
          <button type="button" onClick={onStartTour}><HelpCircle size={20} aria-hidden="true" /> Hướng dẫn sử dụng</button>
          <button type="button" onClick={onOfficerLogin}><LogIn size={20} aria-hidden="true" /> Đăng nhập CSKV</button>
        </div>

        <details className="legal-responsibility-note">
          <summary>
            <Scale size={20} aria-hidden="true" />
            <span><strong>Trách nhiệm khi gửi tin</strong><small>Chỉ gửi phản ánh và SOS đúng sự thật</small></span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="legal-responsibility-body">
            <p>Không gửi thông tin bịa đặt, vu khống hoặc dùng SOS để quấy rối. Mức xử lý cụ thể do cơ quan có thẩm quyền xác định theo tính chất và hậu quả.</p>
            <ul>
              <li>Báo thông tin giả, không đúng sự thật đến cơ quan có thẩm quyền hoặc gọi số khẩn cấp để quấy rối có thể bị phạt từ 2–3 triệu đồng.</li>
              <li>Hành vi bịa đặt hoặc loan truyền điều biết rõ là sai nhằm xúc phạm, gây thiệt hại hoặc vu cáo người khác có thể bị truy cứu về tội vu khống.</li>
            </ul>
            <div className="legal-source-links">
              <a href="https://vanban.chinhphu.vn/?classid=1&docid=204979&pageid=27160" target="_blank" rel="noreferrer">Nghị định 144/2021/NĐ-CP <ExternalLink size={13} aria-hidden="true" /></a>
              <a href="https://vanban.chinhphu.vn/?docid=183216&pageid=27160" target="_blank" rel="noreferrer">Điều 156 Bộ luật Hình sự <ExternalLink size={13} aria-hidden="true" /></a>
            </div>
          </div>
        </details>
      </aside>
    </div>
  );
}
