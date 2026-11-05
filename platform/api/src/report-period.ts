import type { StatisticsPeriod } from './types.js';

const VIETNAM_OFFSET_MS = 7 * 60 * 60_000;

/** Mốc đầu và cuối kỳ theo giờ Việt Nam (UTC+7, không có giờ mùa hè), trả về dạng ISO UTC. */
export function periodBounds(period: StatisticsPeriod, anchorDate: string): { from: string; to: string } {
  const [year, month, day] = anchorDate.split('-').map(Number) as [number, number, number];
  const start = period === 'day' ? Date.UTC(year, month - 1, day)
    : period === 'month' ? Date.UTC(year, month - 1, 1)
      : Date.UTC(year, 0, 1);
  const end = period === 'day' ? Date.UTC(year, month - 1, day + 1)
    : period === 'month' ? Date.UTC(year, month, 1)
      : Date.UTC(year + 1, 0, 1);
  return { from: new Date(start - VIETNAM_OFFSET_MS).toISOString(), to: new Date(end - VIETNAM_OFFSET_MS).toISOString() };
}

/** Một ngày bất kỳ nằm trong kỳ liền trước (ngày hôm trước, tháng trước, năm trước). */
export function previousAnchorDate(period: StatisticsPeriod, anchorDate: string): string {
  const [year, month, day] = anchorDate.split('-').map(Number) as [number, number, number];
  const previous = period === 'day' ? Date.UTC(year, month - 1, day - 1)
    : period === 'month' ? Date.UTC(year, month - 2, 1)
      : Date.UTC(year - 1, 0, 1);
  return new Date(previous).toISOString().slice(0, 10);
}
