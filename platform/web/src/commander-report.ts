import type { CommanderReport, CommanderReportTotals } from './types';

export type DeltaTone = 'good' | 'bad' | 'flat' | 'none';

export interface Delta {
  text: string;
  tone: DeltaTone;
}

/** Chênh lệch so với kỳ trước. `better` cho biết tăng là tốt, giảm là tốt, hay chỉ là số lượng (không tô màu). */
export function compareValue(current: number | null, previous: number | null, better: 'higher' | 'lower' | 'neutral', unit = ''): Delta {
  if (current === null || previous === null) return { text: 'Chưa có kỳ trước để so sánh', tone: 'none' };
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { text: 'Bằng kỳ trước', tone: 'flat' };
  const sign = diff > 0 ? '+' : '−';
  const amount = `${sign}${Math.abs(diff).toLocaleString('vi-VN')}${unit}`;
  const percent = previous > 0 && unit === '' ? ` (${sign}${Math.round(Math.abs(diff) / previous * 100)}%)` : '';
  const tone: DeltaTone = better === 'neutral' ? 'flat' : (diff > 0) === (better === 'higher') ? 'good' : 'bad';
  return { text: `${amount}${percent} so với kỳ trước`, tone };
}

export function minutesText(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${value.toLocaleString('vi-VN')} phút`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return hours < 24 ? `${hours} giờ ${rest} phút` : `${Math.floor(hours / 24)} ngày ${hours % 24} giờ`;
}

export function ratingText(value: number | null, count: number): string {
  return value === null ? '—' : `${value.toLocaleString('vi-VN')}/5 (${count})`;
}

export function rateText(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export interface AttentionFlag {
  tone: 'critical' | 'warning';
  text: string;
}

/** Những điểm chỉ huy cần xem ngay, rút ra từ số liệu của kỳ. Không có gì cần chú ý thì trả về mảng rỗng. */
export function attentionFlags(report: CommanderReport): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  const { current } = report;
  if (current.sosUnacknowledged > 0) flags.push({ tone: 'critical', text: `${current.sosUnacknowledged} SOS chưa có cán bộ xác nhận.` });
  if (current.sosEscalated > 0) flags.push({ tone: 'warning', text: `${current.sosEscalated} SOS đã chuyển tuyến.` });
  if (current.overdue > 0) flags.push({ tone: 'warning', text: `${current.overdue} hồ sơ đang mở đã quá hạn phản hồi.` });
  const noOfficer = report.areas.filter((area) => area.officers.length === 0);
  if (noOfficer.length > 0) flags.push({ tone: 'warning', text: `${noOfficer.length === 1 ? 'Khu vực' : `${noOfficer.length} khu vực`} chưa có cán bộ phụ trách: ${noOfficer.map((area) => area.name).join(', ')}.` });
  if (current.unrouted > 0) flags.push({ tone: 'warning', text: `${current.unrouted} hồ sơ chưa xác định được khu vực phụ trách.` });
  const lowRated = report.officers.filter((officer) => officer.lowRatings > 0);
  if (lowRated.length > 0) flags.push({ tone: 'warning', text: `Có đánh giá từ 2 sao trở xuống: ${lowRated.map((officer) => `${officer.displayName} (${officer.lowRatings})`).join(', ')}.` });
  return flags;
}

/** Các giờ có nhiều hồ sơ nhất (giờ Việt Nam), nhiều nhất trước; bỏ giờ không có hồ sơ nào. */
export function peakHours(hourly: readonly number[], limit = 3): Array<{ hour: number; count: number }> {
  return hourly
    .map((count, hour) => ({ hour, count }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.hour - right.hour)
    .slice(0, limit);
}

export const weekdayLabels = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'] as const;

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
}

export function sumTotals(totals: CommanderReportTotals): number {
  return totals.incidents + totals.sos;
}
