import { createPortal } from 'react-dom';
import type { CommanderReport, OfficerReportCase, OfficerStatistics } from '../types';
import { formatDateTime, formatDuration, periodTitles, reportCategoryLabels, reportRangeLabel, reportStatusLabels } from '../report-export';
import { minutesText, ratingText, rateText } from '../commander-report';

/** Bản in/lưu PDF: chỉ hiện khi in (CSS ẩn phần còn lại của trang). */
export function PrintableReport({ stats, cases, unitName, commander }: { stats: OfficerStatistics; cases: OfficerReportCase[]; unitName: string; commander?: CommanderReport }) {
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
      {commander && <>
        <h2>So với kỳ trước</h2>
        <table className="print-cases">
          <thead><tr><th>Chỉ số</th><th>Kỳ này</th><th>Kỳ trước</th></tr></thead>
          <tbody>
            <tr><td>Phản ánh</td><td>{commander.current.incidents}</td><td>{commander.previous.incidents}</td></tr>
            <tr><td>SOS</td><td>{commander.current.sos}</td><td>{commander.previous.sos}</td></tr>
            <tr><td>Đã xử lý</td><td>{commander.current.resolved}</td><td>{commander.previous.resolved}</td></tr>
            <tr><td>Tỷ lệ được phản hồi</td><td>{rateText(commander.current.respondedRate)}</td><td>{rateText(commander.previous.respondedRate)}</td></tr>
            <tr><td>Phản hồi phản ánh (trung bình)</td><td>{minutesText(commander.current.firstResponseMinutes)}</td><td>{minutesText(commander.previous.firstResponseMinutes)}</td></tr>
            <tr><td>Xác nhận SOS (trung bình)</td><td>{minutesText(commander.current.sosAcknowledgeMinutes)}</td><td>{minutesText(commander.previous.sosAcknowledgeMinutes)}</td></tr>
            <tr><td>Thời gian xử lý (trung bình)</td><td>{minutesText(commander.current.resolutionMinutes)}</td><td>{minutesText(commander.previous.resolutionMinutes)}</td></tr>
            <tr><td>Hài lòng</td><td>{ratingText(commander.current.averageRating, commander.current.ratingCount)}</td><td>{ratingText(commander.previous.averageRating, commander.previous.ratingCount)}</td></tr>
          </tbody>
        </table>
        <h2>Theo khu vực</h2>
        <table className="print-cases">
          <thead><tr><th>Khu vực</th><th>Cán bộ</th><th>Phản ánh</th><th>SOS</th><th>Đã xử lý</th><th>Đang mở</th><th>Quá hạn</th><th>Phản hồi</th><th>Hài lòng</th></tr></thead>
          <tbody>
            {commander.areas.map((area) => <tr key={area.code}>
              <td>{area.name}</td><td>{area.officers.map((officer) => officer.displayName).join(', ') || 'Chưa có'}</td>
              <td>{area.incidents}</td><td>{area.sos}</td><td>{area.resolved}</td><td>{area.open}</td><td>{area.overdue}</td>
              <td>{minutesText(area.firstResponseMinutes)}</td><td>{ratingText(area.averageRating, area.ratingCount)}</td>
            </tr>)}
          </tbody>
        </table>
        <h2>Theo cán bộ</h2>
        <table className="print-cases">
          <thead><tr><th>Cán bộ</th><th>Khu vực</th><th>Phản ánh</th><th>SOS</th><th>Đã xử lý</th><th>Đang mở</th><th>Quá hạn</th><th>Phản hồi</th><th>Hài lòng</th></tr></thead>
          <tbody>
            {commander.officers.map((officer) => <tr key={officer.id}>
              <td>{officer.displayName}</td><td>{officer.areaName ?? 'Toàn phường'}</td>
              <td>{officer.incidents}</td><td>{officer.sos}</td><td>{officer.resolved}</td><td>{officer.open}</td><td>{officer.overdue}</td>
              <td>{minutesText(officer.firstResponseMinutes)}</td><td>{ratingText(officer.averageRating, officer.ratingCount)}</td>
            </tr>)}
          </tbody>
        </table>
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
