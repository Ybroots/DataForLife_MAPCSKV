import type { CreateIncidentInput, CreateSosInput } from './types.js';
import { AttemptWindow } from './rate-limit.js';
import {
  incidentCategories,
  optionalText,
  parseAccuracy,
  parseCoordinate,
  parseDeviceTimestamp,
  parseIncidentAttachments,
  parsePhone,
  sosCategories,
  text,
} from './request-parsing.js';
import type { RouteContext } from './route-context.js';

/** Phản ánh, SOS, trao đổi, đánh giá và thông báo của người dân đã đăng nhập, kèm giới hạn gửi. */
export function registerCitizenRoutes({ app, repository, options, localWorkflowMeta, citizenIdentity, workflowDisabled }: RouteContext): void {
  const clock = options.limits?.clock ?? Date.now;
  const sosWindow = new AttemptWindow(options.limits?.sosPerWindow ?? 5, 10 * 60_000, clock);
  const incidentWindow = new AttemptWindow(options.limits?.incidentsPerWindow ?? 10, 60 * 60_000, clock);

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
    if (!incidentWindow.has(citizenId, clientRequestId)) {
      const wait = incidentWindow.retryAfterSeconds(citizenId);
      if (wait) {
        reply.header('Retry-After', String(wait));
        return reply.code(429).send({
          error: 'INCIDENT_RATE_LIMITED',
          message: 'Tài khoản đã gửi quá nhiều phản ánh trong 1 giờ. Vui lòng thử lại sau hoặc gọi hotline của địa bàn.',
        });
      }
      incidentWindow.record(citizenId, clientRequestId);
    }
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
    if (!sosWindow.has(citizenId, idempotencyKey)) {
      const wait = sosWindow.retryAfterSeconds(citizenId);
      if (wait) {
        reply.header('Retry-After', String(wait));
        return reply.code(429).send({
          error: 'SOS_RATE_LIMITED',
          message: 'Tài khoản đã gửi quá nhiều yêu cầu SOS trong thời gian ngắn. Nếu đang nguy hiểm, hãy gọi trực tiếp 112 hoặc 113.',
        });
      }
      sosWindow.record(citizenId, idempotencyKey);
    }
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

  app.post<{ Params: { receiptCode: string }; Body: { note?: unknown } }>('/v1/citizen/sos/:receiptCode/safe', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const note = text(request.body?.note, 3, 300) ?? 'Người gửi báo đã an toàn. Cán bộ cần xác minh trước khi đóng.';
    return reply.code(201).send({ data: await repository.reportCitizenSosSafe(citizenId, request.params.receiptCode, note), meta: localWorkflowMeta });
  });

  app.post<{ Params: { receiptCode: string }; Body: { note?: unknown } }>('/v1/citizen/incidents/:receiptCode/withdraw', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const note = text(request.body?.note, 3, 300) ?? 'Người dân rút phản ánh trước khi được phân công xử lý.';
    return { data: await repository.withdrawCitizenIncident(citizenId, request.params.receiptCode, note), meta: localWorkflowMeta };
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
}
