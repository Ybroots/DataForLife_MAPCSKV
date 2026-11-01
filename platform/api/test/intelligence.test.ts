import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AiUnavailableError, createJsonModel, type JsonModel, type JsonModelRequest } from '../src/ai-client.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import {
  draftIncident,
  IntelligenceError,
  scoreDuplicate,
  textSimilarity,
  validateDraft,
  validateReview,
  type DuplicateCaseInput,
} from '../src/incident-intelligence.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

const citizen = { 'x-citizen-id': 'citizen-ai-001' };
const officer = { 'x-officer-id': 'officer-demo-xuan-huong' };
const png = [{ fileName: 'hien-truong.png', mimeType: 'image/png', sizeBytes: 4, dataBase64: 'dGVzdA==' }];

/** Mô hình giả: trả lần lượt các kết quả cho trước và ghi lại yêu cầu. */
function fakeModel(...outputs: unknown[]): JsonModel & { requests: JsonModelRequest[] } {
  const requests: JsonModelRequest[] = [];
  return {
    provider: 'Gemini', model: 'test-model', requests,
    async generate(request) {
      requests.push(request);
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function testApp(model?: JsonModel) {
  return buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', allowTestAuthHeaders: true, aiModel: model });
}

function caseInput(overrides: Partial<DuplicateCaseInput> = {}): DuplicateCaseInput {
  return {
    id: 'a', receiptCode: 'PA-1', category: 'public_order', summary: 'Tụ tập gây ồn ở chợ đêm',
    description: 'Nhóm thanh niên tụ tập gây ồn, nẹt pô ở cổng chợ đêm Đà Lạt.', status: 'submitted',
    createdAt: '2026-11-01T14:00:00Z', duplicateOf: null, ...overrides,
  };
}

describe('duplicate scoring rules', () => {
  it('matches the same story written differently, with or without diacritics', () => {
    expect(textSimilarity('Tụ tập gây ồn ở chợ đêm', 'tu tap gay on cho dem')).toBe(1);
    expect(textSimilarity('Tụ tập gây ồn ở chợ đêm', 'Rác thải đổ trộm bên suối')).toBe(0);
  });

  it('rates a nearby, same-time, same-topic report as likely and a far one as no match', () => {
    const target = caseInput();
    const near = scoreDuplicate(target, caseInput({ id: 'b', receiptCode: 'PA-2', createdAt: '2026-11-01T14:20:00Z', summary: 'Thanh niên gây ồn trước chợ đêm' }), 60);
    expect(near?.level).toBe('likely');
    expect(near?.distanceM).toBe(60);
    expect(scoreDuplicate(target, caseInput({ id: 'c' }), 800)).toBeNull();
    expect(scoreDuplicate(target, caseInput({ id: 'd', createdAt: '2026-11-02T08:00:00Z' }), 10)).toBeNull();
    const otherTopic = scoreDuplicate(target, caseInput({ id: 'e', category: 'environment', summary: 'Rác thải bên đường', description: 'Rác thải đổ trộm bên đường ống nước.' }), 300);
    expect(otherTopic).toBeNull();
    // Same spot, minutes apart, but a different topic and different words: not a duplicate.
    const samePlaceOtherStory = scoreDuplicate(target, caseInput({ id: 'f', category: 'security', createdAt: '2026-11-01T14:10:00Z', summary: 'Mất xe máy trước quán', description: 'Xe máy biển số Lâm Đồng bị lấy trộm khi đang gửi.' }), 0);
    expect(samePlaceOtherStory).toBeNull();
  });
});

describe('AI draft and review validation', () => {
  it('keeps the citizen text, adds the time line and falls back to a safe title', () => {
    const draft = validateDraft({ category: 'security', summary: 'ngắn', occurredAt: 'khoảng 21 giờ 30', place: 'chợ đêm Đà Lạt' }, 'Tôi bị mất ví ở chợ đêm. Trong ví có giấy tờ.');
    expect(draft.summary).toBe('Tôi bị mất ví ở chợ đêm');
    expect(draft.description).toBe('Thời điểm xảy ra: khoảng 21 giờ 30.\nTôi bị mất ví ở chợ đêm. Trong ví có giấy tờ.');
    expect(draft.locationNote).toBe('chợ đêm Đà Lạt');
    expect(() => validateDraft({ category: 'weapons', summary: 'x' }, 'abc')).toThrow(IntelligenceError);
  });

  it('does not send a 12-digit ID number to the model and flags emergencies', async () => {
    const model = fakeModel({ category: 'security', summary: 'Có người đánh nhau trước quán', occurredAt: '', place: '' });
    await expect(draftIncident(model, 'Số căn cước 0123 4567 8901 của tôi bị lấy')).rejects.toMatchObject({ code: 'AI_PERSONAL_DATA' });
    expect(model.requests).toHaveLength(0);
    const draft = await draftIncident(model, 'Có người đánh nhau trước quán cà phê, cứu với');
    expect(draft.emergency).toBe(true);
    expect(draft.occurredAt).toBeNull();
  });

  it('keeps only known image labels and maps findings to attachments by index', () => {
    const images = [{ attachmentId: 'img-1', mimeType: 'image/png', data: Buffer.from('a') }, { attachmentId: 'img-2', mimeType: 'image/png', data: Buffer.from('b') }];
    const review = validateReview({
      suggestedCategory: 'traffic', confidence: 'high', reason: 'Ảnh có xe máy đổ trên đường.',
      images: [{ index: 0, labels: ['traffic_accident', 'made_up_label'] }, { index: 9, labels: ['fire_smoke'] }],
    }, images);
    expect(review.imageFindings).toEqual([
      { attachmentId: 'img-1', labels: ['traffic_accident'] },
      { attachmentId: 'img-2', labels: ['unclear'] },
    ]);
  });
});

describe('Gemini JSON client', () => {
  it('sends images inline with room for thinking tokens and reads the JSON answer', async () => {
    let body: Record<string, any> = {};
    const fetcher = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] }));
    }) as unknown as typeof fetch;
    const model = createJsonModel({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', AI_MODEL: 'gemini-test' }, fetcher)!;
    await expect(model.generate({ instructions: 'x', text: 'y', images: [{ mimeType: 'image/png', data: Buffer.from('abc') }], schema: {}, schemaName: 's' })).resolves.toEqual({ ok: true });
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: Buffer.from('abc').toString('base64') } });
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });

  it('hides provider failures and truncated answers behind one error', async () => {
    const truncated = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"ok"' }] } }] }))) as unknown as typeof fetch;
    const model = createJsonModel({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', AI_MODEL: 'm' }, truncated)!;
    await expect(model.generate({ instructions: 'x', text: 'y', schema: {}, schemaName: 's' })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(createJsonModel({ AI_PROVIDER: 'gemini', AI_MODEL: 'm' })).toBeUndefined();
  });
});

describe('intelligence API', () => {
  async function createIncident(summary: string, description: string, latitude = 11.944, longitude = 108.441) {
    const response = await app!.inject({
      method: 'POST', url: '/v1/citizen/incidents', headers: citizen,
      payload: { clientRequestId: `req-${Math.random().toString(36).slice(2, 12)}`, category: 'public_order', summary, description, latitude, longitude, attachments: png },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data as { id: string; receiptCode: string };
  }

  it('accepts a report without a photo but still rejects a malformed attachment', async () => {
    app = await testApp();
    const base = { category: 'administrative', summary: 'Hỏi thủ tục đăng ký tạm trú', description: 'Cần biết giấy tờ cần chuẩn bị để đăng ký tạm trú.', latitude: 11.944, longitude: 108.441 };
    const none = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers: citizen, payload: { ...base, clientRequestId: 'req-no-photo-1' } });
    expect(none.statusCode).toBe(201);
    expect(none.json().data.attachments).toEqual([]);
    const empty = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers: citizen, payload: { ...base, clientRequestId: 'req-no-photo-2', attachments: [] } });
    expect(empty.statusCode).toBe(201);
    const bad = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers: citizen, payload: { ...base, clientRequestId: 'req-bad-photo', attachments: [{ fileName: 'x.png' }] } });
    expect(bad.statusCode).toBe(400);
  });

  it('drafts a report for a signed-in citizen only when AI is configured', async () => {
    app = await testApp();
    expect((await app.inject({ method: 'GET', url: '/v1/ai/status' })).json().data.configured).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/v1/citizen/incident-draft', headers: citizen, payload: { text: 'Có nhóm thanh niên gây ồn ở chợ đêm' } })).statusCode).toBe(503);
    await app.close();

    app = await testApp(fakeModel({ category: 'public_order', summary: 'Nhóm thanh niên gây ồn ở chợ đêm', occurredAt: 'tối nay', place: 'chợ đêm' }));
    expect((await app.inject({ method: 'POST', url: '/v1/citizen/incident-draft', payload: { text: 'Có nhóm thanh niên gây ồn ở chợ đêm' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/citizen/incident-draft', headers: citizen, payload: { text: 'ngắn' } })).statusCode).toBe(400);
    const drafted = await app.inject({ method: 'POST', url: '/v1/citizen/incident-draft', headers: citizen, payload: { text: 'Có nhóm thanh niên gây ồn ở chợ đêm' } });
    expect(drafted.statusCode).toBe(200);
    expect(drafted.json().data).toMatchObject({ category: 'public_order', locationNote: 'chợ đêm', emergency: false, provider: 'Gemini' });
  });

  it('suggests a duplicate on intake, lets the officer link and unlink it, and shows it in the queue', async () => {
    app = await testApp();
    const first = await createIncident('Tụ tập gây ồn ở chợ đêm', 'Nhóm thanh niên tụ tập gây ồn, nẹt pô ở cổng chợ đêm.');
    await createIncident('Rác thải đổ trộm bên suối', 'Có người đổ trộm rác thải xây dựng bên suối Cam Ly.', 11.955, 108.420);
    const second = await createIncident('Gây ồn ở cổng chợ đêm', 'Thanh niên tụ tập gây ồn ở cổng chợ đêm, nẹt pô liên tục.');

    const detail = (await app.inject({ method: 'GET', url: `/v1/officer/incidents/${second.id}`, headers: officer })).json().data;
    expect(detail.suggestedDuplicateOf).toMatchObject({ id: first.id, receiptCode: first.receiptCode });

    const candidates = (await app.inject({ method: 'GET', url: `/v1/officer/incidents/${second.id}/duplicates`, headers: officer })).json().data;
    expect(candidates.map((item: { id: string }) => item.id)).toEqual([first.id]);

    expect((await app.inject({ method: 'POST', url: `/v1/officer/incidents/${second.id}/duplicate-of`, headers: officer, payload: { primaryId: second.id } })).statusCode).toBe(400);
    const linked = await app.inject({ method: 'POST', url: `/v1/officer/incidents/${second.id}/duplicate-of`, headers: officer, payload: { primaryId: first.id } });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data.duplicateOf).toEqual({ id: first.id, receiptCode: first.receiptCode });
    const primary = (await app.inject({ method: 'GET', url: `/v1/officer/incidents/${first.id}`, headers: officer })).json().data;
    expect(primary.duplicates).toEqual([{ id: second.id, receiptCode: second.receiptCode }]);
    // A primary case with linked reports cannot itself be linked elsewhere.
    expect((await app.inject({ method: 'POST', url: `/v1/officer/incidents/${first.id}/duplicate-of`, headers: officer, payload: { primaryId: second.id } })).statusCode).toBe(400);

    const queue = (await app.inject({ method: 'GET', url: '/v1/officer/queue', headers: officer })).json().data;
    expect(queue.find((item: { id: string }) => item.id === second.id).duplicateOfReceiptCode).toBe(first.receiptCode);

    const unlinked = await app.inject({ method: 'POST', url: `/v1/officer/incidents/${second.id}/duplicate-of`, headers: officer, payload: { primaryId: null } });
    expect(unlinked.json().data.duplicateOf).toBeNull();
  });

  it('lets AI suggest a category and image labels, records the officer decision and reports AI accuracy', async () => {
    const model = fakeModel({ suggestedCategory: 'security', confidence: 'medium', reason: 'Mô tả có dấu hiệu trộm cắp.', images: [{ index: 0, labels: ['no_incident_visible'] }] });
    app = await testApp(model);
    const incident = await createIncident('Mất xe máy trước nhà trọ', 'Sáng nay phát hiện mất xe máy để trước cửa nhà trọ.');
    const reviewed = await app.inject({ method: 'POST', url: `/v1/officer/incidents/${incident.id}/ai-review`, headers: officer });
    expect(reviewed.statusCode).toBe(200);
    const review = reviewed.json().data;
    expect(review).toMatchObject({ suggestedCategory: 'security', decision: null });
    expect(review.imageFindings[0].labels).toEqual(['no_incident_visible']);
    expect(model.requests[0]!.images).toHaveLength(1);

    const decided = await app.inject({ method: 'POST', url: `/v1/officer/incidents/${incident.id}/category`, headers: officer, payload: { category: 'security', reviewId: review.id } });
    expect(decided.json().data.category).toBe('security');
    expect((await app.inject({ method: 'GET', url: `/v1/officer/incidents/${incident.id}/ai-review`, headers: officer })).json().data.decision).toBe('accepted');
    expect((await app.inject({ method: 'POST', url: `/v1/officer/incidents/${incident.id}/category`, headers: officer, payload: { category: 'weapons' } })).statusCode).toBe(400);

    const statistics = (await app.inject({ method: 'GET', url: '/v1/officer/statistics?period=day&date=2026-11-01', headers: officer })).json().data;
    expect(statistics.kpis.ai).toMatchObject({ reviews: 1, decided: 1, accepted: 1, accuracy: 1 });
    expect(statistics.kpis.dataQuality).toMatchObject({ vneidConnected: false, vneidVerifiedRate: null });
  });

  it('accepts an app rating and a rating after a resolved SOS only', async () => {
    app = await testApp();
    expect((await app.inject({ method: 'POST', url: '/v1/citizen/app-rating', headers: citizen, payload: { score: 6 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/citizen/app-rating', headers: citizen, payload: { score: 4, comment: 'Dễ dùng' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/v1/citizen/app-rating', headers: citizen })).json().data).toMatchObject({ score: 4, comment: 'Dễ dùng' });

    const sos = (await app.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizen,
      payload: { idempotencyKey: 'sos-rating-0001', category: 'security', latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString() },
    })).json().data;
    const early = await app.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/rating`, headers: citizen, payload: { score: 5 } });
    expect(early.statusCode).toBe(409);
    for (const [toStatus, note] of [['acknowledged', 'Đã nhận tín hiệu SOS.'], ['responding', 'Đang đến hiện trường.'], ['resolved', 'Đã hỗ trợ xong, người dân an toàn tại chỗ.']]) {
      const moved = await app.inject({ method: 'POST', url: `/v1/officer/sos/${sos.id}/transitions`, headers: officer, payload: { toStatus, note } });
      expect(moved.statusCode).toBe(200);
    }
    const rated = await app.inject({ method: 'POST', url: `/v1/citizen/sos/${sos.receiptCode}/rating`, headers: citizen, payload: { score: 5, comment: 'Cán bộ đến nhanh' } });
    expect(rated.statusCode).toBe(201);
    const mine = (await app.inject({ method: 'GET', url: `/v1/citizen/sos/${sos.receiptCode}`, headers: citizen })).json().data;
    expect(mine.satisfactionRating).toMatchObject({ score: 5, comment: 'Cán bộ đến nhanh' });
    const statistics = (await app.inject({ method: 'GET', url: '/v1/officer/statistics?period=day&date=2026-11-01', headers: officer })).json().data;
    expect(statistics.kpis.satisfaction).toMatchObject({ sosAverage: 5, sosCount: 1, appAverage: 4, appCount: 1 });
  });
});
