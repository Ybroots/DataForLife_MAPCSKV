import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateOfficer,
  clearOfficerSessionCookie,
  createOfficerSession,
  officerSessionCookie,
  readOfficerSessionCookie,
  revokeOfficerSessionToken,
} from './officer-auth.js';
import {
  authenticateCitizen,
  citizenSessionCookie,
  clearCitizenSessionCookie,
  createCitizenSession,
  revokeCitizenSessions,
  revokeCitizenSessionToken,
  readCitizenSessionCookie,
} from './citizen-auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateRecoveryCode, normalizeRecoveryCode } from './recovery-code.js';
import { maskEmail, normalizeEmail } from './mailer.js';
import { AttemptWindow, LoginGuard } from './rate-limit.js';
import type { CitizenAccountEventType } from './types.js';
import { passwordText, text } from './request-parsing.js';
import type { RouteContext } from './route-context.js';
import { phoneFromUsername } from './account-phone.js';

/** Đăng nhập, đăng ký, phiên và đăng xuất của cán bộ và người dân, kèm giới hạn thử sai. */
export function registerAuthRoutes({ app, repository, options, localWorkflowMeta, officerIdentity, citizenIdentity, workflowDisabled }: RouteContext): void {
  const registrationAttempts = new Map<string, number[]>();
  const clock = options.limits?.clock ?? Date.now;
  const loginGuard = new LoginGuard({ accountFailures: options.limits?.loginAccountFailures, clock });
  // Đoán mã khôi phục có bộ đếm riêng, không dùng chung với đăng nhập (tránh khóa nhầm đăng nhập thường).
  const recoveryGuard = new LoginGuard({ accountFailures: options.limits?.loginAccountFailures, clock });
  let dummyHash: Promise<string> | undefined;
  /** Burns the same scrypt time for unknown usernames so response time does not reveal which accounts exist. */
  const burnPasswordCheck = async (password: string) => {
    dummyHash ??= hashPassword('khong-co-tai-khoan-nay');
    await verifyPassword(password, await dummyHash);
  };
  // Mã do cán bộ cấp: tối đa 20 mã/cán bộ/24 giờ, mỗi mã hiệu lực 24 giờ.
  const assistedResetLimit = new AttemptWindow(20, 24 * 60 * 60_000, clock);
  const ASSISTED_RESET_TTL_MS = 24 * 60 * 60_000;
  // Email: mã 6 số hiệu lực 15 phút, tối đa 5 lần nhập sai mỗi mã; giới hạn số thư gửi để chống làm phiền và tốn phí.
  const EMAIL_CODE_TTL_MS = 15 * 60_000;
  const EMAIL_CODE_MAX_ATTEMPTS = 5;
  const resetEmailPerPhone = new AttemptWindow(3, 60 * 60_000, clock);
  const resetEmailPerIp = new AttemptWindow(10, 60 * 60_000, clock);
  const verifyEmailPerCitizen = new AttemptWindow(5, 60 * 60_000, clock);
  // Chống dùng form để gửi thư rác tới một địa chỉ: tối đa 3 thư xác minh/giờ cho mỗi địa chỉ email.
  const verifyEmailPerAddress = new AttemptWindow(3, 60 * 60_000, clock);
  const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
  /** Gửi mã xác minh tới email; trả false nếu chưa kết nối, quá hạn mức hoặc gửi lỗi (không ném lỗi ra ngoài). */
  const sendEmailVerification = async (citizenId: string, email: string): Promise<boolean> => {
    const mailer = options.mailer;
    if (!mailer || verifyEmailPerAddress.retryAfterSeconds(email)) return false;
    try {
      const code = sixDigitCode();
      await repository.putCitizenEmailCode(citizenId, 'verify_email', email, await hashPassword(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
      await mailer.send({
        to: email,
        subject: 'Mã xác minh email - Bản đồ số Cảnh sát khu vực',
        text: `Mã xác minh email của bạn là: ${code}\n\nMã có hiệu lực trong 15 phút. Nhập mã này vào ứng dụng để dùng email này khi cần lấy lại mật khẩu.\nNếu bạn không yêu cầu, hãy bỏ qua thư này.\nKhông chia sẻ mã này cho bất kỳ ai.`,
      });
      verifyEmailPerAddress.record(email);
      return true;
    } catch (error) {
      app.log.warn({ err: error }, 'Không gửi được email xác minh');
      return false;
    }
  };
  const emailNotConfigured = (reply: FastifyReply) => reply.code(503).send({
    error: 'EMAIL_NOT_CONFIGURED', message: 'Chức năng email chưa được kết nối trên máy chủ này.',
  });
  /** Ghi nhật ký tài khoản; lỗi ghi nhật ký (ví dụ chưa chạy migration 016) không làm hỏng thao tác chính. */
  const auditAccount = async (citizenId: string, eventType: CitizenAccountEventType, actorId: string | null) => {
    try { await repository.recordCitizenAccountEvent(citizenId, eventType, actorId); }
    catch (error) { app.log.warn({ err: error, eventType }, 'Không ghi được nhật ký tài khoản'); }
  };
  const newRecoveryCode = async () => {
    const code = generateRecoveryCode();
    return { code, hash: await hashPassword(normalizeRecoveryCode(code) as string) };
  };
  const loginLocked = (request: FastifyRequest, reply: FastifyReply, username: string, guard: LoginGuard = loginGuard) => {
    const wait = guard.retryAfterSeconds(request.ip, username);
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

  app.post('/v1/auth/officer/logout', async (request, reply) => {
    if (options.officerSessionSecret) revokeOfficerSessionToken(readOfficerSessionCookie(request.headers.cookie), options.officerSessionSecret);
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

  app.post<{ Body: { username?: unknown; displayName?: unknown; password?: unknown; email?: unknown } }>('/v1/auth/citizen/register', { preHandler: workflowDisabled }, async (request, reply) => {
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
    // Email tùy chọn: để trống thì bỏ qua; có nhập mà sai định dạng thì báo lỗi trước khi tạo tài khoản.
    const rawEmail = request.body?.email;
    const hasEmail = rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() !== '';
    const email = hasEmail ? normalizeEmail(rawEmail) : null;
    if (hasEmail && !email) {
      return reply.code(400).send({ error: 'INVALID_EMAIL', message: 'Địa chỉ email chưa hợp lệ. Bạn có thể để trống và thêm sau trong mục Tài khoản.' });
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
    // Cấp mã khôi phục kèm tài khoản mới. Nếu máy chủ chưa chạy migration 015 thì vẫn cho đăng ký, chỉ không có mã.
    let recoveryCode: string | undefined;
    try {
      const recovery = await newRecoveryCode();
      if (await repository.setCitizenRecoveryCodeHash(account.id, recovery.hash)) recoveryCode = recovery.code;
    } catch (error) {
      app.log.warn({ err: error }, 'Không cấp được mã khôi phục khi đăng ký');
    }
    // Có nhập email: gửi mã xác minh (tốt nhất có thể, không làm hỏng việc đăng ký nếu chưa kết nối email).
    const emailVerification = email ? (await sendEmailVerification(account.id, email) ? 'sent' : 'unavailable') : undefined;
    const token = createCitizenSession(account.id, options.citizenSessionSecret);
    reply.header('Set-Cookie', citizenSessionCookie(token, options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send({ data: { id: account.id, displayName: account.displayName, ...(recoveryCode ? { recoveryCode } : {}), ...(emailVerification ? { emailVerification } : {}) } });
  });

  app.get('/v1/auth/citizen/session', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const configuredCredential = options.citizenCredentials?.find((candidate) => candidate.citizenId === citizenId);
    const storedCredential = configuredCredential ? null : await repository.findCitizenAccountById(citizenId);
    if (!configuredCredential && !storedCredential && !options.allowTestAuthHeaders) return reply.code(403).send({ error: 'CITIZEN_ACCOUNT_DISABLED', message: 'Tài khoản người dân không còn hiệu lực.' });
    reply.header('Cache-Control', 'no-store');
    return { data: { id: citizenId, displayName: configuredCredential?.displayName ?? storedCredential?.displayName ?? 'Người dân kiểm thử', phone: phoneFromUsername(configuredCredential?.username ?? storedCredential?.username) } };
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

  /** Người dân đã đăng nhập tạo (hoặc tạo lại) mã khôi phục. Mã cũ hết hiệu lực; mã mới chỉ hiện một lần trong phản hồi này. */
  app.post('/v1/auth/citizen/recovery-code', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const account = await repository.findCitizenAccountById(citizenId);
    if (!account) return reply.code(400).send({ error: 'PASSWORD_MANAGED_BY_ADMIN', message: 'Tài khoản này do quản trị hệ thống cấp, vui lòng liên hệ quản trị để cấp lại mật khẩu.' });
    const current = passwordText(((request.body ?? {}) as { currentPassword?: unknown }).currentPassword, 8, 200);
    if (!current) return reply.code(400).send({ error: 'INVALID_CREDENTIALS', message: 'Vui lòng nhập mật khẩu hiện tại.' });
    const locked = loginLocked(request, reply, account.username);
    if (locked) return locked;
    if (!await verifyPassword(current, account.passwordHash)) {
      loginGuard.recordFailure(request.ip, account.username);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Mật khẩu hiện tại không đúng.' });
    }
    loginGuard.recordSuccess(request.ip, account.username);
    try {
      const recovery = await newRecoveryCode();
      if (!await repository.setCitizenRecoveryCodeHash(account.id, recovery.hash)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
      await auditAccount(account.id, 'recovery_code_created', account.id);
      reply.header('Cache-Control', 'no-store');
      return { data: { recoveryCode: recovery.code } };
    } catch (error) {
      app.log.error({ err: error }, 'Không tạo được mã khôi phục');
      return reply.code(503).send({ error: 'RECOVERY_UNAVAILABLE', message: 'Chưa tạo được mã khôi phục lúc này. Vui lòng thử lại sau.' });
    }
  });

  /**
   * Quên mật khẩu: số điện thoại + mã khôi phục + mật khẩu mới. Mã dùng một lần (đổi mã mới sau khi thành công).
   * Mọi trường hợp sai (không có tài khoản, chưa có mã, sai mã) trả cùng một thông báo và cùng thời gian xử lý.
   */
  app.post('/v1/auth/citizen/forgot-password', { preHandler: workflowDisabled }, async (request, reply) => {
    const body = (request.body ?? {}) as { username?: unknown; recoveryCode?: unknown; newPassword?: unknown };
    const username = text(body.username, 10, 10);
    const code = normalizeRecoveryCode(body.recoveryCode);
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!username || !/^0\d{9}$/.test(username)) {
      return reply.code(400).send({ error: 'INVALID_PHONE', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.' });
    }
    if (!code) {
      return reply.code(400).send({ error: 'INVALID_RECOVERY_CODE', message: 'Mã khôi phục gồm 16 ký tự chữ và số, ví dụ ABCD-EFGH-JKMN-PQRS.' });
    }
    if (newPassword.length < 10 || newPassword.length > 200 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return reply.code(400).send({ error: 'WEAK_PASSWORD', message: 'Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.' });
    }
    const locked = loginLocked(request, reply, username, recoveryGuard);
    if (locked) return locked;
    const failed = () => {
      recoveryGuard.recordFailure(request.ip, username);
      return reply.code(401).send({ error: 'RECOVERY_FAILED', message: 'Số điện thoại hoặc mã khôi phục không đúng.' });
    };
    try {
      const account = await repository.findCitizenAccountByUsername(username);
      const storedHash = account ? await repository.getCitizenRecoveryCodeHash(account.id) : null;
      // Mã do cán bộ cấp (migration 016). Lỗi đọc (chưa migrate) coi như không có mã này, mã tự giữ vẫn dùng được.
      let assisted: { codeHash: string; expiresAt: string } | null = null;
      if (account) {
        try {
          const issued = await repository.getCitizenAssistedResetCode(account.id);
          if (issued && Date.parse(issued.expiresAt) > Date.now()) assisted = issued;
        } catch (error) { app.log.warn({ err: error }, 'Không đọc được mã đặt lại do cán bộ cấp'); }
      }
      if (!account || (!storedHash && !assisted)) { await burnPasswordCheck(code); return failed(); }
      const via = storedHash && await verifyPassword(code, storedHash) ? 'recovery'
        : assisted && await verifyPassword(code, assisted.codeHash) ? 'assisted'
          : null;
      if (!via) return failed();
      const next = await newRecoveryCode();
      const passwordHash = await hashPassword(newPassword);
      const saved = via === 'recovery'
        ? await repository.resetCitizenPasswordWithRecovery(account.id, passwordHash, next.hash, storedHash as string)
        : await repository.resetCitizenPasswordWithAssistedCode(account.id, passwordHash, next.hash, (assisted as { codeHash: string }).codeHash);
      if (!saved) return failed();
      await auditAccount(account.id, via === 'recovery' ? 'password_reset_recovery' : 'password_reset_assisted', account.id);
      revokeCitizenSessions(account.id);
      recoveryGuard.recordSuccess(request.ip, username);
      loginGuard.recordSuccess(request.ip, username);
      reply.header('Cache-Control', 'no-store');
      return { data: { recoveryCode: next.code } };
    } catch (error) {
      app.log.error({ err: error }, 'Không đặt lại được mật khẩu bằng mã khôi phục');
      return reply.code(503).send({ error: 'RECOVERY_UNAVAILABLE', message: 'Chưa đặt lại được mật khẩu lúc này. Vui lòng thử lại sau.' });
    }
  });

  /** Cho giao diện biết cách tự lấy lại mật khẩu nào đang dùng được (không phụ thuộc tài khoản nào). */
  app.get('/v1/auth/citizen/recovery-options', { preHandler: workflowDisabled }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { data: { email: Boolean(options.mailer) } };
  });

  app.get('/v1/auth/citizen/email', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const account = await repository.findCitizenAccountById(citizenId);
    let current: { email: string; verified: boolean } | null = null;
    if (account) {
      try { current = await repository.getCitizenEmail(citizenId); }
      catch (error) { app.log.warn({ err: error }, 'Không đọc được email khôi phục (chưa chạy migration 017?)'); }
    }
    reply.header('Cache-Control', 'no-store');
    return { data: { available: Boolean(options.mailer) && Boolean(account), email: current ? maskEmail(current.email) : null, verified: current?.verified ?? false } };
  });

  /** Người dân đã đăng nhập thêm email khôi phục: gửi mã 6 số tới email đó để xác minh. */
  app.post('/v1/auth/citizen/email', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    if (!options.mailer) return emailNotConfigured(reply);
    const account = await repository.findCitizenAccountById(citizenId);
    if (!account) return reply.code(400).send({ error: 'PASSWORD_MANAGED_BY_ADMIN', message: 'Tài khoản này do quản trị hệ thống cấp, không thêm được email khôi phục.' });
    const body = (request.body ?? {}) as { email?: unknown; currentPassword?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return reply.code(400).send({ error: 'INVALID_EMAIL', message: 'Địa chỉ email chưa hợp lệ.' });
    const current = passwordText(body.currentPassword, 8, 200);
    if (!current) return reply.code(400).send({ error: 'INVALID_CREDENTIALS', message: 'Vui lòng nhập mật khẩu hiện tại.' });
    const locked = loginLocked(request, reply, account.username);
    if (locked) return locked;
    if (!await verifyPassword(current, account.passwordHash)) {
      loginGuard.recordFailure(request.ip, account.username);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Mật khẩu hiện tại không đúng.' });
    }
    loginGuard.recordSuccess(request.ip, account.username);
    const wait = verifyEmailPerCitizen.retryAfterSeconds(citizenId);
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'EMAIL_RATE_LIMITED', message: 'Bạn đã yêu cầu gửi mã quá nhiều lần. Vui lòng thử lại sau.' });
    }
    verifyEmailPerCitizen.record(citizenId);
    if (verifyEmailPerAddress.retryAfterSeconds(email)) {
      return reply.code(429).send({ error: 'EMAIL_RATE_LIMITED', message: 'Đã gửi quá nhiều mã tới địa chỉ này. Vui lòng thử lại sau.' });
    }
    if (!await sendEmailVerification(citizenId, email)) {
      return reply.code(503).send({ error: 'EMAIL_SEND_FAILED', message: 'Chưa gửi được email. Hãy kiểm tra địa chỉ rồi thử lại sau.' });
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(202).send({ data: { sent: true, email: maskEmail(email) } });
  });

  app.post('/v1/auth/citizen/email/verify', { preHandler: workflowDisabled }, async (request, reply) => {
    const citizenId = citizenIdentity(request);
    if (!citizenId) return reply.code(401).send({ error: 'CITIZEN_SESSION_REQUIRED', message: 'Vui lòng đăng nhập tài khoản người dân.' });
    const code = text((request.body as { code?: unknown } | undefined)?.code, 6, 6);
    if (!code || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'EMAIL_CODE_INVALID', message: 'Mã gồm 6 chữ số.' });
    const invalid = () => reply.code(400).send({ error: 'EMAIL_CODE_INVALID', message: 'Mã không đúng hoặc đã hết hạn. Hãy yêu cầu gửi lại mã.' });
    try {
      const row = await repository.getCitizenEmailCode(citizenId, 'verify_email');
      if (!row || Date.parse(row.expiresAt) <= Date.now() || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return invalid();
      if (!await verifyPassword(code, row.codeHash)) { await repository.bumpCitizenEmailCodeAttempts(citizenId, 'verify_email'); return invalid(); }
      if (!await repository.consumeCitizenEmailCode(citizenId, 'verify_email', row.codeHash, EMAIL_CODE_MAX_ATTEMPTS)) return invalid();
      if (!await repository.setCitizenVerifiedEmail(citizenId, row.email)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
      await auditAccount(citizenId, 'email_verified', citizenId);
      reply.header('Cache-Control', 'no-store');
      return { data: { email: maskEmail(row.email), verified: true } };
    } catch (error) {
      app.log.error({ err: error }, 'Không xác minh được email');
      return reply.code(503).send({ error: 'EMAIL_UNAVAILABLE', message: 'Chưa xác minh được email lúc này. Vui lòng thử lại sau.' });
    }
  });

  /**
   * Quên mật khẩu bước 1: gửi mã 6 số tới email đã xác minh của tài khoản.
   * Luôn trả cùng một phản hồi 202 dù số điện thoại có tài khoản hay không (không lộ ai đã đăng ký); việc tra cứu và gửi thư chạy sau khi đã trả lời
   * để thời gian phản hồi không tiết lộ điều đó. Giới hạn theo số điện thoại và theo IP.
   */
  app.post('/v1/auth/citizen/forgot-password/email', { preHandler: workflowDisabled }, async (request, reply) => {
    if (!options.mailer) return emailNotConfigured(reply);
    const username = text((request.body as { username?: unknown } | undefined)?.username, 10, 10);
    if (!username || !/^0\d{9}$/.test(username)) {
      return reply.code(400).send({ error: 'INVALID_PHONE', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.' });
    }
    const wait = Math.max(resetEmailPerPhone.retryAfterSeconds(username), resetEmailPerIp.retryAfterSeconds(request.ip));
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'RESET_EMAIL_RATE_LIMITED', message: 'Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau.' });
    }
    resetEmailPerPhone.record(username);
    resetEmailPerIp.record(request.ip);
    const mailer = options.mailer;
    void (async () => {
      try {
        const account = await repository.findCitizenAccountByUsername(username);
        const email = account ? await repository.getCitizenEmail(account.id) : null;
        if (!account || !email?.verified) return;
        const code = sixDigitCode();
        await repository.putCitizenEmailCode(account.id, 'reset_password', email.email, await hashPassword(code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString());
        await mailer.send({
          to: email.email,
          subject: 'Mã đặt lại mật khẩu - Bản đồ số Cảnh sát khu vực',
          text: `Mã đặt lại mật khẩu của bạn là: ${code}\n\nMã có hiệu lực trong 15 phút và chỉ dùng được một lần.\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua thư này, mật khẩu của bạn vẫn an toàn.\nKhông chia sẻ mã này cho bất kỳ ai, kể cả người tự nhận là cán bộ.`,
        });
      } catch (error) {
        app.log.error({ err: error }, 'Không gửi được email đặt lại mật khẩu');
      }
    })();
    reply.header('Cache-Control', 'no-store');
    return reply.code(202).send({ data: { sent: true } });
  });

  /** Quên mật khẩu bước 2: nhập số điện thoại + mã từ email + mật khẩu mới. */
  app.post('/v1/auth/citizen/forgot-password/email-confirm', { preHandler: workflowDisabled }, async (request, reply) => {
    const body = (request.body ?? {}) as { username?: unknown; code?: unknown; newPassword?: unknown };
    const username = text(body.username, 10, 10);
    const code = text(body.code, 6, 6);
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!username || !/^0\d{9}$/.test(username)) {
      return reply.code(400).send({ error: 'INVALID_PHONE', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.' });
    }
    if (!code || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'RESET_CODE_INVALID', message: 'Mã gồm 6 chữ số.' });
    if (newPassword.length < 10 || newPassword.length > 200 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return reply.code(400).send({ error: 'WEAK_PASSWORD', message: 'Mật khẩu cần ít nhất 10 ký tự, gồm chữ và số.' });
    }
    const locked = loginLocked(request, reply, username, recoveryGuard);
    if (locked) return locked;
    const failed = () => {
      recoveryGuard.recordFailure(request.ip, username);
      return reply.code(401).send({ error: 'RESET_CODE_INVALID', message: 'Mã không đúng hoặc đã hết hạn. Hãy yêu cầu gửi lại mã.' });
    };
    try {
      const account = await repository.findCitizenAccountByUsername(username);
      const row = account ? await repository.getCitizenEmailCode(account.id, 'reset_password') : null;
      if (!account || !row || Date.parse(row.expiresAt) <= Date.now() || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await burnPasswordCheck(code); return failed();
      }
      if (!await verifyPassword(code, row.codeHash)) { await repository.bumpCitizenEmailCodeAttempts(account.id, 'reset_password'); return failed(); }
      if (!await repository.consumeCitizenEmailCode(account.id, 'reset_password', row.codeHash, EMAIL_CODE_MAX_ATTEMPTS)) return failed();
      if (!await repository.updateCitizenPasswordHash(account.id, await hashPassword(newPassword))) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
      }
      revokeCitizenSessions(account.id);
      await auditAccount(account.id, 'password_reset_email', account.id);
      recoveryGuard.recordSuccess(request.ip, username);
      loginGuard.recordSuccess(request.ip, username);
      reply.header('Cache-Control', 'no-store');
      return { data: { ok: true } };
    } catch (error) {
      app.log.error({ err: error }, 'Không đặt lại được mật khẩu bằng email');
      return reply.code(503).send({ error: 'RECOVERY_UNAVAILABLE', message: 'Chưa đặt lại được mật khẩu lúc này. Vui lòng thử lại sau.' });
    }
  });

  /**
   * Cán bộ cấp mã đặt lại mật khẩu cho người dân đã mất mã khôi phục. Cán bộ phải tự xác minh danh tính người dân
   * (gặp trực tiếp hoặc gọi điện) và xác nhận `verified: true`. Mã hiện một lần cho cán bộ, hiệu lực 24 giờ, dùng một lần;
   * người dân nhập mã này ở màn Quên mật khẩu như mã khôi phục. Mọi lần cấp đều được ghi nhật ký.
   */
  app.post('/v1/officer/citizen-accounts/reset-code', { preHandler: workflowDisabled }, async (request, reply) => {
    const officerId = officerIdentity(request);
    if (!officerId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Vui lòng đăng nhập lại.' });
    const body = (request.body ?? {}) as { phone?: unknown; verified?: unknown };
    const phone = text(body.phone, 10, 10);
    if (!phone || !/^0\d{9}$/.test(phone)) {
      return reply.code(400).send({ error: 'INVALID_PHONE', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.' });
    }
    if (body.verified !== true) {
      return reply.code(400).send({ error: 'IDENTITY_NOT_CONFIRMED', message: 'Cần xác nhận đã kiểm tra danh tính người dân trước khi cấp mã.' });
    }
    const wait = assistedResetLimit.retryAfterSeconds(officerId);
    if (wait) {
      reply.header('Retry-After', String(wait));
      return reply.code(429).send({ error: 'RESET_RATE_LIMITED', message: 'Đã cấp quá nhiều mã trong 24 giờ. Vui lòng liên hệ chỉ huy.' });
    }
    try {
      const recovery = await newRecoveryCode();
      const expiresAt = new Date(Date.now() + ASSISTED_RESET_TTL_MS).toISOString();
      const account = await repository.issueCitizenAssistedResetCode(phone, officerId, recovery.hash, expiresAt);
      if (!account) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: 'Không có tài khoản người dân với số điện thoại này.' });
      assistedResetLimit.record(officerId);
      await auditAccount(account.id, 'assisted_reset_issued', officerId);
      app.log.info({ officerId, citizenId: account.id }, 'Cán bộ cấp mã đặt lại mật khẩu cho người dân');
      reply.header('Cache-Control', 'no-store');
      return reply.code(201).send({ data: { recoveryCode: recovery.code, expiresAt, displayName: account.displayName, phone } });
    } catch (error) {
      app.log.error({ err: error }, 'Không cấp được mã đặt lại mật khẩu');
      return reply.code(503).send({ error: 'RESET_UNAVAILABLE', message: 'Chưa cấp được mã lúc này. Vui lòng thử lại sau.' });
    }
  });

  app.post('/v1/auth/officer/change-password', { preHandler: workflowDisabled }, async (request, reply) => {
    const actorId = officerIdentity(request);
    if (!actorId) return reply.code(401).send({ error: 'OFFICER_SESSION_REQUIRED', message: 'Phiên đăng nhập đã hết hạn.' });
    const account = await repository.findOfficerAccountById(actorId);
    return changePassword(request, reply, account ? { id: actorId, username: account.username, passwordHash: account.passwordHash } : null,
      (hash) => repository.updateOfficerPasswordHash(actorId, hash), 12);
  });

  app.post('/v1/auth/citizen/logout', async (request, reply) => {
    if (options.citizenSessionSecret) revokeCitizenSessionToken(readCitizenSessionCookie(request.headers.cookie), options.citizenSessionSecret);
    reply.header('Set-Cookie', clearCitizenSessionCookie(options.secureCookies === true));
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });
}
