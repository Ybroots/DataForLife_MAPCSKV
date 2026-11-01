import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Download, FileWarning, Printer, RefreshCw, Siren, Star } from 'lucide-react';
import { ApiError, getOfficerStatistics, listOfficerReportCases } from '../api';
import type { OfficerReportCase, OfficerStatistics, StatisticsPeriod } from '../types';
import { buildReportCsv, downloadTextFile, reportFileName } from '../report-export';
import { PrintableReport } from './PrintableReport';
import { OfficerKpiTable } from './OfficerKpiTable';

const periodLabels: Record<StatisticsPeriod, string> = { day: 'Ngày', month: 'Tháng', year: 'Năm' };
const categoryLabels: Record<string, string> = {
  security: 'An ninh', traffic: 'Giao thông', public_order: 'Trật tự công cộng', administrative: 'Hành chính',
  environment: 'Môi trường', fire_rescue: 'PCCC/CNCH', traffic_accident: 'Tai nạn', medical: 'Y tế', other: 'Khác', other_emergency: 'Khẩn cấp khác',
};

function todayVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

export function OfficerStatisticsPanel({ unitName = 'Công an khu vực' }: { unitName?: string }) {
  const [period, setPeriod] = useState<StatisticsPeriod>('day');
  const [date, setDate] = useState(todayVietnam);
  const [data, setData] = useState<OfficerStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState<'csv' | 'print' | null>(null);
  const [printCases, setPrintCases] = useState<OfficerReportCase[] | null>(null);

  useEffect(() => {
    const clear = () => setPrintCases(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  const exportCsv = async () => {
    if (!data || exporting) return;
    setExporting('csv'); setError('');
    try {
      const cases = await listOfficerReportCases(period, date);
      downloadTextFile(reportFileName(data), buildReportCsv(data, cases, unitName));
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Không xuất được báo cáo.'); } finally { setExporting(null); }
  };

  const printReport = async () => {
    if (!data || exporting) return;
    setExporting('print'); setError('');
    try {
      setPrintCases(await listOfficerReportCases(period, date));
      // Đợi bản in được dựng xong rồi mới mở hộp thoại in/lưu PDF.
      window.setTimeout(() => window.print(), 150);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Không chuẩn bị được bản in.'); } finally { setExporting(null); }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void getOfficerStatistics(period, date)
      .then((value) => { if (!cancelled) setData(value); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Không tải được báo cáo.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, period, reloadKey]);

  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend.map((item) => item.incidents + item.sos) ?? [1])), [data]);

  return <div className="statistics-panel">
    <div className="operations-intro"><CalendarDays size={24} /><div><h3>Báo cáo tình hình địa bàn</h3><p>Số liệu trực tiếp từ phản ánh, SOS và đánh giá của Phường Xuân Hương.</p></div></div>
    <div className="report-controls">
      <div className="report-period" role="tablist" aria-label="Kỳ báo cáo">
        {(Object.keys(periodLabels) as StatisticsPeriod[]).map((item) => <button key={item} type="button" role="tab" aria-selected={period === item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>{periodLabels[item]}</button>)}
      </div>
      <label><span>Mốc thời gian</span><input type="date" value={date} max={todayVietnam()} onChange={(event) => setDate(event.target.value)} /></label>
      <button type="button" className="report-refresh" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><RefreshCw size={16} aria-hidden="true" /> Cập nhật</button>
      <div className="report-export" role="group" aria-label="Xuất báo cáo">
        <button type="button" onClick={() => void exportCsv()} disabled={!data || loading || exporting !== null}><Download size={16} aria-hidden="true" /> {exporting === 'csv' ? 'Đang xuất…' : 'Xuất Excel (CSV)'}</button>
        <button type="button" onClick={() => void printReport()} disabled={!data || loading || exporting !== null}><Printer size={16} aria-hidden="true" /> {exporting === 'print' ? 'Đang chuẩn bị…' : 'In / lưu PDF'}</button>
      </div>
    </div>
    {data && printCases && <PrintableReport stats={data} cases={printCases} unitName={unitName} />}
    {loading && <p className="workflow-empty"><RefreshCw className="spin" size={18} /> Đang tổng hợp số liệu…</p>}
    {error && <p className="inline-notice error" role="alert">{error}</p>}
    {data && !loading && <>
      <div className="statistics-kpis">
        <article><FileWarning /><span>Phản ánh</span><strong>{data.totals.incidents}</strong></article>
        <article className="sos"><Siren /><span>SOS</span><strong>{data.totals.sos}</strong></article>
        <article className="success"><CheckCircle2 /><span>Đã xử lý</span><strong>{data.totals.resolved}</strong></article>
        <article><Clock3 /><span>Đang mở</span><strong>{data.totals.open}</strong></article>
        <article className={data.totals.overdue ? 'warning' : ''}><AlertTriangle /><span>Quá SLA</span><strong>{data.totals.overdue}</strong></article>
        <article><Star /><span>Hài lòng</span><strong>{data.totals.averageRating === null ? '—' : `${data.totals.averageRating}/5`}</strong><small>{data.totals.ratingCount} đánh giá</small></article>
      </div>
      <section className="statistics-chart" aria-labelledby="trend-title">
        <header><div><h4 id="trend-title">Nhịp tiếp nhận theo thời gian</h4><p>Cột đỏ: SOS · cột xanh: phản ánh</p></div><span>{new Date(data.from).toLocaleDateString('vi-VN')} – {new Date(data.to).toLocaleDateString('vi-VN')}</span></header>
        <div className="trend-bars" role="img" aria-label="Biểu đồ số phản ánh và SOS theo thời gian">
          {data.trend.map((item) => <div className="trend-column" key={item.label} title={`${item.label}: ${item.incidents} phản ánh, ${item.sos} SOS`}>
            <div className="trend-stacks"><i className="incident" style={{ height: `${Math.max(item.incidents ? 5 : 0, item.incidents / maxTrend * 100)}%` }} /><i className="sos" style={{ height: `${Math.max(item.sos ? 5 : 0, item.sos / maxTrend * 100)}%` }} /></div>
            <span>{item.label}</span>
          </div>)}
        </div>
        <details><summary>Xem bảng số liệu</summary><div className="statistics-table-wrap"><table><thead><tr><th>Thời gian</th><th>Phản ánh</th><th>SOS</th><th>Đã xử lý</th></tr></thead><tbody>{data.trend.map((item) => <tr key={item.label}><td>{item.label}</td><td>{item.incidents}</td><td>{item.sos}</td><td>{item.resolved}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className="category-breakdown"><h4>Nhóm vụ việc</h4>{data.categories.length === 0 ? <p>Chưa có dữ liệu trong kỳ.</p> : data.categories.map((item) => <div key={item.category}><span>{categoryLabels[item.category] ?? item.category}</span><b>{item.count}</b><i style={{ width: `${Math.max(4, item.count / Math.max(1, data.totals.incidents + data.totals.sos) * 100)}%` }} /></div>)}</section>
      {data.kpis && <OfficerKpiTable kpis={data.kpis} />}
    </>}
  </div>;
}
