import type { CommanderReport, OfficerReportCase, OfficerStatistics, StatisticsPeriod } from './types';
import { hourLabel, weekdayLabels } from './commander-report';

export const periodTitles: Record<StatisticsPeriod, string> = { day: 'ngày', month: 'tháng', year: 'năm' };

export const reportStatusLabels: Record<string, string> = {
  submitted: 'Chờ tiếp nhận', received: 'Đã tiếp nhận', assigned: 'Đã phân công', verifying: 'Đang xác minh',
  processing: 'Đang xử lý', resolved: 'Đã có kết quả', closed: 'Đã đóng', rejected: 'Không thuộc phạm vi',
  triggered: 'Mới phát tín hiệu', dispatched: 'Chờ cán bộ nhận', acknowledged: 'Đã xác nhận', responding: 'Đang triển khai xử lý',
  escalated: 'Đã chuyển tuyến', cancelled_by_citizen: 'Người dân đã hủy',
};

export const reportCategoryLabels: Record<string, string> = {
  security: 'An ninh trật tự', traffic: 'Giao thông', public_order: 'Trật tự đô thị', administrative: 'Thủ tục hành chính',
  environment: 'Môi trường', other: 'Nội dung khác', traffic_accident: 'Tai nạn giao thông', fire_rescue: 'Cháy / cứu nạn',
  medical: 'Cấp cứu y tế', other_emergency: 'Tình huống nguy cấp khác',
};

const vnDateTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const vnDate = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });

export function formatDateTime(value: string | null): string { return value ? vnDateTime.format(new Date(value)) : ''; }
export function formatDate(value: string): string { return vnDate.format(new Date(value)); }

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ ${minutes % 60} phút`;
  return `${Math.floor(hours / 24)} ngày ${hours % 24} giờ`;
}

/** Ô bắt đầu bằng = + - @ bị Excel hiểu là công thức; thêm dấu ' phía trước để dữ liệu người dân nhập không chạy được. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(cells: Array<string | number | null | undefined>): string { return cells.map(csvCell).join(','); }

export function reportRangeLabel(stats: OfficerStatistics): string {
  const from = formatDate(stats.from);
  // `to` là mốc cuối kỳ (không bao gồm): lùi 1 phút để ra ngày cuối cùng.
  const last = formatDate(new Date(new Date(stats.to).getTime() - 60_000).toISOString());
  return from === last ? from : `${from} – ${last}`;
}

/** Các phần riêng của báo cáo chỉ huy: so với kỳ trước, theo khu vực, theo cán bộ, giờ cao điểm. Số để dạng số (phút, sao) cho Excel tính được. */
export function commanderCsvLines(report: CommanderReport): string[] {
  const { current, previous } = report;
  const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);
  const lines: string[] = [];
  lines.push(row(['SO VỚI KỲ TRƯỚC', 'Kỳ này', 'Kỳ trước']));
  const pair = (label: string, pick: (totals: CommanderReport['current']) => number | null) => lines.push(row([label, pick(current), pick(previous)]));
  pair('Phản ánh', (t) => t.incidents);
  pair('SOS', (t) => t.sos);
  pair('Đã xử lý', (t) => t.resolved);
  pair('Đang mở', (t) => t.open);
  pair('Quá hạn phản hồi', (t) => t.overdue);
  pair('Tỷ lệ được phản hồi (%)', (t) => percent(t.respondedRate));
  pair('Phản hồi phản ánh trung bình (phút)', (t) => t.firstResponseMinutes);
  pair('Xác nhận SOS trung bình (phút)', (t) => t.sosAcknowledgeMinutes);
  pair('Thời gian xử lý trung bình (phút)', (t) => t.resolutionMinutes);
  pair('Điểm hài lòng trung bình', (t) => t.averageRating);
  pair('Số lượt đánh giá', (t) => t.ratingCount);
  pair('SOS chưa có người xác nhận', (t) => t.sosUnacknowledged);
  pair('SOS đã chuyển tuyến', (t) => t.sosEscalated);
  pair('Hồ sơ chưa xác định khu vực', (t) => t.unrouted);
  lines.push('');
  lines.push(row(['THEO KHU VỰC']));
  lines.push(row(['Khu vực', 'Cán bộ phụ trách', 'Phản ánh', 'SOS', 'Đã xử lý', 'Đang mở', 'Quá hạn', 'Phản hồi TB (phút)', 'Xác nhận SOS TB (phút)', 'Xử lý TB (phút)', 'Hài lòng TB', 'Lượt đánh giá', 'Đánh giá từ 2 sao trở xuống']));
  for (const area of report.areas) {
    lines.push(row([area.name, area.officers.map((officer) => officer.displayName).join('; ') || 'Chưa có', area.incidents, area.sos, area.resolved, area.open, area.overdue,
      area.firstResponseMinutes, area.sosAcknowledgeMinutes, area.resolutionMinutes, area.averageRating, area.ratingCount, area.lowRatings]));
  }
  lines.push('');
  lines.push(row(['THEO CÁN BỘ']));
  lines.push(row(['Cán bộ', 'Khu vực', 'Phản ánh', 'SOS', 'Đã xử lý', 'Đang mở', 'Quá hạn', 'Phản hồi TB (phút)', 'Xử lý TB (phút)', 'Hài lòng TB', 'Lượt đánh giá', 'Đánh giá từ 2 sao trở xuống']));
  for (const officer of report.officers) {
    lines.push(row([officer.displayName, officer.areaName ?? 'Toàn phường', officer.incidents, officer.sos, officer.resolved, officer.open, officer.overdue,
      officer.firstResponseMinutes, officer.resolutionMinutes, officer.averageRating, officer.ratingCount, officer.lowRatings]));
  }
  lines.push('');
  lines.push(row(['HỒ SƠ THEO GIỜ', 'Số hồ sơ']));
  report.hourly.forEach((count, hour) => { if (count > 0) lines.push(row([hourLabel(hour), count])); });
  lines.push('');
  lines.push(row(['HỒ SƠ THEO THỨ', 'Số hồ sơ']));
  report.weekdays.forEach((count, index) => lines.push(row([weekdayLabels[index], count])));
  lines.push('');
  return lines;
}

/** CSV có BOM UTF-8 để Excel mở đúng tiếng Việt. Gồm tổng hợp, nhóm vụ việc, phần của chỉ huy (nếu có) và danh sách hồ sơ chi tiết. */
export function buildReportCsv(stats: OfficerStatistics, cases: OfficerReportCase[], unitName: string, commander?: CommanderReport): string {
  const lines: string[] = [];
  lines.push(row([`BÁO CÁO TÌNH HÌNH ĐỊA BÀN THEO ${periodTitles[stats.period].toUpperCase()}`]));
  lines.push(row(['Đơn vị', unitName]));
  lines.push(row(['Kỳ báo cáo', reportRangeLabel(stats)]));
  lines.push(row(['Xuất lúc', formatDateTime(new Date().toISOString())]));
  lines.push('');
  lines.push(row(['TỔNG HỢP']));
  lines.push(row(['Phản ánh', stats.totals.incidents]));
  lines.push(row(['SOS', stats.totals.sos]));
  lines.push(row(['Đã xử lý', stats.totals.resolved]));
  lines.push(row(['Đang mở', stats.totals.open]));
  lines.push(row(['Quá hạn xử lý', stats.totals.overdue]));
  lines.push(row(['Thời gian xử lý trung bình (phút)', stats.totals.averageResolutionMinutes]));
  lines.push(row(['Điểm hài lòng trung bình', stats.totals.averageRating]));
  lines.push(row(['Số lượt đánh giá', stats.totals.ratingCount]));
  lines.push('');
  lines.push(row(['NHÓM VỤ VIỆC', 'Số lượng']));
  for (const item of stats.categories) lines.push(row([reportCategoryLabels[item.category] ?? item.category, item.count]));
  lines.push('');
  if (commander) lines.push(...commanderCsvLines(commander));
  lines.push(row(['DANH SÁCH HỒ SƠ']));
  lines.push(row(['STT', 'Loại', 'Mã tiếp nhận', 'Nhóm', 'Nội dung', 'Trạng thái', 'Khu vực', 'Cán bộ phụ trách', 'Gửi lúc', 'Có kết quả lúc', 'Đóng lúc', 'Thời gian xử lý', 'Đánh giá (1-5)']));
  cases.forEach((item, index) => lines.push(row([
    index + 1, item.kind === 'sos' ? 'SOS' : 'Phản ánh', item.receiptCode, reportCategoryLabels[item.category] ?? item.category, item.title,
    reportStatusLabels[item.status] ?? item.status, item.serviceAreaName, item.assignedOfficerName, formatDateTime(item.createdAt),
    formatDateTime(item.resolvedAt), formatDateTime(item.closedAt), formatDuration(item.resolutionMinutes), item.ratingScore,
  ])));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadTextFile(fileName: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFileName(stats: OfficerStatistics): string {
  return `bao-cao-${stats.period}-${stats.anchorDate}.csv`;
}
