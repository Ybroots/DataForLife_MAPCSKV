import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import * as maplibregl from '../maplibre-runtime';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lookupByCode } from '../api';
import { pointInBoundary } from '../citizen-map-points';
import { readDevicePosition, supportsDeviceLocation } from '../device-location';
import { addOffshorePlaceLabels, createPublicMapStyle } from '../map-style';
import type { AreaLookup } from '../types';

export interface AlertPoint { latitude: number; longitude: number }

interface AlertLocationPickerProps {
  localityCode: string | null;
  /** Vị trí có sẵn khi sửa cảnh báo; ghim hiện ngay tại đó và có thể kéo đi chỗ khác. */
  initialPoint?: AlertPoint | null;
  /** Called with a point that lies inside the officer's locality, or null while there is none. */
  onChange: (point: AlertPoint | null) => void;
}

const BOUNDARY_SOURCE_ID = 'alert-picker-boundary';

function parseCoordinate(text: string, min: number, max: number): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function collectBounds(input: unknown, bounds: maplibregl.LngLatBounds): void {
  if (!Array.isArray(input)) return;
  if (input.length === 2 && input.every((value) => typeof value === 'number')) {
    bounds.extend(input as [number, number]);
    return;
  }
  for (const item of input) collectBounds(item, bounds);
}

/**
 * Lets an officer place a public alert by clicking the map, dragging the pin or typing coordinates.
 * The two inputs and the map always show the same point; the parent only ever receives a valid point
 * inside the officer's own locality (the API enforces the same rule).
 */
export function AlertLocationPicker({ localityCode, initialPoint = null, onChange }: AlertLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [mapReady, setMapReady] = useState(false);
  const [area, setArea] = useState<AreaLookup | null>(null);
  const [areaFailed, setAreaFailed] = useState(false);
  const [latText, setLatText] = useState(() => initialPoint ? initialPoint.latitude.toFixed(6) : '');
  const [lngText, setLngText] = useState(() => initialPoint ? initialPoint.longitude.toFixed(6) : '');
  const [gpsMessage, setGpsMessage] = useState('');
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const point = useMemo<AlertPoint | null>(() => {
    const latitude = parseCoordinate(latText, -90, 90);
    const longitude = parseCoordinate(lngText, -180, 180);
    return latitude === null || longitude === null ? null : { latitude, longitude };
  }, [latText, lngText]);
  const hasText = latText.trim() !== '' || lngText.trim() !== '';
  const outside = Boolean(point && area?.boundary && !pointInBoundary(point.longitude, point.latitude, area.boundary));

  useEffect(() => { onChangeRef.current(point && !outside ? point : null); }, [point, outside]);

  const place = (latitude: number, longitude: number) => {
    setLatText(latitude.toFixed(6));
    setLngText(longitude.toFixed(6));
    setGpsMessage('');
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [108.441, 11.944],
      zoom: 13,
      attributionControl: false,
      style: createPublicMapStyle(),
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.getCanvas().style.cursor = 'crosshair';
    map.on('load', () => {
      addOffshorePlaceLabels(map);
      map.addSource(BOUNDARY_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'alert-picker-boundary-line', type: 'line', source: BOUNDARY_SOURCE_ID, paint: { 'line-color': '#d71935', 'line-width': 3 } });
      setMapReady(true);
    });
    map.on('click', (event) => {
      setLatText(event.lngLat.lat.toFixed(6));
      setLngText(event.lngLat.lng.toFixed(6));
      setGpsMessage('');
    });
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    setArea(null);
    setAreaFailed(false);
    if (!localityCode) return undefined;
    let cancelled = false;
    void lookupByCode(localityCode)
      .then((payload) => { if (!cancelled) setArea(payload.data); })
      .catch(() => { if (!cancelled) setAreaFailed(true); });
    return () => { cancelled = true; };
  }, [localityCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !area?.boundary) return;
    (map.getSource(BOUNDARY_SOURCE_ID) as GeoJSONSource | undefined)?.setData({ type: 'Feature', properties: {}, geometry: area.boundary });
    const bounds = new maplibregl.LngLatBounds();
    collectBounds(area.boundary.coordinates, bounds);
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 36, duration: 450, maxZoom: 15 });
  }, [area, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!point) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = new maplibregl.Marker({ draggable: true, color: '#d71935' }).setLngLat([point.longitude, point.latitude]).addTo(map);
      marker.on('dragend', () => {
        const next = marker.getLngLat();
        setLatText(next.lat.toFixed(6));
        setLngText(next.lng.toFixed(6));
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([point.longitude, point.latitude]);
    }
    if (!map.getBounds().contains([point.longitude, point.latitude])) map.easeTo({ center: [point.longitude, point.latitude], duration: 350 });
  }, [point, mapReady]);

  const useMyPosition = () => {
    if (!supportsDeviceLocation()) { setGpsMessage('Thiết bị không hỗ trợ GPS.'); return; }
    setGpsBusy(true);
    setGpsMessage('');
    readDevicePosition(
      (position) => { place(position.coords.latitude, position.coords.longitude); setGpsBusy(false); },
      () => { setGpsMessage('Không đọc được vị trí. Hãy bấm vào bản đồ hoặc nhập tọa độ.'); setGpsBusy(false); },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const status = outside
    ? 'Vị trí nằm ngoài ranh địa bàn của bạn. Hãy chọn lại trong đường viền đỏ.'
    : hasText && !point
      ? 'Tọa độ chưa hợp lệ. Nhập vĩ độ và kinh độ dạng số thập phân, ví dụ 11.944000 và 108.441000.'
      : point
        ? 'Cảnh báo sẽ hiện tại điểm này trên bản đồ người dân. Có thể kéo ghim để chỉnh.'
        : areaFailed
          ? 'Chưa tải được ranh địa bàn; máy chủ vẫn kiểm tra vị trí khi phát hành.'
          : 'Bấm vào bản đồ hoặc nhập tọa độ để chọn vị trí cảnh báo.';

  return (
    <div className="alert-location-picker">
      <div className="alert-picker-head"><strong>Vị trí cảnh báo</strong><small>Bắt buộc</small></div>
      <div ref={containerRef} className="alert-picker-map" role="application" aria-label="Bản đồ chọn vị trí cảnh báo" />
      <div className="form-grid">
        <label>Vĩ độ<input inputMode="decimal" value={latText} onChange={(event) => { setLatText(event.target.value); setGpsMessage(''); }} placeholder="11.944000" autoComplete="off" aria-invalid={hasText && !point} /></label>
        <label>Kinh độ<input inputMode="decimal" value={lngText} onChange={(event) => { setLngText(event.target.value); setGpsMessage(''); }} placeholder="108.441000" autoComplete="off" aria-invalid={hasText && !point} /></label>
      </div>
      <div className="alert-picker-actions">
        <button type="button" onClick={useMyPosition} disabled={gpsBusy}><LocateFixed size={16} aria-hidden="true" /> {gpsBusy ? 'Đang lấy vị trí…' : 'Dùng vị trí của tôi'}</button>
        {hasText && <button type="button" onClick={() => { setLatText(''); setLngText(''); setGpsMessage(''); }}>Xóa vị trí</button>}
      </div>
      <p className={`alert-picker-note${outside || (hasText && !point) ? ' warning' : ''}`} role="status">{gpsMessage || status}</p>
    </div>
  );
}
