import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMapAssistant } from './map-assistant-routes.js';
import { registerPushRoutes } from './push-routes.js';
import { MemoryPushStore } from './push.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerCitizenRoutes } from './citizen-routes.js';
import { registerOfficerCaseRoutes } from './officer-case-routes.js';
import { registerCommanderRoutes } from './commander-routes.js';
import { registerOfficerOperationsRoutes } from './officer-operations-routes.js';
import { registerPublicRoutes } from './public-routes.js';
import { registerIntelligenceRoutes } from './intelligence-routes.js';
import { createRouteContext, type AppOptions } from './route-context.js';
import type { DirectoryRepository } from './types.js';
import { WorkflowError } from './workflow.js';

export type { AppOptions } from './route-context.js';

export async function buildApp(
  repository: DirectoryRepository,
  options: AppOptions = {
    corsOrigin: 'http://localhost:5173',
    allowTestAuthHeaders: process.env.NODE_ENV === 'test',
  },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024, trustProxy: '127.0.0.1' });
  await app.register(cors, { origin: options.corsOrigin, credentials: true });
  registerMapAssistant(app, repository, options.assistantPlanner, options.assistantDailyLimit);

  // Ký tự NUL (U+0000) làm PostgreSQL báo lỗi 500: chặn sớm trong URL và trong thân JSON.
  app.addHook('preValidation', async (request, reply) => {
    const hasNul = (value: unknown, depth = 0): boolean => {
      if (typeof value === 'string') return value.includes('\u0000');
      if (depth > 6 || value === null || typeof value !== 'object') return false;
      return Object.values(value as Record<string, unknown>).some((item) => hasNul(item, depth + 1));
    };
    if (request.url.includes('%00') || hasNul(request.body)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Yêu cầu chứa ký tự không hợp lệ.' });
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(self)');
  });

  app.addHook('onClose', async () => {
    await repository.close();
  });

  const context = createRouteContext(app, repository, options);
  registerPublicRoutes(context);
  registerAuthRoutes(context);
  registerCitizenRoutes(context);
  registerPushRoutes(app, {
    store: options.pushStore ?? new MemoryPushStore(),
    enabled: options.pushEnabled ?? false,
    citizenIdentity: context.citizenIdentity,
    officerIdentity: context.officerIdentity,
    clock: options.limits?.clock,
  });
  registerOfficerCaseRoutes(context);
  registerOfficerOperationsRoutes(context);
  registerCommanderRoutes(context);
  registerIntelligenceRoutes(context, options.aiModel, options.aiDailyLimit);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkflowError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'INVALID_TRANSITION' || error.code === 'NO_DUTY_OFFICER' || error.code === 'CONFLICT' ? 409 : 400;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    // Lỗi do người gọi (JSON hỏng, sai Content-Type, body quá lớn...): trả 4xx rõ ràng thay vì 500.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = status === 413 ? 'Dữ liệu gửi lên quá lớn.'
        : status === 415 ? 'Định dạng dữ liệu không được hỗ trợ.'
          : 'Yêu cầu không hợp lệ.';
      return reply.code(status).send({ error: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message });
    }
    if ((error as { code?: unknown }).code === 'PASSWORD_BUSY') {
      reply.header('Retry-After', '5');
      return reply.code(503).send({ error: 'SERVER_BUSY', message: 'Hệ thống đang bận, vui lòng thử lại sau vài giây.' });
    }
    // Mã định danh sai dạng hoặc ký tự NUL trong chuỗi: lỗi đầu vào, không phải lỗi máy chủ.
    const pgCode = (error as { code?: unknown }).code;
    if (pgCode === '22P02') return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu.' });
    if (pgCode === '22021' || pgCode === '22P05') return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Yêu cầu chứa ký tự không hợp lệ.' });
    // Logger của Fastify đang tắt nên ghi thẳng ra journal: chỉ tuyến, mã lỗi và thông điệp (không ghi nội dung yêu cầu).
    console.error('[api] 500', request.method, request.routeOptions?.url ?? '', (error as { code?: unknown }).code ?? '', (error as Error).message);
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Hệ thống chưa thể xử lý yêu cầu. Vui lòng thử lại.',
      ...(process.env.API_DEBUG_ERRORS === 'true' ? { debug: error instanceof Error ? error.message : String(error) } : {}),
    });
  });

  return app;
}
