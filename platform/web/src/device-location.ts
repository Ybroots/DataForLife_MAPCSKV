import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { DEMO_LOCATION_ENABLED, DEMO_POSITION } from './demo-location';

export type DevicePosition = { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number };
export function supportsDeviceLocation(): boolean {
  return DEMO_LOCATION_ENABLED || Capacitor.isNativePlatform() || Boolean(navigator.geolocation);
}
export function readDevicePosition(success: (position: DevicePosition) => void, failure: (error?: unknown) => void, options: PositionOptions = {}): void {
  // Chế độ Demo: trả ngay vị trí cố định, không xin quyền vị trí.
  if (DEMO_LOCATION_ENABLED) {
    setTimeout(() => success({ coords: { ...DEMO_POSITION }, timestamp: Date.now() }), 150);
    return;
  }
  if (!Capacitor.isNativePlatform()) {
    if (!navigator.geolocation) { failure(new Error('Thiết bị không hỗ trợ GPS.')); return; }
    navigator.geolocation.getCurrentPosition(success, failure, options);
    return;
  }
  void (async () => {
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      permissions = await Geolocation.requestPermissions({ permissions: ['location'] });
    }
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') throw new Error('Chưa được cấp quyền vị trí.');
    return Geolocation.getCurrentPosition({
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeout ?? 12_000, maximumAge: options.maximumAge ?? 30_000,
    });
  })().then(success, failure);
}
