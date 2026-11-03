import { randomInt } from 'node:crypto';

/** Bảng ký tự bỏ các chữ dễ nhầm (I, L, O) và số 0, 1: người dân chép tay hoặc đọc qua điện thoại vẫn đúng. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 16;

/** Mã khôi phục dạng XXXX-XXXX-XXXX-XXXX (16 ký tự, khoảng 79 bit ngẫu nhiên). */
export function generateRecoveryCode(): string {
  let raw = '';
  for (let index = 0; index < LENGTH; index += 1) raw += ALPHABET.charAt(randomInt(ALPHABET.length));
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

/** Chuẩn hóa mã người dân nhập (bỏ khoảng trắng, dấu gạch, đổi chữ hoa). Trả về null nếu sai định dạng. */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== LENGTH) return null;
  for (const character of cleaned) if (!ALPHABET.includes(character)) return null;
  return cleaned;
}
