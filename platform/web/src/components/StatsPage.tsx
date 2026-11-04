import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Clock3, Download, FileText, MapPinned, Quote, ShieldCheck, Star, UserRoundCheck } from 'lucide-react';
import { getPublicStats } from '../api';
import type { PublicStats } from '../types';
import { CountUp } from './CountUp';

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

/** Trang Thống kê: các số đếm hoạt động và vài ý kiến đã được duyệt. Tự cập nhật mỗi phút khi đang mở. */
export function StatsPage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getPublicStats()
        .then((value) => { if (!cancelled) { setStats(value); setFailed(false); } })
        .catch(() => { if (!cancelled) setFailed(true); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (!stats) {
    return <section className="feature-section stats-page" aria-live="polite">
      {failed ? <p className="workflow-empty" role="alert">Chưa tải được số liệu. Vui lòng thử lại sau.</p> : <p className="workflow-empty">Đang tải số liệu…</p>}
    </section>;
  }

  const counters = [
    { key: 'areas', icon: MapPinned, label: 'Địa bàn thí điểm', value: stats.pilotAreas },
    { key: 'officers', icon: Building2, label: 'Cán bộ CSKV tham gia', value: stats.officers },
    { key: 'installs', icon: Download, label: 'Lượt cài đặt', value: stats.installs },
    { key: 'users', icon: UserRoundCheck, label: 'Người dùng đã xác thực', value: stats.verifiedUsers },
    { key: 'received', icon: FileText, label: 'Phản ánh tiếp nhận', value: stats.incidentsReceived },
    { key: 'processed', icon: CheckCircle2, label: 'Phản ánh đã xử lý', value: stats.incidentsProcessed },
  ];

  return (
    <section className="feature-section stats-page" aria-labelledby="stats-title">
      <div className="section-title-row">
        <h2 id="stats-title"><ShieldCheck size={20} aria-hidden="true" /> Hoạt động của ứng dụng</h2>
        {stats.demoData && <span className="stats-demo-pill">Số liệu thử nghiệm</span>}
      </div>

      <div className="stats-grid">
        {counters.map(({ key, icon: Icon, label, value }) => (
          <article className="stats-card" key={key}>
            <span className="stats-card-icon" aria-hidden="true"><Icon size={20} /></span>
            <strong><CountUp value={value} /></strong>
            <span>{label}</span>
          </article>
        ))}
        <article className="stats-card wide">
          <span className="stats-card-icon" aria-hidden="true"><Clock3 size={20} /></span>
          <strong>{formatMinutes(stats.avgResponseMinutes)}</strong>
          <span>Thời gian phản hồi trung bình</span>
        </article>
      </div>

      {stats.opinions.length > 0 && (
        <div className="stats-opinions">
          <h3>Ý kiến</h3>
          {stats.opinions.map((item) => (
            <figure className="stats-quote" key={item.id}>
              <Quote size={18} aria-hidden="true" />
              <blockquote>{item.comment}</blockquote>
              <figcaption>
                <span>{item.authorLabel}</span>
                {item.score !== null && <span className="stats-stars" role="img" aria-label={`${item.score} trên 5 sao`}>{Array.from({ length: item.score }, (_, index) => <Star key={index} size={14} aria-hidden="true" />)}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
