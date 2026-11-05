import { randomInt } from 'node:crypto';

/** Bảng ký tự bỏ các chữ dễ nhầm: 0/O/o và 1/l/I. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** Mật khẩu dễ đọc cho cán bộ: 12 ký tự, luôn có cả chữ và số, không có 0/O/o, 1/l/I. */
export function generateReadablePassword(length = 12): string {
  const alphabet = LETTERS + DIGITS;
  const pick = (source: string) => source[randomInt(0, source.length)] as string;
  const chars = [pick(LETTERS), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(alphabet));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [chars[index], chars[swap]] = [chars[swap] as string, chars[index] as string];
  }
  return chars.join('');
}
