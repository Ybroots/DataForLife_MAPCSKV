/** Ảnh chụp từ điện thoại thường 8–20 MB, hàng chục megapixel: đưa thẳng vào <img> hoặc gửi lên đều làm treo trang. */
export const MAX_IMAGE_SIDE = 1920;
const JPEG_QUALITY = 0.82;
// Ảnh nhỏ hơn mức này không cần xử lý (không thể là ảnh cực lớn).
const SKIP_BELOW_BYTES = 600 * 1024;

/** Kích thước mới sao cho cạnh dài nhất không quá `max`, giữ tỉ lệ; không phóng to. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY));
}

/**
 * Thu nhỏ + nén ảnh trước khi xem trước/gửi. Video và ảnh nhỏ giữ nguyên.
 * Ném lỗi (thông điệp tiếng Việt) nếu ảnh quá lớn mà không xử lý được.
 */
export async function prepareImage(file: File, hardLimitBytes: number): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('unsupported');
    // Giải mã trực tiếp ở cỡ nhỏ để không nạp nguyên ảnh hàng chục megapixel vào bộ nhớ.
    const first = await createImageBitmap(file, { resizeWidth: MAX_IMAGE_SIDE, resizeQuality: 'medium' });
    const size = fitWithin(first.width, first.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) { first.close(); throw new Error('no-canvas'); }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(first, 0, 0, size.width, size.height);
    first.close();
    const blob = await canvasToJpeg(canvas);
    canvas.width = 0; canvas.height = 0;
    if (!blob) throw new Error('encode');
    // Đã nhỏ sẵn thì giữ ảnh gốc để không giảm chất lượng vô ích.
    if (blob.size >= file.size && file.size <= hardLimitBytes) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'anh-hien-truong';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    if (file.size <= hardLimitBytes) return file;
    throw new Error('Không xử lý được ảnh này. Hãy chọn ảnh khác hoặc chụp lại ở chất lượng thấp hơn.');
  }
}
