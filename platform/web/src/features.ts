export type FeatureId = 'directory' | 'alerts' | 'reports' | 'sos' | 'feedback' | 'assistant' | 'account';

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
