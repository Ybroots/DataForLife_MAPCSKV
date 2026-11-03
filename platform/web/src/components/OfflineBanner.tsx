import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/** Báo khi điện thoại mất mạng; tự ẩn khi có mạng lại. Nổi phía trên thanh tab, không đẩy bố cục. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => { window.removeEventListener('offline', down); window.removeEventListener('online', up); };
  }, []);
  if (!offline) return null;
  return <div className="offline-banner" role="status"><WifiOff size={16} aria-hidden="true" /> Không có kết nối mạng</div>;
}
