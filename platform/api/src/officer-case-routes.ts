import type { IncidentStatus, SosStatus } from './workflow.js';
import { incidentStatuses, optionalText, parseIncidentAttachments, sosStatuses, text } from './request-parsing.js';
import type { RouteContext } from './route-context.js';

/** Hàng đợi và xử lý hồ sơ của cán bộ: phản ánh, SOS, trao đổi, minh chứng, chuyển trạng thái. */
export function registerOfficerCaseRoutes({ app, repository, localWorkflowMeta, officerIdentity, workflowDisabled }: RouteContext): void {
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
}
