/** Quy tắc tên đăng nhập cán bộ, khớp với máy chủ: 3–100 ký tự, chỉ chữ thường, số, `.`, `_`, `-`. */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,100}$/;

export const OFFICER_USERNAME_HINT = '3–100 ký tự, chỉ gồm chữ thường (không dấu), số, dấu chấm, gạch dưới và gạch ngang.';
export const MIN_OFFICER_PASSWORD_LENGTH = 8;

export function isValidOfficerUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value.trim());
}

export function isValidOfficerPassword(value: string): boolean {
  return value.length >= MIN_OFFICER_PASSWORD_LENGTH && value.length <= 200;
}

/** Mã khu vực trong ô chọn; chuỗi rỗng nghĩa là "Chưa gắn khu vực" (thấy cả phường). */
export function areaCodeFromSelect(value: string): string | null {
  return value === '' ? null : value;
}
