import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer {
  readonly kind: 'smtp' | 'console' | 'memory';
  send(message: MailMessage): Promise<void>;
}

/** Hộp thư trong bộ nhớ, dùng cho kiểm thử. */
export class MemoryMailer implements Mailer {
  readonly kind = 'memory' as const;
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> { this.sent.push(message); }
}

/** In nội dung thư ra console của API: chỉ để thử trên máy cá nhân, không bao giờ bật trên máy chủ thật. */
export class ConsoleMailer implements Mailer {
  readonly kind = 'console' as const;
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(message: MailMessage): Promise<void> {
    this.log(`[EMAIL THỬ] Gửi tới ${message.to}\nChủ đề: ${message.subject}\n${message.text}\n`);
  }
}

const ADDRESS = /^[^\s<>"',;:\\()[\]@]+@[^\s<>"',;:\\()[\]@]+\.[^\s<>"',;:\\()[\]@]+$/;

/** Chuẩn hóa địa chỉ email người dân nhập; trả null nếu không hợp lệ (cấm ký tự xuống dòng để chống chèn tiêu đề thư). */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  return value.length <= 254 && ADDRESS.test(value) ? value : null;
}

/** Che bớt địa chỉ khi hiển thị: ab***@gmail.com. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***@${domain}`;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true: TLS ngay khi kết nối (cổng 465). false: bắt đầu thường rồi nâng cấp bằng STARTTLS (cổng 587). */
  secure: boolean;
  user?: string;
  password?: string;
  /** Địa chỉ người gửi, ví dụ `Bản đồ số CSKV <no-reply@bandosocskv.com>`. */
  from: string;
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
  heloName?: string;
}

const isLoopback = (host: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);

function parseFrom(from: string): { name: string; address: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (match?.[2]) return { name: (match[1] ?? '').trim(), address: match[2] };
  const bare = from.trim();
  if (ADDRESS.test(bare)) return { name: '', address: bare };
  throw new Error('Địa chỉ người gửi (API_MAIL_FROM) không hợp lệ.');
}

function buildMessage(config: SmtpConfig, message: MailMessage, from: { name: string; address: string }): string {
  const domain = from.address.split('@')[1] ?? 'localhost';
  const display = from.name ? `${encodeHeader(from.name)} <${from.address}>` : from.address;
  const body = Buffer.from(message.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${display}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Một phiên SMTP ngắn: kết nối, (STARTTLS), đăng nhập, gửi một thư rồi thoát. */
class SmtpSession {
  private socket!: net.Socket;
  private lines: string[] = [];
  private waiter: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;
  private partial = '';

  constructor(private readonly config: SmtpConfig) {}

  private attach(socket: net.Socket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.config.timeoutMs ?? 15_000, () => this.fail(new Error('SMTP quá thời gian chờ.')));
    socket.on('data', (chunk: string) => {
      this.partial += chunk;
      const parts = this.partial.split('\r\n');
      this.partial = parts.pop() ?? '';
      for (const line of parts) {
        if (this.waiter) { const { resolve } = this.waiter; this.waiter = null; resolve(line); } else this.lines.push(line);
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP đóng kết nối sớm.')));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    if (this.waiter) { const { reject } = this.waiter; this.waiter = null; reject(this.failure); }
  }

  private nextLine(): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  private async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      lines.push(line);
      if (/^\d{3}( |$)/.test(line)) return { code: Number(line.slice(0, 3)), lines };
      if (!/^\d{3}-/.test(line)) throw new Error('Phản hồi SMTP không hợp lệ.');
    }
  }

  private async command(line: string, ok: number[], secret = false): Promise<{ code: number; lines: string[] }> {
    this.socket.write(`${line}\r\n`);
    const answer = await this.reply();
    if (!ok.includes(answer.code)) throw new Error(`SMTP từ chối ${secret ? 'thông tin đăng nhập' : line.split(' ')[0]} (mã ${answer.code}).`);
    return answer;
  }

  private connect(): Promise<void> {
    const { host, port, secure, rejectUnauthorized = true } = this.config;
    return new Promise((resolve, reject) => {
      const socket = secure
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized }, () => resolve())
        : net.connect({ host, port }, () => resolve());
      socket.once('error', reject);
      this.attach(socket);
    });
  }

  private upgradeToTls(): Promise<void> {
    const { host, rejectUnauthorized = true } = this.config;
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('close');
    plain.removeAllListeners('error');
    this.lines = []; this.partial = '';
    return new Promise((resolve, reject) => {
      const secured = tls.connect({ socket: plain, servername: net.isIP(host) ? undefined : host, rejectUnauthorized }, () => resolve());
      secured.once('error', reject);
      this.attach(secured);
    });
  }

  async send(message: MailMessage): Promise<void> {
    const { host, secure, user, password } = this.config;
    const from = parseFrom(this.config.from);
    if (normalizeEmail(message.to) !== message.to.toLowerCase()) throw new Error('Địa chỉ nhận không hợp lệ.');
    const helo = this.config.heloName ?? 'localhost';
    await this.connect();
    try {
      const greeting = await this.reply();
      if (greeting.code !== 220) throw new Error(`SMTP chưa sẵn sàng (mã ${greeting.code}).`);
      let capabilities = (await this.command(`EHLO ${helo}`, [250])).lines.join('\n').toUpperCase();
      let encrypted = secure;
      if (!secure && capabilities.includes('STARTTLS')) {
        await this.command('STARTTLS', [220]);
        await this.upgradeToTls();
        encrypted = true;
        capabilities = (await this.command(`EHLO ${helo}`, [250])).lines.join('\n').toUpperCase();
      }
      // Thư chứa mã xác minh: không gửi qua đường không mã hóa, trừ khi máy chủ SMTP là chính máy này.
      if (!encrypted && !isLoopback(host)) throw new Error('Từ chối gửi qua SMTP không mã hóa (cần cổng 465 hoặc STARTTLS).');
      if (user) {
        if (capabilities.includes('PLAIN')) {
          await this.command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password ?? ''}`, 'utf8').toString('base64')}`, [235], true);
        } else if (capabilities.includes('LOGIN')) {
          await this.command('AUTH LOGIN', [334]);
          await this.command(Buffer.from(user, 'utf8').toString('base64'), [334], true);
          await this.command(Buffer.from(password ?? '', 'utf8').toString('base64'), [235], true);
        } else throw new Error('Máy chủ SMTP không hỗ trợ đăng nhập PLAIN/LOGIN.');
      }
      await this.command(`MAIL FROM:<${from.address}>`, [250]);
      await this.command(`RCPT TO:<${message.to}>`, [250, 251]);
      await this.command('DATA', [354]);
      this.socket.write(`${buildMessage(this.config, message, from)}\r\n.\r\n`);
      const accepted = await this.reply();
      if (accepted.code !== 250) throw new Error(`SMTP không nhận thư (mã ${accepted.code}).`);
      try { await this.command('QUIT', [221]); } catch { /* bỏ qua lỗi khi đóng phiên */ }
    } finally {
      this.socket.destroy();
    }
  }
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  parseFrom(config.from);
  return {
    kind: 'smtp',
    send: (message) => new SmtpSession(config).send(message),
  };
}

/**
 * Cấu hình gửi email từ biến môi trường. Trả null nếu chưa cấu hình (chức năng email ghi rõ là chưa kết nối).
 *   API_SMTP_HOST, API_SMTP_PORT (465 hoặc 587), API_SMTP_SECURE (true/false, mặc định true với cổng 465),
 *   API_SMTP_USER, API_SMTP_PASSWORD, API_MAIL_FROM.
 *   API_MAIL_TRANSPORT=console chỉ để thử trên máy cá nhân (in thư ra console), bị bỏ qua khi NODE_ENV=production.
 */
export function createMailerFromEnv(env: NodeJS.ProcessEnv, log: (message: string) => void = console.error): Mailer | null {
  if (env.API_MAIL_TRANSPORT === 'console') {
    if (env.NODE_ENV === 'production') { log('API_MAIL_TRANSPORT=console bị bỏ qua vì đang chạy production.'); return null; }
    return new ConsoleMailer();
  }
  const host = env.API_SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.API_SMTP_PORT) || 465;
  const from = (env.API_MAIL_FROM || env.API_SMTP_USER || '').trim();
  try {
    return createSmtpMailer({
      host, port,
      secure: env.API_SMTP_SECURE ? env.API_SMTP_SECURE === 'true' : port === 465,
      user: env.API_SMTP_USER?.trim() || undefined,
      password: env.API_SMTP_PASSWORD || undefined,
      from,
      rejectUnauthorized: env.API_SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      heloName: env.API_SMTP_HELO_NAME?.trim() || undefined,
    });
  } catch (error) {
    log(`Email bị tắt: ${error instanceof Error ? error.message : 'cấu hình SMTP không hợp lệ'}`);
    return null;
  }
}
