import { useEffect, useState } from 'react';
import { MapPin, Phone, RefreshCw, Star, UserRoundCheck } from 'lucide-react';
import { ApiError, getAreaOfficerOverview } from '../api';
import type { AreaOfficerOverview, RatingSummary, StatisticsPeriod } from '../types';

const periodLabels: Record<StatisticsPeriod, string> = { day: 'Ngày', month: 'Tháng', year: 'Năm' };

function todayVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

function ratingText(rating: RatingSummary): string {
  return rating.average === null ? 'Chưa có đánh giá' : `${rating.average.toLocaleString('vi-VN')}/5 · ${rating.count} lượt`;
}

function Stars({ value }: { value: number | null }) {
  const filled = value === null ? 0 : Math.round(value);
  return <span className="area-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((score) => <Star key={score} size={16} fill={score <= filled ? 'currentColor' : 'none'} />)}</span>;
}

/** Chỉ huy xem từng khu vực của phường: cán bộ phụ trách, khối lượng hồ sơ và đánh giá của người dân. Chỉ đọc, không phân công. */
export function CommanderAreaPanel() {
  const [period, setPeriod] = useState<StatisticsPeriod>('month');
  const [date, setDate] = useState(todayVietnam);
  const [rows, setRows] = useState<AreaOfficerOverview[] | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    getAreaOfficerOverview(period, date)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((cause) => { if (!cancelled) { setRows(null); setError(cause instanceof ApiError ? cause.message : 'Chưa tải được dữ liệu các khu vực.'); } });
    return () => { cancelled = true; };
  }, [period, date, reloadKey]);

  return <div className="commander-areas">
    <div className="operations-intro"><UserRoundCheck size={24} /><div><h3>Cán bộ khu vực</h3></div></div>
    <p className="commander-note">Mỗi cán bộ chỉ xử lý hồ sơ trong khu vực mình phụ trách. Điểm hài lòng tính theo cán bộ đang phụ trách hồ sơ.</p>
    <div className="report-controls">
      <div className="report-period" role="tablist" aria-label="Kỳ xem">
        {(Object.keys(periodLabels) as StatisticsPeriod[]).map((item) => <button key={item} type="button" role="tab" aria-selected={period === item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>{periodLabels[item]}</button>)}
      </div>
      <label><span>Mốc thời gian</span><input type="date" value={date} max={todayVietnam()} onChange={(event) => setDate(event.target.value || todayVietnam())} /></label>
      <button type="button" className="report-refresh" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Cập nhật</button>
    </div>
    {error && <p className="ops-error" role="alert">{error}</p>}
    {!error && rows === null && <p className="workflow-empty" role="status">Đang tải…</p>}
    {rows !== null && rows.length === 0 && <p className="workflow-empty">Chưa có khu vực nào được cấu hình cho phường.</p>}
    <div className="area-officer-list">
      {rows?.map((row) => {
        const rating = row.incidentRating;
        return <article className="area-officer-card" key={`${row.serviceArea.code}:${row.officer?.id ?? 'none'}`}>
          <header>
            <span className="area-name"><MapPin size={16} aria-hidden="true" />{row.serviceArea.name}</span>
            {row.officer ? <strong>{row.officer.displayName}</strong> : <strong className="area-unassigned">Chưa có cán bộ phụ trách</strong>}
            {row.officer?.beatNote && <p>{row.officer.beatNote}</p>}
            {row.officer?.phone && <a className="call-button" href={`tel:${row.officer.phone}`} aria-label={`Gọi ${row.officer.displayName}`}><Phone size={16} aria-hidden="true" /><span>{row.officer.phone}</span></a>}
          </header>
          <dl className="area-metrics-grid">
            <div><dt>Phản ánh nhận</dt><dd>{row.incidents.received}</dd></div>
            <div><dt>Đang mở</dt><dd>{row.incidents.open}</dd></div>
            <div><dt>Đã xử lý</dt><dd>{row.incidents.resolved}</dd></div>
            <div><dt>SOS</dt><dd>{row.sosReceived}</dd></div>
          </dl>
          <div className="area-rating">
            <div><Stars value={rating.average} /><strong>{ratingText(rating)}</strong><small>Sau xử lý phản ánh</small></div>
            <div><Stars value={row.sosRating.average} /><strong>{ratingText(row.sosRating)}</strong><small>Sau hỗ trợ SOS</small></div>
            {(rating.lowScoreCount > 0 || row.sosRating.lowScoreCount > 0) && <p className="area-low">Có {rating.lowScoreCount + row.sosRating.lowScoreCount} đánh giá từ 2 sao trở xuống trong kỳ.</p>}
          </div>
        </article>;
      })}
    </div>
  </div>;
}
