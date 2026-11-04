import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  BellRing,
  ChevronRight,
  ClipboardList,
  Clock3,
  Filter,
  FileWarning,
  ListFilter,
  LogOut,
  MapPinned,
  Navigation,
  PhoneCall,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Siren,
  Star,
  UserRoundCheck,
  X,
  Bell,
  BellOff,
} from 'lucide-react';
import {
  ApiError,
  getOfficerIncident,
  getOfficerSos,
  listOfficerArchive,
  listOfficerQueue,
  listWorkflowActors,
  transitionOfficerIncident,
  transitionOfficerSos,
} from '../api';
import type {
  Incident,
  IncidentStatus,
  OfficerQueueItem,
  SosEvent,
  SosStatus,
  WorkflowActor,
} from '../types';
import { useSosAlerts } from '../officer-alerts';
import { WorkflowTimeline } from './WorkflowTimeline';
import { IncidentCollaboration } from './IncidentCollaboration';
import { PoliceOperations } from './PoliceOperations';
import { SosEmergencyOverlay } from './SosEmergencyOverlay';
import { AssigneeHint } from './AssigneeHint';
import { IncidentInsights } from './IncidentInsights';
import { QueueThumb } from './QueueThumb';
import { CaseActionCard } from './CaseActionCard';
import { stepAssignsSelf } from '../case-actions';
import type { CaseAction } from '../case-actions';
import directoryLogoUrl from '../../../../assets/images/logo-transparent.png';

type WorkDetail = Incident | SosEvent;
/** Shown to the citizen in the SOS timeline when an officer takes the SOS from the alarm screen. */
const QUICK_ACK_NOTE = 'Cán bộ khu vực đã nhận tín hiệu SOS và đang liên hệ với bạn.';
type QueueScope = 'attention' | 'mine' | 'all' | 'archive';
type MobilePane = 'queue' | 'map' | 'detail' | 'operations';

const PoliceDutyMap = lazy(async () => {
  const module = await import('./PoliceDutyMap');
  return { default: module.PoliceDutyMap };
});

const statusLabels: Record<string, string> = {
  submitted: 'Chờ tiếp nhận', received: 'Đã tiếp nhận', assigned: 'Đã phân công', verifying: 'Đang xác minh',
  processing: 'Đang xử lý', resolved: 'Đã có kết quả', closed: 'Đã đóng', rejected: 'Không thuộc phạm vi',
  triggered: 'Vừa kích hoạt', dispatched: 'Chờ xác nhận', acknowledged: 'Đã xác nhận', responding: 'Đang triển khai xử lý',
  escalated: 'Đã chuyển tuyến', cancelled_by_citizen: 'Người dân đã hủy',
};

const categoryLabels: Record<string, string> = {
  security: 'An ninh trật tự', traffic: 'Giao thông', public_order: 'Trật tự đô thị',
  administrative: 'Thủ tục hành chính', environment: 'Môi trường', other: 'Nội dung khác',
  traffic_accident: 'Tai nạn giao thông', fire_rescue: 'Cháy / cứu nạn', medical: 'Cấp cứu y tế',
  other_emergency: 'Tình huống nguy cấp khác',
};

const attentionStatuses = new Set(['submitted', 'received', 'dispatched', 'acknowledged', 'escalated']);
const priorityLabels: Record<OfficerQueueItem['priority'], string> = {
  low: 'Ưu tiên thấp', normal: 'Thông thường', high: 'Ưu tiên cao', urgent: 'Khẩn', critical: 'Đặc biệt khẩn',
};
const priorityRanks: Record<OfficerQueueItem['priority'], number> = {
  low: 0, normal: 1, high: 2, urgent: 3, critical: 4,
};

const timeFormatter = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Không thể kết nối cổng nghiệp vụ.';
}

function workTitle(detail: WorkDetail): string {
  return detail.kind === 'incident' ? detail.summary : detail.note || 'Yêu cầu hỗ trợ khẩn cấp';
}

function ageInMinutes(value: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function ageLabel(value: string): string {
  const minutes = ageInMinutes(value);
  if (minutes < 1) return 'Vừa nhận';
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

function isOverdue(item: OfficerQueueItem): boolean {
  const limits: Partial<Record<IncidentStatus | SosStatus, number>> = {
    submitted: 15,
    received: 30,
    dispatched: 2,
    acknowledged: 5,
    responding: 30,
  };
  const limit = limits[item.status];
  return limit !== undefined && ageInMinutes(item.createdAt) > limit;
}

function policeParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = new URL(window.location.href).searchParams.get(name) as T | null;
  return value && allowed.includes(value) ? value : fallback;
}

interface PolicePortalProps {
  onSignOut: () => void;
  sessionActor: WorkflowActor;
}

export function PolicePortal({ onSignOut, sessionActor }: PolicePortalProps) {
  const currentActorId = sessionActor.id;
  const detailRequestId = useRef(0);
  const [queue, setQueue] = useState<OfficerQueueItem[]>([]);
  const [actors, setActors] = useState<WorkflowActor[]>([]);
  const [scope, setScope] = useState<QueueScope>(() => policeParam('scope', ['attention', 'mine', 'all', 'archive'], 'attention'));
  const [queueQuery, setQueueQuery] = useState('');
  // Hồ sơ đã đóng/từ chối: không còn trong hàng đợi nhưng vẫn xem lại được lịch sử xử lý.
  const [archive, setArchive] = useState<OfficerQueueItem[]>([]);
  const archiveRef = useRef<OfficerQueueItem[]>([]);
  const [archiveFrom, setArchiveFrom] = useState('');
  const [archiveTo, setArchiveTo] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [justArchived, setJustArchived] = useState<{ key: string; code: string } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => new URL(window.location.href).searchParams.get('case'));
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => policeParam('pane', ['queue', 'map', 'detail', 'operations'], 'queue'));
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sosAcceptingId, setSosAcceptingId] = useState<string | null>(null);
  const [sosAlertError, setSosAlertError] = useState('');

  const filteredQueue = useMemo(() => {
    const normalizedQuery = queueQuery.trim().toLocaleLowerCase('vi-VN');
    if (scope === 'archive') return archive;
    const matches = queue.filter((item) => {
      if (scope === 'mine' && item.assignedOfficer?.id !== currentActorId) return false;
      if (scope === 'attention' && !attentionStatuses.has(item.status) && !isOverdue(item)) return false;
      if (!normalizedQuery) return true;
      return [item.receiptCode, item.title, item.localityName, item.serviceAreaName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase('vi-VN').includes(normalizedQuery));
    });
    return [...matches].sort((left, right) => {
      const overdueDelta = Number(isOverdue(right)) - Number(isOverdue(left));
      if (overdueDelta) return overdueDelta;
      const emergencyDelta = Number(right.kind === 'sos') - Number(left.kind === 'sos');
      if (emergencyDelta) return emergencyDelta;
      const priorityDelta = priorityRanks[right.priority] - priorityRanks[left.priority];
      return priorityDelta || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }, [archive, currentActorId, queue, queueQuery, scope]);
  const selectedItem = useMemo(() => queue.find((item) => `${item.kind}:${item.id}` === selectedKey) ?? archive.find((item) => `${item.kind}:${item.id}` === selectedKey) ?? null, [archive, queue, selectedKey]);
  const currentActor = actors.find((actor) => actor.id === currentActorId) ?? sessionActor;
  const alerts = useSosAlerts(queue, lastUpdated !== null);

  const loadQueue = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [queuePayload, actorsPayload] = await Promise.all([
        listOfficerQueue(),
        actors.length ? Promise.resolve({ data: actors }) : listWorkflowActors(),
      ]);
      setQueue(queuePayload.data);
      setActors(actorsPayload.data);
      setLastUpdated(new Date());
      setError('');
      setSelectedKey((current) => {
        const currentStillExists = current && (queuePayload.data.some((item) => `${item.kind}:${item.id}` === current)
          || archiveRef.current.some((item) => `${item.kind}:${item.id}` === current));
        if (currentStillExists) return current;
        const first = queuePayload.data[0];
        return first ? `${first.kind}:${first.id}` : null;
      });
    } catch (caught) {
      if (!quiet) setError(errorMessage(caught));
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const loadArchive = async () => {
    setArchiveLoading(true);
    try {
      const items = await listOfficerArchive({ q: queueQuery, from: archiveFrom || undefined, to: archiveTo || undefined });
      archiveRef.current = items;
      setArchive(items);
      setError('');
      setSelectedKey((current) => current && items.some((item) => `${item.kind}:${item.id}` === current) ? current : items[0] ? `${items[0].kind}:${items[0].id}` : null);
    } catch (caught) { setError(errorMessage(caught)); } finally { setArchiveLoading(false); }
  };

  useEffect(() => {
    if (scope !== 'archive') return;
    // Gõ tìm kiếm thì chờ một nhịp để không gọi máy chủ sau mỗi phím.
    const timer = window.setTimeout(() => void loadArchive(), 250);
    return () => window.clearTimeout(timer);
  }, [scope, queueQuery, archiveFrom, archiveTo]);

  const loadDetail = async (item: OfficerQueueItem) => {
    const requestId = ++detailRequestId.current;
    setDetailLoading(true);
    setError('');
    try {
      const payload = item.kind === 'incident' ? await getOfficerIncident(item.id) : await getOfficerSos(item.id);
      if (requestId !== detailRequestId.current) return;
      setDetail(payload.data);
    } catch (caught) {
      if (requestId === detailRequestId.current) setError(errorMessage(caught));
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
    const timer = window.setInterval(() => void loadQueue(true), 8_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    // A successful transition already returned the full, newer detail. The
    // subsequent queue refresh must not reload it and erase the next draft.
    if (detail?.id === selectedItem.id && detail.kind === selectedItem.kind
      && Date.parse(detail.updatedAt) >= Date.parse(selectedItem.updatedAt)) return;
    void loadDetail(selectedItem);
  }, [selectedItem?.id, selectedItem?.kind, selectedItem?.updatedAt]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('kind');
    url.searchParams.delete('sort');
    if (scope === 'attention') url.searchParams.delete('scope'); else url.searchParams.set('scope', scope);
    if (mobilePane === 'queue') url.searchParams.delete('pane'); else url.searchParams.set('pane', mobilePane);
    if (selectedKey) url.searchParams.set('case', selectedKey); else url.searchParams.delete('case');
    window.history.replaceState({}, '', url);
  }, [mobilePane, scope, selectedKey]);

  const selectItem = (item: OfficerQueueItem) => {
    const key = `${item.kind}:${item.id}`;
    if (key === selectedKey) {
      setMobilePane('detail');
      if (!detail && !detailLoading) void loadDetail(item);
      return;
    }
    detailRequestId.current += 1;
    setDetail(null);
    setSelectedKey(key);
    setMobilePane('detail');
  };

  // Alarm screen: take the SOS in one tap (acknowledged + assigned to me, message to the citizen), then open it.
  const acceptSos = async (item: OfficerQueueItem) => {
    setSosAcceptingId(item.id);
    setSosAlertError('');
    try {
      const payload = await transitionOfficerSos(item.id, 'acknowledged', QUICK_ACK_NOTE, currentActorId, true);
      alerts.hide([item.id]);
      detailRequestId.current += 1;
      setSelectedKey(`sos:${item.id}`);
      setDetail(payload.data);
      setMobilePane('detail');
      await loadQueue(true);
    } catch (caught) {
      setSosAlertError(`${errorMessage(caught)} Hàng đợi đã được tải lại.`);
      await loadQueue(true);
    } finally {
      setSosAcceptingId(null);
    }
  };

  const alarmFrontId = alerts.overlayItems[0]?.id;
  useEffect(() => { setSosAlertError(''); }, [alarmFrontId]);

  // Mở một phản ánh khác từ khối "Phản ánh trùng" (kể cả hồ sơ đã đóng, không còn trong hàng đợi).
  const openIncidentById = (id: string) => {
    const item = queue.find((entry) => entry.kind === 'incident' && entry.id === id);
    if (item) { selectItem(item); return; }
    const requestId = ++detailRequestId.current;
    setDetailLoading(true);
    setError('');
    getOfficerIncident(id)
      .then((payload) => { if (requestId === detailRequestId.current) { setDetail(payload.data); setMobilePane('detail'); } })
      .catch((caught) => { if (requestId === detailRequestId.current) setError(errorMessage(caught)); })
      .finally(() => { if (requestId === detailRequestId.current) setDetailLoading(false); });
  };

  const viewSosFromAlarm = (item: OfficerQueueItem) => {
    alerts.hide([item.id]);
    setSosAlertError('');
    selectItem(item);
  };

  // One tap = one or more legal transitions in order. Only the last one carries the citizen-visible message.
  const runCaseAction = async (action: CaseAction, note: string, tellCitizen: boolean): Promise<boolean> => {
    if (!detail) return false;
    setTransitioning(true);
    setError('');
    try {
      let latest: WorkDetail = detail;
      for (const [index, status] of action.steps.entries()) {
        const assignTo = stepAssignsSelf(status) ? currentActorId : undefined;
        const visible = tellCitizen && index === action.steps.length - 1;
        const payload = latest.kind === 'incident'
          ? await transitionOfficerIncident(latest.id, status as IncidentStatus, note, assignTo, visible)
          : await transitionOfficerSos(latest.id, status as SosStatus, note, assignTo, visible);
        latest = payload.data;
        setDetail(latest);
      }
      await loadQueue(true);
      if (latest.status === 'closed' || latest.status === 'rejected') {
        // Hồ sơ rời hàng đợi nhưng toàn bộ lịch sử xử lý vẫn lưu ở mục "Đã đóng".
        setJustArchived({ key: `${latest.kind}:${latest.id}`, code: latest.receiptCode });
        window.setTimeout(() => setJustArchived((current) => current?.key === `${latest.kind}:${latest.id}` ? null : current), 25_000);
      }
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      await loadQueue(true);
      return false;
    } finally {
      setTransitioning(false);
    }
  };

  const attentionCount = queue.filter((item) => attentionStatuses.has(item.status) || isOverdue(item)).length;
  const mineCount = queue.filter((item) => item.assignedOfficer?.id === currentActorId).length;
  const scopeLabels: Record<QueueScope, string> = {
    attention: `Cần làm${attentionCount ? ` (${attentionCount})` : ''}`,
    mine: `Của tôi${mineCount ? ` (${mineCount})` : ''}`,
    all: `Tất cả (${queue.length})`,
    archive: 'Đã đóng',
  };
  // The sound switch asks for browser notifications once, so the alarm also reaches a hidden tab.
  const toggleSound = async () => {
    if (alerts.enabled) { alerts.disable(); return; }
    await alerts.enable();
    if (alerts.permission === 'default') void alerts.requestPermission();
  };

  return (
    <div className="police-portal" data-mobile-pane={mobilePane}>
      <a className="skip-link" href="#police-main">Đến hàng đợi xử lý</a>
      <header className="police-topbar">
        <a className="police-brand" href="./" aria-label="Cổng nghiệp vụ CSKV" onClick={(e) => { e.preventDefault(); onSignOut(); }}>
          <img src={directoryLogoUrl} alt="" width="38" height="38" />
          <span><strong>Cổng nghiệp vụ CSKV</strong><small>{currentActor?.displayName ?? 'CSKV trực địa bàn'}</small></span>
        </a>
        <nav className="police-topnav" aria-label="Chức năng cổng cán bộ">
          <button type="button" className={mobilePane === 'queue' || mobilePane === 'detail' ? 'active' : ''} onClick={() => { setScope('attention'); setMobilePane('queue'); }}>
            <ClipboardList size={18} aria-hidden="true" /><span>Hàng đợi</span>{attentionCount > 0 && <em>{attentionCount}</em>}
          </button>
          <button type="button" className={mobilePane === 'map' ? 'active' : ''} onClick={() => setMobilePane('map')}><MapPinned size={18} aria-hidden="true" /><span>Bản đồ</span></button>
          <button type="button" className={mobilePane === 'operations' ? 'active' : ''} onClick={() => setMobilePane('operations')}><RadioTower size={18} aria-hidden="true" /><span>Nghiệp vụ</span></button>
        </nav>
        <div className="topbar-right-actions">
          <button
            type="button"
            className={alerts.enabled ? 'topbar-sound on' : 'topbar-sound'}
            aria-pressed={alerts.enabled}
            aria-label={alerts.enabled ? 'Tắt còi báo SOS' : 'Bật còi báo SOS'}
            title={alerts.enabled ? 'Còi báo SOS đang bật. Bấm để tắt.' : 'Còi báo SOS đang tắt. Bấm để bật.'}
            onClick={() => void toggleSound()}
          >
            {alerts.enabled ? <Bell size={19} aria-hidden="true" /> : <BellOff size={19} aria-hidden="true" />}
            <span>{alerts.enabled ? 'Còi bật' : 'Còi tắt'}</span>
          </button>
          <button className="topbar-icon-btn logout" type="button" onClick={onSignOut} aria-label="Đăng xuất" title="Đăng xuất">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="police-main" id="police-main">
        <div className="police-workspace">
          <aside className="police-queue-pane" aria-label="Hàng đợi địa bàn">
            <div className="queue-search-row">
              <label className="queue-search">
                <span className="sr-only">Tìm trong hàng đợi</span>
                <Search size={18} aria-hidden="true" />
                <input name="queueQuery" type="search" autoComplete="off" value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} placeholder="Tìm hồ sơ" />
              </label>
              <button className="queue-refresh" type="button" onClick={() => void loadQueue()} disabled={loading} aria-label="Tải lại hàng đợi"><RefreshCw size={18} aria-hidden="true" /></button>
            </div>
            <div className="queue-scopes" role="group" aria-label="Phạm vi hàng đợi">
              {(['attention', 'mine', 'all', 'archive'] as const).map((value) => (
                <button type="button" key={value} className={scope === value ? 'active' : ''} aria-pressed={scope === value} onClick={() => setScope(value)}>{scopeLabels[value]}</button>
              ))}
            </div>
            {justArchived && scope !== 'archive' && (
              <div className="archive-note" role="status">
                <span>Đã lưu hồ sơ <code>{justArchived.code}</code> vào mục Đã đóng.</span>
                <button type="button" onClick={() => { archiveRef.current = []; setArchive([]); setSelectedKey(justArchived.key); setScope('archive'); setJustArchived(null); setMobilePane('detail'); }}>Xem lịch sử</button>
              </div>
            )}
            {scope === 'archive' && (
              <div className="archive-filters" role="group" aria-label="Lọc hồ sơ đã đóng theo ngày">
                <label><span>Từ ngày</span><input type="date" value={archiveFrom} max={archiveTo || undefined} onChange={(event) => setArchiveFrom(event.target.value)} /></label>
                <label><span>Đến ngày</span><input type="date" value={archiveTo} min={archiveFrom || undefined} onChange={(event) => setArchiveTo(event.target.value)} /></label>
                {(archiveFrom || archiveTo) && <button type="button" onClick={() => { setArchiveFrom(''); setArchiveTo(''); }}>Xóa lọc</button>}
              </div>
            )}
            <div className="queue-list">
              {(scope === 'archive' ? archiveLoading && archive.length === 0 : loading) && <div className="queue-loading"><span className="loader" /> Đang tải…</div>}
              {!(scope === 'archive' ? archiveLoading && archive.length === 0 : loading) && filteredQueue.length === 0 && <div className="queue-empty"><ShieldCheck size={28} aria-hidden="true" /><strong>{scope === 'attention' ? 'Không có việc cần làm ngay' : 'Không có hồ sơ'}</strong>{scope === 'attention' && queue.length > 0 && <button type="button" onClick={() => setScope('all')}>Xem tất cả hồ sơ</button>}</div>}
              {filteredQueue.map((item) => {
                const overdue = isOverdue(item);
                const duplicateHint = item.duplicateOfReceiptCode ? 'Đã gộp' : item.suggestedDuplicateReceiptCode ? 'Có thể trùng' : '';
                return (
                  <button key={`${item.kind}:${item.id}`} type="button" className={`${selectedKey === `${item.kind}:${item.id}` ? 'queue-card active' : 'queue-card'} ${item.kind}${overdue ? ' overdue' : ''}`} onClick={() => selectItem(item)}>
                    <span className="queue-kind-icon">{item.kind === 'sos' ? <Siren size={20} aria-hidden="true" /> : <FileWarning size={20} aria-hidden="true" />}</span>
                    <span className="queue-card-copy">
                      <strong><span className="sr-only">{item.kind === 'sos' ? 'SOS: ' : 'Phản ánh: '}</span>{item.title}</strong>
                      <span className="queue-card-status">
                        <span className={`status-chip ${item.status}`}>{statusLabels[item.status] ?? item.status}</span>
                        {scope === 'archive'
                          ? <time dateTime={item.updatedAt}>Đóng {timeFormatter.format(new Date(item.updatedAt))}</time>
                          : <time dateTime={item.createdAt} className={overdue ? 'late' : ''}>{ageLabel(item.createdAt)}{overdue ? ' · quá hạn' : ''}</time>}
                        {duplicateHint && <span className="duplicate-chip">{duplicateHint}</span>}
                      </span>
                    </span>
                    {item.kind === 'incident' && item.previewAttachmentId && <QueueThumb incidentId={item.id} attachmentId={item.previewAttachmentId} photoCount={item.photoCount ?? 1} />}
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="police-case-pane" aria-label="Chi tiết hồ sơ">
            {detailLoading && <div className="case-loading"><span className="loader" /> Đang tải hồ sơ…</div>}
            {!detailLoading && !detail && <div className="case-placeholder"><ListFilter size={40} aria-hidden="true" /><h2>Chọn một hồ sơ</h2><p>Chi tiết, vị trí, lịch sử và hành động xử lý sẽ hiển thị tại đây.</p></div>}
            {!detailLoading && detail && (
              <>
                <button className="mobile-back-queue" type="button" onClick={() => setMobilePane('queue')}><ArrowLeft size={18} aria-hidden="true" /> Hàng đợi</button>
                <div className={detail.kind === 'sos' ? 'case-hero sos' : 'case-hero incident'}>
                  <div className="case-hero-icon">{detail.kind === 'sos' ? <AlertOctagon size={26} aria-hidden="true" /> : <FileWarning size={26} aria-hidden="true" />}</div>
                  <div><span>{detail.kind === 'sos' ? 'SOS' : 'Phản ánh'} · <code>{detail.receiptCode}</code></span><h2>{workTitle(detail)}</h2></div>
                  <span className={`status-chip ${detail.status}`}>{statusLabels[detail.status] ?? detail.status}</span>
                </div>

                <div className={detail.contactPhone ? 'case-quick-actions' : 'case-quick-actions single'} aria-label="Liên hệ và vị trí">
                  {detail.contactPhone && <a href={`tel:${detail.contactPhone}`}><PhoneCall size={20} aria-hidden="true" /><span>Gọi người dân</span></a>}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${detail.location.latitude},${detail.location.longitude}`} target="_blank" rel="noreferrer"><Navigation size={20} aria-hidden="true" /><span>Mở vị trí</span></a>
                </div>

                <CaseActionCard
                  kind={detail.kind}
                  status={detail.status}
                  caseKey={`${detail.kind}:${detail.id}`}
                  busy={transitioning}
                  onRun={runCaseAction}
                />

                <div className="case-stack">
                  <section className="ops-card case-overview-card">
                    <div className="ops-card-title"><h3>Nội dung</h3><span>{categoryLabels[detail.category] ?? detail.category}</span></div>
                    {detail.kind === 'incident' ? <p>{detail.description}</p> : <p>{detail.note || 'Người dân không nhập mô tả.'}</p>}
                    <dl className="ops-facts">
                      <div><dt>Gửi lúc</dt><dd>{timeFormatter.format(new Date(detail.createdAt))}</dd></div>
                      <div><dt>Điện thoại</dt><dd>{detail.contactPhone || 'Không cung cấp'}</dd></div>
                      <div><dt>Phụ trách</dt><dd>{detail.assignedOfficer?.displayName ?? 'Chưa có'}{detail.kind === 'incident' && !detail.assignedOfficer && <AssigneeHint incidentId={detail.id} />}</dd></div>
                      {detail.location.accuracyM && detail.location.accuracyM > 150 ? <div><dt>Vị trí</dt><dd>Chỉ gần đúng (sai số {Math.round(detail.location.accuracyM)} m)</dd></div> : null}
                    </dl>
                  </section>

                  {detail.kind === 'incident' && detail.satisfactionRating && (
                    <section className="ops-card officer-rating-card" aria-labelledby="officer-rating-title">
                      <div className="ops-card-title"><h3 id="officer-rating-title">Đánh giá của người dân</h3><span>{detail.satisfactionRating.score}/5</span></div>
                      <div className="officer-rating-stars" aria-label={`${detail.satisfactionRating.score} trên 5 sao`}>
                        {[1, 2, 3, 4, 5].map((score) => <Star key={score} size={21} fill={score <= detail.satisfactionRating!.score ? 'currentColor' : 'none'} aria-hidden="true" />)}
                      </div>
                      <p>{detail.satisfactionRating.comment || 'Người dân không nhập góp ý bổ sung.'}</p>
                    </section>
                  )}

                  {detail.kind === 'incident' && (
                    <IncidentInsights
                      incident={detail}
                      categoryLabels={categoryLabels}
                      onIncidentChange={(updated) => { setDetail(updated); void loadQueue(true); }}
                      onOpenCase={openIncidentById}
                    />
                  )}

                  {detail.kind === 'incident' && <IncidentCollaboration incident={detail} onAttachmentAdded={(attachment) => setDetail((current) => current?.kind === 'incident' ? { ...current, attachments: [...current.attachments, attachment] } : current)} />}

                  <details className="ops-card case-history">
                    <summary>Lịch sử xử lý ({detail.history.length})</summary>
                    <WorkflowTimeline history={detail.history} statusLabels={statusLabels} />
                  </details>
                </div>
              </>
            )}
            {error && <p className="ops-error" role="alert">{error}</p>}
          </section>

          <section className="police-duty-map-pane" aria-label="Bản đồ địa bàn trực ban">
            <Suspense fallback={<div className="duty-map-module-loading"><span className="loader" /> Đang mở bản đồ trực ban…</div>}>
              <PoliceDutyMap
                active={mobilePane === 'map'}
                localityCode={currentActor?.localityCode ?? null}
                queue={queue}
                onBackToQueue={() => setMobilePane('queue')}
                onOpenCase={selectItem}
              />
            </Suspense>
          </section>

          <PoliceOperations localityCode={currentActor?.localityCode ?? null} unitName={currentActor?.displayName} />
        </div>
      </main>

      <nav className="police-mobile-nav" aria-label="Điều hướng workspace">
        <button type="button" className={mobilePane === 'queue' ? 'active' : ''} onClick={() => setMobilePane('queue')}><ClipboardList size={21} aria-hidden="true" />Hàng đợi</button>
        <button type="button" className={mobilePane === 'map' ? 'active' : ''} onClick={() => setMobilePane('map')}><MapPinned size={21} aria-hidden="true" />Bản đồ</button>
        <button type="button" className={mobilePane === 'detail' ? 'active' : ''} onClick={() => setMobilePane('detail')} disabled={!detail}><FileWarning size={21} aria-hidden="true" />Hồ sơ</button>
        <button type="button" className={mobilePane === 'operations' ? 'active' : ''} onClick={() => setMobilePane('operations')}><RadioTower size={21} aria-hidden="true" />Nghiệp vụ</button>
      </nav>
      <SosEmergencyOverlay
        items={alerts.overlayItems}
        sirenOn={alerts.sirenOn}
        soundBlocked={alerts.soundBlocked}
        soundEnabled={alerts.enabled}
        acceptingId={sosAcceptingId}
        error={sosAlertError}
        onAccept={(item) => void acceptSos(item)}
        onView={viewSosFromAlarm}
        onMute={alerts.mute}
        onUnlockSound={alerts.unlockSound}
      />
    </div>
  );
}
