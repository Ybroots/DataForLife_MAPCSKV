import {
  alertCategories,
  alertRiskLevels,
  optionalText,
  parseCoordinate,
  parseIsoTimestamp,
  parseOperationalMapPoint,
  patrolActions,
  statisticsPeriods,
  text,
} from './request-parsing.js';
import type { RouteContext } from './route-context.js';

/** Việc vận hành của cán bộ: thông báo, cảnh báo công khai, tuần tra, báo cáo ca, thống kê, điểm bản đồ. */
export function registerOfficerOperationsRoutes({ app, repository, localWorkflowMeta, officerIdentity, workflowDisabled }: RouteContext): void {
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
    const startsAt = parseIsoTimestamp(request.body?.startsAt);
    const endsAt = parseIsoTimestamp(request.body?.endsAt);
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
    const scheduledAt = parseIsoTimestamp(request.body?.scheduledAt);
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

  app.get<{ Querystring: { period?: string; date?: string } }>('/v1/officer/reports/cases', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const period = request.query.period && statisticsPeriods.has(request.query.period) ? request.query.period as import('./types.js').StatisticsPeriod : 'day';
    const anchorDate = typeof request.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.query.date) && Number.isFinite(Date.parse(`${request.query.date}T00:00:00Z`))
      ? request.query.date : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    return { data: await repository.listReportCases(officerId, period, anchorDate), meta: localWorkflowMeta };
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
}
