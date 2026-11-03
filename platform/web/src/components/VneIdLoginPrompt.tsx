import { ChevronRight, UserRoundCheck } from 'lucide-react';

interface VneIdLoginPromptProps {
  action: string;
  onLogin: () => void;
  compact?: boolean;
}

export function VneIdLoginPrompt({ action, onLogin, compact = false }: VneIdLoginPromptProps) {
  return (
    <aside className={compact ? 'vneid-access-prompt compact' : 'vneid-access-prompt'} aria-label="Yêu cầu đăng nhập tài khoản người dân">
      <UserRoundCheck size={28} aria-hidden="true" />
      <span><strong>Đăng nhập để {action}</strong></span>
      <button type="button" onClick={onLogin}><span>Đăng nhập / Đăng ký</span><ChevronRight size={18} aria-hidden="true" /></button>
    </aside>
  );
}
