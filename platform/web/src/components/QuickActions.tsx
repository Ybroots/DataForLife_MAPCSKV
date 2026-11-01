import { Bot, FileWarning, Navigation, Phone, ShieldAlert } from 'lucide-react';

interface Props {
  onReport: () => void;
  onAlerts: () => void;
  onDirections: () => void;
  onAssistant: () => void;
}

/** Hàng lối tắt cho các việc người dân hay làm nhất: gọi công an, phản ánh, xem cảnh báo, chỉ đường, hỏi trợ lý. */
export function QuickActions({ onReport, onAlerts, onDirections, onAssistant }: Props) {
  return (
    <div className="quick-actions" role="group" aria-label="Lối tắt thường dùng">
      <a className="quick-action quick-action-call" href="tel:113"><Phone size={18} aria-hidden="true" /><span>Gọi 113</span></a>
      <button className="quick-action" type="button" onClick={onReport}><FileWarning size={18} aria-hidden="true" /><span>Phản ánh</span></button>
      <button className="quick-action" type="button" onClick={onAlerts}><ShieldAlert size={18} aria-hidden="true" /><span>Cảnh báo</span></button>
      <button className="quick-action" type="button" onClick={onDirections}><Navigation size={18} aria-hidden="true" /><span>Chỉ đường</span></button>
      <button className="quick-action" type="button" onClick={onAssistant}><Bot size={18} aria-hidden="true" /><span>Trợ lý AI</span></button>
    </div>
  );
}
