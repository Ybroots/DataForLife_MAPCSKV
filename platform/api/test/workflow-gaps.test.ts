import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const citizen = { 'x-citizen-id': 'citizen-gap-001' };
const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
const attachments = [{ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 4, dataBase64: 'dGVzdA==' }];

async function newApp() {
  app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://x', allowTestAuthHeaders: true });
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
  const sosBody = { idempotencyKey: 'gap-sos-key-0001', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() };

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
    expect(r.json().data.localityCodes).toContain('DEMO-DA-LAT');
  });
});
