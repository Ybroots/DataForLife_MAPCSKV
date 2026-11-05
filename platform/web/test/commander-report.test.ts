import { describe, expect, it } from 'vitest';
import { attentionFlags, compareValue, hourLabel, minutesText, peakHours, rateText, ratingText } from '../src/commander-report';
import { buildReportCsv } from '../src/report-export';
import type { CommanderReport, CommanderReportTotals, OfficerStatistics } from '../src/types';

const totals = (overrides: Partial<CommanderReportTotals> = {}): CommanderReportTotals => ({
  incidents: 0, sos: 0, resolved: 0, open: 0, overdue: 0, firstResponseMinutes: null, sosAcknowledgeMinutes: null, resolutionMinutes: null,
  respondedRate: null, sosUnacknowledged: 0, sosEscalated: 0, unrouted: 0, averageRating: null, ratingCount: 0, ...overrides,
});

const report = (overrides: Partial<CommanderReport> = {}): CommanderReport => ({
  period: 'month', anchorDate: '2026-11-05', from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z',
  previousFrom: '2026-09-30T17:00:00.000Z', previousTo: '2026-10-31T17:00:00.000Z',
  current: totals(), previous: totals(), areas: [], officers: [],
  hourly: Array.from({ length: 24 }, () => 0), weekdays: Array.from({ length: 7 }, () => 0), attention: [], ...overrides,
});

describe('compareValue', () => {
  it('tô màu theo hướng tốt/xấu của từng chỉ số', () => {
    expect(compareValue(12, 8, 'neutral')).toMatchObject({ tone: 'flat', text: '+4 (+50%) so với kỳ trước' });
    expect(compareValue(6, 10, 'lower', ' phút')).toMatchObject({ tone: 'good', text: '−4 phút so với kỳ trước' });
    expect(compareValue(14, 10, 'lower', ' phút').tone).toBe('bad');
    expect(compareValue(4.5, 4, 'higher', ' sao').tone).toBe('good');
    expect(compareValue(3, 3, 'higher')).toEqual({ text: 'Bằng kỳ trước', tone: 'flat' });
  });

  it('không so sánh được khi thiếu số liệu', () => {
    expect(compareValue(5, null, 'higher').tone).toBe('none');
    expect(compareValue(null, 5, 'lower').tone).toBe('none');
  });
});

describe('định dạng', () => {
  it('đổi phút, tỷ lệ và điểm', () => {
    expect(minutesText(null)).toBe('—');
    expect(minutesText(45)).toBe('45 phút');
    expect(minutesText(125)).toBe('2 giờ 5 phút');
    expect(rateText(0.9)).toBe('90%');
    expect(rateText(null)).toBe('—');
    expect(ratingText(null, 0)).toBe('—');
    expect(ratingText(4.5, 2)).toContain('/5 (2)');
    expect(hourLabel(23)).toBe('23:00–00:00');
  });

  it('chọn giờ cao điểm, bỏ giờ không có hồ sơ', () => {
    const hourly = Array.from({ length: 24 }, () => 0);
    hourly[9] = 4; hourly[20] = 7; hourly[3] = 4;
    expect(peakHours(hourly)).toEqual([{ hour: 20, count: 7 }, { hour: 3, count: 4 }, { hour: 9, count: 4 }]);
    expect(peakHours(Array.from({ length: 24 }, () => 0))).toEqual([]);
  });
});

describe('attentionFlags', () => {
  it('không có gì cần chú ý thì để trống', () => {
    expect(attentionFlags(report())).toEqual([]);
  });

  it('nêu SOS chưa nhận, khu chưa có cán bộ và đánh giá thấp', () => {
    const flags = attentionFlags(report({
      current: totals({ sosUnacknowledged: 2, overdue: 3, unrouted: 1 }),
      areas: [{ code: 'P1', name: 'Phường 1', officers: [], incidents: 0, sos: 0, resolved: 0, open: 0, overdue: 0, firstResponseMinutes: null, sosAcknowledgeMinutes: null, resolutionMinutes: null, averageRating: null, ratingCount: 0, lowRatings: 0 }],
      officers: [{ id: 'o1', displayName: 'Cán bộ A', areaName: 'Phường 2', incidents: 1, sos: 0, resolved: 0, open: 1, overdue: 0, firstResponseMinutes: null, resolutionMinutes: null, averageRating: 1.5, ratingCount: 2, lowRatings: 2 }],
    }));
    expect(flags[0]).toMatchObject({ tone: 'critical', text: '2 SOS chưa có cán bộ xác nhận.' });
    const text = flags.map((flag) => flag.text).join('\n');
    expect(text).toContain('3 hồ sơ đang mở đã quá hạn');
    expect(text).toContain('chưa có cán bộ phụ trách: Phường 1');
    expect(text).toContain('1 hồ sơ chưa xác định được khu vực');
    expect(text).toContain('Cán bộ A (2)');
  });
});

describe('buildReportCsv của chỉ huy', () => {
  it('thêm so sánh, khu vực, cán bộ và giờ cao điểm trước danh sách hồ sơ', () => {
    const stats = {
      period: 'month', anchorDate: '2026-11-05', from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z',
      totals: { incidents: 1, sos: 0, resolved: 0, open: 1, overdue: 0, averageResolutionMinutes: null, averageRating: null, ratingCount: 0 },
      trend: [], categories: [],
    } as OfficerStatistics;
    const hourly = Array.from({ length: 24 }, () => 0);
    hourly[8] = 3;
    const csv = buildReportCsv(stats, [], 'Đơn vị thử', report({
      current: totals({ incidents: 8, respondedRate: 0.9 }), previous: totals({ incidents: 5 }),
      areas: [{ code: 'P1', name: 'Phường 1', officers: [{ id: 'o1', displayName: 'Cán bộ A' }], incidents: 8, sos: 0, resolved: 6, open: 2, overdue: 0, firstResponseMinutes: 7.5, sosAcknowledgeMinutes: null, resolutionMinutes: 95, averageRating: 4.5, ratingCount: 2, lowRatings: 0 }],
      officers: [{ id: 'o1', displayName: 'Cán bộ A', areaName: 'Phường 1', incidents: 8, sos: 0, resolved: 6, open: 2, overdue: 0, firstResponseMinutes: 7.5, resolutionMinutes: 95, averageRating: 4.5, ratingCount: 2, lowRatings: 0 }],
      hourly,
    }));
    expect(csv).toContain('SO VỚI KỲ TRƯỚC,Kỳ này,Kỳ trước');
    expect(csv).toContain('Phản ánh,8,5');
    expect(csv).toContain('Tỷ lệ được phản hồi (%),90,');
    expect(csv).toContain('Phường 1,Cán bộ A,8,0,6,2,0,7.5,,95,4.5,2,0');
    expect(csv).toContain('Cán bộ A,Phường 1,8,0,6,2,0,7.5,95,4.5,2,0');
    expect(csv).toContain('08:00–09:00,3');
    expect(csv.indexOf('THEO KHU VỰC')).toBeLessThan(csv.indexOf('DANH SÁCH HỒ SƠ'));
  });
});
