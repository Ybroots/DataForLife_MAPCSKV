import type { FastifyReply } from 'fastify';
import { AiUnavailableError, type AiImage, type JsonModel } from './ai-client.js';
import { draftIncident, draftReply, incidentCategoryValues, suggestAssignee, IntelligenceError, reviewIncident, type IncidentCategory, type ReviewImage } from './incident-intelligence.js';
import { containsPersonalIdNumber } from './map-assistant.js';
import { matchProcedureByKeyword, pickProcedureWithAi, PROCEDURE_DISCLAIMER, type Procedure } from './procedures.js';
import { AttemptWindow } from './rate-limit.js';
import { summarizeStatistics } from './report-summary.js';
import { translateMessage, translateProcedure, TranslationCache, translationTargets, type TranslationTarget } from './translation.js';
import { matchesDeclaredMedia, optionalText, statisticsPeriods } from './request-parsing.js';
import type { RouteContext } from './route-context.js';
import { COMMANDER_READ_ONLY_MESSAGE } from './workflow.js';

const REVIEW_IMAGE_LIMIT = 3;
const REVIEW_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const DRAFT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const DRAFT_BODY_LIMIT = 6 * 1024 * 1024;

function parseDraftImage(value: unknown): AiImage | null {
  const candidate = value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
  const mimeType = candidate?.mimeType;
  const data = candidate?.dataBase64;
  if ((mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') || typeof data !== 'string' || !/^[a-zA-Z0-9+/]+={0,2}$/.test(data)) return null;
  const decoded = Buffer.from(data, 'base64');
  if (decoded.length < 16 || decoded.length > DRAFT_IMAGE_MAX_BYTES || !matchesDeclaredMedia(decoded, mimeType)) return null;
  return { mimeType, data: decoded };
}

/** Giới hạn chi phí AI cho cả tiến trình API: số lượt mỗi ngày và số lượt chạy đồng thời. */
class AiBudget {
  private day = '';
  private count = 0;
  private inFlight = 0;

  constructor(private readonly dailyCap: number, private readonly clock: () => number) {}

  /** Trả về số giây cần chờ, hoặc 0 khi được phép gọi (và đã giữ chỗ). */
  acquire(): number {
    const now = this.clock();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.day !== today) { this.day = today; this.count = 0; }
    if (this.count >= this.dailyCap) return Math.ceil((Date.parse(`${today}T00:00:00Z`) + 86_400_000 - now) / 1000);
    if (this.inFlight >= 3) return 10;
    this.count += 1;
    this.inFlight += 1;
    return 0;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

function parseScore(value: unknown): number | null {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

/**
 * AI hỗ trợ điền phiếu, nhóm phản ánh trùng, gợi ý lĩnh vực và nhận biết ảnh, đánh giá sau SOS và đánh giá ứng dụng.
 * AI chỉ gợi ý: người dân xem lại trước khi gửi, cán bộ quyết định lĩnh vực và việc gộp hồ sơ.
 */
export function registerIntelligenceRoutes(context: RouteContext, model: JsonModel | undefined, dailyLimit = 200): void {
  const { app, repository, options, localWorkflowMeta, officerIdentity, citizenIdentity, workflowDisabled } = context;
  /** Chỉ huy chỉ xem: các thao tác nhờ AI soạn hoặc phân tích hồ sơ thuộc việc xử lý nên bị chặn trước khi tốn lượt AI. */
  const isCommander = async (officerId: string): Promise<boolean> =>
    (await repository.listWorkflowActors(officerId)).find((actor) => actor.id === officerId)?.actorType === 'supervisor';
  const clock = options.limits?.clock ?? Date.now;
  const draftWindow = new AttemptWindow(20, 60 * 60_000, clock);
  const reviewWindow = new AttemptWindow(60, 60 * 60_000, clock);
  const procedureWindow = new AttemptWindow(12, 60 * 60_000, clock);
  const translateWindow = new AttemptWindow(40, 60 * 60_000, clock);
  const messageCache = new TranslationCache<string>(500);
  const procedureCache = new TranslationCache<Awaited<ReturnType<typeof translateProcedure>>>(20);
  const budget = new AiBudget(Number.isSafeInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : 200, clock);

  const notConfigured = (reply: FastifyReply) => reply.code(503).send({
    error: 'AI_NOT_CONFIGURED', message: 'Chức năng phân tích chưa được bật trên máy chủ.',
  });

  async function runAi<T>(reply: FastifyReply, subject: string, window: AttemptWindow, task: () => Promise<T>) {
    const wait = window.retryAfterSeconds(subject) || budget.acquire();
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'AI_RATE_LIMITED', message: 'Đã đạt giới hạn sử dụng. Hãy thử lại sau.' });
    }
    window.record(subject);
    try {
      return { data: await task() };
    } catch (error) {
      if (error instanceof IntelligenceError) return reply.code(error.status).send({ error: error.code, message: error.message });
      if (error instanceof AiUnavailableError) {
        return reply.code(503).send({ error: 'AI_PROVIDER_UNAVAILABLE', message: 'Chưa kết nối được hệ thống phân tích. Hãy thử lại sau.' });
      }
      throw error;
    } finally {
      budget.release();
    }
  }

  app.get('/v1/ai/status', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { data: { configured: Boolean(model), provider: model?.provider ?? null, features: model ? ['incident_draft', 'incident_review', 'reply_draft', 'procedure_help', 'translate', 'report_summary'] : [] } };
  });

  // Hỏi đáp thủ tục: từ khóa trước, AI chỉ chọn mã; nội dung luôn lấy từ kho.
  app.post<{ Body: { question?: unknown; ai?: unknown; lang?: unknown } }>('/v1/assistant/procedure', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const question = typeof request.body?.question === 'string' ? request.body.question.trim() : '';
    if (question.length < 3 || question.length > 600) {
      return reply.code(400).send({ error: 'INVALID_AI_QUERY', message: 'Câu hỏi cần từ 3 đến 600 ký tự.' });
    }
    const english = request.body?.lang === 'en';
    const localize = async (procedure: Procedure): Promise<Procedure & { language: 'vi' | 'en' }> => {
      if (!english || !model) return { ...procedure, language: 'vi' };
      let translated = procedureCache.get(procedure.id);
      if (!translated && !budget.acquire()) {
        try { translated = await translateProcedure(model, procedure); procedureCache.set(procedure.id, translated); } catch { /* giữ tiếng Việt */ } finally { budget.release(); }
      }
      return translated ? { ...procedure, ...translated, language: 'en' } : { ...procedure, language: 'vi' };
    };
    const respond = async (procedure: Procedure | null, via: 'keyword' | 'ai' | 'none') => ({
      data: { matched: Boolean(procedure), via, procedure: procedure ? await localize(procedure) : null, disclaimer: PROCEDURE_DISCLAIMER },
    });
    const byKeyword = matchProcedureByKeyword(question);
    if (byKeyword) return respond(byKeyword, 'keyword');
    // ai=false: chỉ so khớp từ khóa.
    if (!model || request.body?.ai === false || containsPersonalIdNumber(question)) return respond(null, 'none');
    const result = await runAi(reply, request.ip, procedureWindow, () => pickProcedureWithAi(model, question));
    if (reply.sent) return reply;
    const picked = (result as { data: Procedure | null }).data;
    return respond(picked, picked ? 'ai' : 'none');
  });

  app.post<{ Body: { text?: unknown; image?: unknown } }>('/v1/citizen/incident-draft', { preHandler: workflowDisabled, bodyLimit: DRAFT_BODY_LIMIT }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập trước khi dùng tính năng điền phiếu hỗ trợ.' });
    if (!model) return notConfigured(reply);
    const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
    const rawImage = request.body?.image;
    let image: AiImage | undefined;
    if (rawImage !== undefined && rawImage !== null) {
      image = parseDraftImage(rawImage) ?? undefined;
      if (!image) return reply.code(400).send({ error: 'INVALID_DRAFT_IMAGE', message: 'Ảnh không hợp lệ hoặc lớn hơn 4 MB. Hãy chọn ảnh JPG, PNG hoặc WebP nhỏ hơn.' });
    }
    if (text.length > 2000 || (!image && text.length < 10)) {
      return reply.code(400).send({ error: 'INVALID_DRAFT_TEXT', message: 'Lời mô tả cần từ 10 đến 2.000 ký tự (hoặc kèm một ảnh).' });
    }
    return runAi(reply, citizenId, draftWindow, () => draftIncident(model, text, image));
  });

  app.get<{ Params: { id: string } }>('/v1/officer/incidents/:id/duplicates', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.findIncidentDuplicates(officerId, request.params.id), meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string }; Body: { primaryId?: unknown } }>('/v1/officer/incidents/:id/duplicate-of', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const primaryId = request.body?.primaryId;
    if (primaryId !== null && (typeof primaryId !== 'string' || !/^[\w-]{8,64}$/.test(primaryId))) {
      return reply.code(400).send({ error: 'INVALID_PRIMARY', message: 'Hồ sơ chính không hợp lệ.' });
    }
    return { data: await repository.setIncidentDuplicateOf(officerId, request.params.id, primaryId), meta: localWorkflowMeta };
  });

  app.get<{ Params: { id: string } }>('/v1/officer/incidents/:id/ai-review', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.getLatestIncidentAiReview(officerId, request.params.id), meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string } }>('/v1/officer/incidents/:id/ai-review', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    if (!model) return notConfigured(reply);
    if (await isCommander(officerId)) return reply.code(403).send({ error: 'FORBIDDEN', message: COMMANDER_READ_ONLY_MESSAGE });
    const incident = await repository.getOfficerIncident(officerId, request.params.id);
    if (!incident) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy phản ánh trong địa bàn.' });
    const images: ReviewImage[] = [];
    for (const attachment of incident.attachments) {
      if (images.length >= REVIEW_IMAGE_LIMIT) break;
      if (!attachment.mimeType.startsWith('image/') || attachment.sizeBytes > REVIEW_IMAGE_MAX_BYTES || attachment.uploaderRole !== 'citizen') continue;
      const file = await repository.getOfficerIncidentAttachment(officerId, incident.id, attachment.id);
      if (file) images.push({ attachmentId: attachment.id, mimeType: file.mimeType, data: file.content });
    }
    return runAi(reply, officerId, reviewWindow, async () => {
      const suggestion = await reviewIncident(model, incident, images);
      return repository.saveIncidentAiReview(officerId, incident.id, suggestion);
    });
  });

  app.get<{ Params: { id: string } }>('/v1/officer/incidents/:id/assignee-suggestion', { preHandler: workflowDisabled }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const incident = await repository.getOfficerIncident(officerId, request.params.id);
    if (!incident) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy phản ánh trong địa bàn.' });
    if (incident.assignedOfficer || ['closed', 'rejected'].includes(incident.status) || await isCommander(officerId)) return { data: { suggestion: null } };
    const [actors, queue] = await Promise.all([repository.listWorkflowActors(officerId), repository.listOfficerQueue(officerId)]);
    return { data: { suggestion: suggestAssignee(incident.location.localityCode, actors, queue) } };
  });

  app.post<{ Body: { text?: unknown; target?: unknown } }>('/v1/ai/translate', { preHandler: workflowDisabled, bodyLimit: 8 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const subject = officerIdentity(request) ?? citizenIdentity(request);
    if (!subject) return reply.code(401).send({ error: 'SESSION_REQUIRED', message: 'Vui lòng đăng nhập để dùng tính năng dịch.' });
    if (!model) return notConfigured(reply);
    const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
    const target = request.body?.target;
    if (text.length < 2 || text.length > 1500 || !translationTargets.includes(target as TranslationTarget)) {
      return reply.code(400).send({ error: 'INVALID_TRANSLATION', message: 'Nội dung cần dịch từ 2 đến 1.500 ký tự và ngôn ngữ đích là en hoặc vi.' });
    }
    const key = `${target}:${text}`;
    const cached = messageCache.get(key);
    if (cached) return { data: { translation: cached, provider: model.provider } };
    return runAi(reply, subject, translateWindow, async () => {
      const translation = await translateMessage(model, text, target as TranslationTarget);
      messageCache.set(key, translation);
      return { translation, provider: model.provider };
    });
  });

  app.post<{ Body: { period?: unknown; date?: unknown } }>('/v1/officer/statistics/summary', { preHandler: workflowDisabled }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    if (!model) return notConfigured(reply);
    const rawPeriod = request.body?.period;
    const period = typeof rawPeriod === 'string' && statisticsPeriods.has(rawPeriod) ? rawPeriod as import('./types.js').StatisticsPeriod : 'day';
    const rawDate = request.body?.date;
    const anchorDate = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(Date.parse(`${rawDate}T00:00:00Z`))
      ? rawDate : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const stats = await repository.getOfficerStatistics(officerId, period, anchorDate);
    return runAi(reply, officerId, reviewWindow, () => summarizeStatistics(model, stats));
  });

  app.post<{ Params: { id: string } }>('/v1/officer/incidents/:id/reply-draft', { preHandler: workflowDisabled }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    if (!model) return notConfigured(reply);
    if (await isCommander(officerId)) return reply.code(403).send({ error: 'FORBIDDEN', message: COMMANDER_READ_ONLY_MESSAGE });
    const incident = await repository.getOfficerIncident(officerId, request.params.id);
    if (!incident) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy phản ánh trong địa bàn.' });
    const thread = await repository.listOfficerIncidentMessages(officerId, incident.id);
    return runAi(reply, officerId, reviewWindow, () => draftReply(model, incident, thread));
  });

  app.post<{ Params: { id: string }; Body: { category?: unknown; reviewId?: unknown } }>('/v1/officer/incidents/:id/category', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const category = request.body?.category;
    const reviewId = request.body?.reviewId ?? null;
    if (typeof category !== 'string' || !incidentCategoryValues.includes(category as IncidentCategory)
      || (reviewId !== null && (typeof reviewId !== 'string' || !/^[\w-]{8,64}$/.test(reviewId)))) {
      return reply.code(400).send({ error: 'INVALID_CATEGORY', message: 'Lĩnh vực không hợp lệ.' });
    }
    return { data: await repository.decideIncidentCategory(officerId, request.params.id, category as IncidentCategory, reviewId as string | null), meta: localWorkflowMeta };
  });

  app.get('/v1/citizen/app-rating', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    reply.header('Cache-Control', 'private, no-store');
    return { data: await repository.getCitizenAppRating(citizenId) };
  });

  app.post<{ Body: { score?: unknown; comment?: unknown } }>('/v1/citizen/app-rating', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const score = parseScore(request.body?.score);
    const comment = optionalText(request.body?.comment, 1000);
    if (score === null || comment === undefined) return reply.code(400).send({ error: 'INVALID_RATING', message: 'Điểm đánh giá phải từ 1 đến 5.' });
    return reply.code(201).send({ data: await repository.saveCitizenAppRating(citizenId, score, comment) });
  });

  app.post<{ Params: { receiptCode: string }; Body: { score?: unknown; comment?: unknown } }>('/v1/citizen/sos/:receiptCode/rating', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const score = parseScore(request.body?.score);
    const comment = optionalText(request.body?.comment, 1000);
    if (score === null || comment === undefined) return reply.code(400).send({ error: 'INVALID_RATING', message: 'Điểm đánh giá phải từ 1 đến 5.' });
    return reply.code(201).send({ data: await repository.createSosRating(citizenId, request.params.receiptCode, score, comment), meta: localWorkflowMeta });
  });
}
