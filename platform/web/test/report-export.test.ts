import { describe, expect, it } from 'vitest';
import { buildReportCsv, csvCell, formatDuration } from '../src/report-export';
import { fitWithin } from '../src/image-compress';
import type { OfficerStatistics } from '../src/types';

describe('csvCell', () => {
  it('chặn công thức Excel và escape dấu phẩy/ngoặc kép', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+84 912')).toBe("'+84 912");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(5)).toBe('5');
  });
});

describe('formatDuration', () => {
  it('đổi phút sang giờ/ngày', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(45)).toBe('45 phút');
    expect(formatDuration(125)).toBe('2 giờ 5 phút');
    expect(formatDuration(60 * 26)).toBe('1 ngày 2 giờ');
  });
});

describe('buildReportCsv', () => {
  it('có BOM UTF-8, tổng hợp và dòng hồ sơ', () => {
    const stats = {
      period: 'day', anchorDate: '2026-11-02', from: '2026-11-01T17:00:00.000Z', to: '2026-11-02T17:00:00.000Z',
      totals: { incidents: 1, sos: 0, resolved: 1, open: 0, overdue: 0, averageResolutionMinutes: 30, averageRating: 5, ratingCount: 1 },
      trend: [], categories: [{ category: 'security', count: 1 }],
    } as OfficerStatistics;
    const csv = buildReportCsv(stats, [{
      kind: 'incident', receiptCode: 'PA-1', category: 'security', title: '=cmd', status: 'closed', priority: 'normal',
      serviceAreaName: null, assignedOfficerName: 'A', createdAt: '2026-11-02T01:00:00.000Z', resolvedAt: null, closedAt: null, resolutionMinutes: 30, ratingScore: 5,
    }], 'Đơn vị thử');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Đơn vị,Đơn vị thử');
    expect(csv).toContain("'=cmd");
    expect(csv).toContain('An ninh trật tự,1');
  });
});

describe('fitWithin', () => {
  it('thu nhỏ theo cạnh dài nhất, không phóng to', () => {
    expect(fitWithin(8000, 6000)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 960, height: 1920 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
