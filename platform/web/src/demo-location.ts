/**
 * Chế độ Demo: "vị trí của tôi" luôn là điểm cố định tại phường demo (Xuân Hương), không hỏi GPS của máy.
 * Dùng để thử nghiệm khi chưa cấp được quyền vị trí hoặc đang chạy trên máy giả lập.
 * Chỉ bật khi build/chạy với VITE_DEMO_LOCATION=true: bản APK preview (scripts/build-android.ps1 tự đặt), hoặc web dev
 * (đặt VITE_DEMO_LOCATION=true trong platform/web/.env.local). Bản -Release và web chính thức không bao giờ bật.
 */
export const DEMO_LOCATION_ENABLED = import.meta.env.VITE_DEMO_LOCATION === 'true';

/** Trụ sở Công an phường Xuân Hương (Đà Lạt), nằm trong ranh địa bàn demo. */
export const DEMO_POSITION = { latitude: 11.9327, longitude: 108.4426, accuracy: 15 } as const;
