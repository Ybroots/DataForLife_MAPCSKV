import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { CommanderReportStore } from '../src/commander-report-store.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { periodBounds, previousAnchorDate } from '../src/report-period.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const commander = { 'x-officer-id': 'supervisor-demo-xuan-huong' };
const officer = { 'x-officer-id': 'officer-cskv-01' };

async function newApp() {
  app = await buildApp(new FixtureDirectoryRepository({ managedOfficers: true }), {
    corsOrigin: 'http://x', allowTestAuthHeaders: true, officerSessionSecret: 'test-secret-test-secret-test-secret',
  });
  return app;
}

describe('previous period', () => {
  it('steps back one day, month or year', () => {
    expect(previousAnchorDate('day', '2026-03-01')).toBe('2026-02-28');
    expect(previousAnchorDate('month', '2026-01-15')).toBe('2025-12-01');
    expect(previousAnchorDate('year', '2026-11-05')).toBe('2025-01-01');
  });

  it('previous bounds end exactly where the current period starts', () => {
    for (const [period, date] of [['day', '2026-11-05'], ['month', '2026-11-05'], ['year', '2026-11-05'], ['month', '2026-03-31']] as const) {
      expect(periodBounds(period, previousAnchorDate(period, date)).to).toBe(periodBounds(period, date).from);
    }
  });
});

describe('GET /v1/commander/report', () => {
  it('needs a session and refuses officers', async () => {
    const a = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/report' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/v1/commander/report', headers: officer })).statusCode).toBe(403);
  });

  it('rejects an invalid period or date', async () => {
    const a = await newApp();
    expect((await a.inject({ method: 'GET', url: '/v1/commander/report?period=week', headers: commander })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/v1/commander/report?date=2026-13-40', headers: commander })).statusCode).toBe(400);
  });

  it('returns the report shape for the commander', async () => {
    const a = await newApp();
    const response = await a.inject({ method: 'GET', url: '/v1/commander/report?period=month&date=2026-11-05', headers: commander });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data).toMatchObject({ period: 'month', anchorDate: '2026-11-05' });
    expect(data.hourly).toHaveLength(24);
    expect(data.weekdays).toHaveLength(7);
    expect(data.previousTo).toBe(data.from);
  });
});

describe('CommanderReportStore aggregation', () => {
  function fakePool(): Pool {
    const metrics = { incidents: 0, sos: 0, resolved: 0, open: 0, overdue: 0, first_response: null, sos_ack: null, resolution: null, responded: 0, sos_unack: 0, sos_escalated: 0, unrouted: 0 };
    return {
      async query(sql: string) {
        if (sql.includes('FROM workflow_actors') && sql.includes('actor_type, locality_id')) return { rows: [{ actor_type: 'supervisor', locality_id: 'loc-1' }] };
        if (sql.includes('GROUP BY 1\n') || sql.includes('FROM cases c GROUP BY 1')) {
          return { rows: [
            { is_current: true, ...metrics, incidents: 8, sos: 2, resolved: 6, open: 4, overdue: 1, first_response: '7.5', sos_ack: '1.2', resolution: '95', responded: 9, sos_unack: 1, sos_escalated: 0, unrouted: 1 },
            { is_current: false, ...metrics, incidents: 5, sos: 1, resolved: 5, open: 0 },
          ] };
        }
        if (sql.includes('satisfaction_ratings')) {
          return { rows: [
            { is_current: true, area_id: 'a1', officer_id: 'o1', n: 2, total: 9, low: 0 },
            { is_current: true, area_id: 'a1', officer_id: 'o2', n: 1, total: 2, low: 1 },
            { is_current: false, area_id: 'a1', officer_id: 'o1', n: 4, total: 12, low: 1 },
          ] };
        }
        if (sql.includes('FROM service_areas sa') && sql.includes('LEFT JOIN cases c ON c.service_area_id')) {
          return { rows: [{ area_id: 'a1', code: 'XH-P1', name: 'Phường 1', ...metrics, incidents: 6, sos: 1, resolved: 4, open: 3, overdue: 1 }] };
        }
        if (sql.includes("a.actor_type = 'officer' AND a.active = true")) {
          return { rows: [
            { id: 'o1', display_name: 'Cán bộ 1', area_id: 'a1', area_name: 'Phường 1', ...metrics, incidents: 4, resolved: 3 },
            { id: 'o2', display_name: 'Cán bộ 2', area_id: 'a1', area_name: 'Phường 1', ...metrics },
            { id: 'o3', display_name: 'Cán bộ 3', area_id: null, area_name: null, ...metrics },
          ] };
        }
        if (sql.includes('isodow')) return { rows: [{ h: 8, d: 1, n: 3 }, { h: 8, d: 7, n: 2 }, { h: 23, d: 1, n: 1 }] };
        if (sql.includes('waiting')) {
          return { rows: [{ kind: 'sos', id: 's1', receipt_code: 'SOS-1', status: 'triggered', title: 'SOS khẩn cấp', area_name: 'Phường 1', officer_name: null, created_at: new Date(Date.now() - 12 * 60_000) }] };
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
      },
    } as unknown as Pool;
  }

  it('builds totals, rows, ratings, hours and the waiting list', async () => {
    const report = await new CommanderReportStore(fakePool()).report('supervisor-demo-xuan-huong', 'month', '2026-11-05');
    expect(report.current).toMatchObject({ incidents: 8, sos: 2, open: 4, overdue: 1, firstResponseMinutes: 7.5, sosAcknowledgeMinutes: 1.2, resolutionMinutes: 95, sosUnacknowledged: 1, unrouted: 1, averageRating: 3.7, ratingCount: 3 });
    expect(report.current.respondedRate).toBe(0.9);
    expect(report.previous).toMatchObject({ incidents: 5, sos: 1, averageRating: 3, ratingCount: 4 });
    expect(report.areas[0]).toMatchObject({ code: 'XH-P1', incidents: 6, averageRating: 3.7, ratingCount: 3, lowRatings: 1 });
    expect(report.areas[0]!.officers.map((item) => item.id)).toEqual(['o1', 'o2']);
    expect(report.officers.map((item) => [item.id, item.averageRating, item.ratingCount])).toEqual([['o1', 4.5, 2], ['o2', 2, 1], ['o3', null, 0]]);
    expect(report.officers[2]!.areaName).toBeNull();
    expect(report.hourly[8]).toBe(5);
    expect(report.hourly[23]).toBe(1);
    expect(report.weekdays[0]).toBe(4);
    expect(report.weekdays[6]).toBe(2);
    expect(report.attention[0]).toMatchObject({ kind: 'sos', receiptCode: 'SOS-1', officerName: null });
    expect(report.attention[0]!.ageMinutes).toBeGreaterThanOrEqual(12);
  });

  it('refuses a plain officer', async () => {
    const pool = { async query() { return { rows: [{ actor_type: 'officer', locality_id: 'loc-1' }] }; } } as unknown as Pool;
    await expect(new CommanderReportStore(pool).report('officer-cskv-01', 'day', '2026-11-05')).rejects.toThrow();
  });
});
