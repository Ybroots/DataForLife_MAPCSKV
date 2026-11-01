import { afterAll, afterEach, describe as baseDescribe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import type { JsonModel } from '../src/ai-client.js';
import { PostgresDirectoryRepository } from '../src/postgres-repository.js';

// Integration test against a REAL PostgreSQL + PostGIS database with migration 014 (never production!).
// Run: TEST_DATABASE_URL=postgres://... npx vitest run test/pg-intelligence.test.ts
const url = process.env.TEST_DATABASE_URL ?? '';
const describe = url ? baseDescribe : baseDescribe.skip;
const citizenId = `citizen-pg-intel-${Date.now()}`;
const citizen = { 'x-citizen-id': citizenId };
const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
const png = [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 68, dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=' }];
let app: FastifyInstance | undefined;

afterEach(async () => { if (app) await app.close(); app = undefined; });
afterAll(async () => {
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('DELETE FROM incident_reports WHERE citizen_external_id=$1', [citizenId]);
  await pool.query('DELETE FROM sos_events WHERE citizen_external_id=$1', [citizenId]);
  await pool.query('DELETE FROM app_ratings WHERE citizen_external_id=$1', [citizenId]);
  await pool.end();
});

const model: JsonModel = {
  provider: 'Gemini', model: 'test-model',
  async generate() {
    return { suggestedCategory: 'public_order', confidence: 'high', reason: 'Mô tả về gây ồn, tụ tập.', images: [{ index: 0, labels: ['crowd_gathering'] }] };
  },
};

async function newApp() {
  app = await buildApp(new PostgresDirectoryRepository(url), { corsOrigin: 'http://x', allowTestAuthHeaders: true, aiModel: model });
  return app;
}

async function report(a: FastifyInstance, summary: string, description: string, latitude: number, longitude: number, category = 'public_order') {
  const response = await a.inject({
    method: 'POST', url: '/v1/citizen/incidents', headers: citizen,
    payload: { clientRequestId: `intel-${Math.random().toString(36).slice(2, 12)}`, category, summary, description, latitude, longitude, attachments: png },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; receiptCode: string };
}

describe('duplicates on PostGIS', () => {
  it('suggests the nearby report on intake, links and unlinks it, and writes an audit trail', async () => {
    const a = await newApp();
    const first = await report(a, 'Tụ tập gây ồn ở chợ đêm', 'Nhóm thanh niên tụ tập gây ồn, nẹt pô ở cổng chợ đêm.', 11.944, 108.441);
    const second = await report(a, 'Gây ồn ở cổng chợ đêm', 'Thanh niên tụ tập gây ồn ở cổng chợ đêm, nẹt pô liên tục.', 11.9444, 108.4412);

    const detail = (await a.inject({ method: 'GET', url: `/v1/officer/incidents/${second.id}`, headers: officer })).json().data;
    expect(detail.suggestedDuplicateOf).toMatchObject({ id: first.id, receiptCode: first.receiptCode });

    const candidates = (await a.inject({ method: 'GET', url: `/v1/officer/incidents/${second.id}/duplicates`, headers: officer })).json().data;
    expect(candidates[0]).toMatchObject({ id: first.id, level: 'likely', sameCategory: true });
    expect(candidates[0].distanceM).toBeGreaterThan(30);
    expect(candidates[0].distanceM).toBeLessThan(80);

    const linked = await a.inject({ method: 'POST', url: `/v1/officer/incidents/${second.id}/duplicate-of`, headers: officer, payload: { primaryId: first.id } });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data.duplicateOf).toEqual({ id: first.id, receiptCode: first.receiptCode });
    expect(linked.json().data.suggestedDuplicateOf).toBeNull();
    const queue = (await a.inject({ method: 'GET', url: '/v1/officer/queue', headers: officer })).json().data;
    expect(queue.find((item: { id: string }) => item.id === second.id).duplicateOfReceiptCode).toBe(first.receiptCode);
    expect((await a.inject({ method: 'POST', url: `/v1/officer/incidents/${first.id}/duplicate-of`, headers: officer, payload: { primaryId: second.id } })).statusCode).toBe(400);

    const statistics = (await a.inject({ method: 'GET', url: `/v1/officer/statistics?period=day&date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())}`, headers: officer })).json().data;
    expect(statistics.kpis.dataQuality.duplicateLinked).toBeGreaterThanOrEqual(1);

    const unlinked = await a.inject({ method: 'POST', url: `/v1/officer/incidents/${second.id}/duplicate-of`, headers: officer, payload: { primaryId: null } });
    expect(unlinked.json().data.duplicateOf).toBeNull();

    const pool = new pg.Pool({ connectionString: url });
    const audit = await pool.query(`SELECT action FROM workflow_audit_events WHERE aggregate_id=$1 ORDER BY id`, [second.id]);
    await pool.end();
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['duplicate_linked', 'duplicate_unlinked']));
  });
});

describe('AI review, ratings and KPIs on PostgreSQL', () => {
  it('stores the AI suggestion, the officer decision, SOS and app ratings, and reports them', async () => {
    const a = await newApp();
    const incident = await report(a, 'Ồn ào khu nhà trọ ban đêm', 'Khu nhà trọ mở nhạc lớn sau 23 giờ nhiều đêm liền.', 11.9452, 108.4385, 'other');
    const reviewed = await a.inject({ method: 'POST', url: `/v1/officer/incidents/${incident.id}/ai-review`, headers: officer });
    expect(reviewed.statusCode).toBe(200);
    const review = reviewed.json().data;
    expect(review).toMatchObject({ suggestedCategory: 'public_order', confidence: 'high', decision: null });
    expect(review.imageFindings).toHaveLength(1);
    const decided = await a.inject({ method: 'POST', url: `/v1/officer/incidents/${incident.id}/category`, headers: officer, payload: { category: 'public_order', reviewId: review.id } });
    expect(decided.json().data.category).toBe('public_order');
    expect((await a.inject({ method: 'GET', url: `/v1/officer/incidents/${incident.id}/ai-review`, headers: officer })).json().data.decision).toBe('accepted');

    expect((await a.inject({ method: 'POST', url: '/v1/citizen/app-rating', headers: citizen, payload: { score: 4 } })).statusCode).toBe(201);
    expect((await a.inject({ method: 'POST', url: '/v1/citizen/app-rating', headers: citizen, payload: { score: 5, comment: 'Tốt' } })).json().data.score).toBe(5);

    const sos = (await a.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizen,
      payload: { idempotencyKey: `intel-sos-${Date.now()}`, category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() },
    })).json().data;
    expect((await a.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/rating`, headers: citizen, payload: { score: 5 } })).statusCode).toBe(409);
    for (const [toStatus, note] of [['acknowledged', 'Đã nhận tín hiệu SOS.'], ['responding', 'Đang đến hiện trường.'], ['resolved', 'Đã hỗ trợ xong, người dân an toàn tại chỗ.']]) {
      expect((await a.inject({ method: 'POST', url: `/v1/officer/sos/${sos.id}/transitions`, headers: officer, payload: { toStatus, note } })).statusCode).toBe(200);
    }
    expect((await a.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/rating`, headers: citizen, payload: { score: 5, comment: 'Nhanh' } })).statusCode).toBe(201);
    expect((await a.inject({ method: 'GET', url: `/v1/citizen/sos/${sos.receiptCode}`, headers: citizen })).json().data.satisfactionRating.score).toBe(5);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const kpis = (await a.inject({ method: 'GET', url: `/v1/officer/statistics?period=day&date=${today}`, headers: officer })).json().data.kpis;
    expect(kpis.ai.accepted).toBeGreaterThanOrEqual(1);
    expect(kpis.ai.accuracy).toBeGreaterThan(0);
    expect(kpis.satisfaction.sosCount).toBeGreaterThanOrEqual(1);
    expect(kpis.satisfaction.appCount).toBeGreaterThanOrEqual(1);
    expect(kpis.response.sosAcknowledgeMinutes).not.toBeNull();
    expect(kpis.response.respondedRate).toBeGreaterThan(0);
    expect(kpis.dataQuality).toMatchObject({ vneidConnected: false, vneidVerifiedRate: null });
  });
});
