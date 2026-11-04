import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BellRing, FileWarning, LocateFixed, MapPinned, Siren } from 'lucide-react';
import * as maplibregl from '../maplibre-runtime';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getOfficerIncident, getOfficerSos, listOperationalMapPoints, listPublicAlerts, lookupByCode } from '../api';
import { addOffshorePlaceLabels, createPublicMapStyle } from '../map-style';
import type { AreaLookup, Incident, OfficerQueueItem, OperationalMapPoint, PublicAlert, SosEvent } from '../types';

interface PoliceDutyMapProps {
  active: boolean;
  localityCode: string | null;
  queue: OfficerQueueItem[];
  onBackToQueue: () => void;
  onOpenCase: (item: OfficerQueueItem) => void;
}

type WorkDetail = Incident | SosEvent;

interface DutyPoint {
  item: OfficerQueueItem;
  detail: WorkDetail;
}

const AREA_SOURCE_ID = 'duty-locality-boundary';
const SERVICE_SOURCE_ID = 'duty-service-areas';
const OUTSIDE_MASK_SOURCE_ID = 'duty-outside-mask';
const detailCache = new Map<string, { version: string; detail: WorkDetail }>();

const statusLabels: Record<string, string> = {
  submitted: 'Chờ tiếp nhận',
  received: 'Đã tiếp nhận',
  assigned: 'Đã phân công',
  verifying: 'Đang xác minh',
  processing: 'Đang xử lý',
  resolved: 'Đã có kết quả',
  closed: 'Đã đóng',
  rejected: 'Ngoài phạm vi',
  triggered: 'Vừa kích hoạt',
  dispatched: 'Chờ xác nhận',
  acknowledged: 'Đã xác nhận',
  responding: 'Đang ứng cứu',
  escalated: 'Đã chuyển tuyến',
  cancelled_by_citizen: 'Người dân đã hủy',
};

function collectBounds(input: unknown, bounds: maplibregl.LngLatBounds): void {
  if (!Array.isArray(input)) return;
  if (input.length === 2 && input.every((value) => typeof value === 'number')) {
    bounds.extend(input as [number, number]);
    return;
  }
  for (const item of input) collectBounds(item, bounds);
}

function boundaryBounds(area: AreaLookup): maplibregl.LngLatBounds | null {
  if (!area.boundary) return null;
  const bounds = new maplibregl.LngLatBounds();
  collectBounds(area.boundary.coordinates, bounds);
  return bounds.isEmpty() ? null : bounds;
}

function paddedBounds(bounds: maplibregl.LngLatBounds, ratio: number, viewportRatio: number): maplibregl.LngLatBounds {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const centerLongitude = (southWest.lng + northEast.lng) / 2;
  const centerLatitude = (southWest.lat + northEast.lat) / 2;
  let longitudeSpan = northEast.lng - southWest.lng;
  let latitudeSpan = northEast.lat - southWest.lat;
  if (longitudeSpan / latitudeSpan < viewportRatio) longitudeSpan = latitudeSpan * viewportRatio;
  else latitudeSpan = longitudeSpan / viewportRatio;
  longitudeSpan *= 1 + ratio * 2;
  latitudeSpan *= 1 + ratio * 2;
  return new maplibregl.LngLatBounds(
    [centerLongitude - longitudeSpan / 2, centerLatitude - latitudeSpan / 2],
    [centerLongitude + longitudeSpan / 2, centerLatitude + latitudeSpan / 2],
  );
}

function outsideBoundaryMask(boundary: NonNullable<AreaLookup['boundary']>) {
  const outerRings = boundary.type === 'Polygon'
    ? [boundary.coordinates[0]]
    : boundary.coordinates.map((polygon) => polygon[0]);
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
        ...outerRings.filter((ring): ring is number[][] => Boolean(ring)),
      ],
    },
  };
}

function markerIcon(kind: OfficerQueueItem['kind']): string {
  return kind === 'sos'
    ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a4 4 0 0 0-4 4v2.3c0 .9-.3 1.8-.9 2.5L5 13.5h14l-2.1-2.7a4 4 0 0 1-.9-2.5V6a4 4 0 0 0-4-4Z"/><path d="M9.8 18a2.4 2.4 0 0 0 4.4 0"/><path d="M4 7 2.5 5.5M20 7l1.5-1.5"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s7-4.8 7-12a7 7 0 1 0-14 0c0 7.2 7 12 7 12Z"/><path d="M9 10h6M12 7v6"/></svg>';
}

function popupContent(point: DutyPoint, onOpenCase: (item: OfficerQueueItem) => void): HTMLDivElement {
  const content = document.createElement('div');
  content.className = `duty-map-popup ${point.item.kind}`;

  const kind = document.createElement('span');
  kind.className = 'duty-popup-kind';
  kind.textContent = point.item.kind === 'sos' ? 'SOS KHẨN CẤP' : 'PHẢN ÁNH NGƯỜI DÂN';

  const title = document.createElement('strong');
  title.textContent = point.item.title;

  const meta = document.createElement('span');
  meta.textContent = `${point.item.receiptCode} · ${statusLabels[point.item.status] ?? point.item.status}`;

  const area = document.createElement('span');
  area.textContent = point.item.serviceAreaName ?? point.item.localityName;

  const coordinate = document.createElement('span');
  coordinate.textContent = `GPS ${point.detail.location.latitude.toFixed(6)}, ${point.detail.location.longitude.toFixed(6)}`;

  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Mở hồ sơ xử lý';
  open.addEventListener('click', () => onOpenCase(point.item), { once: true });

  content.append(kind, title, meta, area, coordinate, open);
  return content;
}

export function PoliceDutyMap({ active, localityCode, queue, onBackToQueue, onOpenCase }: PoliceDutyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const serviceLabelsRef = useRef<maplibregl.Marker[]>([]);
  const operationalMarkersRef = useRef<maplibregl.Marker[]>([]);
  const alertMarkersRef = useRef<maplibregl.Marker[]>([]);
  const onOpenCaseRef = useRef(onOpenCase);
  const [mapReady, setMapReady] = useState(false);
  const [area, setArea] = useState<AreaLookup | null>(null);
  const [points, setPoints] = useState<DutyPoint[]>([]);
  const [areaLoading, setAreaLoading] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [operationalPoints, setOperationalPoints] = useState<OperationalMapPoint[]>([]);
  const [publicAlerts, setPublicAlerts] = useState<PublicAlert[]>([]);
  const [error, setError] = useState('');
  const [viewRevision, setViewRevision] = useState(0);
  const queueVersion = queue
    .filter((item) => item.localityCode === localityCode)
    .map((item) => `${item.kind}:${item.id}:${item.updatedAt}`)
    .join('|');

  useEffect(() => {
    onOpenCaseRef.current = onOpenCase;
  }, [onOpenCase]);

  useEffect(() => {
    if (!active || !containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [108.441, 11.944],
      zoom: 12.8,
      attributionControl: false,
      style: createPublicMapStyle(),
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.on('load', () => {
      addOffshorePlaceLabels(map);
      map.addSource(AREA_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(SERVICE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(OUTSIDE_MASK_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer(
          {
            id: 'duty-outside-mask', type: 'fill', source: OUTSIDE_MASK_SOURCE_ID,
            paint: { 'fill-color': '#f7f2ee', 'fill-opacity': 0.76 },
          },
      );
      map.addLayer(
          {
            id: 'duty-area-fill', type: 'fill', source: AREA_SOURCE_ID,
            paint: { 'fill-color': '#d71935', 'fill-opacity': 0.055 },
          },
      );
      map.addLayer(
          {
            id: 'duty-service-fill', type: 'fill', source: SERVICE_SOURCE_ID,
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 },
          },
      );
      map.addLayer(
          {
            id: 'duty-service-line', type: 'line', source: SERVICE_SOURCE_ID,
            paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.95 },
          },
      );
      map.addLayer(
          {
            id: 'duty-area-line', type: 'line', source: AREA_SOURCE_ID,
            paint: { 'line-color': '#d71935', 'line-width': 3.4, 'line-opacity': 1 },
          },
      );
      setMapReady(true);
    });
    map.on('moveend', () => setViewRevision((revision) => revision + 1));
    map.on('resize', () => setViewRevision((revision) => revision + 1));
    map.on('error', (event) => {
      if (String(event.error?.message ?? event.error).includes('/planet/')) setError('Nền bản đồ chưa tải; ranh địa bàn và điểm nghiệp vụ vẫn sử dụng được.');
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      serviceLabelsRef.current.forEach((marker) => marker.remove());
      operationalMarkersRef.current.forEach((marker) => marker.remove());
      alertMarkersRef.current.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!active || !localityCode) {
      setArea(null);
      return;
    }
    let cancelled = false;
    setAreaLoading(true);
    void lookupByCode(localityCode)
      .then((payload) => {
        if (!cancelled) {
          setArea(payload.data);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Không tải được ranh địa bàn của tài khoản đang đăng nhập.');
      })
      .finally(() => {
        if (!cancelled) setAreaLoading(false);
      });
    return () => { cancelled = true; };
  }, [active, localityCode]);

  useEffect(() => {
    if (!active || !localityCode) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    const scopedQueue = queue.filter((item) => (
      item.localityCode === localityCode
      && (showCompleted || !['resolved', 'closed', 'rejected', 'cancelled_by_citizen'].includes(item.status))
    ));
    setPointsLoading(true);
    void (async () => {
      const nextPoints: DutyPoint[] = [];
      for (const item of scopedQueue) {
        if (cancelled) return;
        const key = `${item.kind}:${item.id}`;
        const cached = detailCache.get(key);
        try {
          const detail = cached?.version === item.updatedAt
            ? cached.detail
            : (item.kind === 'incident' ? await getOfficerIncident(item.id) : await getOfficerSos(item.id)).data;
          detailCache.set(key, { version: item.updatedAt, detail });
          if (Number.isFinite(detail.location.latitude) && Number.isFinite(detail.location.longitude)) {
            nextPoints.push({ item, detail });
          }
        } catch {
          // Một hồ sơ lỗi không được làm mất toàn bộ tình hình địa bàn.
        }
      }
      if (!cancelled) setPoints(nextPoints);
    })().finally(() => {
      if (!cancelled) setPointsLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, localityCode, queueVersion, showCompleted]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => void listOperationalMapPoints().then((items) => { if (!cancelled) setOperationalPoints(items.filter((item) => item.status !== 'inactive')); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active]);

  useEffect(() => {
    if (!active || !localityCode) { setPublicAlerts([]); return; }
    let cancelled = false;
    const load = () => void listPublicAlerts(localityCode)
      .then((items) => { if (!cancelled) setPublicAlerts((previous) => JSON.stringify(previous) === JSON.stringify(items) ? previous : items); })
      .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, localityCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !area?.boundary) return;
    const areaSource = map.getSource(AREA_SOURCE_ID) as GeoJSONSource | undefined;
    const serviceSource = map.getSource(SERVICE_SOURCE_ID) as GeoJSONSource | undefined;
    const outsideMaskSource = map.getSource(OUTSIDE_MASK_SOURCE_ID) as GeoJSONSource | undefined;
    areaSource?.setData({ type: 'Feature', properties: { code: area.code }, geometry: area.boundary });
    outsideMaskSource?.setData(outsideBoundaryMask(area.boundary));
    serviceSource?.setData({
      type: 'FeatureCollection',
      features: area.serviceAreas.map((serviceArea) => ({
        type: 'Feature',
        properties: { code: serviceArea.code, name: serviceArea.name, color: serviceArea.displayColor, isDemo: serviceArea.isDemo },
        geometry: serviceArea.boundary,
      })),
    });

    serviceLabelsRef.current.forEach((marker) => marker.remove());
    serviceLabelsRef.current = area.serviceAreas.map((serviceArea) => {
      const label = document.createElement('span');
      label.className = serviceArea.isDemo ? 'duty-service-label reference' : 'duty-service-label';
      label.textContent = serviceArea.legacyWardCode ? `P.${serviceArea.legacyWardCode}` : serviceArea.name;
      label.title = serviceArea.isDemo ? `${serviceArea.name} — ranh tái dựng chỉ dùng tham chiếu` : serviceArea.name;
      label.style.setProperty('--service-color', serviceArea.displayColor);
      return new maplibregl.Marker({ element: label })
        .setLngLat([serviceArea.center.longitude, serviceArea.center.latitude])
        .addTo(map);
    });

    const bounds = boundaryBounds(area);
    if (bounds) {
      map.resize();
      const container = map.getContainer();
      const viewportRatio = Math.max(0.5, container.clientWidth / Math.max(1, container.clientHeight));
      map.setMaxBounds(paddedBounds(bounds, 0.2, viewportRatio));
      map.fitBounds(bounds, {
        padding: window.innerWidth < 768
          ? { top: 118, right: 22, bottom: 92, left: 22 }
          : { top: 90, right: 70, bottom: 70, left: 70 },
        duration: 550,
        maxZoom: 14.3,
      });
    }
  }, [area, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    markersRef.current.forEach((marker) => marker.remove());
    const placements = points.map((point, index) => {
      const projected = map.project([point.detail.location.longitude, point.detail.location.latitude]);
      const seedAngle = index * 2.399963;
      return {
        point,
        originalX: projected.x,
        originalY: projected.y,
        x: projected.x + Math.cos(seedAngle) * 2,
        y: projected.y + Math.sin(seedAngle) * 2,
      };
    });
    const mapContainer = map.getContainer();
    const safeLeft = 34;
    const safeRight = 34;
    const safeTop = window.innerWidth < 768 ? 112 : 90;
    const safeBottom = window.innerWidth < 768 ? 92 : 70;
    const minimumDistance = 58;
    for (let pass = 0; pass < 90; pass += 1) {
      for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
        const left = placements[leftIndex];
        if (!left) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
          const right = placements[rightIndex];
          if (!right) continue;
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distance = Math.hypot(dx, dy);
          if (distance >= minimumDistance) continue;
          if (distance < 0.01) {
            const angle = (leftIndex + rightIndex + 1) * 2.399963;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }
          const push = (minimumDistance - distance) / 2 + 0.2;
          const pushX = dx / distance * push;
          const pushY = dy / distance * push;
          left.x -= pushX;
          left.y -= pushY;
          right.x += pushX;
          right.y += pushY;
        }
      }
      placements.forEach((placement) => {
        placement.x = Math.min(mapContainer.clientWidth - safeRight, Math.max(safeLeft, placement.x));
        placement.y = Math.min(mapContainer.clientHeight - safeBottom, Math.max(safeTop, placement.y));
      });
    }
    const markerOffsets = new Map<DutyPoint, [number, number]>();
    placements.forEach((placement) => {
      markerOffsets.set(placement.point, [placement.x - placement.originalX, placement.y - placement.originalY]);
    });
    markersRef.current = points.map((point) => {
      const offset = markerOffsets.get(point) ?? [0, 0];
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = `duty-map-marker ${point.item.kind}`;
      markerButton.innerHTML = markerIcon(point.item.kind);
      markerButton.setAttribute('aria-label', `${point.item.kind === 'sos' ? 'SOS' : 'Phản ánh'}: ${point.item.title}`);
      const popup = new maplibregl.Popup({ offset: 28, maxWidth: '300px', className: 'duty-popup-shell' })
        .setDOMContent(popupContent(point, (item) => {
          popup.remove();
          onOpenCaseRef.current(item);
        }));
      return new maplibregl.Marker({ element: markerButton, anchor: 'center', offset })
        .setLngLat([point.detail.location.longitude, point.detail.location.latitude])
        .setPopup(popup)
        .addTo(map);
    });
  }, [mapReady, points, viewRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    operationalMarkersRef.current.forEach((marker) => marker.remove());
    operationalMarkersRef.current = operationalPoints.map((point) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `operational-map-marker ${point.pointType} ${point.status}`;
      const badge = document.createElement('span');
      badge.textContent = point.pointType === 'camera' ? 'CAM' : point.pointType === 'risk_point' ? '!' : point.pointType === 'police_post' ? 'CA' : point.pointType === 'patrol_checkpoint' ? 'TT' : 'Đ';
      element.append(badge);
      element.setAttribute('aria-label', `${point.name}, ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`);
      const content = document.createElement('div');
      content.className = 'operational-point-popup';
      const title = document.createElement('strong'); title.textContent = point.name;
      const meta = document.createElement('span'); meta.textContent = `${point.status === 'maintenance' ? 'Đang bảo trì' : 'Đang hoạt động'} · ${point.visibility === 'public' ? 'Công khai' : 'Nội bộ'}`;
      const description = document.createElement('p'); description.textContent = point.description || 'Không có ghi chú.';
      content.append(title, meta, description);
      if (point.contactPhone) { const phone = document.createElement('a'); phone.href = `tel:${point.contactPhone.replace(/\s/g, '')}`; phone.textContent = point.contactPhone; content.append(phone); }
      return new maplibregl.Marker({ element }).setLngLat([point.longitude, point.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24, maxWidth: '280px' }).setDOMContent(content)).addTo(map);
    });
  }, [mapReady, operationalPoints]);

  const alertPoints = publicAlerts.filter((alert) => alert.latitude !== null && alert.longitude !== null);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    alertMarkersRef.current.forEach((marker) => marker.remove());
    alertMarkersRef.current = alertPoints.map((alert) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `duty-alert-marker ${alert.riskLevel}`;
      const badge = document.createElement('span');
      badge.textContent = '!';
      element.append(badge);
      element.setAttribute('aria-label', `Cảnh báo công khai: ${alert.title}`);
      const content = document.createElement('div');
      content.className = 'operational-point-popup';
      const title = document.createElement('strong'); title.textContent = alert.title;
      const meta = document.createElement('span');
      meta.textContent = `Cảnh báo công khai · hiệu lực đến ${new Date(alert.endsAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`;
      const summary = document.createElement('p'); summary.textContent = alert.summary;
      content.append(title, meta, summary);
      return new maplibregl.Marker({ element }).setLngLat([alert.longitude as number, alert.latitude as number])
        .setPopup(new maplibregl.Popup({ offset: 24, maxWidth: '280px' }).setDOMContent(content)).addTo(map);
    });
  }, [mapReady, publicAlerts]); // eslint-disable-line react-hooks/exhaustive-deps

  const sosCount = points.filter((point) => point.item.kind === 'sos').length;
  const incidentCount = points.length - sosCount;
  const referenceAreaCount = area?.serviceAreas.filter((serviceArea) => serviceArea.isDemo).length ?? 0;

  return (
    <div className="police-duty-map">
      <div ref={containerRef} className="police-duty-map-canvas" aria-label={`Bản đồ trực ban ${area?.name ?? ''}`} />

      <section className="duty-map-summary" aria-live="polite">
        <button type="button" className="duty-map-back" onClick={onBackToQueue} aria-label="Trở về hàng đợi">
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <span className="duty-map-heading-icon"><MapPinned size={21} aria-hidden="true" /></span>
        <div>
          
          <strong>{area?.name ?? (areaLoading ? 'Đang tải địa bàn…' : 'Chưa gán địa bàn')}</strong>
          <span>{area ? `${referenceAreaCount ? `${referenceAreaCount} ranh tham chiếu` : `${area.serviceAreas.length} khu phụ trách`} · ${points.length} hồ sơ · ${operationalPoints.length} điểm quản lý` : 'Theo tài khoản đang đăng nhập'}</span>
        </div>
      </section>

      <div className="duty-map-legend" aria-label="Chú giải điểm nghiệp vụ">
        <span className="sos"><Siren size={15} aria-hidden="true" /><strong>{sosCount}</strong> SOS</span>
        <span className="incident"><FileWarning size={15} aria-hidden="true" /><strong>{incidentCount}</strong> Phản ánh</span>
        <span className="alert"><BellRing size={15} aria-hidden="true" /><strong>{alertPoints.length}</strong> Cảnh báo</span>
        <span className="boundary"><LocateFixed size={15} aria-hidden="true" /> Ranh phụ trách</span>
        <button type="button" className={showCompleted ? 'active' : ''} onClick={() => setShowCompleted((value) => !value)} aria-pressed={showCompleted}>
          {showCompleted ? 'Ẩn hồ sơ kết thúc' : 'Hiện hồ sơ kết thúc'}
        </button>
      </div>

      {(areaLoading || pointsLoading) && <div className="duty-map-loading"><span className="loader" /> {areaLoading ? 'Đang tải ranh địa bàn…' : 'Đang đồng bộ điểm nghiệp vụ…'}</div>}
      {error && <div className="duty-map-warning" role="status">{error}</div>}
    </div>
  );
}
