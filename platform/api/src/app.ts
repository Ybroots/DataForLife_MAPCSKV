import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { CreateIncidentInput, CreateSosInput, DirectoryRepository, IncidentAttachmentInput } from './types.js';
import {
  authenticateOfficer,
  clearOfficerSessionCookie,
  createOfficerSession,
  officerSessionCookie,
  readOfficerSessionCookie,
  verifyOfficerSession,
  type OfficerCredential,
} from './officer-auth.js';
import { WorkflowError, type IncidentStatus, type SosStatus } from './workflow.js';
import {
  authenticateCitizen,
  citizenSessionCookie,
  clearCitizenSessionCookie,
  createCitizenSession,
  readCitizenSessionCookie,
  verifyCitizenSession,
  type CitizenCredential,
} from './citizen-auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { registerMapAssistant } from './map-assistant-routes.js';
import type { AssistantPlanner } from './map-assistant.js';

interface AppOptions {
  corsOrigin: string;
  enableLocalWorkflows?: boolean;
  officerSessionSecret?: string;
  officerCredentials?: readonly OfficerCredential[];
  secureCookies?: boolean;
  allowTestAuthHeaders?: boolean;
  citizenSessionSecret?: string;
  citizenCredentials?: readonly CitizenCredential[];
  releaseValidation?: boolean;
  assistantPlanner?: AssistantPlanner;
  assistantDailyLimit?: number;
}

const incidentCategories = new Set(['security', 'traffic', 'public_order', 'administrative', 'environment', 'other']);
const sosCategories = new Set(['security', 'traffic_accident', 'fire_rescue', 'medical', 'other_emergency']);
const incidentStatuses = new Set(['submitted', 'received', 'assigned', 'verifying', 'processing', 'resolved', 'closed', 'rejected']);
const sosStatuses = new Set(['triggered', 'dispatched', 'acknowledged', 'responding', 'escalated', 'resolved', 'closed', 'cancelled_by_citizen']);
const alertCategories = new Set(['security', 'traffic', 'fire_rescue', 'weather', 'other']);
const alertRiskLevels = new Set(['info', 'medium', 'high']);
const patrolActions = new Set(['start', 'pause', 'resume', 'checkin', 'complete']);
const statisticsPeriods = new Set(['day', 'month', 'year']);
const mapPointTypes = new Set(['police_post', 'camera', 'risk_point', 'patrol_checkpoint', 'public_facility']);
const mapPointStatuses = new Set(['active', 'inactive', 'maintenance']);
const mapPointVisibilities = new Set(['officer', 'public']);

function parseCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function headerIdentity(value: string | string[] | undefined): string | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(normalized)) return null;
  return normalized;
}

function text(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

function passwordText(value: unknown, minimum: number, maximum: number): string | null {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum ? value : null;
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return text(value, 1, maximum) ?? undefined;
}

function parseAccuracy(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000 ? parsed : undefined;
}

function parsePhone(value: unknown): string | null | undefined {
  const normalized = optionalText(value, 30);
  if (normalized === null || normalized === undefined) return normalized;
  const compact = normalized.replace(/[\s().-]/g, '');
  if (!/^\+?\d{8,15}$/.test(compact)) return undefined;
  return normalized;
}

function parseDeviceTimestamp(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const age = now - parsed;
  if (age < -5 * 60_000 || age > 24 * 60 * 60_000) return null;
  return new Date(parsed).toISOString();
}

function parseOperationalMapPoint(body: Record<string, unknown>) {
  const name = text(body.name, 3, 160);
  const pointType = typeof body.pointType === 'string' && mapPointTypes.has(body.pointType) ? body.pointType : null;
  const description = optionalText(body.description, 1200);
  const contactPhone = parsePhone(body.contactPhone);
  const status = typeof body.status === 'string' && mapPointStatuses.has(body.status) ? body.status : null;
  const visibility = typeof body.visibility === 'string' && mapPointVisibilities.has(body.visibility) ? body.visibility : null;
  const latitude = parseCoordinate(body.latitude, -90, 90);
  const longitude = parseCoordinate(body.longitude, -180, 180);
  if (!name || !pointType || description === undefined || contactPhone === undefined || !status || !visibility || latitude === null || longitude === null) return null;
  return { name, pointType, description, contactPhone, status, visibility, latitude, longitude } as import('./types.js').OperationalMapPointInput;
}

function parseIncidentAttachments(value: unknown): IncidentAttachmentInput[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const item = value[0];
  if (!item || typeof item !== 'object') return null;
  const candidate = item as Record<string, unknown>;
  const fileName = text(candidate.fileName, 1, 180);
  const mimeType = typeof candidate.mimeType === 'string' && ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(candidate.mimeType)
    ? candidate.mimeType as IncidentAttachmentInput['mimeType']
    : null;
  const sizeBytes = typeof candidate.sizeBytes === 'number' && Number.isInteger(candidate.sizeBytes)
    && candidate.sizeBytes >= 1 && candidate.sizeBytes <= (candidate.mimeType?.toString().startsWith('video/') ? 20 : 5) * 1024 * 1024
    ? candidate.sizeBytes
    : null;
  const dataBase64 = typeof candidate.dataBase64 === 'string' && /^[a-zA-Z0-9+/]+={0,2}$/.test(candidate.dataBase64)
    ? candidate.dataBase64
    : null;
  if (!fileName || !mimeType || !sizeBytes || !dataBase64) return null;
  const decoded = Buffer.from(dataBase64, 'base64');
  if (decoded.length !== sizeBytes) return null;
  return [{ fileName, mimeType, sizeBytes, dataBase64 }];
}

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
  const registrationAttempts = new Map<string, number[]>();

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(self)');
  });

  app.addHook('onClose', async () => {
    await repository.close();
  });

  app.get('/health', async () => ({ status: 'ok', dataSource: repository.sourceName,
    ...(options.releaseValidation ? { releaseValidation: true } : {}) }));

  app.get('/v1/areas/overview', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { data: await repository.getAreaOverview(), meta: { dataSource: repository.sourceName } };
  });

  app.get<{ Querystring: { query?: string; limit?: string } }>('/v1/areas', async (request) => {
    const query = request.query.query?.trim() ?? '';
    const requestedLimit = Number(request.query.limit ?? 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 30) : 10;
    return { data: await repository.searchAreas(query, limit) };
  });

  app.get<{ Params: { code: string } }>('/v1/lookup/by-code/:code', async (request, reply) => {
    const result = await repository.lookupByCode(request.params.code.trim());
    if (!result) return reply.code(404).send({ error: 'AREA_NOT_FOUND', message: 'Không tìm thấy địa bàn.' });
    return { data: result, meta: { dataSource: repository.sourceName } };
  });

  app.get<{ Querystring: { lat?: string; lng?: string } }>('/v1/lookup/by-location', async (request, reply) => {
    const latitude = parseCoordinate(request.query.lat, -90, 90);
    const longitude = parseCoordinate(request.query.lng, -180, 180);
    if (latitude === null || longitude === null) {
      return reply.code(400).send({
        error: 'INVALID_COORDINATES',
        message: 'Tọa độ không hợp lệ. lat phải từ -90 đến 90 và lng từ -180 đến 180.',
      });
    }
    const result = await repository.lookupByLocation(latitude, longitude);
    if (!result) {
      return reply.code(404).send({
        error: 'LOCATION_OUTSIDE_COVERAGE',
        message: 'Vị trí chưa thuộc địa bàn có dữ liệu công khai.',
      });
    }
    return { data: result, meta: { dataSource: repository.sourceName } };
  });

  app.get('/v1/hotlines', async () => ({ data: await repository.listHotlines() }));
  app.get('/v1/directory/units', async () => ({ data: await repository.listUnitContacts() }));

  app.get<{ Querystring: { areaCode?: string } }>('/v1/public/alerts', async (request, reply) => {
    const areaCode = text(request.query.areaCode, 3, 80);
    if (!areaCode) return reply.code(400).send({ error: 'INVALID_AREA_CODE', message: 'Thiếu mã địa bàn.' });
    return { data: await repository.listPublicAlerts(areaCode) };
  });

  const localWorkflowMeta = {
    workflowMode: 'local_sandbox' as const,
    authentication: 'http_only_session' as const,
    emergencyDispatchConnected: false,
  };

  const officerIdentity = (request: FastifyRequest): string | null => {
    if (options.allowTestAuthHeaders) {
      const testIdentity = headerIdentity(request.headers['x-officer-id']);
      if (testIdentity) return testIdentity;
    }
    if (!options.officerSessionSecret) return null;
    const token = readOfficerSessionCookie(request.headers.cookie);
    return verifyOfficerSession(token, options.officerSessionSecret);
  };

  const citizenIdentity = (request: FastifyRequest): string | null => {
    if (options.allowTestAuthHeaders) {
      const testIdentity = headerIdentity(request.headers['x-citizen-id']);
      if (testIdentity) return testIdentity;
    }
    if (!options.citizenSessionSecret) return null;
    return verifyCitizenSession(readCitizenSessionCookie(request.headers.cookie), options.citizenSessionSecret);
  };

  const workflowDisabled = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (options.enableLocalWorkflows !== false) return undefined;
    await reply.code(503).send({
      error: 'WORKFLOW_DISABLED',
      message: 'Workflow nghiệp vụ local đang tắt.',
    });
  };

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/v1/auth/officer/login', { preHandler: workflowDisabled }, async (request, reply) => {
    if (!options.officerSessionSecret) {
      return reply.code(503).send({ error: 'AUTH_NOT_CONFIGURED', message: 'Xác thực cán bộ chưa được cấu hình.' });
    }
    const username = text(request.body?.username, 3, 100);
    const password = passwordText(request.body?.password, 8, 200);
    if (!username || !password) {
      return reply.code(400).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
    }
    const configuredCredential = authenticateOfficer(options.officerCredentials ?? [], username, password);
    const storedCredential = configuredCredential ? null : await repository.findOfficerAccountByUsername(username);
    const credential = configuredCredential ?? (storedCredential && await verifyPassword(password, storedCredential.passwordHash)
      ? { username: storedCredential.username, password: '', actorId: storedCredential.actorId }
      : null);
    if (!credential) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    const actors = await repository.listWorkflowActors(credential.actorId);
    const actor = actors.find((candidate) => candidate.id === credential.actorId);
    if (!actor) return reply.code(403).send({ error: 'ACTOR_DISABLED', message: 'Tài khoản cán bộ không còn hiệu lực.' });
    const token = createOfficerSession(actor.id, options.officerSessionSecret);
    reply.header('Set-Cookie', officerSessionCookie(token, options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return { data: actor, meta: localWorkflowMeta };
  });

  app.get('/v1/auth/officer/session', { preHandler: workflowDisabled }, async (request, reply) => {
    const actorId = officerIdentity(request);
    if (!actorId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Phiên đăng nhập đã hết hạn.' });
    const actors = await repository.listWorkflowActors(actorId);
    const actor = actors.find((candidate) => candidate.id === actorId);
    if (!actor) return reply.code(403).send({ error: 'ACTOR_DISABLED', message: 'Tài khoản cán bộ không còn hiệu lực.' });
    reply.header('Cache-Control', 'no-store');
    return { data: actor, meta: localWorkflowMeta };
  });

  app.post('/v1/auth/officer/logout', async (_request, reply) => {
    reply.header('Set-Cookie', clearOfficerSessionCookie(options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/v1/auth/citizen/login', { preHandler: workflowDisabled }, async (request, reply) => {
    if (!options.citizenSessionSecret) {
      return reply.code(503).send({ error: 'CITIZEN_AUTH_NOT_CONFIGURED', message: 'Đăng nhập người dân chưa được cấu hình.' });
    }
    const username = text(request.body?.username, 3, 100);
    const password = passwordText(request.body?.password, 8, 200);
    if (!username || !password) return reply.code(400).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
    const configuredCredential = authenticateCitizen(options.citizenCredentials ?? [], username, password);
    const storedCredential = configuredCredential ? null : await repository.findCitizenAccountByUsername(username);
    const credential = configuredCredential ?? (storedCredential && await verifyPassword(password, storedCredential.passwordHash)
      ? { username: storedCredential.username, password: '', citizenId: storedCredential.id, displayName: storedCredential.displayName }
      : null);
    if (!credential) return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    const token = createCitizenSession(credential.citizenId, options.citizenSessionSecret);
    reply.header('Set-Cookie', citizenSessionCookie(token, options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return { data: { id: credential.citizenId, displayName: credential.displayName } };
  });

  app.post<{ Body: { username?: unknown; displayName?: unknown; password?: unknown } }>('/v1/auth/citizen/register', { preHandler: workflowDisabled }, async (request, reply) => {
    if (!options.citizenSessionSecret) {
      return reply.code(503).send({ error: 'CITIZEN_AUTH_NOT_CONFIGURED', message: 'Đăng ký người dân chưa được cấu hình.' });
    }
    const now = Date.now();
    if (registrationAttempts.size > 10_000) {
      for (const [ip, attempts] of registrationAttempts) {
        if (!attempts.some((timestamp) => now - timestamp < 10 * 60_000)) registrationAttempts.delete(ip);
      }
    }
    const recentAttempts = (registrationAttempts.get(request.ip) ?? []).filter((timestamp) => now - timestamp < 10 * 60_000);
    if (recentAttempts.length >= 5) {
      reply.header('Retry-After', '600');
      return reply.code(429).send({ error: 'REGISTRATION_RATE_LIMITED', message: 'Bạn đã thử đăng ký quá nhiều lần. Vui lòng thử lại sau 10 phút.' });
    }
    registrationAttempts.set(request.ip, [...recentAttempts, now]);

    const username = text(request.body?.username, 10, 10);
    const displayName = text(request.body?.displayName, 2, 100);
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!username || !/^0\d{9}$/.test(username)) {
      return reply.code(400).send({ error: 'INVALID_PHONE', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.' });
    }
    if (!displayName) {
      return reply.code(400).send({ error: 'INVALID_DISPLAY_NAME', message: 'Họ tên phải có từ 2 đến 100 ký tự.' });
    }
    if (password.length < 10 || password.length > 200 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return reply.code(400).send({ error: 'WEAK_PASSWORD', message: 'Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.' });
    }
    const conflictsWithConfigured = options.citizenCredentials?.some(
      (candidate) => candidate.username.toLocaleLowerCase('vi-VN') === username.toLocaleLowerCase('vi-VN'),
    );
    if (conflictsWithConfigured || await repository.findCitizenAccountByUsername(username)) {
      return reply.code(409).send({ error: 'ACCOUNT_EXISTS', message: 'Số điện thoại này đã có tài khoản. Hãy đăng nhập hoặc dùng số khác.' });
    }
    const passwordHash = await hashPassword(password);
    const account = await repository.createCitizenAccount({
      id: `citizen-${randomUUID()}`,
      username,
      displayName,
      passwordHash,
    });
    if (!account) {
      return reply.code(409).send({ error: 'ACCOUNT_EXISTS', message: 'Số điện thoại này đã có tài khoản. Hãy đăng nhập hoặc dùng số khác.' });
    }
    const token = createCitizenSession(account.id, options.citizenSessionSecret);
    reply.header('Set-Cookie', citizenSessionCookie(token, options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send({ data: { id: account.id, displayName: account.displayName } });
  });

  app.get('/v1/auth/citizen/session', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const configuredCredential = options.citizenCredentials?.find((candidate) => candidate.citizenId === citizenId);
    const storedCredential = configuredCredential ? null : await repository.findCitizenAccountById(citizenId);
    if (!configuredCredential && !storedCredential && !options.allowTestAuthHeaders) return reply.code(403).send({ error: 'CITIZEN_ACCOUNT_DISABLED', message: 'Tài khoản người dân không còn hiệu lực.' });
    reply.header('Cache-Control', 'no-store');
    return { data: { id: citizenId, displayName: configuredCredential?.displayName ?? storedCredential?.displayName ?? 'Người dân kiểm thử' } };
  });

  app.post('/v1/auth/citizen/logout', async (_request, reply) => {
    reply.header('Set-Cookie', clearCitizenSessionCookie(options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  app.post<{ Body: Record<string, unknown> }>('/v1/citizen/incidents', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập trước khi gửi phản ánh.' });
    const body = request.body ?? {};
    const latitude = parseCoordinate(body.latitude, -90, 90);
    const longitude = parseCoordinate(body.longitude, -180, 180);
    const clientRequestId = text(body.clientRequestId, 8, 100);
    const category = typeof body.category === 'string' && incidentCategories.has(body.category) ? body.category : null;
    const summary = text(body.summary, 10, 180);
    const description = text(body.description, 10, 4000);
    const locationNote = optionalText(body.locationNote, 500);
    const contactPhone = parsePhone(body.contactPhone);
    const accuracyM = parseAccuracy(body.accuracyM);
    const attachments = parseIncidentAttachments(body.attachments);
    if (contactPhone === undefined) {
      return reply.code(400).send({ error: 'INVALID_CONTACT_PHONE', message: 'Số liên hệ phải gồm 8–15 chữ số; có thể dùng dấu cách, dấu chấm hoặc dấu gạch ngang.' });
    }
    if (!attachments) {
      return reply.code(400).send({ error: 'INVALID_ATTACHMENT', message: 'Minh chứng phải là ảnh JPEG/PNG/WebP tối đa 5 MB hoặc video MP4/WebM tối đa 20 MB.' });
    }
    if (latitude === null || longitude === null || !clientRequestId || !category || !summary || !description || locationNote === undefined || accuracyM === undefined) {
      return reply.code(400).send({ error: 'INVALID_INCIDENT', message: 'Thông tin phản ánh chưa đầy đủ hoặc không hợp lệ.' });
    }
    const input: CreateIncidentInput = {
      clientRequestId,
      category: category as CreateIncidentInput['category'],
      summary,
      description,
      locationNote,
      contactPhone,
      latitude,
      longitude,
      accuracyM,
      attachments,
    };
    const result = await repository.createIncident(citizenId, input);
    return reply.code(201).send({ data: result, meta: localWorkflowMeta });
  });

  app.get('/v1/citizen/incidents', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    return { data: await repository.listCitizenIncidents(citizenId), meta: localWorkflowMeta };
  });

  app.get<{ Params: { receiptCode: string } }>('/v1/citizen/incidents/:receiptCode', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const result = await repository.getCitizenIncident(citizenId, request.params.receiptCode);
    if (!result) return reply.code(404).send({ error: 'INCIDENT_NOT_FOUND', message: 'Không tìm thấy phản ánh.' });
    return { data: result, meta: localWorkflowMeta };
  });

  app.get<{ Params: { receiptCode: string } }>('/v1/citizen/incidents/:receiptCode/messages', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    return { data: await repository.listCitizenIncidentMessages(citizenId, request.params.receiptCode), meta: localWorkflowMeta };
  });

  app.post<{ Params: { receiptCode: string }; Body: { message?: unknown } }>('/v1/citizen/incidents/:receiptCode/messages', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const message = text(request.body?.message, 2, 2000);
    if (!message) return reply.code(400).send({ error: 'INVALID_MESSAGE', message: 'Nội dung trao đổi phải từ 2 đến 2.000 ký tự.' });
    return reply.code(201).send({ data: await repository.addCitizenIncidentMessage(citizenId, request.params.receiptCode, message), meta: localWorkflowMeta });
  });

  app.post<{ Params: { receiptCode: string }; Body: { attachment?: unknown } }>('/v1/citizen/incidents/:receiptCode/attachments', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const attachment = parseIncidentAttachments([request.body?.attachment]);
    if (!attachment) return reply.code(400).send({ error: 'INVALID_ATTACHMENT', message: 'Tệp bổ sung không hợp lệ hoặc vượt giới hạn dung lượng.' });
    return reply.code(201).send({ data: await repository.addCitizenIncidentAttachment(citizenId, request.params.receiptCode, attachment[0]!), meta: localWorkflowMeta });
  });

  app.get<{ Params: { receiptCode: string; attachmentId: string } }>('/v1/citizen/incidents/:receiptCode/attachments/:attachmentId/content', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const file = await repository.getCitizenIncidentAttachment(citizenId, request.params.receiptCode, request.params.attachmentId);
    if (!file) return reply.code(404).send({ error: 'ATTACHMENT_NOT_FOUND', message: 'Không tìm thấy tệp minh chứng.' });
    return reply.type(file.mimeType).header('Cache-Control', 'private, no-store').send(file.content);
  });

  app.post<{ Params: { receiptCode: string }; Body: { score?: unknown; comment?: unknown } }>('/v1/citizen/incidents/:receiptCode/rating', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const score = Number(request.body?.score);
    const comment = optionalText(request.body?.comment, 1000);
    if (!Number.isInteger(score) || score < 1 || score > 5 || comment === undefined) {
      return reply.code(400).send({ error: 'INVALID_RATING', message: 'Điểm đánh giá phải từ 1 đến 5.' });
    }
    return reply.code(201).send({ data: await repository.createSatisfactionRating(citizenId, request.params.receiptCode, score, comment), meta: localWorkflowMeta });
  });

  app.post<{ Body: Record<string, unknown> }>('/v1/citizen/sos', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const body = request.body ?? {};
    const latitude = parseCoordinate(body.latitude, -90, 90);
    const longitude = parseCoordinate(body.longitude, -180, 180);
    const idempotencyKey = text(body.idempotencyKey, 8, 100);
    const category = typeof body.category === 'string' && sosCategories.has(body.category) ? body.category : null;
    const note = optionalText(body.note, 500);
    const contactPhone = parsePhone(body.contactPhone);
    const accuracyM = parseAccuracy(body.accuracyM);
    const deviceTimestamp = parseDeviceTimestamp(body.deviceTimestamp);
    if (latitude === null || longitude === null || !idempotencyKey || !category || note === undefined || contactPhone === undefined || accuracyM === undefined || !deviceTimestamp) {
      return reply.code(400).send({ error: 'INVALID_SOS', message: 'Thông tin SOS chưa đầy đủ hoặc không hợp lệ.' });
    }
    const input: CreateSosInput = {
      idempotencyKey,
      category: category as CreateSosInput['category'],
      note,
      contactPhone,
      latitude,
      longitude,
      accuracyM,
      deviceTimestamp,
    };
    const result = await repository.createSos(citizenId, input);
    return reply.code(201).send({ data: result, meta: localWorkflowMeta });
  });

  app.get('/v1/citizen/sos', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    return { data: await repository.listCitizenSos(citizenId), meta: localWorkflowMeta };
  });

  app.get<{ Params: { receiptCode: string } }>('/v1/citizen/sos/:receiptCode', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập để xem yêu cầu SOS.' });
    const result = await repository.getCitizenSos(citizenId, request.params.receiptCode);
    if (!result) return reply.code(404).send({ error: 'SOS_NOT_FOUND', message: 'Không tìm thấy yêu cầu SOS thuộc tài khoản này.' });
    reply.header('Cache-Control', 'private, no-store');
    return { data: result, meta: localWorkflowMeta };
  });

  app.post<{ Params: { receiptCode: string }; Body: { note?: unknown } }>('/v1/citizen/sos/:receiptCode/cancel', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const note = text(request.body?.note, 3, 300) ?? 'Người dân hủy trước khi cán bộ xác nhận tiếp nhận.';
    return { data: await repository.cancelCitizenSos(citizenId, request.params.receiptCode, note), meta: localWorkflowMeta };
  });

  app.get<{ Querystring: { kind?: string } }>('/v1/officer/queue', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const kind = request.query.kind === 'incident' || request.query.kind === 'sos' ? request.query.kind : undefined;
    return { data: await repository.listOfficerQueue(officerId, kind), meta: localWorkflowMeta };
  });

  app.get('/v1/officer/actors', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.listWorkflowActors(officerId), meta: localWorkflowMeta };
  });

  app.get<{ Querystring: { cursor?: string; limit?: string; unread?: string } }>('/v1/citizen/notifications', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập để xem thông báo.' });
    const limit = request.query.limit === undefined ? 30 : Number(request.query.limit);
    const cursor = request.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && !/^(incident|sos|message):[a-zA-Z0-9-]{1,100}$/.test(cursor)) || ![undefined, '0', '1'].includes(request.query.unread)) {
      return reply.code(400).send({ error: 'INVALID_QUERY', message: 'Bộ lọc thông báo không hợp lệ.' });
    }
    reply.header('Cache-Control', 'private, no-store');
    return { data: await repository.listCitizenNotifications(citizenId, { limit, cursor, unreadOnly: request.query.unread === '1' }) };
  });

  app.post<{ Body: { ids?: unknown } }>('/v1/citizen/notifications/read', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập để cập nhật thông báo.' });
    const ids = request.body?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !/^(incident|sos|message):[a-zA-Z0-9-]{1,100}$/.test(id))) {
      return reply.code(400).send({ error: 'INVALID_NOTIFICATION_IDS', message: 'Danh sách thông báo không hợp lệ.' });
    }
    return { data: { updated: await repository.markCitizenNotificationsRead(citizenId, [...new Set(ids)]) } };
  });

  app.get('/v1/officer/notifications', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.listOfficerNotifications(officerId), meta: localWorkflowMeta };
  });

  app.post<{ Body: Record<string, unknown> }>('/v1/officer/alerts', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const title = text(request.body?.title, 5, 160);
    const summary = text(request.body?.summary, 10, 1200);
    const category = typeof request.body?.category === 'string' && alertCategories.has(request.body.category) ? request.body.category : null;
    const riskLevel = typeof request.body?.riskLevel === 'string' && alertRiskLevels.has(request.body.riskLevel) ? request.body.riskLevel : null;
    const latitude = request.body?.latitude == null ? null : parseCoordinate(request.body.latitude, -90, 90);
    const longitude = request.body?.longitude == null ? null : parseCoordinate(request.body.longitude, -180, 180);
    const startsAt = typeof request.body?.startsAt === 'string' && Number.isFinite(Date.parse(request.body.startsAt)) ? new Date(request.body.startsAt).toISOString() : null;
    const endsAt = typeof request.body?.endsAt === 'string' && Number.isFinite(Date.parse(request.body.endsAt)) ? new Date(request.body.endsAt).toISOString() : null;
    if (!title || !summary || !category || !riskLevel || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt) || (latitude === null) !== (longitude === null)) {
      return reply.code(400).send({ error: 'INVALID_ALERT', message: 'Thông tin cảnh báo chưa đầy đủ hoặc thời gian không hợp lệ.' });
    }
    const data = await repository.createPublicAlert(officerId, {
      title, summary, category: category as 'security' | 'traffic' | 'fire_rescue' | 'weather' | 'other',
      riskLevel: riskLevel as 'info' | 'medium' | 'high', latitude, longitude, startsAt, endsAt,
    });
    return reply.code(201).send({ data, meta: localWorkflowMeta });
  });

  app.get('/v1/officer/patrols', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.listPatrolSessions(officerId), meta: localWorkflowMeta };
  });

  app.post<{ Body: Record<string, unknown> }>('/v1/officer/patrols', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const title = text(request.body?.title, 5, 160);
    const routeNote = optionalText(request.body?.routeNote, 1000);
    const scheduledAt = typeof request.body?.scheduledAt === 'string' && Number.isFinite(Date.parse(request.body.scheduledAt)) ? new Date(request.body.scheduledAt).toISOString() : null;
    if (!title || routeNote === undefined || !scheduledAt) return reply.code(400).send({ error: 'INVALID_PATROL', message: 'Thông tin lịch tuần tra chưa hợp lệ.' });
    return reply.code(201).send({ data: await repository.createPatrolSession(officerId, title, routeNote, scheduledAt), meta: localWorkflowMeta });
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/v1/officer/patrols/:id/actions', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const action = typeof request.body?.action === 'string' && patrolActions.has(request.body.action) ? request.body.action as 'start' | 'pause' | 'resume' | 'checkin' | 'complete' : null;
    const latitude = request.body?.latitude == null ? null : parseCoordinate(request.body.latitude, -90, 90);
    const longitude = request.body?.longitude == null ? null : parseCoordinate(request.body.longitude, -180, 180);
    if (!action || (action === 'checkin' && (latitude === null || longitude === null))) return reply.code(400).send({ error: 'INVALID_PATROL_ACTION', message: 'Thao tác hoặc tọa độ check-in không hợp lệ.' });
    return { data: await repository.updatePatrolSession(officerId, request.params.id, action, latitude, longitude), meta: localWorkflowMeta };
  });

  app.get('/v1/officer/shift-summary', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.getShiftSummary(officerId), meta: localWorkflowMeta };
  });

  app.post<{ Body: { note?: unknown } }>('/v1/officer/shift-reports', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const note = optionalText(request.body?.note, 2000);
    if (note === undefined) return reply.code(400).send({ error: 'INVALID_SHIFT_REPORT', message: 'Ghi chú báo cáo không hợp lệ.' });
    return reply.code(201).send({ data: await repository.confirmShiftReport(officerId, note), meta: localWorkflowMeta });
  });

  app.get<{ Querystring: { period?: string; date?: string } }>('/v1/officer/statistics', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const period = request.query.period && statisticsPeriods.has(request.query.period) ? request.query.period as import('./types.js').StatisticsPeriod : 'day';
    const anchorDate = typeof request.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.query.date) && Number.isFinite(Date.parse(`${request.query.date}T00:00:00Z`))
      ? request.query.date : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    return { data: await repository.getOfficerStatistics(officerId, period, anchorDate), meta: localWorkflowMeta };
  });

  app.get('/v1/officer/map-points', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.listOperationalMapPoints(officerId), meta: localWorkflowMeta };
  });

  app.post<{ Body: Record<string, unknown> }>('/v1/officer/map-points', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const input = parseOperationalMapPoint(request.body ?? {});
    if (!input) return reply.code(400).send({ error: 'INVALID_MAP_POINT', message: 'Thông tin điểm bản đồ hoặc tọa độ chưa hợp lệ.' });
    return reply.code(201).send({ data: await repository.createOperationalMapPoint(officerId, input), meta: localWorkflowMeta });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/v1/officer/map-points/:id', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const input = parseOperationalMapPoint(request.body ?? {});
    if (!input) return reply.code(400).send({ error: 'INVALID_MAP_POINT', message: 'Thông tin điểm bản đồ hoặc tọa độ chưa hợp lệ.' });
    return { data: await repository.updateOperationalMapPoint(officerId, request.params.id, input), meta: localWorkflowMeta };
  });

  app.delete<{ Params: { id: string } }>('/v1/officer/map-points/:id', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    await repository.deleteOperationalMapPoint(officerId, request.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/v1/officer/incidents/:id', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const result = await repository.getOfficerIncident(officerId, request.params.id);
    if (!result) return reply.code(404).send({ error: 'INCIDENT_NOT_FOUND', message: 'Không tìm thấy phản ánh trong địa bàn.' });
    return { data: result, meta: localWorkflowMeta };
  });

  app.get<{ Params: { id: string } }>('/v1/officer/incidents/:id/messages', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    return { data: await repository.listOfficerIncidentMessages(officerId, request.params.id), meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/v1/officer/incidents/:id/messages', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const message = text(request.body?.message, 2, 2000);
    if (!message) return reply.code(400).send({ error: 'INVALID_MESSAGE', message: 'Nội dung trao đổi phải từ 2 đến 2.000 ký tự.' });
    return reply.code(201).send({ data: await repository.addOfficerIncidentMessage(officerId, request.params.id, message, request.body?.requestMedia === true), meta: localWorkflowMeta });
  });

  app.post<{ Params: { id: string }; Body: { attachment?: unknown } }>('/v1/officer/incidents/:id/attachments', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const attachment = parseIncidentAttachments([request.body?.attachment]);
    if (!attachment) return reply.code(400).send({ error: 'INVALID_ATTACHMENT', message: 'Tệp minh chứng không hợp lệ hoặc vượt giới hạn dung lượng.' });
    return reply.code(201).send({ data: await repository.addOfficerIncidentAttachment(officerId, request.params.id, attachment[0]!), meta: localWorkflowMeta });
  });

  app.get<{ Params: { id: string; attachmentId: string } }>('/v1/officer/incidents/:id/attachments/:attachmentId/content', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const file = await repository.getOfficerIncidentAttachment(officerId, request.params.id, request.params.attachmentId);
    if (!file) return reply.code(404).send({ error: 'ATTACHMENT_NOT_FOUND', message: 'Không tìm thấy tệp minh chứng.' });
    return reply.type(file.mimeType).header('Cache-Control', 'private, no-store').send(file.content);
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/v1/officer/incidents/:id/transitions', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const toStatus = typeof request.body?.toStatus === 'string' && incidentStatuses.has(request.body.toStatus)
      ? request.body.toStatus as IncidentStatus
      : null;
    const note = text(request.body?.note, 8, 500);
    const assignedOfficerId = optionalText(request.body?.assignedOfficerId, 80);
    const publicMessage = request.body?.publicMessage === true;
    if (!toStatus || !note || assignedOfficerId === undefined) return reply.code(400).send({ error: 'INVALID_TRANSITION', message: 'Trạng thái hoặc ghi chú xử lý không hợp lệ; ghi chú phải có ít nhất 8 ký tự.' });
    if (['resolved', 'closed', 'rejected'].includes(toStatus) && note.trim().length < 20) {
      return reply.code(400).send({ error: 'INVALID_TRANSITION', message: 'Kết quả, đóng hoặc từ chối hồ sơ phải có ghi chú ít nhất 20 ký tự để đủ căn cứ nghiệp vụ.' });
    }
    return { data: await repository.transitionIncident(officerId, request.params.id, toStatus, note, assignedOfficerId, publicMessage), meta: localWorkflowMeta };
  });

  app.get<{ Params: { id: string } }>('/v1/officer/sos/:id', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const result = await repository.getOfficerSos(officerId, request.params.id);
    if (!result) return reply.code(404).send({ error: 'SOS_NOT_FOUND', message: 'Không tìm thấy SOS trong địa bàn.' });
    return { data: result, meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/v1/officer/sos/:id/transitions', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const toStatus = typeof request.body?.toStatus === 'string' && sosStatuses.has(request.body.toStatus)
      ? request.body.toStatus as SosStatus
      : null;
    const note = text(request.body?.note, 8, 500);
    const assignedOfficerId = optionalText(request.body?.assignedOfficerId, 80);
    const publicMessage = request.body?.publicMessage === true;
    if (!toStatus || !note || assignedOfficerId === undefined) return reply.code(400).send({ error: 'INVALID_TRANSITION', message: 'Trạng thái hoặc ghi chú xử lý không hợp lệ; ghi chú phải có ít nhất 8 ký tự.' });
    if (['resolved', 'closed'].includes(toStatus) && note.trim().length < 20) {
      return reply.code(400).send({ error: 'INVALID_TRANSITION', message: 'Kết quả hoặc đóng SOS phải có ghi chú ít nhất 20 ký tự để đủ căn cứ nghiệp vụ.' });
    }
    return { data: await repository.transitionSos(officerId, request.params.id, toStatus, note, assignedOfficerId, publicMessage), meta: localWorkflowMeta };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WorkflowError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'INVALID_TRANSITION' ? 409 : 400;
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
