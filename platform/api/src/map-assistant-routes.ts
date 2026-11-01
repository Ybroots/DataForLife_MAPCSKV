import type { FastifyInstance } from 'fastify';
import { answerMapQuestion, createKeywordPlanner, MapAssistantError, type AssistantPlanner } from './map-assistant.js';
import type { DirectoryRepository } from './types.js';

export function registerMapAssistant(app: FastifyInstance, repository: DirectoryRepository, planner?: AssistantPlanner, dailyLimit = 200) {
  const attempts = new Map<string, { start: number; count: number }>();
  let day = '';
  let dailyCount = 0;
  let inFlight = 0;
  const keyword = createKeywordPlanner();
  const cap = Number.isSafeInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : 200;

  app.get('/v1/assistant/status', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // `configured` means an AI provider is set up. Name lookup works without it, so the box is never locked.
    return { data: { configured: Boolean(planner), provider: planner?.provider ?? null, lookupAvailable: true,
      capabilities: ['area', 'directory', 'alerts', 'hotlines'], emergencyDispatchConnected: false } };
  });

  app.post<{ Body: { question?: unknown; areaCode?: unknown } }>('/v1/assistant/query', {
    bodyLimit: 4096,
    errorHandler(error, _request, reply) {
      const oversized = error.statusCode === 413;
      reply.code(oversized ? 413 : 400).send({ error: oversized ? 'AI_QUERY_TOO_LARGE' : 'INVALID_AI_QUERY', message: oversized ? 'Câu hỏi quá dài. Hãy rút gọn nội dung.' : 'Câu hỏi không đúng định dạng.' });
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { question, areaCode } = request.body ?? {};
    if (typeof question !== 'string' || question.trim().length < 3 || question.trim().length > 600
      || (areaCode !== undefined && areaCode !== null && (typeof areaCode !== 'string' || !/^[\w-]{3,80}$/.test(areaCode)))) {
      return reply.code(400).send({ error: 'INVALID_AI_QUERY', message: 'Câu hỏi cần từ 3 đến 600 ký tự và mã địa bàn hợp lệ.' });
    }
    const now = Date.now();
    for (const [ip, bucket] of attempts) if (now - bucket.start >= 60_000) attempts.delete(ip);
    const today = new Date(now).toISOString().slice(0, 10);
    if (day !== today) { day = today; dailyCount = 0; }
    const bucket = attempts.get(request.ip) ?? { start: now, count: 0 };
    // Bounded memory, per-IP quota, global daily spend cap and concurrency cap for this API process.
    if (bucket.count >= 6 || inFlight >= 3 || (!attempts.has(request.ip) && attempts.size >= 2000)) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: 'AI_RATE_LIMITED', message: 'Trợ lý đã đạt giới hạn tra cứu. Hãy thử lại sau hoặc dùng tìm kiếm xã/phường.' });
    }
    bucket.count++; attempts.set(request.ip, bucket);
    // Past the daily AI budget the question is still answered by name lookup, which costs nothing.
    const ai = planner && dailyCount < cap ? planner : undefined;
    if (ai) dailyCount++;
    inFlight++;
    try {
      const area = typeof areaCode === 'string' ? areaCode : null;
      if (!ai) return { data: await answerMapQuestion(repository, keyword, question.trim(), area) };
      try {
        return { data: await answerMapQuestion(repository, ai, question.trim(), area) };
      } catch (error) {
        // AI down or unusable: answer by name lookup instead of a dead end. The answer says it did not use AI.
        if (error instanceof MapAssistantError && (error.code === 'AI_PROVIDER_UNAVAILABLE' || error.code === 'AI_INVALID_RESULT')) {
          return { data: await answerMapQuestion(repository, keyword, question.trim(), area) };
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof MapAssistantError) return reply.code(error.status).send({ error: error.code, message: error.message });
      return reply.code(503).send({ error: 'AI_DATA_UNAVAILABLE', message: 'Chưa thể đối chiếu dữ liệu địa bàn. Hãy thử lại sau.' });
    } finally { inFlight--; }
  });
}
