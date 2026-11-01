import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { answerMapQuestion, createAssistantPlanner, createKeywordPlanner, MapAssistantError, type AssistantPlanner, type AssistantPlan } from '../src/map-assistant.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });
const plan: AssistantPlan = { intent: 'directory', areaCodes: ['DEMO-DA-LAT'], hotlineIds: [], needsClarification: false };
function planner(result: unknown = plan): AssistantPlanner {
  return { provider: 'OpenAI', plan: vi.fn().mockResolvedValue(result) };
}

describe('map assistant: public data boundary', () => {
  it('answers by name lookup, labelled as not using AI, when no provider is configured', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const status = await app.inject({ method: 'GET', url: '/v1/assistant/status' });
    expect(status.json().data).toMatchObject({ configured: false, provider: null, lookupAvailable: true, emergencyDispatchConnected: false });
    const response = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Cho tôi số liên hệ phường Xuân Hương' } });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.meta.provider).toBe('keyword');
    expect(data.intent).toBe('directory');
    expect(data.areas[0].code).toBe('DEMO-DA-LAT');
    const emergency = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Cứu tôi với, nhà tôi đang cháy' } });
    expect(emergency.json().data.intent).toBe('emergency');
  });

  it('falls back to name lookup when the AI provider fails or is over its daily budget', async () => {
    const failing: AssistantPlanner = { provider: 'Gemini', plan: vi.fn().mockRejectedValue(new MapAssistantError(503, 'AI_PROVIDER_UNAVAILABLE', 'down')) };
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: failing, assistantDailyLimit: 1 });
    const first = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Tìm phường Xuân Hương' }, remoteAddress: '10.0.0.1' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.meta.provider).toBe('keyword');
    const second = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Tìm phường Xuân Hương' }, remoteAddress: '10.0.0.2' });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.meta.provider).toBe('keyword');
    expect(failing.plan).toHaveBeenCalledTimes(1);
  });

  it('keyword planner: never guesses an unknown place and picks the longest matching name', async () => {
    const planner = createKeywordPlanner();
    const areas = [
      { code: 'A', name: 'Xã Đức Trọng', localityType: 'Xã', provinceName: null },
      { code: 'B', name: 'Xã Trọng', localityType: 'Xã', provinceName: null },
      { code: 'C', name: 'Phường 1 - Đà Lạt', localityType: 'Phường', provinceName: null },
      { code: 'D', name: 'Phường 10 - Đà Lạt', localityType: 'Phường', provinceName: null },
    ];
    const ask = (q: string, currentAreaCode: string | null = null) => planner.plan(q, { areas, hotlines: [{ id: 'h1', categoryLabel: 'Y tế', label: 'Cấp cứu 115' }, { id: 'h2', categoryLabel: 'An ninh', label: 'Công an 113' }], currentAreaCode });
    expect(await ask('địa chỉ trụ sở xã Đức Trọng')).toMatchObject({ intent: 'directory', areaCodes: ['A'], needsClarification: false });
    expect(await ask('cảnh báo ở phường 10')).toMatchObject({ intent: 'alerts', areaCodes: ['D'] });
    expect(await ask('số liên hệ phường 1')).toMatchObject({ areaCodes: ['C'] });
    expect(await ask('số liên hệ ở đây', 'C')).toMatchObject({ intent: 'directory', areaCodes: ['C'] });
    expect(await ask('số liên hệ xã Không Có')).toMatchObject({ areaCodes: [], needsClarification: true });
    expect(await ask('thời tiết hôm nay thế nào')).toMatchObject({ intent: 'unsupported', areaCodes: [] });
    expect(await ask('đường dây nóng cấp cứu')).toMatchObject({ intent: 'hotlines', hotlineIds: ['h1'] });
    expect(await ask('cách gửi phản ánh')).toMatchObject({ intent: 'help' });
  });

  it('hydrates only canonical facts, ignoring model-invented addresses, coordinates and answers', async () => {
    const repository = new FixtureDirectoryRepository();
    const model = planner({ ...plan, message: 'made up', latitude: 99, phone: 'made up' });
    const answer = await answerMapQuestion(repository, model, 'Tìm số liên hệ Xuân Hương', null);
    const canonical = await repository.lookupByCode('DEMO-DA-LAT');
    expect(answer.areas[0]?.directory).toEqual(canonical?.directory);
    expect(answer.areas[0]?.station?.address).toBe(canonical?.station?.address);
    expect(answer.meta).toMatchObject({ dataSource: 'fixture', emergencyDispatchConnected: false });
    expect(JSON.stringify(answer)).not.toContain('made up');
    expect(answer.areas[0]).not.toHaveProperty('center');
    const context = vi.mocked(model.plan).mock.calls[0]?.[1];
    expect(context?.areas[0]).not.toHaveProperty('geometry');
    expect(context?.hotlines[0]).not.toHaveProperty('phone');
    expect(context).not.toHaveProperty('directory');
  });

  it('uses the full overview rather than a truncated search catalog', async () => {
    const repository = new FixtureDirectoryRepository();
    const original = (await repository.getAreaOverview()).features[0]!;
    const canonical = (await repository.lookupByCode('DEMO-DA-LAT'))!;
    vi.spyOn(repository, 'getAreaOverview').mockResolvedValue({ type: 'FeatureCollection', features: Array.from({ length: 124 }, (_, i) => ({
      ...original, id: `TEST-${i}`, properties: { ...original.properties, code: `TEST-${i}`, name: `Địa bàn kiểm thử ${i}` },
    })) });
    vi.spyOn(repository, 'lookupByCode').mockResolvedValue({ ...canonical, code: 'TEST-123', name: 'Địa bàn kiểm thử 123' });
    const model = planner({ ...plan, areaCodes: ['TEST-123'] });
    const answer = await answerMapQuestion(repository, model, 'Địa bàn kiểm thử cuối cùng', null);
    expect(vi.mocked(model.plan).mock.calls[0]?.[1].areas).toHaveLength(124);
    expect(answer.areas[0]?.code).toBe('TEST-123');
  });

  it.each([
    { ...plan, areaCodes: ['invented-area'] },
    { ...plan, hotlineIds: ['invented-phone'] },
    { ...plan, intent: 'execute_sql' },
    { ...plan, areaCodes: Array(4).fill('DEMO-DA-LAT') },
    null,
  ])('rejects untrusted or out-of-catalog model output: %j', async result => {
    await expect(answerMapQuestion(new FixtureDirectoryRepository(), planner(result), 'Câu hỏi kiểm thử', null)).rejects.toMatchObject({ status: 502, code: 'AI_INVALID_RESULT' });
  });

  it('does not contact AI with an invalid context area', async () => {
    const model = planner();
    await expect(answerMapQuestion(new FixtureDirectoryRepository(), model, 'Tra cứu ở đây', 'missing')).rejects.toMatchObject({ status: 400 });
    expect(model.plan).not.toHaveBeenCalled();
  });

  it('offers an explicit SOS handoff without taking emergency action', async () => {
    const repository = new FixtureDirectoryRepository();
    const createSos = vi.spyOn(repository, 'createSos');
    const answer = await answerMapQuestion(repository, planner({ ...plan, intent: 'emergency' }), 'Tôi đang gặp nguy hiểm', null);
    expect(answer.areas).toEqual([]);
    expect(answer.hotlines).toEqual([]);
    expect(answer.message).toContain('không tiếp nhận');
    expect(createSos).not.toHaveBeenCalled();
  });

  it('does not hydrate contact details when the area is ambiguous', async () => {
    const answer = await answerMapQuestion(new FixtureDirectoryRepository(), planner({ ...plan, needsClarification: true }), 'Tìm phường', null);
    expect(answer.needsClarification).toBe(true);
    expect(answer.areas[0]?.directory).toEqual([]);
  });

  it('returns only canonical hotline numbers and public alerts', async () => {
    const repository = new FixtureDirectoryRepository();
    const hotline = (await repository.listHotlines())[0]!;
    const answer = await answerMapQuestion(repository, planner({ ...plan, intent: 'hotlines', hotlineIds: [hotline.id] }), 'Đường dây nóng', null);
    expect(answer.hotlines).toEqual([hotline]);
    const alerts = vi.spyOn(repository, 'listPublicAlerts');
    await answerMapQuestion(repository, planner({ ...plan, intent: 'alerts' }), 'Cảnh báo ở đây', 'DEMO-DA-LAT');
    expect(alerts).toHaveBeenCalledWith('DEMO-DA-LAT');
  });
});

describe('map assistant: safety checks before the model', () => {
  it('answers emergencies on the server without calling the model, with or without diacritics', async () => {
    for (const question of ['Cứu với, nhà tôi đang cháy', 'co nguoi bi dam o cho', 'Vừa xảy ra tai nạn trên đèo Prenn', 'Có kẻ dọa giết tôi']) {
      const model = planner();
      const answer = await answerMapQuestion(new FixtureDirectoryRepository(), model, question, null);
      expect(answer.intent).toBe('emergency');
      expect(answer.message).toContain('113');
      expect(model.plan).not.toHaveBeenCalled();
    }
  });

  it('still answers the emergency when the provider is down', async () => {
    const down: AssistantPlanner = { provider: 'Gemini', plan: vi.fn().mockRejectedValue(new Error('down')) };
    const answer = await answerMapQuestion(new FixtureDirectoryRepository(), down, 'Khẩn cấp, có người bất tỉnh', null);
    expect(answer.intent).toBe('emergency');
  });

  it('does not treat ordinary procedure questions as emergencies', async () => {
    for (const question of ['Thủ tục đăng ký tạm trú khi thuê nhà', 'Giấy chứng nhận phòng cháy chữa cháy làm ở đâu', 'Số liên hệ phường Xuân Hương']) {
      const model = planner();
      await answerMapQuestion(new FixtureDirectoryRepository(), model, question, null);
      expect(model.plan).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a question containing a 12-digit personal ID before reaching the model', async () => {
    for (const question of ['Số căn cước 068123456789 của tôi đăng ký tạm trú chưa', 'CCCD 068 123 456 789 bị mất thì sao']) {
      const model = planner();
      await expect(answerMapQuestion(new FixtureDirectoryRepository(), model, question, null)).rejects.toMatchObject({ status: 400, code: 'AI_PERSONAL_DATA' });
      expect(model.plan).not.toHaveBeenCalled();
    }
    const model = planner();
    await answerMapQuestion(new FixtureDirectoryRepository(), model, 'Gọi số 0263 3822 000 được không', null);
    expect(model.plan).toHaveBeenCalledTimes(1);
  });
});

describe('map assistant limits', () => {
  it('rejects malformed questions before invoking the provider', async () => {
    const model = planner();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: model });
    for (const payload of [{ question: 'a' }, { question: 'a'.repeat(601) }, { question: 'Hỏi địa bàn', areaCode: { code: 'bad' } }]) {
      expect((await app.inject({ method: 'POST', url: '/v1/assistant/query', payload })).statusCode).toBe(400);
    }
    expect(model.plan).not.toHaveBeenCalled();
  });

  it('enforces per-IP and global daily cost limits', async () => {
    const model = planner();
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: model, assistantDailyLimit: 7 });
    const query = (ip: string) => app!.inject({ method: 'POST', url: '/v1/assistant/query', remoteAddress: ip, payload: { question: 'Tìm Xuân Hương' } });
    for (let i = 0; i < 6; i++) expect((await query('192.0.2.1')).statusCode).toBe(200);
    const limit = await query('192.0.2.1');
    expect(limit.statusCode).toBe(429);
    expect(limit.headers['retry-after']).toBeDefined();
    expect((await query('192.0.2.2')).statusCode).toBe(200);
    // Past the daily AI budget the question is answered by name lookup instead of being refused.
    const overBudget = await query('192.0.2.3');
    expect(overBudget.statusCode).toBe(200);
    expect(overBudget.json().data.meta.provider).toBe('keyword');
    expect(model.plan).toHaveBeenCalledTimes(7);
  });

  it('returns 413 for oversized payloads and 400 for malformed JSON', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: planner() });
    const oversized = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'a'.repeat(5000) } });
    expect(oversized.statusCode).toBe(413);
    const malformed = await app.inject({ method: 'POST', url: '/v1/assistant/query', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
  });

  it('caps concurrent calls and releases slots after completion', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise(resolve => { release = resolve; });
    const model: AssistantPlanner = { provider: 'OpenAI', plan: vi.fn().mockReturnValue(pending) };
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: model });
    const query = (ip: string) => app!.inject({ method: 'POST', url: '/v1/assistant/query', remoteAddress: ip, payload: { question: 'Tìm địa bàn' } }).then(value => value);
    const active = [query('192.0.2.1'), query('192.0.2.2'), query('192.0.2.3')];
    await vi.waitFor(() => expect(model.plan).toHaveBeenCalledTimes(3));
    expect((await query('192.0.2.4')).statusCode).toBe(429);
    release(plan);
    expect((await Promise.all(active)).every(response => response.statusCode === 200)).toBe(true);
    expect((await query('192.0.2.5')).statusCode).toBe(200);
  });

  it('sanitizes unexpected errors rather than leaking configuration or model output', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost', assistantPlanner: { provider: 'OpenAI', plan: async () => { throw new Error('secret-api-key'); } } });
    const response = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Tìm Xuân Hương' } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret-api-key');
  });
});

describe('server-only provider adapters (mock HTTP, no paid calls)', () => {
  const context = { areas: [], hotlines: [], currentAreaCode: null };
  it('requires an explicit provider, model and matching key', () => {
    expect(createAssistantPlanner({})).toBeUndefined();
    expect(createAssistantPlanner({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only' })).toBeUndefined();
    expect(createAssistantPlanner({ AI_PROVIDER: 'gemini', AI_MODEL: 'test-model', OPENAI_API_KEY: 'test-only' })).toBeUndefined();
  });

  it('uses OpenAI Responses structured output with store=false', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(plan) }] }] })));
    const model = createAssistantPlanner({ AI_PROVIDER: 'openai', AI_MODEL: 'test-model', OPENAI_API_KEY: 'test-only' }, http)!;
    expect(await model.plan('Tìm xã', context)).toEqual(plan);
    const [endpoint, init] = http.mock.calls[0]!;
    expect(endpoint).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(init!.body as string);
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses Gemini structured output and never includes the key in the URL', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(plan) }] } }] })));
    const model = createAssistantPlanner({ AI_PROVIDER: 'gemini', AI_MODEL: 'test-model', GEMINI_API_KEY: 'test-only' }, http)!;
    expect(await model.plan('Tìm xã', context)).toEqual(plan);
    const [endpoint, init] = http.mock.calls[0]!;
    expect(endpoint).not.toContain('test-only');
    expect(JSON.parse(init!.body as string).generationConfig.responseMimeType).toBe('application/json');
  });

  it.each([new Response('private provider failure', { status: 401 }), new Response(JSON.stringify({ status: 'incomplete' })), new Response(JSON.stringify({ status: 'completed', output: [] }))])('handles errors/refusals/incomplete results without fabricated answers', async response => {
    const model = createAssistantPlanner({ AI_PROVIDER: 'openai', AI_MODEL: 'test-model', OPENAI_API_KEY: 'test-only' }, vi.fn<typeof fetch>().mockResolvedValue(response))!;
    await expect(model.plan('Tìm xã', context)).rejects.toMatchObject({ status: 503, code: 'AI_PROVIDER_UNAVAILABLE' });
  });
});
