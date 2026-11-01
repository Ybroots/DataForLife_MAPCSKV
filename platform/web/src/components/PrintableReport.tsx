import { createPortal } from 'react-dom';
import type { OfficerReportCase, OfficerStatistics } from '../types';
import { formatDateTime, formatDuration, periodTitles, reportCategoryLabels, reportRangeLabel, reportStatusLabels } from '../report-export';

/** Bản in/lưu PDF: chỉ hiện khi in (CSS ẩn phần còn lại của trang). */
export function PrintableReport({ stats, cases, unitName }: { stats: OfficerStatistics; cases: OfficerReportCase[]; unitName: string }) {
  return createPortal(
    <article className="print-report" aria-hidden="true">
      <header>
        <p>{unitName}</p>
        <h1>BÁO CÁO TÌNH HÌNH ĐỊA BÀN THEO {periodTitles[stats.period].toUpperCase()}</h1>
        <p>Kỳ báo cáo: {reportRangeLabel(stats)} · Xuất lúc {formatDateTime(new Date().toISOString())}</p>
      </header>
      <table className="print-summary">
        <tbody>
          <tr><th>Phản ánh</th><td>{stats.totals.incidents}</td><th>SOS</th><td>{stats.totals.sos}</td></tr>
          <tr><th>Đã xử lý</th><td>{stats.totals.resolved}</td><th>Đang mở</th><td>{stats.totals.open}</td></tr>
          <tr><th>Quá hạn</th><td>{stats.totals.overdue}</td><th>Xử lý trung bình</th><td>{formatDuration(stats.totals.averageResolutionMinutes) || '—'}</td></tr>
          <tr><th>Hài lòng</th><td>{stats.totals.averageRating === null ? '—' : `${stats.totals.averageRating}/5`}</td><th>Lượt đánh giá</th><td>{stats.totals.ratingCount}</td></tr>
        </tbody>
      </table>
      {stats.categories.length > 0 && <>
        <h2>Nhóm vụ việc</h2>
        <table className="print-summary"><tbody>{stats.categories.map((item) => <tr key={item.category}><th>{reportCategoryLabels[item.category] ?? item.category}</th><td>{item.count}</td></tr>)}</tbody></table>
      </>}
      <h2>Danh sách hồ sơ ({cases.length})</h2>
      <table className="print-cases">
        <thead><tr><th>STT</th><th>Loại</th><th>Mã</th><th>Nội dung</th><th>Trạng thái</th><th>Gửi lúc</th><th>Xử lý</th><th>Đánh giá</th></tr></thead>
        <tbody>
          {cases.map((item, index) => <tr key={`${item.kind}:${item.receiptCode}`}>
            <td>{index + 1}</td><td>{item.kind === 'sos' ? 'SOS' : 'Phản ánh'}</td><td>{item.receiptCode}</td>
            <td>{item.title}</td><td>{reportStatusLabels[item.status] ?? item.status}</td><td>{formatDateTime(item.createdAt)}</td>
            <td>{formatDuration(item.resolutionMinutes) || '—'}</td><td>{item.ratingScore ?? '—'}</td>
          </tr>)}
        </tbody>
      </table>
    </article>,
    document.body,
  );
}
