import { afterEach, describe as baseDescribe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { PostgresDirectoryRepository } from '../src/postgres-repository.js';
import pg from 'pg';

// Integration test against a REAL PostgreSQL + PostGIS database (never production!).
// Run: TEST_DATABASE_URL=postgres://... npx vitest run test/pg-workflows.test.ts
// The database needs migrations 001-003 + 005-011 and locality code 24781 with the demo officer actor
// (see platform/docs/postgres-integration-test.md). Skipped when TEST_DATABASE_URL is not set.
const url = process.env.TEST_DATABASE_URL ?? '';
const describe = url ? baseDescribe : baseDescribe.skip;
let app: FastifyInstance | undefined;
let repo: PostgresDirectoryRepository | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; repo = undefined; });

const citizen = { 'x-citizen-id': 'citizen-pg-001' };
const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
const attachments = [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 4, dataBase64: 'dGVzdA==' }];

async function newApp() {
  repo = new PostgresDirectoryRepository(url);
  app = await buildApp(repo, { corsOrigin: 'http://x', allowTestAuthHeaders: true });
  return app;
}
async function createIncident(a: FastifyInstance, id: string) {
  const r = await a.inject({
    method: 'POST', url: '/v1/citizen/incidents', headers: citizen,
    payload: { clientRequestId: id, category: 'other', summary: 'Phản ánh kiểm thử luồng', description: 'Nội dung phản ánh đủ dài để qua kiểm tra đầu vào.', latitude: 11.944, longitude: 108.441, attachments },
  });
  expect(r.statusCode).toBe(201);
  return r.json().data as { id: string; receiptCode: string };
}
const move = (a: FastifyInstance, id: string, toStatus: string, note = 'Cán bộ xử lý theo quy trình nghiệp vụ.') =>
  a.inject({ method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officer, payload: { toStatus, note } });

describe('citizen withdraws an incident', () => {
  it('closes it while nobody is assigned, and refuses afterwards', async () => {
    const a = await newApp();
    const first = await createIncident(a, 'withdraw-req-0001');
    const done = await a.inject({ method: 'POST', url: `/v1/citizen/incidents/${first.receiptCode}/withdraw`, headers: citizen, payload: {} });
    expect(done.statusCode).toBe(200);
    expect(done.json().data.status).toBe('closed');
    expect(done.json().data.history.at(-1)).toMatchObject({ actorRole: 'citizen', toStatus: 'closed' });

    const second = await createIncident(a, 'withdraw-req-0002');
    expect((await move(a, second.id, 'received')).statusCode).toBe(200);
    expect((await move(a, second.id, 'assigned')).statusCode).toBe(200);
    const late = await a.inject({ method: 'POST', url: `/v1/citizen/incidents/${second.receiptCode}/withdraw`, headers: citizen, payload: {} });
    expect(late.statusCode).toBe(409);

    const other = await a.inject({ method: 'POST', url: `/v1/citizen/incidents/${second.receiptCode}/withdraw`, headers: { 'x-citizen-id': 'someone-else-001' }, payload: {} });
    expect(other.statusCode).toBe(404);
  });
});

describe('officer can reject after assignment', () => {
  it('allows assigned -> rejected and processing -> rejected', async () => {
    const a = await newApp();
    const one = await createIncident(a, 'reject-req-00001');
    await move(a, one.id, 'received'); await move(a, one.id, 'assigned');
    const rejected = await move(a, one.id, 'rejected', 'Trùng với phản ánh đã tiếp nhận trước đó, đã thông báo người dân.');
    expect(rejected.statusCode).toBe(200);
    const two = await createIncident(a, 'reject-req-00002');
    await move(a, two.id, 'received'); await move(a, two.id, 'assigned'); await move(a, two.id, 'processing');
    expect((await move(a, two.id, 'rejected', 'Xác minh xong: thông tin sai sự thật, không thuộc phạm vi xử lý.')).statusCode).toBe(200);
  });
});

describe('SOS: citizen reports safe, officer closes a false alarm', () => {
  const sosBody = { idempotencyKey: 'pg-sos-key-0001', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() };

  it('records the safe report without changing status, once, and officer can resolve from acknowledged', async () => {
    const a = await newApp();
    const sos = (await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: sosBody })).json().data;
    const ack = await a.inject({ method: 'POST', url: `/v1/officer/sos/${sos.id}/transitions`, headers: officer, payload: { toStatus: 'acknowledged', note: 'Đã xác nhận tiếp nhận yêu cầu.' } });
    expect(ack.statusCode).toBe(200);

    const safe = await a.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/safe`, headers: citizen, payload: {} });
    expect(safe.statusCode).toBe(201);
    expect(safe.json().data.status).toBe('acknowledged');
    const length = safe.json().data.history.length;
    expect(safe.json().data.history.at(-1)).toMatchObject({ actorRole: 'citizen', fromStatus: 'acknowledged', toStatus: 'acknowledged' });

    const again = await a.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/safe`, headers: citizen, payload: {} });
    expect(again.json().data.history).toHaveLength(length);

    const resolved = await a.inject({ method: 'POST', url: `/v1/officer/sos/${sos.id}/transitions`, headers: officer, payload: { toStatus: 'resolved', note: 'Đã gọi xác minh, người gửi an toàn, báo nhầm; đóng yêu cầu.' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.status).toBe('resolved');

    const afterClose = await a.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/safe`, headers: citizen, payload: {} });
    expect(afterClose.statusCode).toBe(409);
  });
});

describe('duty coverage', () => {
  it('publishes which localities have an active officer', async () => {
    const a = await newApp();
    const r = await a.inject({ method: 'GET', url: '/v1/public/duty-coverage' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.localityCodes).toContain('24781');
  });
});


describe('postgres only: duty gate and ownership', () => {
  const pool = () => new pg.Pool({ connectionString: url });
  it('rejects SOS with 409 when no officer is active in the locality, accepts again after reactivation', async () => {
    const a = await newApp();
    const p = pool();
    try {
      await p.query("UPDATE workflow_actors SET active=false WHERE actor_type='officer'");
      const body = { idempotencyKey: 'pg-sos-nooff-0001', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() };
      const blocked = await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: body });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toBe('NO_DUTY_OFFICER');
      const cov = await a.inject({ method: 'GET', url: '/v1/public/duty-coverage' });
      expect(cov.json().data.localityCodes).not.toContain('24781');
      await p.query("UPDATE workflow_actors SET active=true WHERE actor_type='officer'");
      const ok = await a.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizen, payload: body });
      expect(ok.statusCode).toBe(201);
    } finally { await p.query("UPDATE workflow_actors SET active=true WHERE actor_type='officer'"); await p.end(); }
  });
  it('refuses a second officer acting on a colleague\'s assigned case', async () => {
    const a = await newApp();
    const p = pool();
    try {
      await p.query("INSERT INTO workflow_actors (id, actor_type, display_name, locality_id) SELECT 'officer-b-pg','officer','CSKV B', locality_id FROM workflow_actors WHERE id='officer-demo-xuan-huong' ON CONFLICT DO NOTHING");
      const inc = await createIncident(a, 'pg-own-req-00001');
      await move(a, inc.id, 'received');
      expect((await move(a, inc.id, 'assigned')).statusCode).toBe(200);
      const other = await a.inject({ method: 'POST', url: `/v1/officer/incidents/${inc.id}/transitions`, headers: { 'x-officer-id': 'officer-b-pg' }, payload: { toStatus: 'processing', note: 'Thử xử lý hồ sơ của đồng chí khác.' } });
      expect(other.statusCode).toBe(403);
      expect((await move(a, inc.id, 'processing')).statusCode).toBe(200);
    } finally { await p.end(); }
  });
});

describe('officer publishes a located alert', () => {
  it('accepts a point inside the locality and refuses one outside it', async () => {
    const a = await newApp();
    const base = { title: 'Cảnh báo kiểm thử vị trí', category: 'traffic', riskLevel: 'info', summary: 'Nội dung cảnh báo kiểm thử hợp lệ.', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() };
    const inside = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: { ...base, latitude: 11.944, longitude: 108.441 } });
    expect(inside.statusCode).toBe(201);
    expect(inside.json().data).toMatchObject({ latitude: 11.944, longitude: 108.441, areaCode: '24781' });
    const outside = await a.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officer, payload: { ...base, latitude: 10.5, longitude: 106.5 } });
    expect(outside.statusCode).toBe(400);
    const listed = await a.inject({ method: 'GET', url: '/v1/public/alerts?areaCode=24781' });
    expect(listed.json().data.some((item: { title: string; latitude: number | null }) => item.title === base.title && item.latitude === 11.944)).toBe(true);
    await repo!['pool'].query(`DELETE FROM public_alerts WHERE title = $1`, [base.title]);
  });
});
