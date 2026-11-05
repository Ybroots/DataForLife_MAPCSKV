import { AlertTriangle, Siren, FileWarning } from 'lucide-react';
import type { CommanderReport, CommanderReportAreaRow, CommanderReportOfficerRow } from '../types';
import {
  attentionFlags, compareValue, hourLabel, minutesText, peakHours, rateText, ratingText, weekdayLabels,
  type Delta,
} from '../commander-report';

interface Tile {
  label: string;
  value: string;
  delta: Delta;
}

function tilesOf(report: CommanderReport): Tile[] {
  const { current, previous } = report;
  const percent = (value: number | null) => (value === null ? null : Math.round(value * 100));
  return [
    { label: 'Phản ánh', value: String(current.incidents), delta: compareValue(current.incidents, previous.incidents, 'neutral') },
    { label: 'SOS', value: String(current.sos), delta: compareValue(current.sos, previous.sos, 'neutral') },
    { label: 'Đã xử lý', value: String(current.resolved), delta: compareValue(current.resolved, previous.resolved, 'higher') },
    { label: 'Tỷ lệ được phản hồi', value: rateText(current.respondedRate), delta: compareValue(percent(current.respondedRate), percent(previous.respondedRate), 'higher', '%') },
    { label: 'Phản hồi phản ánh (trung bình)', value: minutesText(current.firstResponseMinutes), delta: compareValue(current.firstResponseMinutes, previous.firstResponseMinutes, 'lower', ' phút') },
    { label: 'Xác nhận SOS (trung bình)', value: minutesText(current.sosAcknowledgeMinutes), delta: compareValue(current.sosAcknowledgeMinutes, previous.sosAcknowledgeMinutes, 'lower', ' phút') },
    { label: 'Thời gian xử lý (trung bình)', value: minutesText(current.resolutionMinutes), delta: compareValue(current.resolutionMinutes, previous.resolutionMinutes, 'lower', ' phút') },
    { label: 'Hài lòng của người dân', value: ratingText(current.averageRating, current.ratingCount), delta: compareValue(current.averageRating, previous.averageRating, 'higher', ' sao') },
  ];
}

function Bars({ values, label, title, caption }: { values: readonly number[]; label: (index: number) => string; title: (index: number) => string; caption: string }) {
  const max = Math.max(1, ...values);
  return <div className="cmd-bars" role="img" aria-label={caption}>
    {values.map((value, index) => <div className="cmd-bar" key={index} title={`${title(index)} · ${value} hồ sơ`}>
      <i style={{ height: `${value === 0 ? 0 : Math.max(6, value / max * 100)}%` }} />
      <span>{label(index)}</span>
    </div>)}
  </div>;
}

function AreaTable({ rows }: { rows: CommanderReportAreaRow[] }) {
  return <div className="statistics-table-wrap">
    <table className="cmd-table">
      <caption className="sr-only">Số liệu theo khu vực phụ trách</caption>
      <thead><tr><th>Khu vực</th><th>Cán bộ</th><th>Phản ánh</th><th>SOS</th><th>Đã xử lý</th><th>Đang mở</th><th>Quá hạn</th><th>Phản hồi</th><th>Xác nhận SOS</th><th>Xử lý</th><th>Hài lòng</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.code}>
          <th scope="row">{row.name}</th>
          <td className={row.officers.length === 0 ? 'cmd-bad' : ''}>{row.officers.length === 0 ? 'Chưa có' : row.officers.map((officer) => officer.displayName).join(', ')}</td>
          <td>{row.incidents}</td><td>{row.sos}</td><td>{row.resolved}</td><td>{row.open}</td>
          <td className={row.overdue > 0 ? 'cmd-bad' : ''}>{row.overdue}</td>
          <td>{minutesText(row.firstResponseMinutes)}</td><td>{minutesText(row.sosAcknowledgeMinutes)}</td><td>{minutesText(row.resolutionMinutes)}</td>
          <td className={row.lowRatings > 0 ? 'cmd-bad' : ''}>{ratingText(row.averageRating, row.ratingCount)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function OfficerTable({ rows }: { rows: CommanderReportOfficerRow[] }) {
  return <div className="statistics-table-wrap">
    <table className="cmd-table">
      <caption className="sr-only">Số liệu theo cán bộ, tính trên hồ sơ được giao cho từng người</caption>
      <thead><tr><th>Cán bộ</th><th>Khu vực</th><th>Phản ánh</th><th>SOS</th><th>Đã xử lý</th><th>Đang mở</th><th>Quá hạn</th><th>Phản hồi</th><th>Xử lý</th><th>Hài lòng</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.id}>
          <th scope="row">{row.displayName}</th>
          <td>{row.areaName ?? 'Toàn phường'}</td>
          <td>{row.incidents}</td><td>{row.sos}</td><td>{row.resolved}</td><td>{row.open}</td>
          <td className={row.overdue > 0 ? 'cmd-bad' : ''}>{row.overdue}</td>
          <td>{minutesText(row.firstResponseMinutes)}</td><td>{minutesText(row.resolutionMinutes)}</td>
          <td className={row.lowRatings > 0 ? 'cmd-bad' : ''}>{ratingText(row.averageRating, row.ratingCount)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

/** Phần báo cáo riêng của chỉ huy: so với kỳ trước, điểm cần chú ý, từng khu vực, từng cán bộ, giờ cao điểm, hồ sơ chờ quá hạn. */
export function CommanderReportSections({ report }: { report: CommanderReport }) {
  const flags = attentionFlags(report);
  const peaks = peakHours(report.hourly);
  return <div className="cmd-report">
    <section className="cmd-section" aria-labelledby="cmd-compare-title">
      <h4 id="cmd-compare-title">So với kỳ trước</h4>
      <div className="cmd-tiles">
        {tilesOf(report).map((tile) => <article key={tile.label}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small className={`cmd-delta ${tile.delta.tone}`}>{tile.delta.text}</small>
        </article>)}
      </div>
    </section>

    {flags.length > 0 && <section className="cmd-section cmd-flags" aria-labelledby="cmd-flags-title">
      <h4 id="cmd-flags-title">Cần chú ý</h4>
      <ul>{flags.map((flag) => <li key={flag.text} className={flag.tone}><AlertTriangle size={17} aria-hidden="true" /><span>{flag.text}</span></li>)}</ul>
    </section>}

    <section className="cmd-section" aria-labelledby="cmd-waiting-title">
      <h4 id="cmd-waiting-title">Hồ sơ chờ tiếp nhận quá hạn</h4>
      {report.attention.length === 0
        ? <p className="workflow-empty">Không có hồ sơ nào đang chờ quá hạn.</p>
        : <ul className="cmd-waiting">
          {report.attention.map((item) => <li key={`${item.kind}:${item.id}`} className={item.kind}>
            {item.kind === 'sos' ? <Siren size={18} aria-hidden="true" /> : <FileWarning size={18} aria-hidden="true" />}
            <div>
              <strong>{item.kind === 'sos' ? 'SOS' : 'Phản ánh'} · {item.receiptCode}</strong>
              <span>{item.areaName ?? 'Chưa xác định khu vực'} · {item.officerName ? `Giao ${item.officerName}` : 'Chưa có cán bộ nhận'}</span>
            </div>
            <em>Chờ {minutesText(item.ageMinutes)}</em>
          </li>)}
        </ul>}
    </section>

    <section className="cmd-section" aria-labelledby="cmd-areas-title">
      <h4 id="cmd-areas-title">Theo khu vực</h4>
      {report.areas.length === 0 ? <p className="workflow-empty">Chưa có khu vực nào được cấu hình cho phường.</p> : <AreaTable rows={report.areas} />}
    </section>

    <section className="cmd-section" aria-labelledby="cmd-officers-title">
      <h4 id="cmd-officers-title">Theo cán bộ</h4>
      {report.officers.length === 0 ? <p className="workflow-empty">Chưa có cán bộ nào trong phường.</p> : <OfficerTable rows={report.officers} />}
    </section>

    <section className="cmd-section" aria-labelledby="cmd-time-title">
      <h4 id="cmd-time-title">Giờ cao điểm</h4>
      {peaks.length === 0
        ? <p className="workflow-empty">Chưa có hồ sơ trong kỳ.</p>
        : <>
          <p className="cmd-peaks">{peaks.map((item) => `${hourLabel(item.hour)} (${item.count} hồ sơ)`).join(' · ')}</p>
          <Bars values={report.hourly} label={(index) => (index % 3 === 0 ? String(index) : '')} title={hourLabel} caption="Hồ sơ theo giờ trong ngày" />
          <Bars values={report.weekdays} label={(index) => weekdayLabels[index]!.replace('Thứ ', 'T').replace('Chủ nhật', 'CN')} title={(index) => weekdayLabels[index]!} caption="Hồ sơ theo thứ trong tuần" />
        </>}
    </section>
  </div>;
}
