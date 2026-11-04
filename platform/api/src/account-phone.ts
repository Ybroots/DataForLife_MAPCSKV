/** Tài khoản người dân đăng ký bằng số điện thoại 10 chữ số bắt đầu bằng 0; tên đăng nhập chính là số đó. */
export function phoneFromUsername(username: string | null | undefined): string | null {
  const value = username?.trim() ?? '';
  return /^0\d{9}$/.test(value) ? value : null;
}
