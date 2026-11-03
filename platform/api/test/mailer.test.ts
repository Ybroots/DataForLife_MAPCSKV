import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { createSmtpMailer, maskEmail, normalizeEmail } from '../src/mailer.js';

/** Máy chủ SMTP giả tối thiểu: ghi lại những gì nhận được. */
async function fakeSmtp() {
  const captured = { auth: '', rcpt: '', data: '' };
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = ''; let inData = false;
    const write = (line: string) => socket.write(`${line}\r\n`);
    write('220 fake ready');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          captured.data = buffer.slice(0, end); buffer = buffer.slice(end + 5); inData = false; write('250 queued'); continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol < 0) return;
        const line = buffer.slice(0, eol); buffer = buffer.slice(eol + 2);
        const command = line.toUpperCase();
        if (command.startsWith('EHLO')) { write('250-localhost'); write('250 AUTH PLAIN'); }
        else if (command.startsWith('AUTH PLAIN')) { captured.auth = Buffer.from(line.slice(11), 'base64').toString().replace(/\0/g, '|'); write('235 ok'); }
        else if (command.startsWith('MAIL FROM')) write('250 ok');
        else if (command.startsWith('RCPT TO')) { captured.rcpt = line; write('250 ok'); }
        else if (command === 'DATA') { inData = true; write('354 go'); }
        else if (command === 'QUIT') { write('221 bye'); socket.end(); }
        else write('500 unknown');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { captured, port: (server.address() as net.AddressInfo).port, close: () => server.close() };
}

describe('SMTP mailer', () => {
  it('authenticates, sends a UTF-8 message and refuses header injection', async () => {
    const smtp = await fakeSmtp();
    try {
      const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, secure: false, user: 'user@example.vn', password: 'p@ss', from: 'Bản đồ số CSKV <no-reply@bandosocskv.com>' });
      await mailer.send({ to: 'nguoi.dan@example.com', subject: 'Mã xác minh', text: 'Mã của bạn là 123456.\nCó hiệu lực 15 phút.' });
      expect(smtp.captured.auth).toBe('|user@example.vn|p@ss');
      expect(smtp.captured.rcpt).toContain('<nguoi.dan@example.com>');
      const [head, ...rest] = smtp.captured.data.split('\r\n\r\n');
      expect(head).toContain('Content-Type: text/plain; charset=utf-8');
      expect(Buffer.from(rest.join('').replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Mã của bạn là 123456.\r\nCó hiệu lực 15 phút.');
      await expect(mailer.send({ to: 'a@b.vn\r\nBcc: x@y.vn', subject: 'x', text: 'x' })).rejects.toThrow('không hợp lệ');
    } finally { smtp.close(); }
  });

  it('refuses unencrypted SMTP to a non-local host before sending credentials', async () => {
    const mailer = createSmtpMailer({ host: '127.0.0.2', port: 9, secure: false, user: 'u', password: 'p', from: 'no-reply@example.vn' });
    await expect(mailer.send({ to: 'a@b.vn', subject: 'x', text: 'x' })).rejects.toThrow();
  });

  it('validates and masks addresses', () => {
    expect(normalizeEmail(' A@B.vn ')).toBe('a@b.vn');
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('a b@c.vn')).toBeNull();
    expect(normalizeEmail(5)).toBeNull();
    expect(maskEmail('nguyenvan@gmail.com')).toBe('ng***@gmail.com');
  });
});
