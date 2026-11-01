import type { AreaLookup } from './types';

/** Đường dẫn chỉ đường Google Maps tới trụ sở Công an của địa bàn; null khi chưa có tọa độ hoặc địa chỉ. */
export function stationDirectionsUrl(area: Pick<AreaLookup, 'station'>): string | null {
  if (!area.station) return null;
  const destination = area.station.latitude !== null && area.station.longitude !== null
    ? `${area.station.latitude},${area.station.longitude}`
    : area.station.address;
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
}
