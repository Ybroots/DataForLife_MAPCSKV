import { statisticsPeriods } from './request-parsing.js';
import type { RouteContext } from './route-context.js';
import type { StatisticsPeriod } from './types.js';

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
export function registerCommanderRoutes({ app, repository, localWorkflowMeta, officerIdentity, workflowDisabled }: RouteContext): void {
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
}
