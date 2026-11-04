import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AttemptWindow } from './rate-limit.js';
import type { PushStore } from './push.js';

export interface PushRouteOptions {
  store: PushStore;
  /** true khi máy chủ đã có khóa FCM và thực sự gửi được thông báo. */
  enabled: boolean;
  /** Mã tài khoản người dân của phiên hiện tại, hoặc null nếu chưa đăng nhập. */
  citizenIdentity(request: FastifyRequest): string | null;
  /** Mã tài khoản cán bộ của phiên hiện tại, hoặc null. */
  officerIdentity?(request: FastifyRequest): string | null;
  clock?: () => number;
  /** Số lần đăng ký/gỡ thiết bị tối đa mỗi IP trong 10 phút. */
  perWindow?: number;
}

// Mã FCM gồm chữ, số, ':', '_', '-'. Giới hạn độ dài để không lưu dữ liệu tùy ý.
const TOKEN_PATTERN = /^[\w:.-]{20,4096}$/;
const AREA_PATTERN = /^[\w-]{3,80}$/;
export const MAX_FOLLOWED_AREAS = 5;

export function registerPushRoutes(app: FastifyInstance, options: PushRouteOptions): void {
  const attempts = new AttemptWindow(options.perWindow ?? 30, 10 * 60_000, options.clock);

  const limited = (request: FastifyRequest): number => {
    const wait = attempts.retryAfterSeconds(request.ip);
    if (!wait) attempts.record(request.ip);
    return wait;
  };

  app.get('/v1/push/status', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { data: { enabled: options.enabled } };
  });

  app.post<{ Body: { token?: unknown; areaCodes?: unknown } }>('/v1/push/devices', { bodyLimit: 8192 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const wait = limited(request);
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'PUSH_RATE_LIMITED', message: 'Thiết lập thông báo quá nhiều lần. Vui lòng thử lại sau.' });
    }
    const { token, areaCodes } = request.body ?? {};
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)
      || !Array.isArray(areaCodes) || areaCodes.length > MAX_FOLLOWED_AREAS
      || areaCodes.some((code) => typeof code !== 'string' || !AREA_PATTERN.test(code))) {
      return reply.code(400).send({ error: 'INVALID_PUSH_DEVICE', message: 'Thông tin thiết bị nhận thông báo không hợp lệ.' });
    }
    await options.store.upsertDevice({
      token,
      citizenId: options.citizenIdentity(request),
      areaCodes: [...new Set(areaCodes as string[])],
    });
    return { data: { registered: true, enabled: options.enabled } };
  });

  // Thiết bị của cán bộ: cần phiên cán bộ, nhận SOS và phản ánh mới tại địa bàn mình phụ trách.
  app.post<{ Body: { token?: unknown } }>('/v1/push/officer-devices', { bodyLimit: 8192 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const officerId = options.officerIdentity?.(request) ?? null;
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const wait = limited(request);
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'PUSH_RATE_LIMITED', message: 'Thiết lập thông báo quá nhiều lần. Vui lòng thử lại sau.' });
    }
    const { token } = request.body ?? {};
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      return reply.code(400).send({ error: 'INVALID_PUSH_DEVICE', message: 'Thông tin thiết bị nhận thông báo không hợp lệ.' });
    }
    await options.store.upsertDevice({ token, citizenId: null, officerId, areaCodes: [] });
    return { data: { registered: true, enabled: options.enabled } };
  });

  app.post<{ Body: { token?: unknown } }>('/v1/push/devices/remove', { bodyLimit: 8192 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const wait = limited(request);
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'PUSH_RATE_LIMITED', message: 'Thiết lập thông báo quá nhiều lần. Vui lòng thử lại sau.' });
    }
    const { token } = request.body ?? {};
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      return reply.code(400).send({ error: 'INVALID_PUSH_DEVICE', message: 'Thông tin thiết bị nhận thông báo không hợp lệ.' });
    }
    // Biết mã thiết bị (bí mật của chính thiết bị đó) là đủ để gỡ; không cần phiên đăng nhập.
    return { data: { removed: await options.store.removeDevice(token) } };
  });
}
