import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { readDevicePosition } from '../src/device-location';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: { checkPermissions: vi.fn(), requestPermissions: vi.fn(), getCurrentPosition: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('device location', () => {
  it('keeps browser location permissions and behavior', () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const success = vi.fn(), failure = vi.fn();
    readDevicePosition(success, failure, { timeout: 1234 });
    expect(getCurrentPosition).toHaveBeenCalledWith(success, failure, { timeout: 1234 });
    expect(Geolocation.requestPermissions).not.toHaveBeenCalled();
  });
  it('requests native permission and returns actual plugin coordinates', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    vi.mocked(Geolocation.requestPermissions).mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
    const position = { timestamp: 1, coords: { latitude: 11, longitude: 108, accuracy: 9 } };
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue(position as Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>);
    const received = await new Promise((resolve, reject) => readDevicePosition(resolve, reject));
    expect(received).toBe(position);
    expect(Geolocation.requestPermissions).toHaveBeenCalledWith({ permissions: ['location'] });
  });
  it('reports denied permission without inventing a position', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });
    vi.mocked(Geolocation.requestPermissions).mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });
    await expect(new Promise((resolve, reject) => readDevicePosition(resolve, reject))).rejects.toThrow('quyền vị trí');
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
