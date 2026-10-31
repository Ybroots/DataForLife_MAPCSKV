/**
 * LocationService — adapter GPS cho mobile
 *
 * Bọc expo-location để:
 * - Xin quyền đúng cách (chỉ foreground, không xin background)
 * - Xử lý từ chối, GPS tắt, timeout
 * - Cung cấp một điểm duy nhất để lấy vị trí trong toàn app
 *
 * Theo tài liệu hướng dẫn:
 * - Bản đầu chỉ định vị khi đang dùng chức năng; không xin quyền theo dõi nền
 * - Có trạng thái từ chối quyền/GPS tắt/timeout và cách thử lại
 */

import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';

export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

export type LocationError =
  | 'PERMISSION_DENIED'
  | 'GPS_DISABLED'
  | 'TIMEOUT'
  | 'UNAVAILABLE';

export class LocationServiceError extends Error {
  constructor(
    public readonly code: LocationError,
    message: string,
  ) {
    super(message);
    this.name = 'LocationServiceError';
  }
}

/**
 * Mở cài đặt để người dùng bật GPS/quyền vị trí.
 * Android: mở cài đặt ứng dụng
 * iOS: mở cài đặt vị trí
 */
export async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    await Linking.openSettings();
  } else {
    await Linking.openURL('app-settings:');
  }
}

/**
 * Lấy vị trí hiện tại.
 * Xin quyền foreground nếu chưa có.
 * Throws LocationServiceError với code cụ thể để UI xử lý.
 */
export async function getCurrentLocation(timeoutMs = 10000): Promise<LocationResult> {
  // 1. Kiểm tra và xin quyền
  const { status } = await Location.requestForegroundPermissionsAsync();

  if (status === 'denied') {
    throw new LocationServiceError(
      'PERMISSION_DENIED',
      'Ứng dụng chưa được cấp quyền truy cập vị trí.',
    );
  }

  // 2. Kiểm tra GPS/services bật không
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    throw new LocationServiceError(
      'GPS_DISABLED',
      'Dịch vụ vị trí đang tắt. Vui lòng bật GPS.',
    );
  }

  // 3. Lấy vị trí với timeout
  try {
    const location = await Promise.race<Location.LocationObject>([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new LocationServiceError('TIMEOUT', 'Lấy vị trí quá thời gian.')),
          timeoutMs,
        ),
      ),
    ]);

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyM: location.coords.accuracy,
    };
  } catch (error) {
    if (error instanceof LocationServiceError) throw error;
    throw new LocationServiceError('UNAVAILABLE', 'Không thể lấy vị trí hiện tại.');
  }
}

/**
 * Hiển thị Alert thân thiện khi có lỗi GPS.
 * Với PERMISSION_DENIED và GPS_DISABLED: có nút mở cài đặt.
 */
export function showLocationErrorAlert(error: LocationServiceError): void {
  if (error.code === 'PERMISSION_DENIED') {
    Alert.alert(
      'Cần quyền vị trí',
      'Ứng dụng cần quyền truy cập vị trí để xác định địa bàn. Vui lòng cho phép trong cài đặt.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Mở cài đặt', onPress: () => openLocationSettings() },
      ],
    );
  } else if (error.code === 'GPS_DISABLED') {
    Alert.alert(
      'GPS chưa bật',
      'Vui lòng bật dịch vụ vị trí để xác định địa bàn của bạn.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Mở cài đặt', onPress: () => openLocationSettings() },
      ],
    );
  } else if (error.code === 'TIMEOUT') {
    Alert.alert(
      'Lấy vị trí thất bại',
      'Không nhận được tín hiệu GPS. Thử ra ngoài trời hoặc khu vực thoáng hơn.',
      [{ text: 'OK' }],
    );
  } else {
    Alert.alert('Lỗi vị trí', error.message, [{ text: 'OK' }]);
  }
}
