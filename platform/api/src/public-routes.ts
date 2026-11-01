import { parseCoordinate, text } from './request-parsing.js';
import type { RouteContext } from './route-context.js';

/** Dữ liệu công khai: địa bàn, tra cứu theo mã hoặc vị trí, danh bạ, cảnh báo công khai. Không cần đăng nhập. */
export function registerPublicRoutes({ app, repository, options }: RouteContext): void {
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
    // Không truyền areaCode: trả các cảnh báo công khai đang hiệu lực toàn tỉnh (bản đồ khi chưa chọn địa bàn).
    const raw = request.query.areaCode;
    const areaCode = raw === undefined ? undefined : text(raw, 3, 80);
    if (raw !== undefined && !areaCode) return reply.code(400).send({ error: 'INVALID_AREA_CODE', message: 'Mã địa bàn không hợp lệ.' });
    return { data: await repository.listPublicAlerts(areaCode ?? undefined) };
  });

  app.get('/v1/public/duty-coverage', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return { data: { localityCodes: await repository.listDutyLocalityCodes() } };
  });
}
