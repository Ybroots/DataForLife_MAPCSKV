import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('vị trí Demo cố định', () => {
  it('mặc định tắt, không ảnh hưởng GPS thật', async () => {
    vi.stubEnv('VITE_DEMO_LOCATION', '');
    const mod = await import('../src/demo-location');
    expect(mod.DEMO_LOCATION_ENABLED).toBe(false);
  });

  it('bật bằng VITE_DEMO_LOCATION=true và trả vị trí cố định không hỏi GPS', async () => {
    vi.stubEnv('VITE_DEMO_LOCATION', 'true');
    const { DEMO_LOCATION_ENABLED, DEMO_POSITION } = await import('../src/demo-location');
    expect(DEMO_LOCATION_ENABLED).toBe(true);
    const { readDevicePosition, supportsDeviceLocation } = await import('../src/device-location');
    expect(supportsDeviceLocation()).toBe(true);
    const position = await new Promise<{ coords: { latitude: number; longitude: number } }>((resolve, reject) => readDevicePosition(resolve, reject));
    expect(position.coords.latitude).toBe(DEMO_POSITION.latitude);
    expect(position.coords.longitude).toBe(DEMO_POSITION.longitude);
  });
});
