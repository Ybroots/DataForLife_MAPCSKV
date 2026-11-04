/** Tiêu đề hiển thị cho yêu cầu SOS: "SOS - tên - SĐT". */
export function sosTitle(name: string | null | undefined, phone: string | null | undefined): string {
  const who = name?.trim() || 'Người dân';
  const tel = phone?.trim();
  return tel ? `SOS - ${who} - ${tel}` : `SOS - ${who}`;
}
