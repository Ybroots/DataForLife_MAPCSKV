import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateOfficer,
  clearOfficerSessionCookie,
  createOfficerSession,
  officerSessionCookie,
} from './officer-auth.js';
import {
  authenticateCitizen,
  citizenSessionCookie,
  clearCitizenSessionCookie,
  createCitizenSession,
} from './citizen-auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { LoginGuard } from './rate-limit.js';
import { passwordText, text } from './request-parsing.js';
import type { RouteContext } from './route-context.js';

/** Đăng nhập, đăng ký, phiên và đăng xuất của cán bộ và người dân, kèm giới hạn thử sai. */
export function registerAuthRoutes({ app, repository, options, localWorkflowMeta, officerIdentity, citizenIdentity, workflowDisabled }: RouteContext): void {
  const registrationAttempts = new Map<string, number[]>();
  const clock = options.limits?.clock ?? Date.now;
  const loginGuard = new LoginGuard({ accountFailures: options.limits?.loginAccountFailures, clock });
  let dummyHash: Promise<string> | undefined;
  /** Burns the same scrypt time for unknown usernames so response time does not reveal which accounts exist. */
  const burnPasswordCheck = async (password: string) => {
    dummyHash ??= hashPassword('khong-co-tai-khoan-nay');
    await verifyPassword(password, await dummyHash);
  };
  const loginLocked = (request: FastifyRequest, reply: FastifyReply, username: string) => {
    const wait = loginGuard.retryAfterSeconds(request.ip, username);
    if (!wait) return null;
    reply.header('Retry-After', String(wait));
    return reply.code(429).send({
      error: 'LOGIN_RATE_LIMITED',
      message: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.max(1, Math.ceil(wait / 60))} phút.`,
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
    const locked = loginLocked(request, reply, username);
    if (locked) return locked;
    const configuredCredential = authenticateOfficer(options.officerCredentials ?? [], username, password);
    const storedCredential = configuredCredential ? null : await repository.findOfficerAccountByUsername(username);
    if (!configuredCredential && !storedCredential) await burnPasswordCheck(password);
    const credential = configuredCredential ?? (storedCredential && await verifyPassword(password, storedCredential.passwordHash)
      ? { username: storedCredential.username, password: '', actorId: storedCredential.actorId }
      : null);
    if (!credential) {
      loginGuard.recordFailure(request.ip, username);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    loginGuard.recordSuccess(request.ip, username);
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
    const locked = loginLocked(request, reply, username);
    if (locked) return locked;
    const configuredCredential = authenticateCitizen(options.citizenCredentials ?? [], username, password);
    const storedCredential = configuredCredential ? null : await repository.findCitizenAccountByUsername(username);
    if (!configuredCredential && !storedCredential) await burnPasswordCheck(password);
    const credential = configuredCredential ?? (storedCredential && await verifyPassword(password, storedCredential.passwordHash)
      ? { username: storedCredential.username, password: '', citizenId: storedCredential.id, displayName: storedCredential.displayName }
      : null);
    if (!credential) {
      loginGuard.recordFailure(request.ip, username);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    loginGuard.recordSuccess(request.ip, username);
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

  /** Đổi mật khẩu cho tài khoản lưu trong CSDL; tài khoản cấu hình bằng biến môi trường phải đổi ở máy chủ. */
  async function changePassword(
    request: FastifyRequest, reply: FastifyReply,
    who: { id: string; username: string; passwordHash: string } | null,
    save: (hash: string) => Promise<boolean>,
    minimumLength: number,
  ) {
    const body = (request.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    const current = passwordText(body.currentPassword, 8, 200);
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!who) return reply.code(400).send({ error: 'PASSWORD_MANAGED_BY_ADMIN', message: 'Tài khoản này do quản trị hệ thống cấp, vui lòng liên hệ quản trị để đổi mật khẩu.' });
    if (!current) return reply.code(400).send({ error: 'INVALID_CREDENTIALS', message: 'Vui lòng nhập mật khẩu hiện tại.' });
    const locked = loginLocked(request, reply, who.username);
    if (locked) return locked;
    if (next.length < minimumLength || next.length > 200 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      return reply.code(400).send({ error: 'WEAK_PASSWORD', message: `Mật khẩu mới cần ít nhất ${minimumLength} ký tự, gồm chữ và số.` });
    }
    if (!await verifyPassword(current, who.passwordHash)) {
      loginGuard.recordFailure(request.ip, who.username);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Mật khẩu hiện tại không đúng.' });
    }
    if (current === next) return reply.code(400).send({ error: 'PASSWORD_UNCHANGED', message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
    loginGuard.recordSuccess(request.ip, who.username);
    if (!await save(await hashPassword(next))) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  }

  app.post('/v1/auth/citizen/change-password', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const account = await repository.findCitizenAccountById(citizenId);
    return changePassword(request, reply, account, (hash) => repository.updateCitizenPasswordHash(citizenId, hash), 10);
  });

  app.post('/v1/auth/officer/change-password', { preHandler: workflowDisabled }, async (request, reply) => {
    const actorId = officerIdentity(request);
    if (!actorId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Phiên đăng nhập đã hết hạn.' });
    const account = await repository.findOfficerAccountById(actorId);
    return changePassword(request, reply, account ? { id: actorId, username: account.username, passwordHash: account.passwordHash } : null,
      (hash) => repository.updateOfficerPasswordHash(actorId, hash), 12);
  });

  app.post('/v1/auth/citizen/logout', async (_request, reply) => {
    reply.header('Set-Cookie', clearCitizenSessionCookie(options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });
}
