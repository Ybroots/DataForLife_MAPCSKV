import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  /** Số chữ số thập phân hiển thị. */
  decimals?: number;
  suffix?: string;
  duration?: number;
}

/** Số chạy lên từ 0 tới giá trị khi hiện ra (không chạy nếu máy bật "giảm chuyển động"). */
export function CountUp({ value, decimals = 0, suffix = '', duration = 700 }: CountUpProps) {
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = previous.current ?? 0;
    previous.current = value;
    if (reduced || from === value) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{shown.toLocaleString('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}
