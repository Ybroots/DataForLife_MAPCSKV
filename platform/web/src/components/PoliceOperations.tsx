import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { readDevicePosition, supportsDeviceLocation, type DevicePosition } from '../device-location';
import { BarChart3, BellRing, Bot, Camera, CheckCircle2, ClipboardCheck, Database, LocateFixed, MapPinned, Play, Pause, RadioTower, Route, ShieldCheck } from 'lucide-react';
import { ApiError, confirmShiftReport, createPatrolSession, createPublicAlert, getShiftSummary, listPatrolSessions, updatePatrolSession } from '../api';
import type { PatrolSession, PublicAlert, ShiftSummary } from '../types';

import { OfficerStatisticsPanel } from './OfficerStatisticsPanel';
import { OfficerMapDataManager } from './OfficerMapDataManager';
import type { AlertPoint } from './AlertLocationPicker';

const AlertLocationPicker = lazy(async () => {
  const module = await import('./AlertLocationPicker');
  return { default: module.AlertLocationPicker };
});

type Tab = 'reports' | 'mapdata' | 'alerts' | 'patrol' | 'shift' | 'roadmap';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Không thể kết nối nghiệp vụ.';
}

export function PoliceOperations({ localityCode }: { localityCode: string | null }) {
  const [tab, setTab] = useState<Tab>('reports');
  const [alertPoint, setAlertPoint] = useState<AlertPoint | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [patrols, setPatrols] = useState<PatrolSession[]>([]);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [patrolData, shiftData] = await Promise.all([listPatrolSessions(), getShiftSummary()]);
      setPatrols(patrolData); setSummary(shiftData);
    } catch (error) { setNotice(errorText(error)); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submitAlert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice('');
    if (!alertPoint) { setNotice('Chọn vị trí cảnh báo trong ranh địa bàn: bấm vào bản đồ hoặc nhập tọa độ.'); return; }
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const now = new Date();
    const hours = Number(data.get('duration')) || 4;
    try {
      const alert = await createPublicAlert({
        title: String(data.get('title')), summary: String(data.get('summary')),
        category: String(data.get('category')) as PublicAlert['category'], riskLevel: String(data.get('risk')) as PublicAlert['riskLevel'],
        latitude: alertPoint.latitude, longitude: alertPoint.longitude, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
      });
      setNotice(`Đã phát hành cảnh báo “${alert.title}” trong ${hours} giờ. Cảnh báo hiện trên bản đồ người dân; thiết bị đã bật thông báo của địa bàn sẽ nhận trong ít phút.`);
      form.reset(); setAlertPoint(null); setPickerKey((key) => key + 1);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const submitPatrol = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    try {
      await createPatrolSession(String(data.get('title')), String(data.get('routeNote')), new Date(String(data.get('scheduledAt'))).toISOString());
      setNotice('Đã tạo lịch tuần tra.'); form.reset(); await refresh();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const patrolAction = async (patrol: PatrolSession, action: 'start' | 'pause' | 'resume' | 'checkin' | 'complete') => {
    setBusy(true); setNotice('');
    try {
      if (action === 'checkin') {
        if (!supportsDeviceLocation()) throw new Error('Thiết bị không hỗ trợ GPS.');
        const position = await new Promise<DevicePosition>((resolve, reject) => readDevicePosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000 }));
        await updatePatrolSession(patrol.id, action, position.coords.latitude, position.coords.longitude);
      } else await updatePatrolSession(patrol.id, action);
      setNotice(action === 'checkin' ? 'Đã check-in vị trí hiện trường.' : 'Đã cập nhật lịch tuần tra.'); await refresh();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const submitShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const data = new FormData(event.currentTarget);
      const result = await confirmShiftReport(String(data.get('note') ?? ''));
      setNotice(`Đã xác nhận báo cáo ca lúc ${new Date(result.confirmedAt).toLocaleTimeString('vi-VN')}.`);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  return (
    <section className="police-operations-pane" aria-label="Nghiệp vụ địa bàn">
      <header className="operations-heading"><div><small>CÔNG CỤ TRỰC BAN</small><h2>Nghiệp vụ địa bàn</h2></div><span className="capability-active"><ShieldCheck size={15} /> Hoạt động local</span></header>
      <div className="operations-tabs" role="tablist" aria-label="Nhóm nghiệp vụ">
        <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><BarChart3 size={18} /> Báo cáo</button>
        <button role="tab" aria-selected={tab === 'mapdata'} className={tab === 'mapdata' ? 'active' : ''} onClick={() => setTab('mapdata')}><Database size={18} /> Bản đồ</button>
        <button role="tab" aria-selected={tab === 'alerts'} className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}><BellRing size={18} /> Cảnh báo</button>
        <button role="tab" aria-selected={tab === 'patrol'} className={tab === 'patrol' ? 'active' : ''} onClick={() => setTab('patrol')}><Route size={18} /> Tuần tra</button>
        <button role="tab" aria-selected={tab === 'shift'} className={tab === 'shift' ? 'active' : ''} onClick={() => setTab('shift')}><ClipboardCheck size={18} /> Cuối ca</button>
        <button role="tab" aria-selected={tab === 'roadmap'} className={tab === 'roadmap' ? 'active' : ''} onClick={() => setTab('roadmap')}><RadioTower size={18} /> Tích hợp</button>
      </div>

      {tab === 'reports' && <OfficerStatisticsPanel />}
      {tab === 'mapdata' && <OfficerMapDataManager />}

      {tab === 'alerts' && <form className="operations-form" onSubmit={submitAlert}>
        <div className="operations-intro"><BellRing size={24} /><div><h3>Phát hành cảnh báo khu vực</h3><p>Chọn vị trí trên bản đồ hoặc nhập tọa độ. Cảnh báo hiện ngay trên bản đồ người dân trong thời gian hiệu lực và gửi thông báo tới thiết bị đã bật thông báo.</p></div></div>
        <label>Tiêu đề<input name="title" minLength={5} maxLength={160} required placeholder="Ví dụ: Mật độ giao thông tăng" /></label>
        <div className="form-grid"><label>Nhóm<select name="category" defaultValue="security"><option value="security">An ninh</option><option value="traffic">Giao thông</option><option value="fire_rescue">PCCC/CNCH</option><option value="weather">Thời tiết</option><option value="other">Khác</option></select></label><label>Mức độ<select name="risk" defaultValue="info"><option value="info">Thông tin</option><option value="medium">Mức vừa</option><option value="high">Mức cao</option></select></label></div>
        <label>Nội dung<textarea name="summary" minLength={10} maxLength={1200} rows={5} required placeholder="Thông tin ngắn gọn, có hướng dẫn hành động cụ thể…" /></label>
        <Suspense fallback={<p className="workflow-empty">Đang mở bản đồ chọn vị trí…</p>}>
          <AlertLocationPicker key={pickerKey} localityCode={localityCode} onChange={setAlertPoint} />
        </Suspense>
        <label>Thời gian hiệu lực<select name="duration" defaultValue="4"><option value="2">2 giờ</option><option value="4">4 giờ</option><option value="8">8 giờ</option><option value="24">24 giờ</option></select></label>
        <button className="ops-submit" disabled={busy}><BellRing size={17} /> Phát hành cảnh báo</button>
      </form>}

      {tab === 'patrol' && <div className="operations-stack">
        <form className="operations-form" onSubmit={submitPatrol}>
          <div className="operations-intro"><MapPinned size={24} /><div><h3>Lập lịch tuần tra</h3><p>Theo dõi bắt đầu, tạm dừng, check-in GPS và kết thúc.</p></div></div>
          <label>Tên ca/tuyến<input name="title" minLength={5} maxLength={160} required placeholder="Tuần tra khu Hòa Bình" /></label>
          <label>Thời gian dự kiến<input name="scheduledAt" type="datetime-local" required /></label>
          <label>Tuyến và điểm cần kiểm tra<textarea name="routeNote" maxLength={1000} rows={3} /></label>
          <button className="ops-submit" disabled={busy}><Route size={17} /> Tạo lịch tuần tra</button>
        </form>
        <div className="patrol-list">{patrols.length === 0 && <p className="workflow-empty">Chưa có lịch tuần tra.</p>}{patrols.map((patrol) => <article key={patrol.id} className={`patrol-card ${patrol.status}`}><div><span>{patrol.status === 'planned' ? 'Chờ bắt đầu' : patrol.status === 'active' ? 'Đang tuần tra' : patrol.status === 'paused' ? 'Tạm dừng' : 'Đã hoàn thành'}</span><h3>{patrol.title}</h3><p>{patrol.routeNote || 'Không có ghi chú tuyến.'}</p><small>{new Date(patrol.scheduledAt).toLocaleString('vi-VN')}</small>{patrol.lastCheckin && <small>Check-in: {patrol.lastCheckin.latitude.toFixed(5)}, {patrol.lastCheckin.longitude.toFixed(5)}</small>}</div><div className="patrol-actions">{patrol.status === 'planned' && <button onClick={() => void patrolAction(patrol, 'start')}><Play size={15} /> Bắt đầu</button>}{patrol.status === 'active' && <><button onClick={() => void patrolAction(patrol, 'checkin')}><LocateFixed size={15} /> Check-in</button><button onClick={() => void patrolAction(patrol, 'pause')}><Pause size={15} /> Tạm dừng</button><button onClick={() => void patrolAction(patrol, 'complete')}><CheckCircle2 size={15} /> Kết thúc</button></>}{patrol.status === 'paused' && <button onClick={() => void patrolAction(patrol, 'resume')}><Play size={15} /> Tiếp tục</button>}</div></article>)}</div>
      </div>}

      {tab === 'shift' && <form className="operations-form" onSubmit={submitShift}>
        <div className="operations-intro"><ClipboardCheck size={24} /><div><h3>Báo cáo nhanh cuối ca</h3><p>Số liệu được tổng hợp trực tiếp từ hồ sơ, SOS và lịch tuần tra trong ngày.</p></div></div>
        {summary && <div className="shift-metrics"><span><strong>{summary.incidentsReceived}</strong>Phản ánh nhận</span><span><strong>{summary.incidentsResolved}</strong>Phản ánh xong</span><span><strong>{summary.sosReceived}</strong>SOS nhận</span><span><strong>{summary.sosResolved}</strong>SOS xong</span><span><strong>{summary.patrolsCompleted}</strong>Ca tuần tra</span><span className={summary.overdueOpen ? 'warning' : ''}><strong>{summary.overdueOpen}</strong>Quá hạn mở</span></div>}
        <label>Ghi chú bàn giao<textarea name="note" maxLength={2000} rows={6} placeholder="Việc còn tồn, đầu mối phối hợp, nội dung cần ca sau tiếp tục…" /></label>
        <button className="ops-submit" disabled={busy}><ClipboardCheck size={17} /> Xác nhận báo cáo ca</button>
      </form>}

      {tab === 'roadmap' && <div className="development-grid">
        {[{ icon: <ShieldCheck />, title: 'Xác thực VNeID', note: 'Chờ kết nối định danh và quy trình phê duyệt.' }, { icon: <Bot />, title: 'AI phân loại & trợ lý', note: 'Chờ mô hình, kho tri thức và cơ chế kiểm duyệt.' }, { icon: <Camera />, title: 'Camera địa bàn', note: 'Chờ nền tảng camera và phân quyền truy cập.' }, { icon: <RadioTower />, title: 'SMS, Web Push, 112/113', note: 'Chờ nhà cung cấp và đầu mối nghiệp vụ chính thức.' }].map((item) => <article key={item.title}><span>{item.icon}</span><div><em>Đang phát triển</em><h3>{item.title}</h3><p>{item.note}</p></div></article>)}
      </div>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
    </section>
  );
}
