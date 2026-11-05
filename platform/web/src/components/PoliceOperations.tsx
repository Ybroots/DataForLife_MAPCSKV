import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, BellRing, Pencil, Trash2, X, Camera, Database, RadioTower, UserRoundCheck } from 'lucide-react';
import { ApiError, cancelPublicAlert, createPublicAlert, listPublicAlerts, lookupByCode, updatePublicAlert } from '../api';
import { filterPointsInZone, zoneBoundaryOf } from '../area-scope';
import type { PublicAlert, ServiceArea } from '../types';

import { OfficerStatisticsPanel } from './OfficerStatisticsPanel';
import { CommanderAreaPanel } from './CommanderAreaPanel';
import { OfficerMapDataManager } from './OfficerMapDataManager';
import type { AlertPoint } from './AlertLocationPicker';

const AlertLocationPicker = lazy(async () => {
  const module = await import('./AlertLocationPicker');
  return { default: module.AlertLocationPicker };
});

type Tab = 'areas' | 'reports' | 'mapdata' | 'alerts' | 'roadmap';

const alertRiskLabels: Record<PublicAlert['riskLevel'], string> = { info: 'Thông tin', medium: 'Mức vừa', high: 'Mức cao' };

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Không kết nối được máy chủ. Vui lòng thử lại.';
}

/** commander: chỉ huy xem khu vực và báo cáo, không có nghiệp vụ ghi (cảnh báo, tuần tra, cuối ca, bản đồ, tài khoản dân). */
export function PoliceOperations({ localityCode, serviceAreaCode = null, unitName, commander = false, editRequest = null, areaFocus = null }: { localityCode: string | null; serviceAreaCode?: string | null; unitName?: string; commander?: boolean; editRequest?: { alert: PublicAlert; nonce: number } | null; areaFocus?: { areaCode: string; nonce: number } | null }) {
  const [tab, setTab] = useState<Tab>(commander ? 'areas' : 'reports');
  const [alertPoint, setAlertPoint] = useState<AlertPoint | null>(null);
  const [allAlerts, setActiveAlerts] = useState<PublicAlert[]>([]);
  const [zoneBoundary, setZoneBoundary] = useState<ServiceArea['boundary'] | null>(null);
  const [editingAlert, setEditingAlert] = useState<PublicAlert | null>(null);
  const [removeArmedId, setRemoveArmedId] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setZoneBoundary(null);
    if (commander || !localityCode || !serviceAreaCode) return undefined;
    let cancelled = false;
    void lookupByCode(localityCode).then((payload) => { if (!cancelled) setZoneBoundary(zoneBoundaryOf(payload.data, serviceAreaCode)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [commander, localityCode, serviceAreaCode]);
  // Cán bộ khu vực chỉ thấy cảnh báo nằm trong khu vực của mình (chờ có ranh khu vực rồi mới hiện).
  const activeAlerts = useMemo(() => (serviceAreaCode ? (zoneBoundary ? filterPointsInZone(allAlerts, zoneBoundary) : []) : allAlerts), [allAlerts, serviceAreaCode, zoneBoundary]);

  const loadAlerts = useCallback(async () => {
    if (!localityCode) return;
    try { setActiveAlerts(await listPublicAlerts(localityCode)); } catch (error) { setNotice(errorText(error)); }
  }, [localityCode]);

  useEffect(() => { if (tab === 'alerts') void loadAlerts(); }, [tab, loadAlerts]);

  // Bấm "Sửa cảnh báo" trên bản đồ: mở tab Cảnh báo ở chế độ sửa.
  useEffect(() => {
    if (!editRequest) return;
    setTab('alerts'); setEditingAlert(editRequest.alert); setPickerKey((key) => key + 1); setNotice('');
  }, [editRequest]);

  // Chỉ huy bấm một khu trên bản đồ: mở tab Khu vực.
  useEffect(() => {
    if (areaFocus && commander) setTab('areas');
  }, [areaFocus, commander]);

  const startEdit = (alert: PublicAlert) => { setEditingAlert(alert); setAlertPoint(null); setPickerKey((key) => key + 1); setNotice(''); };
  const stopEdit = () => { setEditingAlert(null); setAlertPoint(null); setPickerKey((key) => key + 1); };

  const removeAlert = async (alert: PublicAlert) => {
    if (removeArmedId !== alert.id) { setRemoveArmedId(alert.id); return; }
    setBusy(true); setNotice(''); setRemoveArmedId(null);
    try {
      await cancelPublicAlert(alert.id);
      if (editingAlert?.id === alert.id) stopEdit();
      setNotice(`Đã gỡ cảnh báo “${alert.title}”. Người dân không còn thấy cảnh báo này trên bản đồ.`);
      await loadAlerts();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const submitAlertEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice('');
    if (!editingAlert) return;
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const updated = await updatePublicAlert(editingAlert.id, {
        title: String(data.get('title')), summary: String(data.get('summary')),
        category: String(data.get('category')) as PublicAlert['category'], riskLevel: String(data.get('risk')) as PublicAlert['riskLevel'],
        ...(alertPoint ? { latitude: alertPoint.latitude, longitude: alertPoint.longitude } : {}),
      });
      setNotice(`Đã cập nhật cảnh báo “${updated.title}”.`);
      stopEdit(); await loadAlerts();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const submitAlert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice('');
    if (!alertPoint) { setNotice('Chọn vị trí cảnh báo trong ranh địa bàn: bấm vào bản đồ hoặc nhập tọa độ.'); return; }
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    try {
      const alert = await createPublicAlert({
        title: String(data.get('title')), summary: String(data.get('summary')),
        category: String(data.get('category')) as PublicAlert['category'], riskLevel: String(data.get('risk')) as PublicAlert['riskLevel'],
        latitude: alertPoint.latitude, longitude: alertPoint.longitude, 
      });
      setNotice(`Đã phát hành cảnh báo “${alert.title}”. Cảnh báo giữ nguyên cho đến khi cán bộ gỡ; hiện trên bản đồ người dân; thiết bị đã bật thông báo của địa bàn sẽ nhận trong ít phút.`);
      form.reset(); setAlertPoint(null); setPickerKey((key) => key + 1);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  return (
    <section className="police-operations-pane" aria-label="Nghiệp vụ địa bàn">
      <header className="operations-heading"><div><h2>Nghiệp vụ địa bàn</h2></div></header>
      <div className="operations-tabs" role="tablist" aria-label="Nhóm chức năng">
        {commander && <button role="tab" aria-selected={tab === 'areas'} className={tab === 'areas' ? 'active' : ''} onClick={() => setTab('areas')}><UserRoundCheck size={18} /> Khu vực</button>}
        <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><BarChart3 size={18} /> Báo cáo</button>
        {!commander && <button role="tab" aria-selected={tab === 'mapdata'} className={tab === 'mapdata' ? 'active' : ''} onClick={() => setTab('mapdata')}><Database size={18} /> Bản đồ</button>}
        <button role="tab" aria-selected={tab === 'alerts'} className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}><BellRing size={18} /> Cảnh báo</button>
        {!commander && <>
          <button role="tab" aria-selected={tab === 'roadmap'} className={tab === 'roadmap' ? 'active' : ''} onClick={() => setTab('roadmap')}><RadioTower size={18} /> Sắp có</button>
        </>}
      </div>

      {tab === 'areas' && commander && <CommanderAreaPanel focus={areaFocus} />}
      {tab === 'reports' && <OfficerStatisticsPanel unitName={unitName} commander={commander} />}
      {tab === 'mapdata' && <OfficerMapDataManager zoneBoundary={serviceAreaCode ? zoneBoundary : null} />}

      {tab === 'alerts' && <div className="operations-stack">
        <section className="alert-manage-list" aria-label="Cảnh báo đang hiển thị">
          <h3>Cảnh báo đang hiển thị ({activeAlerts.length})</h3>
          {activeAlerts.length === 0 && <p className="workflow-empty">Chưa có cảnh báo nào đang hiển thị.</p>}
          {activeAlerts.map((alert) => (
            <article key={alert.id} className={`alert-manage-item ${alert.riskLevel}${editingAlert?.id === alert.id ? ' editing' : ''}`}>
              <div>
                <strong>{alert.title}</strong>
                <small>{alertRiskLabels[alert.riskLevel]} · đến khi gỡ{alert.latitude === null ? ' · chưa có vị trí' : ''}</small>
              </div>
              <div className="alert-manage-actions">
                <button type="button" disabled={busy} onClick={() => startEdit(alert)}><Pencil size={15} aria-hidden="true" /> Sửa</button>
                <button type="button" className="danger" disabled={busy} onClick={() => void removeAlert(alert)}><Trash2 size={15} aria-hidden="true" /> {removeArmedId === alert.id ? 'Bấm lần nữa để gỡ' : 'Gỡ'}</button>
              </div>
            </article>
          ))}
        </section>
        <form className="operations-form" key={editingAlert?.id ?? 'new'} onSubmit={editingAlert ? submitAlertEdit : submitAlert}>
          <div className="operations-intro"><BellRing size={24} /><div><h3>{editingAlert ? 'Sửa cảnh báo khu vực' : 'Phát hành cảnh báo khu vực'}</h3></div></div>
          <label>Tiêu đề<input name="title" minLength={5} maxLength={160} required defaultValue={editingAlert?.title} placeholder="Ví dụ: Mật độ giao thông tăng" /></label>
          <div className="form-grid"><label>Nhóm<select name="category" defaultValue={editingAlert?.category ?? 'security'}><option value="security">An ninh</option><option value="traffic">Giao thông</option><option value="fire_rescue">PCCC/CNCH</option><option value="weather">Thời tiết</option><option value="other">Khác</option></select></label><label>Mức độ<select name="risk" defaultValue={editingAlert?.riskLevel ?? 'info'}><option value="info">Thông tin</option><option value="medium">Mức vừa</option><option value="high">Mức cao</option></select></label></div>
          <label>Nội dung<textarea name="summary" minLength={10} maxLength={1200} rows={5} required defaultValue={editingAlert?.summary} placeholder="Thông tin ngắn gọn, có hướng dẫn hành động cụ thể…" /></label>
          <Suspense fallback={<p className="workflow-empty">Đang mở bản đồ chọn vị trí…</p>}>
            <AlertLocationPicker
              key={`${pickerKey}-${editingAlert?.id ?? 'new'}`}
              localityCode={localityCode}
              serviceAreaCode={serviceAreaCode}
              initialPoint={editingAlert && editingAlert.latitude !== null && editingAlert.longitude !== null ? { latitude: editingAlert.latitude, longitude: editingAlert.longitude } : null}
              onChange={setAlertPoint}
            />
          </Suspense>
          <div className="ops-submit-row">
            <button className="ops-submit" disabled={busy}><BellRing size={17} /> {editingAlert ? 'Lưu thay đổi' : 'Phát hành cảnh báo'}</button>
            {editingAlert && <button type="button" className="ops-cancel" disabled={busy} onClick={stopEdit}><X size={16} aria-hidden="true" /> Hủy sửa</button>}
          </div>
        </form>
      </div>}
      {tab === 'roadmap' && <div className="development-grid">
        {[{ icon: <Camera />, title: 'Camera địa bàn' }, { icon: <RadioTower />, title: 'SMS và thông báo đẩy' }].map((item) => <article key={item.title}><span>{item.icon}</span><div><em>Đang phát triển</em><h3>{item.title}</h3></div></article>)}
      </div>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
    </section>
  );
}
