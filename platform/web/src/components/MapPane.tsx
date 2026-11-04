import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { readDevicePosition, supportsDeviceLocation } from '../device-location';
import { DEMO_LOCATION_ENABLED } from '../demo-location';
import { showToast } from '../toast';
import { Building2, ChevronRight, Info, Layers3, LoaderCircle, LocateFixed, Phone, Shield, ShieldAlert, Siren, TriangleAlert, X } from 'lucide-react';
import * as maplibregl from '../maplibre-runtime';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildCitizenMapPoints, buildProvinceAlertPoints, buildPublicAlertPoints, pointsWithinZone, zoneBadgeLabel, zoneReferenceKind, type CitizenMapPoint } from '../citizen-map-points';
import { listPublicAlerts } from '../api';
import { addOffshorePlaceLabels, createPublicMapStyle } from '../map-style';
import type { AreaLookup, AreaOverview, Hotline, PublicAlert } from '../types';

interface MapPaneProps {
  area: AreaLookup | null;
  overview: AreaOverview | null;
  onAreaSelect: (code: string) => void;
  selectedPosition: { latitude: number; longitude: number } | null;
  onCoordinateSelect: (latitude: number, longitude: number) => void;
  showDemoAlerts: boolean;
  hotlines: Hotline[];
  onOpenSos: () => void;
  toolMenuOpen: boolean;
  onToolMenuOpenChange: (open: boolean) => void;
  /** Gọi trước khi xử lý một lần chạm lên bản đồ; trả về true nếu lần chạm đã được dùng (ví dụ đóng bảng danh bạ) và bản đồ không được chọn vùng khác. */
  onMapTapGuard?: () => boolean;
}

const SOURCE_ID = 'verified-area';
const PROVINCE_SOURCE_ID = 'province-areas';
const PROVINCE_FILL_ID = 'province-areas-fill';
const PROVINCE_LINE_ID = 'province-areas-line';
const FILL_LAYER_ID = 'verified-area-fill';
const LINE_LAYER_ID = 'verified-area-line';
const SERVICE_AREA_SOURCE_ID = 'historical-service-areas';
const SERVICE_AREA_FILL_LAYER_ID = 'historical-service-areas-fill';
const SERVICE_AREA_LINE_LAYER_ID = 'historical-service-areas-line';
const RADIUS_SOURCE_ID = 'lookup-radius';
const RADIUS_FILL_LAYER_ID = 'lookup-radius-fill';
const RADIUS_LINE_LAYER_ID = 'lookup-radius-line';
const SEARCH_RADIUS_KM = 3;

function circleAround(longitude: number, latitude: number, radiusKm: number) {
  const coordinates: [number, number][] = [];
  const earthRadiusKm = 6371;
  const latitudeRadians = latitude * Math.PI / 180;
  const angularDistance = radiusKm / earthRadiusKm;
  for (let step = 0; step <= 64; step += 1) {
    const bearing = step / 64 * Math.PI * 2;
    const pointLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance)
      + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLongitude = longitude * Math.PI / 180 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(pointLatitude),
    );
    coordinates.push([pointLongitude * 180 / Math.PI, pointLatitude * 180 / Math.PI]);
  }
  return {
    type: 'Feature' as const,
    properties: { radiusKm },
    geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
  };
}

function collectBounds(input: unknown, bounds: maplibregl.LngLatBounds): void {
  if (!Array.isArray(input)) return;
  if (input.length === 2 && input.every((value) => typeof value === 'number')) {
    bounds.extend(input as [number, number]);
    return;
  }
  for (const item of input) collectBounds(item, bounds);
}

function fitAreaBoundary(
  map: MapLibreMap,
  boundary: NonNullable<AreaLookup['boundary']>,
  container: HTMLDivElement | null,
  duration = 260,
): void {
  const bounds = new maplibregl.LngLatBounds();
  collectBounds(boundary.coordinates, bounds);
  if (bounds.isEmpty()) return;
  const rect = container?.getBoundingClientRect();
  const padding = rect && rect.height < 360
    ? { top: 90, right: 22, bottom: 24, left: 22 }
    : rect && rect.width < 600
      ? { top: 124, right: 22, bottom: 68, left: 22 }
      : 72;
  map.fitBounds(bounds, { padding, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration, maxZoom: 14 });
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

/** Góc nhìn bản đồ gần nhất: mở lại bản đồ (từ Phản ánh, SOS, Tài khoản…) giữ đúng chỗ người dùng đang xem. */
let lastCamera: { center: [number, number]; zoom: number; bearing: number; pitch: number; areaCode: string | null } | null = null;

export function MapPane({ area, overview, onAreaSelect, selectedPosition, onCoordinateSelect, showDemoAlerts, onOpenSos, toolMenuOpen, onToolMenuOpenChange, onMapTapGuard }: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onCoordinateSelectRef = useRef(onCoordinateSelect);
  const onAreaSelectRef = useRef(onAreaSelect);
  const mapTapGuardRef = useRef(onMapTapGuard);
  // Giữ góc nhìn khi người dùng vừa định vị (hoặc chạm chọn một điểm) và khi họ tự kéo/phóng bản đồ:
  // việc tra cứu xã trả về sau đó, hay một lần đổi cỡ cửa sổ, không được tự thu bản đồ về toàn xã.
  const selectedPositionRef = useRef(selectedPosition);
  const cameraLockedRef = useRef(false);
  // Bản đồ được dựng lại khi quay về từ trang khác: dùng lại góc nhìn cũ, không tự thu về toàn xã/toàn tỉnh.
  const restoredAreaRef = useRef<AreaLookup | null | undefined>(lastCamera && lastCamera.areaCode === (area?.code ?? null) ? area : undefined);
  const areaCodeRef = useRef<string | null>(area?.code ?? null);
  const userMovedRef = useRef(restoredAreaRef.current !== undefined);
  /** true khi khung nhìn đang là khung đã khôi phục cho đúng địa bàn này: không fit lại. */
  const keepRestoredView = (current: AreaLookup | null) => {
    if (restoredAreaRef.current === undefined) return false;
    if (restoredAreaRef.current === current) return true;
    restoredAreaRef.current = undefined;
    return false;
  };
  const holdCamera = () => cameraLockedRef.current && selectedPositionRef.current !== null;
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const alertMarkersRef = useRef<maplibregl.Marker[]>([]);
  const demoOfficerMarkersRef = useRef<maplibregl.Marker[]>([]);
  const demoStationMarkersRef = useRef<maplibregl.Marker[]>([]);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const [tileWarning, setTileWarning] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [boundaryVisible, setBoundaryVisible] = useState(true);
  const [serviceAreasVisible, setServiceAreasVisible] = useState(true);
  const [radiusVisible, setRadiusVisible] = useState(true);
  const [alertsVisible, setAlertsVisible] = useState(true);
  const [demoOfficersVisible, setDemoOfficersVisible] = useState(true);
  const [selectedServiceAreaCode, setSelectedServiceAreaCode] = useState<string | null>(null);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const pointPopupsRef = useRef(new Map<string, maplibregl.Popup>());
  const [publicAlerts, setPublicAlerts] = useState<PublicAlert[]>([]);
  const [alertsFailed, setAlertsFailed] = useState(false);

  const mapPoints = useMemo(() => [...buildCitizenMapPoints(area), ...(area ? buildPublicAlertPoints(area, publicAlerts) : buildProvinceAlertPoints(publicAlerts))], [area, publicAlerts]);
  const provinceBoundary = useMemo(() => overview ? { type: 'MultiPolygon' as const,
    coordinates: overview.features.flatMap(feature => feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as number[][][]] : feature.geometry.coordinates as number[][][][]) } : null, [overview]);

  useEffect(() => {
    let cancelled = false;
    setPublicAlerts([]); setAlertsFailed(false);
    const load = () => void listPublicAlerts(area?.code)
      .then(alerts => { if (!cancelled) { setAlertsFailed(false); setPublicAlerts(previous => JSON.stringify(previous) === JSON.stringify(alerts) ? previous : alerts); } })
      .catch(() => { if (!cancelled) setAlertsFailed(true); });
    load();
    // Cảnh báo mới do cán bộ phát hành hiện lên mà người dân không phải tải lại trang.
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [area?.code]);

  const selectedServiceArea = area?.serviceAreas.find((serviceArea) => serviceArea.code === selectedServiceAreaCode) ?? null;
  const selectedAreaPoints = (selectedServiceArea ? pointsWithinZone(mapPoints, selectedServiceArea) : []).filter((point) => (
    point.kind === 'alert' ? alertsVisible : demoOfficersVisible
  ));

  const closePointPopup = useCallback(() => {
    activePopupRef.current?.remove();
    activePopupRef.current = null;
    setActivePointId(null);
  }, []);

  const showMapPoint = useCallback((point: CitizenMapPoint, toggle = false) => {
    const map = mapRef.current;
    const popup = pointPopupsRef.current.get(point.id);
    if (!map || !popup) return;
    if (toggle && popup.isOpen()) { closePointPopup(); return; }
    closePointPopup();
    // Bấm icon trên bản đồ (toggle=true): chỉ hiện thông tin của icon đó, đóng bảng khu vực. Chọn điểm từ danh sách trong bảng khu vực: giữ bảng khu vực.
    setSelectedServiceAreaCode(toggle ? null : point.serviceAreaCode);
    onToolMenuOpenChange(false);
    activePopupRef.current = popup;
    setActivePointId(point.id);
    popup.setLngLat([point.longitude, point.latitude]).addTo(map);
    const rect = map.getContainer().getBoundingClientRect();
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    map.easeTo({
      center: [point.longitude, point.latitude], zoom: Math.max(map.getZoom(), 14.2),
      offset: mobile ? [0, -rect.height * 0.23] : [Math.min(180, rect.width * 0.2), 70],
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
    });
  }, [closePointPopup, onToolMenuOpenChange]);

  const registerPopup = useCallback((point: CitizenMapPoint, content: HTMLElement) => {
    const popup = new maplibregl.Popup({
      anchor: 'bottom', offset: 40, closeButton: true, maxWidth: '300px', className: 'citizen-point-popup',
      focusAfterOpen: false,
    }).setDOMContent(content);
    popup.on('close', () => {
      if (activePopupRef.current === popup) {
        activePopupRef.current = null;
        setActivePointId(null);
      }
    });
    popup.on('open', () => {
      const element = popup.getElement();
      element?.setAttribute('role', 'region');
      element?.setAttribute('aria-label', `Thông tin ${point.name}`);
      element?.querySelector('button')?.setAttribute('aria-label', 'Đóng thông tin điểm');
    });
    pointPopupsRef.current.set(point.id, popup);
    return popup;
  }, []);

  const releasePopups = useCallback((kind: CitizenMapPoint['kind']) => {
    for (const [id, popup] of pointPopupsRef.current) {
      if (!id.startsWith(`${kind}:`)) continue;
      popup.remove();
      pointPopupsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    onCoordinateSelectRef.current = onCoordinateSelect;
    onAreaSelectRef.current = onAreaSelect;
    mapTapGuardRef.current = onMapTapGuard;
    selectedPositionRef.current = selectedPosition;
    if (!selectedPosition) cameraLockedRef.current = false;
    areaCodeRef.current = area?.code ?? null;
  }, [area, onCoordinateSelect, onAreaSelect, onMapTapGuard, selectedPosition]);

  useEffect(() => {
    const selectedFromLookup = area?.serviceAreas.find((serviceArea) => serviceArea.selected)?.code ?? null;
    setSelectedServiceAreaCode(selectedFromLookup);
    closePointPopup();
  }, [area, closePointPopup]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activePopupRef.current) closePointPopup();
      else { setSelectedServiceAreaCode(null); onToolMenuOpenChange(false); }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closePointPopup, onToolMenuOpenChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: lastCamera && restoredAreaRef.current !== undefined ? lastCamera.center : [108.25, 11.55],
      zoom: lastCamera && restoredAreaRef.current !== undefined ? lastCamera.zoom : 7,
      bearing: lastCamera && restoredAreaRef.current !== undefined ? lastCamera.bearing : 0,
      pitch: lastCamera && restoredAreaRef.current !== undefined ? lastCamera.pitch : 0,
      attributionControl: false,
      style: createPublicMapStyle(),
    });
    // A worker or tile request can stall without a MapLibre error event.
    // Do not silently leave a blank canvas behind otherwise working markers.
    const loadTimeout = window.setTimeout(() => setTileWarning(true), 12000);
    map.on('load', () => {
      window.clearTimeout(loadTimeout);
      setTileWarning(false);
      containerRef.current?.setAttribute('data-map-loaded', 'true');
      addOffshorePlaceLabels(map);
      map.addSource(PROVINCE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: PROVINCE_FILL_ID, type: 'fill', source: PROVINCE_SOURCE_ID,
        paint: { 'fill-color': '#667782', 'fill-opacity': 0.06 } });
      map.addLayer({ id: PROVINCE_LINE_ID, type: 'line', source: PROVINCE_SOURCE_ID,
        paint: { 'line-color': '#526a77', 'line-width': 1, 'line-opacity': 0.75 } });
      map.on('mouseenter', PROVINCE_FILL_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', PROVINCE_FILL_ID, () => { map.getCanvas().style.cursor = ''; });
      map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(SERVICE_AREA_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(RADIUS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer(
          {
            id: FILL_LAYER_ID,
            type: 'fill',
            source: SOURCE_ID,
            paint: { 'fill-color': '#24566a', 'fill-opacity': 0.04 },
          },
      );
      map.addLayer(
          {
            id: SERVICE_AREA_FILL_LAYER_ID,
            type: 'fill',
            source: SERVICE_AREA_SOURCE_ID,
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.38, 0.2],
            },
          },
      );
      map.addLayer(
          {
            id: SERVICE_AREA_LINE_LAYER_ID,
            type: 'line',
            source: SERVICE_AREA_SOURCE_ID,
            paint: {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['boolean', ['get', 'selected'], false], 3, 1.7],
              'line-opacity': 0.96,
            },
          },
      );
      map.addLayer(
          {
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            paint: { 'line-color': '#24566a', 'line-width': 2 },
          },
      );
      map.addLayer(
          {
            id: RADIUS_FILL_LAYER_ID,
            type: 'fill',
            source: RADIUS_SOURCE_ID,
            paint: { 'fill-color': '#216b86', 'fill-opacity': 0.08 },
          },
      );
      map.addLayer(
          {
            id: RADIUS_LINE_LAYER_ID,
            type: 'line',
            source: RADIUS_SOURCE_ID,
            paint: { 'line-color': '#216b86', 'line-width': 2, 'line-dasharray': [2, 2] },
          },
      );
      map.on('mouseenter', SERVICE_AREA_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', SERVICE_AREA_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('error', (event) => {
      if (('sourceId' in event && event.sourceId === 'openmaptiles') || String(event.error?.message ?? event.error).includes('openfreemap')) {
        setTileWarning(true);
      }
    });
    map.on('click', (event: MapMouseEvent) => {
      // Bảng danh bạ đang mở: chạm ra ngoài chỉ đóng bảng (như nút X), không chọn sang vùng khác.
      if (mapTapGuardRef.current?.()) return;
      const selectedFeature = map.getLayer(SERVICE_AREA_FILL_LAYER_ID)
        ? map.queryRenderedFeatures(event.point, { layers: [SERVICE_AREA_FILL_LAYER_ID] })[0]
        : undefined;
      const serviceAreaCode = selectedFeature?.properties?.code;
      if (typeof serviceAreaCode === 'string' && serviceAreaCode) {
        closePointPopup();
        setSelectedServiceAreaCode(serviceAreaCode);
        onToolMenuOpenChange(false);
        return;
      }
      closePointPopup();
      setSelectedServiceAreaCode(null);
      const provinceFeature = map.getLayer(PROVINCE_FILL_ID)
        ? map.queryRenderedFeatures(event.point, { layers: [PROVINCE_FILL_ID] })[0] : undefined;
      if (typeof provinceFeature?.properties?.code === 'string') {
        onAreaSelectRef.current(provinceFeature.properties.code);
        return;
      }
      cameraLockedRef.current = true;
      onCoordinateSelectRef.current(event.lngLat.lat, event.lngLat.lng);
    });
    // Người dùng tự kéo/phóng bản đồ: từ đó không tự đưa về toàn xã khi cửa sổ đổi cỡ.
    const markUserMove = (event: { originalEvent?: unknown }) => { if (event.originalEvent) userMovedRef.current = true; };
    map.on('dragstart', markUserMove);
    map.on('zoomstart', markUserMove);
    map.on('rotatestart', markUserMove);
    map.on('pitchstart', markUserMove);
    map.on('moveend', () => {
      const center = map.getCenter();
      lastCamera = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), areaCode: areaCodeRef.current };
    });
    mapRef.current = map;

    return () => {
      window.clearTimeout(loadTimeout);
      markerRef.current?.remove();
      for (const marker of alertMarkersRef.current) marker.remove();
      for (const marker of demoOfficerMarkersRef.current) marker.remove();
      for (const marker of demoStationMarkersRef.current) marker.remove();
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      alertMarkersRef.current = [];
      demoOfficerMarkersRef.current = [];
      demoStationMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [onToolMenuOpenChange]);

  useEffect(() => {
    // The directory is an overlay: the map stays visible and must still resize.
    let frame = 0;
    const resizeAndFit = (areaChanged: boolean) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const map = mapRef.current;
        if (!map) return;
        map.resize();
        if (keepRestoredView(area)) return;
        // Đổi cỡ cửa sổ (bàn phím, popup, thanh hệ thống) chỉ cập nhật khung vẽ, không đổi góc nhìn người dùng đang xem.
        if (!areaChanged && (userMovedRef.current || holdCamera())) return;
        if (areaChanged) {
          if (holdCamera()) return;
          userMovedRef.current = false;
        }
        if (area?.boundary) fitAreaBoundary(map, area.boundary, containerRef.current, 0);
        else if (provinceBoundary) fitAreaBoundary(map, provinceBoundary, containerRef.current, 0);
      });
    };
    resizeAndFit(true);
    const onWindowResize = () => resizeAndFit(false);
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onWindowResize);
    };
  }, [area, provinceBoundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !overview) return;
    const markLoaded = () => {
      if (map.getSource(PROVINCE_SOURCE_ID) && map.isSourceLoaded(PROVINCE_SOURCE_ID)) {
        containerRef.current?.setAttribute('data-overview-count', String(overview.features.length));
      }
    };
    const update = () => {
      const source = map.getSource(PROVINCE_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) source.setData(overview);
    };
    map.on('sourcedata', markLoaded);
    if (map.getSource(PROVINCE_SOURCE_ID)) update(); else map.once('load', update);
    return () => { map.off('load', update); map.off('sourcedata', markLoaded); };
  }, [overview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!selectedPosition) return;
    const markerElement = document.createElement('div');
    markerElement.className = 'position-marker';
    markerElement.setAttribute('role', 'img');
    markerElement.setAttribute('aria-label', 'Vị trí đang tra cứu, bán kính tối đa 3 km');
    markerRef.current = new maplibregl.Marker({ element: markerElement })
      .setLngLat([selectedPosition.longitude, selectedPosition.latitude])
      .addTo(map);
  }, [selectedPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateRadius = () => {
      const source = map.getSource(RADIUS_SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: 'FeatureCollection',
        features: selectedPosition && radiusVisible
          ? [circleAround(selectedPosition.longitude, selectedPosition.latitude, SEARCH_RADIUS_KM)]
          : [],
      });
    };
    if (map.getSource(RADIUS_SOURCE_ID)) updateRadius();
    else map.once('load', updateRadius);
    return () => { map.off('load', updateRadius); };
  }, [radiusVisible, selectedPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateBoundary = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      if (!area?.boundary) {
        source.setData({ type: 'FeatureCollection', features: [] });
        containerRef.current?.removeAttribute('data-boundary-rendered');
        if (provinceBoundary && !holdCamera() && !keepRestoredView(area)) fitAreaBoundary(map, provinceBoundary, containerRef.current);
        return;
      }
      const feature = {
        type: 'Feature' as const,
        properties: { code: area.code, name: area.name },
        geometry: area.boundary!,
      };
      const data = { type: 'FeatureCollection' as const, features: [feature] };
      source.setData(data);
      if (!holdCamera() && !keepRestoredView(area)) fitAreaBoundary(map, area.boundary!, containerRef.current);
      containerRef.current?.setAttribute('data-boundary-rendered', area.code);
    };
    if (map.getSource(SOURCE_ID)) updateBoundary();
    else map.once('load', updateBoundary);
    return () => { map.off('load', updateBoundary); };
  }, [area, provinceBoundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of demoOfficerMarkersRef.current) marker.remove();
    demoOfficerMarkersRef.current = [];
    if (!demoOfficersVisible) return;

    demoOfficerMarkersRef.current = mapPoints.filter((point) => point.kind === 'officer').map((point) => {
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = 'cskv-demo-marker';
      markerElement.dataset.mapPointId = point.id;
      markerElement.dataset.serviceAreaCode = point.serviceAreaCode;
      markerElement.setAttribute('aria-label', `Mở thông tin ${point.name}${point.phone ? `, số ${point.phone}` : ''}`);
      for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
        markerElement.addEventListener(eventName, (event) => event.stopPropagation());
      }

      const badge = document.createElement('span');
      badge.className = 'cskv-demo-marker-badge';
      const title = document.createElement('strong');
      title.textContent = 'CSKV';
      const code = document.createElement('small');
      const pointZone = area?.serviceAreas.find((serviceArea) => serviceArea.code === point.serviceAreaCode);
      code.textContent = pointZone ? zoneBadgeLabel(pointZone) : 'CSKV';
      badge.append(title, code);
      markerElement.append(badge);

      const popupContent = document.createElement('div');
      popupContent.className = 'cskv-demo-popup';
      const popupTitle = document.createElement('strong');
      popupTitle.textContent = point.name;
      popupContent.append(popupTitle);
      if (point.phone) {
        const phoneLink = document.createElement('a');
        phoneLink.className = 'cskv-demo-phone';
        phoneLink.href = telHref(point.phone);
        phoneLink.textContent = point.phone;
        phoneLink.setAttribute('aria-label', `Gọi ${point.name} theo số ${point.phone}`);
        popupContent.append(phoneLink);
      } else {
        const noPhone = document.createElement('small');
        noPhone.textContent = 'Chưa có số điện thoại công khai';
        popupContent.append(noPhone);
      }

      registerPopup(point, popupContent);
      markerElement.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        showMapPoint(point, true);
      });
      return new maplibregl.Marker({ element: markerElement, anchor: 'bottom' })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
    });
    return () => { demoOfficerMarkersRef.current.forEach((marker) => marker.remove()); releasePopups('officer'); };
  }, [area, demoOfficersVisible, mapPoints, registerPopup, releasePopups, showMapPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of demoStationMarkersRef.current) marker.remove();
    demoStationMarkersRef.current = [];
    if (!demoOfficersVisible) return;

    demoStationMarkersRef.current = mapPoints.filter((point) => point.kind === 'station').map((point) => {
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = 'station-demo-marker';
      markerElement.dataset.mapPointId = point.id;
      markerElement.dataset.serviceAreaCode = point.serviceAreaCode;
      markerElement.setAttribute('aria-label', `Mở thông tin ${point.name}`);
      for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
        markerElement.addEventListener(eventName, (event) => event.stopPropagation());
      }
      const markerBadge = document.createElement('span');
      const markerTitle = document.createElement('strong');
      markerTitle.textContent = 'CA';
      const markerCaption = document.createElement('small');
      markerCaption.textContent = 'TRỤ SỞ';
      markerBadge.append(markerTitle, markerCaption);
      markerElement.append(markerBadge);

      const popupContent = document.createElement('div');
      popupContent.className = 'station-demo-popup';
      const popupTitle = document.createElement('strong');
      popupTitle.textContent = point.name;
      const popupAddress = document.createElement('p');
      popupAddress.textContent = point.detail;
      popupContent.append(popupTitle, popupAddress);
      if (point.phone) {
        const phoneLink = document.createElement('a');
        phoneLink.className = 'station-demo-phone';
        phoneLink.href = telHref(point.phone);
        phoneLink.textContent = point.phone;
        phoneLink.setAttribute('aria-label', `Gọi ${point.name} theo số ${point.phone}`);
        popupContent.append(phoneLink);
      }

      registerPopup(point, popupContent);
      markerElement.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        showMapPoint(point, true);
      });
      return new maplibregl.Marker({ element: markerElement, anchor: 'bottom' })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
    });
    return () => { demoStationMarkersRef.current.forEach((marker) => marker.remove()); releasePopups('station'); };
  }, [demoOfficersVisible, mapPoints, registerPopup, releasePopups, showMapPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateServiceAreas = () => {
      const source = map.getSource(SERVICE_AREA_SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: 'FeatureCollection',
        features: (area?.serviceAreas ?? []).map((serviceArea) => ({
          type: 'Feature' as const,
          properties: {
            code: serviceArea.code,
            name: serviceArea.name,
            groupName: serviceArea.groupName,
            color: serviceArea.displayColor,
            selected: serviceArea.code === selectedServiceAreaCode,
            dataMode: serviceArea.isDemo ? 'Ranh tham chiếu' : 'Ranh chính thức',
          },
          geometry: serviceArea.boundary,
        })),
      });
    };
    if (map.getSource(SERVICE_AREA_SOURCE_ID)) updateServiceAreas();
    else map.once('load', updateServiceAreas);
    return () => { map.off('load', updateServiceAreas); };
  }, [area, selectedServiceAreaCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateVisibility = () => {
      for (const layerId of [PROVINCE_FILL_ID, PROVINCE_LINE_ID, FILL_LAYER_ID, LINE_LAYER_ID]) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', boundaryVisible ? 'visible' : 'none');
      }
    };
    if (map.getLayer(FILL_LAYER_ID)) updateVisibility();
    else map.once('load', updateVisibility);
    return () => { map.off('load', updateVisibility); };
  }, [boundaryVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateVisibility = () => {
      for (const layerId of [SERVICE_AREA_FILL_LAYER_ID, SERVICE_AREA_LINE_LAYER_ID]) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', serviceAreasVisible ? 'visible' : 'none');
      }
    };
    if (map.getLayer(SERVICE_AREA_FILL_LAYER_ID)) updateVisibility();
    else map.once('load', updateVisibility);
    return () => { map.off('load', updateVisibility); };
  }, [serviceAreasVisible]);

  useEffect(() => {
    if (showDemoAlerts) setAlertsVisible(true);
  }, [showDemoAlerts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of alertMarkersRef.current) marker.remove();
    alertMarkersRef.current = [];
    if (!alertsVisible) return;

    alertMarkersRef.current = mapPoints.filter((point) => point.kind === 'alert').map((point) => {
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = 'alert-map-marker';
      markerElement.dataset.mapPointId = point.id;
      markerElement.dataset.serviceAreaCode = point.serviceAreaCode;
      markerElement.textContent = '!';
      markerElement.setAttribute('aria-label', `${point.name}. Cảnh báo địa bàn.`);
      const content = document.createElement('div');
      content.className = 'alert-popup';
      const title = document.createElement('strong');
      title.textContent = point.name;
      const demo = document.createElement('span');
      demo.textContent = 'Cảnh báo công khai đang hiệu lực';
      const detail = document.createElement('p');
      detail.textContent = point.detail;
      content.append(title, demo, detail);
      registerPopup(point, content);
      markerElement.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        showMapPoint(point, true);
      });
      return new maplibregl.Marker({ element: markerElement })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
    });
    return () => { alertMarkersRef.current.forEach((marker) => marker.remove()); releasePopups('alert'); };
  }, [alertsVisible, mapPoints, registerPopup, releasePopups, showMapPoint]);

  useEffect(() => {
    const markerElements = containerRef.current?.querySelectorAll<HTMLElement>('[data-service-area-code]') ?? [];
    markerElements.forEach((element) => {
      const inSelectedZone = Boolean(selectedServiceAreaCode && element.dataset.serviceAreaCode === selectedServiceAreaCode);
      element.classList.toggle('in-selected-zone', inSelectedZone);
      element.classList.toggle('outside-selected-zone', Boolean(selectedServiceAreaCode && !inSelectedZone));
    });
  }, [alertsVisible, demoOfficersVisible, mapPoints, selectedServiceAreaCode]);

  const openMapPoint = (point: CitizenMapPoint) => {
    showMapPoint(point);
    activePopupRef.current?.getElement()?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  const selectZone = (code: string) => {
    closePointPopup();
    setSelectedServiceAreaCode(code);
    onToolMenuOpenChange(false);
    const zone = area?.serviceAreas.find((candidate) => candidate.code === code);
    const map = mapRef.current;
    if (!zone || !map) return;
    const bounds = new maplibregl.LngLatBounds();
    collectBounds(zone.boundary.coordinates, bounds);
    const { width, height } = map.getContainer().getBoundingClientRect();
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    // A bottom sheet must not squeeze a short phone map into a few pixels.
    // In landscape/desktop the list occupies the left, so fit the zone to its right.
    const padding = !mobile || (width > height && height < 520)
      ? { top: 40, right: 28, bottom: 82, left: Math.min(390, width * 0.48) }
      : { top: 70, right: 28, bottom: 100, left: 28 };
    if (!bounds.isEmpty()) map.fitBounds(bounds, {
      padding, maxZoom: 15,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
    });
  };

  return (
    <section className="map-pane" id="map-panel" aria-label="Bản đồ địa bàn" data-point-open={Boolean(activePointId)} data-tools-open={toolMenuOpen}>
      <button
        className="map-tool-trigger"
        type="button"
        onClick={() => { closePointPopup(); onToolMenuOpenChange(!toolMenuOpen); }}
        aria-expanded={toolMenuOpen}
        aria-controls="map-tool-menu"
        aria-label="Mở tùy chọn hiển thị bản đồ"
      >
        {toolMenuOpen ? <X size={20} aria-hidden="true" /> : <Layers3 size={20} aria-hidden="true" />}
      </button>

      {toolMenuOpen && (
        <div className="map-tool-menu" id="map-tool-menu">
          <strong>Tùy chọn hiển thị</strong>
          <label><input name="boundaryVisible" type="checkbox" checked={boundaryVisible} onChange={(event) => setBoundaryVisible(event.target.checked)} /> <span>Ranh giới hành chính</span></label>
          {(area?.serviceAreas?.length ?? 0) > 0 && (
            <>
              <label><input name="serviceAreasVisible" type="checkbox" checked={serviceAreasVisible} onChange={(event) => { setServiceAreasVisible(event.target.checked); if (!event.target.checked) { closePointPopup(); setSelectedServiceAreaCode(null); } }} /> <span>{zoneReferenceKind(area) === 'former_wards' ? `${area!.serviceAreas.length} khu vực phường` : `${area!.serviceAreas.length} khu vực chia minh họa`}</span></label>
              {serviceAreasVisible && (
                <div className="service-area-key" aria-label="Chọn một khu vực để xem các điểm bên trong">
                  {area!.serviceAreas.map((serviceArea) => (
                    <button type="button" className={serviceArea.code === selectedServiceAreaCode ? 'selected' : ''} aria-pressed={serviceArea.code === selectedServiceAreaCode} key={serviceArea.code} onClick={() => selectZone(serviceArea.code)}>
                      <i style={{ backgroundColor: serviceArea.displayColor }} aria-hidden="true" />
                      {serviceArea.name.replace('Khu vực ', '')}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <label><input name="radiusVisible" type="checkbox" checked={radiusVisible} onChange={(event) => setRadiusVisible(event.target.checked)} /> <span>Bán kính tra cứu 3 km</span></label>
          {(area?.serviceAreas?.length ?? 0) > 0 && <label><input name="demoOfficersVisible" type="checkbox" checked={demoOfficersVisible} onChange={(event) => setDemoOfficersVisible(event.target.checked)} /> <span>Trụ sở và CSKV</span></label>}
          <label><input name="alertsVisible" type="checkbox" checked={alertsVisible} onChange={(event) => setAlertsVisible(event.target.checked)} /> <span>Cảnh báo địa bàn</span></label>
          {alertsFailed && <small><ShieldAlert size={15} aria-hidden="true" /> Chưa tải được cảnh báo. Hãy tải lại trang để thử lại.</small>}
        </div>
      )}
      <div ref={containerRef} className="map-canvas" data-testid="map-canvas" />
      {selectedServiceArea && (
        <aside className="map-zone-panel" style={{ '--zone-color': selectedServiceArea.displayColor } as CSSProperties} aria-live="polite" aria-label={`Thông tin ${selectedServiceArea.name}`}>
          <header>
            <span><strong>{selectedServiceArea.name}</strong></span>
            <button type="button" onClick={() => { closePointPopup(); setSelectedServiceAreaCode(null); }} aria-label="Đóng thông tin khu vực"><X size={19} aria-hidden="true" /></button>
          </header>
          <div className="map-zone-metrics">
            <span><strong>{selectedAreaPoints.length}</strong><small>điểm</small></span>
            <span><strong>{selectedServiceArea.areaKm2?.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) ?? '—'} km²</strong><small>diện tích</small></span>
          </div>
          <div className="map-zone-point-list">
            {selectedAreaPoints.map((point) => (
              <button type="button" key={point.id} onClick={() => openMapPoint(point)}>
                <span className={`map-zone-point-icon ${point.kind}`} aria-hidden="true">
                  {point.kind === 'station' ? <Building2 size={18} /> : point.kind === 'officer' ? <Shield size={18} /> : <TriangleAlert size={18} />}
                </span>
                <span className="map-zone-point-copy">
                  <small>{point.kind === 'station' ? 'Trụ sở / điểm tiếp dân' : point.kind === 'officer' ? 'Cảnh sát khu vực' : 'Cảnh báo khu vực'}</small>
                  <strong>{point.name}</strong>
                  {point.phone && <span><Phone size={12} aria-hidden="true" /> {point.phone}</span>}
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
            {selectedAreaPoints.length === 0 && <p>Chưa có điểm công khai trong lớp bản đồ đang bật.</p>}
          </div>
        </aside>
      )}
      <div className="map-action-dock">
        <button className="map-sos-button" data-tour="sos" type="button" onClick={onOpenSos} aria-label="Mở quy trình SOS khẩn cấp" title="SOS khẩn cấp">
          <Siren size={22} aria-hidden="true" /><span><strong>SOS</strong></span>
        </button>
        <button
          className="my-location-button"
          data-tour="location"
          type="button"
          disabled={locating}
          onClick={() => {
            setLocationError('');
            if (!supportsDeviceLocation()) { setLocationError('Thiết bị chưa hỗ trợ vị trí. Hãy tìm theo tên địa bàn.'); return; }
            setLocating(true);
            readDevicePosition((pos) => {
              setLocating(false);
              showToast({ kind: 'success', topic: 'location', title: 'Đã xác định vị trí của bạn' });
              cameraLockedRef.current = true;
              userMovedRef.current = false;
              onCoordinateSelectRef.current(pos.coords.latitude, pos.coords.longitude);
              mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260 });
            }, () => {
              setLocating(false);
              setLocationError('Chưa lấy được vị trí. Bật định vị, cho phép trình duyệt truy cập rồi thử lại.');
            }, { timeout: 12000, maximumAge: 60000 });
          }}
          aria-label={locating ? 'Đang xác định vị trí' : DEMO_LOCATION_ENABLED ? 'Vị trí của tôi (chế độ Demo: vị trí cố định)' : 'Vị trí của tôi'}
          title={DEMO_LOCATION_ENABLED ? 'Vị trí của tôi (Demo)' : 'Vị trí của tôi'}
        >
          {locating ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : <LocateFixed size={20} aria-hidden="true" />}
          {DEMO_LOCATION_ENABLED && <span className="demo-location-badge" aria-hidden="true">Demo</span>}
        </button>
      </div>
      <div className="map-credits">
        {creditsOpen && (
          <div className="map-credits-popover" id="map-credits-popover">
            <strong>Nguồn dữ liệu nền</strong>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              © OpenStreetMap contributors
            </a>
            <a href="https://openfreemap.org" target="_blank" rel="noreferrer">© OpenFreeMap</a>
          </div>
        )}
        <button
          className="map-credits-button"
          type="button"
          onClick={() => setCreditsOpen((open) => !open)}
          aria-label="Nguồn dữ liệu bản đồ"
          aria-expanded={creditsOpen}
          aria-controls="map-credits-popover"
          title="Nguồn dữ liệu bản đồ"
        >
          <Info size={14} aria-hidden="true" /><span className="map-credits-label">Nguồn bản đồ</span>
        </button>
      </div>
      {locationError && <div className="map-location-error" role="alert"><span>{locationError}</span><button type="button" onClick={() => setLocationError('')} aria-label="Đóng thông báo vị trí"><X size={18} aria-hidden="true" /></button></div>}
      {tileWarning && <div className="map-network-warning" role="status"><span>Nền bản đồ tải chậm hoặc bị gián đoạn.</span><button type="button" onClick={() => window.location.reload()}>Tải lại bản đồ</button></div>}
    </section>
  );
}
