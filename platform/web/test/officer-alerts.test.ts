import { describe, expect, it } from 'vitest';
import { elapsedLabel, isPendingSos, OVERLAY_REPEAT_MS, overlaySosItems } from '../src/officer-alerts';
import type { OfficerQueueItem } from '../src/types';

function sos(id: string, status: OfficerQueueItem['status'], createdAt: string, kind: OfficerQueueItem['kind'] = 'sos'): OfficerQueueItem {
  return {
    kind, id, receiptCode: `SOS-${id}`, category: 'sos', title: 'SOS khẩn cấp', status, priority: 'critical',
    localityCode: '24781', localityName: 'Phường Xuân Hương - Đà Lạt', serviceAreaName: null, assignedOfficer: null,
    createdAt, updatedAt: createdAt,
  };
}

describe('officer SOS alarm', () => {
  it('only treats SOS nobody has acknowledged yet as pending', () => {
    expect(isPendingSos(sos('a', 'dispatched', '2026-11-01T07:00:00Z'))).toBe(true);
    expect(isPendingSos(sos('b', 'triggered', '2026-11-01T07:00:00Z'))).toBe(true);
    expect(isPendingSos(sos('c', 'acknowledged', '2026-11-01T07:00:00Z'))).toBe(false);
    expect(isPendingSos(sos('d', 'received', '2026-11-01T07:00:00Z', 'incident'))).toBe(false);
  });

  it('shows the SOS waiting longest first', () => {
    const items = overlaySosItems([
      sos('new', 'dispatched', '2026-11-01T07:05:00Z'),
      sos('old', 'dispatched', '2026-11-01T07:00:00Z'),
    ], new Map(), Date.parse('2026-11-01T07:06:00Z'));
    expect(items.map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('brings a set-aside alarm back after two minutes while still unacknowledged', () => {
    const pending = [sos('a', 'dispatched', '2026-11-01T07:00:00Z')];
    const hiddenAt = new Map([['a', 1_000]]);
    expect(overlaySosItems(pending, hiddenAt, 1_000 + OVERLAY_REPEAT_MS - 1)).toEqual([]);
    expect(overlaySosItems(pending, hiddenAt, 1_000 + OVERLAY_REPEAT_MS).map((item) => item.id)).toEqual(['a']);
  });

  it('labels how long the SOS has waited', () => {
    const at = Date.parse('2026-11-01T07:00:00Z');
    expect(elapsedLabel('2026-11-01T07:00:00Z', at + 35_000)).toBe('35 giây trước');
    expect(elapsedLabel('2026-11-01T07:00:00Z', at + 4 * 60_000)).toBe('4 phút trước');
    expect(elapsedLabel('2026-11-01T07:00:00Z', at + 2 * 3_600_000)).toBe('2 giờ trước');
    expect(elapsedLabel('2026-11-01T07:00:00Z', at - 5_000)).toBe('0 giây trước');
  });
});
