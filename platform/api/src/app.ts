import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMapAssistant } from './map-assistant-routes.js';
import { registerPushRoutes } from './push-routes.js';
import { MemoryPushStore } from './push.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerCitizenRoutes } from './citizen-routes.js';
import { registerOfficerCaseRoutes } from './officer-case-routes.js';
import { registerOfficerOperationsRoutes } from './officer-operations-routes.js';
import { registerPublicRoutes } from './public-routes.js';
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
    clock: options.limits?.clock,
  });
  registerOfficerCaseRoutes(context);
  registerOfficerOperationsRoutes(context);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WorkflowError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'INVALID_TRANSITION' || error.code === 'NO_DUTY_OFFICER' ? 409 : 400;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    app.log.error(error);
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Hệ thống chưa thể xử lý yêu cầu. Vui lòng thử lại.',
      ...(process.env.API_DEBUG_ERRORS === 'true' ? { debug: error instanceof Error ? error.message : String(error) } : {}),
    });
  });

  return app;
}
