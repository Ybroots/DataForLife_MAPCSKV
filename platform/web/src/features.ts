export type FeatureId = 'directory' | 'alerts' | 'reports' | 'sos' | 'feedback' | 'assistant' | 'account';

export interface DemoAlert {
  id: string;
  title: string;
  category: 'An ninh trật tự' | 'Giao thông';
  summary: string;
  latitude: number;
  longitude: number;
  activeWindow: string;
}

export const DEMO_ALERTS: DemoAlert[] = [
  {
    id: 'alert-demo-theft',
    title: 'Lưu ý bảo quản tài sản',
    category: 'An ninh trật tự',
    summary: 'Khu vực đông người; chủ động bảo quản điện thoại, ví và phương tiện cá nhân.',
    latitude: 11.9428,
    longitude: 108.4389,
    activeWindow: 'Minh họa · 06:00–22:00',
  },
  {
    id: 'alert-demo-traffic',
    title: 'Mật độ giao thông tăng',
    category: 'Giao thông',
    summary: 'Dự kiến đông phương tiện vào khung giờ cao điểm; ưu tiên lộ trình thay thế.',
    latitude: 11.9467,
    longitude: 108.4446,
    activeWindow: 'Minh họa · 16:30–18:30',
  },
];

export const FEATURE_LABELS: Record<FeatureId, string> = {
  directory: 'Bản đồ & danh bạ',
  alerts: 'Cảnh báo khu vực',
  reports: 'Phản ánh kiến nghị',
  sos: 'SOS khẩn cấp',
  feedback: 'Đánh giá hài lòng',
  assistant: 'Trợ lý AI',
  account: 'Tài khoản',
};

export const featureDescriptions: Record<FeatureId, string> = {
  directory: 'Danh bạ cơ quan và ranh giới phục vụ của Công an cấp xã.',
  alerts: 'Thông tin cảnh báo an ninh, giao thông từ cổng CSKV cho vị trí hiện tại.',
  reports: 'Luồng gửi phản ánh có ghi nhận vị trí và hình ảnh hiện trường.',
  sos: 'Luồng khẩn cấp có bước kiểm tra cuối, mã tiếp nhận và đồng bộ trạng thái từ cổng CSKV.',
  feedback: 'Chỉ cho phép đánh giá sau khi mã vụ việc được xác nhận hoàn thành.',
  assistant: 'Tìm địa bàn, danh bạ và cảnh báo công khai bằng câu hỏi tự nhiên.',
  account: 'Quản lý phiên đăng nhập, phản ánh và các tùy chọn hỗ trợ người dân.',
};
