import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CircleParking, MapPin, Pencil, Plus, Save, Shield, Trash2, TriangleAlert, X } from 'lucide-react';
import { ApiError, createOperationalMapPoint, deleteOperationalMapPoint, listOperationalMapPoints, updateOperationalMapPoint } from '../api';
import { filterPointsInZone } from '../area-scope';
import { pointInBoundary } from '../citizen-map-points';
import type { OperationalMapPoint, OperationalMapPointInput, ServiceArea } from '../types';

const labels: Record<OperationalMapPoint['pointType'], string> = { police_post: 'Điểm CSKV', camera: 'Camera', risk_point: 'Điểm nguy cơ', patrol_checkpoint: 'Điểm nghiệp vụ', public_facility: 'Tiện ích công cộng' };
const icons = { police_post: Shield, camera: Camera, risk_point: TriangleAlert, patrol_checkpoint: CircleParking, public_facility: MapPin };

const emptyInput: OperationalMapPointInput = { name: '', pointType: 'police_post', description: null, contactPhone: null, status: 'active', visibility: 'officer', latitude: 11.944, longitude: 108.441 };

export function OfficerMapDataManager({ onChanged, zoneBoundary = null }: { onChanged?: () => void; zoneBoundary?: ServiceArea['boundary'] | null }) {
  const [allItems, setItems] = useState<OperationalMapPoint[]>([]);
  const [editing, setEditing] = useState<OperationalMapPoint | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Cán bộ khu vực chỉ thấy và chỉ thêm điểm nằm trong khu vực của mình.
  const items = useMemo(() => filterPointsInZone(allItems, zoneBoundary), [allItems, zoneBoundary]);

  const refresh = useCallback(async () => {
    try { setItems(await listOperationalMapPoints()); } catch (caught) { setNotice(caught instanceof ApiError ? caught.message : 'Không tải được dữ liệu bản đồ.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = new FormData(event.currentTarget);
    const input: OperationalMapPointInput = {
      name: String(form.get('name')), pointType: String(form.get('pointType')) as OperationalMapPoint['pointType'],
      description: String(form.get('description') || '') || null, contactPhone: String(form.get('contactPhone') || '') || null,
      status: String(form.get('status')) as OperationalMapPoint['status'], visibility: String(form.get('visibility')) as OperationalMapPoint['visibility'],
      latitude: Number(form.get('latitude')), longitude: Number(form.get('longitude')),
    };
    if (zoneBoundary && !pointInBoundary(input.longitude, input.latitude, zoneBoundary)) {
      setNotice('Vị trí nằm ngoài khu vực bạn phụ trách. Hãy nhập tọa độ trong khu vực của mình.'); setBusy(false); return;
    }
    try {
      if (editing === 'new') await createOperationalMapPoint(input); else if (editing) await updateOperationalMapPoint(editing.id, input);
      setNotice(editing === 'new' ? 'Đã thêm điểm lên bản đồ nghiệp vụ.' : 'Đã lưu thay đổi điểm bản đồ.'); setEditing(null); await refresh(); onChanged?.();
    } catch (caught) { setNotice(caught instanceof ApiError ? caught.message : 'Không lưu được điểm bản đồ.'); } finally { setBusy(false); }
  };

  const remove = async (item: OperationalMapPoint) => {
    if (!window.confirm(`Xóa “${item.name}” khỏi bản đồ nghiệp vụ?`)) return;
    setBusy(true); setNotice('');
    try { await deleteOperationalMapPoint(item.id); setNotice('Đã xóa điểm bản đồ.'); await refresh(); onChanged?.(); }
    catch (caught) { setNotice(caught instanceof ApiError ? caught.message : 'Không xóa được điểm bản đồ.'); } finally { setBusy(false); }
  };

  const defaults = editing && editing !== 'new' ? editing : emptyInput;
  return <div className="map-data-manager">
    <div className="operations-intro"><MapPin size={24} /><div><h3>Dữ liệu bản đồ địa bàn</h3></div><button type="button" className="ops-add-button" onClick={() => setEditing('new')}><Plus size={17} /> Thêm điểm</button></div>
    <div className="map-data-list">
      {items.length === 0 && <p className="workflow-empty">Chưa có điểm nghiệp vụ tùy chỉnh.</p>}
      {items.map((item) => { const Icon = icons[item.pointType]; return <article key={item.id} className={item.status !== 'active' ? 'muted' : ''}>
        <span className={`map-data-icon ${item.pointType}`}><Icon size={19} /></span><div><strong>{item.name}</strong><small>{labels[item.pointType]} · {item.visibility === 'public' ? 'Công khai' : 'Nội bộ'} · {item.status === 'active' ? 'Hoạt động' : item.status === 'maintenance' ? 'Bảo trì' : 'Tạm ẩn'}</small><code>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</code></div>
        <div><button type="button" onClick={() => setEditing(item)} aria-label={`Sửa ${item.name}`}><Pencil size={17} /></button><button type="button" onClick={() => void remove(item)} aria-label={`Xóa ${item.name}`}><Trash2 size={17} /></button></div>
      </article>; })}
    </div>
    {editing && <div className="map-data-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="map-data-sheet" onSubmit={submit} aria-label={editing === 'new' ? 'Thêm điểm bản đồ' : 'Sửa điểm bản đồ'}>
      <header><div><h3>{editing === 'new' ? 'Thêm điểm bản đồ' : 'Chỉnh sửa điểm bản đồ'}</h3></div><button type="button" onClick={() => setEditing(null)} aria-label="Đóng"><X /></button></header>
      <label>Tên điểm<input name="name" required minLength={3} maxLength={160} defaultValue={defaults.name} /></label>
      <div className="form-grid"><label>Loại điểm<select name="pointType" defaultValue={defaults.pointType}>{Object.entries(labels).filter(([value]) => value !== 'patrol_checkpoint' || defaults.pointType === 'patrol_checkpoint').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Trạng thái<select name="status" defaultValue={defaults.status}><option value="active">Hoạt động</option><option value="maintenance">Bảo trì</option><option value="inactive">Tạm ẩn</option></select></label></div>
      <div className="form-grid"><label>Vĩ độ<input name="latitude" type="number" step="0.000001" min="-90" max="90" required defaultValue={defaults.latitude} /></label><label>Kinh độ<input name="longitude" type="number" step="0.000001" min="-180" max="180" required defaultValue={defaults.longitude} /></label></div>
      <label>Phạm vi hiển thị<select name="visibility" defaultValue={defaults.visibility}><option value="officer">Chỉ cán bộ</option><option value="public">Công khai cho người dân</option></select></label>
      <label>Số điện thoại<input name="contactPhone" type="tel" inputMode="tel" defaultValue={defaults.contactPhone ?? ''} placeholder="02633…" /></label>
      <label>Mô tả<textarea name="description" rows={3} maxLength={1200} defaultValue={defaults.description ?? ''} /></label>
      <button className="ops-submit" disabled={busy}><Save size={17} /> {busy ? 'Đang lưu…' : 'Lưu điểm bản đồ'}</button>
    </form></div>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}
  </div>;
}
