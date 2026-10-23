import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';
import { answerMapQuestion, createAssistantPlanner, type AssistantPlanner, type AssistantPlan } from '../src/map-assistant.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });
const plan: AssistantPlan = { intent: 'directory', areaCodes: ['DEMO-DA-LAT'], hotlineIds: [], needsClarification: false };
function planner(result: unknown = plan): AssistantPlanner {
  return { provider: 'OpenAI', plan: vi.fn().mockResolvedValue(result) };
}

describe('map assistant: public data boundary', () => {
  it('keeps an unconfigured AI explicitly unavailable', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const status = await app.inject({ method: 'GET', url: '/v1/assistant/status' });
    expect(status.json().data).toMatchObject({ configured: false, provider: null, emergencyDispatchConnected: false });
    const response = await app.inject({ method: 'POST', url: '/v1/assistant/query', payload: { question: 'Tìm Xuân Hương' } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('AI_NOT_CONFIGURED');
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
    expect((await query('192.0.2.3')).statusCode).toBe(429);
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
