import { generateReadablePassword } from './generate-password.js';
import { revokeOfficerSessions } from './officer-auth.js';
import { hashPassword } from './password.js';
import { passwordText, statisticsPeriods } from './request-parsing.js';
import type { RouteContext } from './route-context.js';
import type { StatisticsPeriod, UpdateManagedOfficerInput } from './types.js';

const OFFICER_USERNAME_PATTERN = /^[a-z0-9._-]{3,100}$/;
const OFFICER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/;

const VIETNAM_OFFSET_MS = 7 * 60 * 60_000;

/** Mốc đầu và cuối kỳ theo giờ Việt Nam (UTC+7, không có giờ mùa hè), trả về dạng ISO UTC. */
export function periodBounds(period: StatisticsPeriod, anchorDate: string): { from: string; to: string } {
  const [year, month, day] = anchorDate.split('-').map(Number) as [number, number, number];
  const start = period === 'day' ? Date.UTC(year, month - 1, day)
    : period === 'month' ? Date.UTC(year, month - 1, 1)
      : Date.UTC(year, 0, 1);
  const end = period === 'day' ? Date.UTC(year, month - 1, day + 1)
    : period === 'month' ? Date.UTC(year, month, 1)
      : Date.UTC(year + 1, 0, 1);
  return { from: new Date(start - VIETNAM_OFFSET_MS).toISOString(), to: new Date(end - VIETNAM_OFFSET_MS).toISOString() };
}

/** Màn hình chỉ huy: các khu vực của phường, cán bộ phụ trách và đánh giá của người dân. Chỉ đọc. */
export function registerCommanderRoutes({ app, repository, options, localWorkflowMeta, officerIdentity, workflowDisabled }: RouteContext): void {
  app.get<{ Querystring: { period?: string; date?: string } }>('/v1/commander/area-officers', { preHandler: workflowDisabled }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const { period: rawPeriod, date } = request.query;
    if ((rawPeriod !== undefined && !statisticsPeriods.has(rawPeriod))
      || (date !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))))) {
      return reply.code(400).send({ error: 'INVALID_PERIOD', message: 'Kỳ báo cáo không hợp lệ.' });
    }
    const period = (rawPeriod ?? 'month') as StatisticsPeriod;
    const anchorDate = date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const { from, to } = periodBounds(period, anchorDate);
    return { data: await repository.listAreaOfficerOverview(officerId, from, to), meta: localWorkflowMeta };
  });

  // Quản lý tài khoản cán bộ cùng phường. Chỉ chỉ huy (kho dữ liệu kiểm tra); không bao giờ trả mật khẩu cũ hay bản băm.
  const requireSession = (request: Parameters<typeof officerIdentity>[0]) => officerIdentity(request);
  const sessionRequired = { error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' };

  app.get('/v1/commander/officers', { preHandler: workflowDisabled }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = requireSession(request);
    if (!officerId) return reply.code(401).send(sessionRequired);
    return { data: await repository.listManagedOfficers(officerId), meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string }; Body: { username?: unknown; serviceAreaCode?: unknown } }>('/v1/commander/officers/:id/update', { preHandler: workflowDisabled, bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = requireSession(request);
    if (!officerId) return reply.code(401).send(sessionRequired);
    if (!OFFICER_ID_PATTERN.test(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy cán bộ trong phường.' });
    const body = request.body ?? {};
    const input: UpdateManagedOfficerInput = {};
    if (body.username !== undefined) {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!OFFICER_USERNAME_PATTERN.test(username)) {
        return reply.code(400).send({ error: 'INVALID_USERNAME', message: 'Tên đăng nhập dài 3–100 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới và gạch ngang.' });
      }
      input.username = username;
    }
    if (body.serviceAreaCode !== undefined) {
      if (body.serviceAreaCode !== null && (typeof body.serviceAreaCode !== 'string' || body.serviceAreaCode.length < 1 || body.serviceAreaCode.length > 40)) {
        return reply.code(400).send({ error: 'INVALID_AREA', message: 'Khu vực không hợp lệ.' });
      }
      input.serviceAreaCode = body.serviceAreaCode;
    }
    if (input.username === undefined && input.serviceAreaCode === undefined) {
      return reply.code(400).send({ error: 'NOTHING_TO_UPDATE', message: 'Chưa có thay đổi nào để lưu.' });
    }
    const reserved = (options.officerCredentials ?? []).map((credential) => credential.username.toLocaleLowerCase('vi-VN'));
    const result = await repository.updateManagedOfficer(officerId, request.params.id, input, reserved);
    if (result.usernameChanged) revokeOfficerSessions(request.params.id);
    return { data: result.officer, meta: localWorkflowMeta };
  });

  app.post<{ Params: { id: string }; Body: { password?: unknown; generate?: unknown } }>('/v1/commander/officers/:id/password', { preHandler: workflowDisabled, bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = requireSession(request);
    if (!officerId) return reply.code(401).send(sessionRequired);
    if (!OFFICER_ID_PATTERN.test(request.params.id)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy cán bộ trong phường.' });
    const body = request.body ?? {};
    const generate = body.generate === true;
    const typed = passwordText(body.password, 8, 200);
    if (generate === (body.password !== undefined)) {
      return reply.code(400).send({ error: 'INVALID_PASSWORD_REQUEST', message: 'Hãy nhập mật khẩu mới hoặc chọn tạo mật khẩu tự động.' });
    }
    if (!generate && !typed) return reply.code(400).send({ error: 'WEAK_PASSWORD', message: 'Mật khẩu cần ít nhất 8 ký tự.' });
    const password = generate ? generateReadablePassword() : typed as string;
    const officer = await repository.setManagedOfficerPasswordHash(officerId, request.params.id, await hashPassword(password));
    revokeOfficerSessions(request.params.id);
    // Mật khẩu tự tạo chỉ có trong phản hồi này; mật khẩu do chỉ huy nhập thì không trả lại.
    return { data: officer, ...(generate ? { generatedPassword: password } : {}), meta: localWorkflowMeta };
  });
}
