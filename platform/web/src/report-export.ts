import type { OfficerReportCase, OfficerStatistics, StatisticsPeriod } from './types';

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

/** CSV có BOM UTF-8 để Excel mở đúng tiếng Việt. Gồm tổng hợp, nhóm vụ việc và danh sách hồ sơ chi tiết. */
export function buildReportCsv(stats: OfficerStatistics, cases: OfficerReportCase[], unitName: string): string {
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
