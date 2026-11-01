import { useEffect, useRef } from 'react';
import * as maplibregl from '../maplibre-runtime';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPinned } from 'lucide-react';
import { addOffshorePlaceLabels, createPublicMapStyle } from '../map-style';

interface WorkflowLocationMapProps {
  position: { latitude: number; longitude: number } | null;
  onSelect: (position: { latitude: number; longitude: number }) => void;
  emergency?: boolean;
}

const XUAN_HUONG_CENTER: [number, number] = [108.441, 11.944];

export function WorkflowLocationMap({ position, onSelect, emergency = false }: WorkflowLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: position ? [position.longitude, position.latitude] : XUAN_HUONG_CENTER,
      zoom: position ? 15 : 13.4,
      attributionControl: false,
      style: createPublicMapStyle(),
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('load', () => addOffshorePlaceLabels(map));
    map.on('click', (event: MapMouseEvent) => onSelectRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    if (!markerRef.current) {
      const marker = document.createElement('span');
      marker.className = emergency ? 'workflow-map-marker emergency' : 'workflow-map-marker';
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', emergency ? 'Vị trí gửi SOS' : 'Vị trí gửi phản ánh');
      markerRef.current = new maplibregl.Marker({ element: marker }).setLngLat([position.longitude, position.latitude]).addTo(map);
    } else {
      markerRef.current.setLngLat([position.longitude, position.latitude]);
    }
    map.easeTo({ center: [position.longitude, position.latitude], zoom: Math.max(map.getZoom(), 15), duration: 280 });
  }, [emergency, position]);

  return (
    <div className={emergency ? 'workflow-map-card emergency' : 'workflow-map-card'}>
      <div className="workflow-map-card-heading"><MapPinned size={18} aria-hidden="true" /><span><strong>Chạm vào bản đồ để chọn vị trí</strong></span></div>
      <div ref={containerRef} className="workflow-map-canvas" aria-label={emergency ? 'Bản đồ chọn vị trí SOS' : 'Bản đồ chọn vị trí phản ánh'} />
    </div>
  );
}
