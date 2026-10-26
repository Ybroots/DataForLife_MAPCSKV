import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  BadgeCheck,
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  ExternalLink,
  Filter,
  FileWarning,
  ListFilter,
  LocateFixed,
  LogOut,
  MapPin,
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
  listOfficerQueue,
  listOfficerNotifications,
  listWorkflowActors,
  transitionOfficerIncident,
  transitionOfficerSos,
} from '../api';
import type {
  Incident,
  IncidentStatus,
  OfficerQueueItem,
  OfficerNotification,
  SosEvent,
  SosStatus,
  WorkflowActor,
} from '../types';
import { useSosAlerts } from '../officer-alerts';
import { WorkflowTimeline } from './WorkflowTimeline';
import { IncidentCollaboration } from './IncidentCollaboration';
import { PoliceOperations } from './PoliceOperations';
import directoryLogoUrl from '../../../../assets/images/logo-transparent.png';

type WorkDetail = Incident | SosEvent;
type QueueFilter = 'all' | 'sos' | 'incident';
type QueueScope = 'attention' | 'mine' | 'unassigned' | 'all';
type QueueSort = 'priority' | 'newest' | 'oldest';
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

// Keep in sync with api/src/workflow.ts (the API is the authority; this only decides which buttons to show).
const incidentNext: Record<IncidentStatus, IncidentStatus[]> = {
  submitted: ['received', 'closed'], received: ['assigned', 'rejected', 'closed'], assigned: ['verifying', 'processing', 'rejected'],
  verifying: ['processing', 'rejected'], processing: ['resolved', 'rejected'], resolved: ['closed', 'processing'],
  closed: [], rejected: ['closed'],
};

const sosNext: Record<SosStatus, SosStatus[]> = {
  triggered: ['dispatched', 'cancelled_by_citizen'], dispatched: ['acknowledged', 'escalated', 'cancelled_by_citizen'],
  acknowledged: ['responding', 'escalated', 'resolved'], responding: ['resolved', 'escalated'], escalated: ['acknowledged', 'responding'],
  resolved: ['closed', 'responding'], closed: [], cancelled_by_citizen: [],
};

const transitionLabels: Record<string, string> = {
  received: 'Xác nhận tiếp nhận', assigned: 'Phân công xử lý', verifying: 'Bắt đầu xác minh', processing: 'Chuyển sang xử lý',
  resolved: 'Ghi nhận kết quả', closed: 'Đóng hồ sơ', rejected: 'Chuyển trạng thái ngoài phạm vi',
  acknowledged: 'Xác nhận SOS', responding: 'Đang triển khai lực lượng', escalated: 'Chuyển tuyến / phối hợp đơn vị',
  cancelled_by_citizen: 'Ghi nhận người dân hủy', dispatched: 'Đưa vào hàng đợi',
};

const transitionGuidance: Record<string, string> = {
  received: 'Kiểm tra nội dung, vị trí và thông tin liên hệ trước khi tiếp nhận.',
  assigned: 'Chọn đúng cán bộ phụ trách địa bàn; cán bộ CSKV chỉ có thể nhận cho chính mình.',
  verifying: 'Ghi rõ nguồn tin hoặc biện pháp xác minh đã thực hiện.',
  processing: 'Nêu biện pháp đang triển khai và đầu mối phối hợp nếu có.',
  resolved: 'Ghi kết quả, căn cứ xử lý và tình trạng an toàn của người dân.',
  closed: 'CSKV rà soát toàn bộ timeline và kết quả trước khi đóng hồ sơ.',
  rejected: 'Nêu rõ lý do ngoài phạm vi và đơn vị/đầu mối cần chuyển tiếp.',
  acknowledged: 'Xác nhận đã nhận tín hiệu, liên hệ người dân và nhận xử lý.',
  responding: 'Ghi lực lượng đang triển khai, hướng di chuyển hoặc đơn vị phối hợp.',
  escalated: 'Nêu đơn vị nhận chuyển tuyến, thời điểm và thông tin đã bàn giao.',
  cancelled_by_citizen: 'Ghi cách đã xác minh việc hủy để tránh bỏ sót tình huống nguy hiểm.',
};

const incidentFlow: IncidentStatus[] = ['submitted', 'received', 'assigned', 'verifying', 'processing', 'resolved', 'closed'];
const sosFlow: SosStatus[] = ['dispatched', 'acknowledged', 'responding', 'resolved', 'closed'];
const terminalStatuses = new Set(['resolved', 'closed', 'rejected']);
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
  const [notifications, setNotifications] = useState<OfficerNotification[]>([]);
  const [filter, setFilter] = useState<QueueFilter>(() => policeParam('kind', ['all', 'sos', 'incident'], 'all'));
  const [scope, setScope] = useState<QueueScope>(() => policeParam('scope', ['attention', 'mine', 'unassigned', 'all'], 'attention'));
  const [sort, setSort] = useState<QueueSort>(() => policeParam('sort', ['priority', 'newest', 'oldest'], 'priority'));
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<QueueFilter>('all');
  const [draftScope, setDraftScope] = useState<QueueScope>('attention');
  const [draftSort, setDraftSort] = useState<QueueSort>('priority');
  const [queueQuery, setQueueQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(() => new URL(window.location.href).searchParams.get('case'));
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => policeParam('pane', ['queue', 'map', 'detail', 'operations'], 'map'));
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [criticalConfirmation, setCriticalConfirmation] = useState(false);
  const [targetStatus, setTargetStatus] = useState('');
  const [assignee, setAssignee] = useState(sessionActor.id);
  const [note, setNote] = useState('');
  const [publicMessage, setPublicMessage] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const actionFormRef = useRef<HTMLFormElement>(null);
  const filterSheetRef = useRef<HTMLElement>(null);

  const filteredQueue = useMemo(() => {
    const normalizedQuery = queueQuery.trim().toLocaleLowerCase('vi-VN');
    const matches = queue.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (scope === 'mine' && item.assignedOfficer?.id !== currentActorId) return false;
      if (scope === 'unassigned' && item.assignedOfficer) return false;
      if (scope === 'attention' && !attentionStatuses.has(item.status) && !isOverdue(item)) return false;
      if (!normalizedQuery) return true;
      return [item.receiptCode, item.title, item.localityName, item.serviceAreaName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase('vi-VN').includes(normalizedQuery));
    });
    return [...matches].sort((left, right) => {
      if (sort === 'newest') return Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (sort === 'oldest') return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      const overdueDelta = Number(isOverdue(right)) - Number(isOverdue(left));
      if (overdueDelta) return overdueDelta;
      const emergencyDelta = Number(right.kind === 'sos') - Number(left.kind === 'sos');
      if (emergencyDelta) return emergencyDelta;
      const priorityDelta = priorityRanks[right.priority] - priorityRanks[left.priority];
      return priorityDelta || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }, [currentActorId, filter, queue, queueQuery, scope, sort]);
  const selectedItem = useMemo(() => queue.find((item) => `${item.kind}:${item.id}` === selectedKey) ?? null, [queue, selectedKey]);
  const currentActor = actors.find((actor) => actor.id === currentActorId) ?? sessionActor;
  const rawNextStatuses = detail
    ? detail.kind === 'incident' ? incidentNext[detail.status] : sosNext[detail.status]
    : [];
  const nextStatuses = rawNextStatuses;
  const assignableActors = actors.filter((actor) => actor.id === currentActorId);
  const requiredNoteLength = terminalStatuses.has(targetStatus) ? 20 : 8;
  const detailFlow = detail ? (detail.kind === 'incident' ? incidentFlow : sosFlow) : [];
  const detailFlowIndex = detail ? detailFlow.indexOf(detail.status as never) : -1;

  const alerts = useSosAlerts(queue, lastUpdated !== null);

  const loadQueue = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [queuePayload, actorsPayload, notificationPayload] = await Promise.all([
        listOfficerQueue(),
        actors.length ? Promise.resolve({ data: actors }) : listWorkflowActors(),
        listOfficerNotifications(),
      ]);
      setQueue(queuePayload.data);
      setActors(actorsPayload.data);
      setNotifications(notificationPayload.data);
      setLastUpdated(new Date());
      setError('');
      setSelectedKey((current) => {
        const currentStillExists = current && queuePayload.data.some((item) => `${item.kind}:${item.id}` === current);
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

  const loadDetail = async (item: OfficerQueueItem) => {
    const requestId = ++detailRequestId.current;
    setDetailLoading(true);
    setError('');
    try {
      const payload = item.kind === 'incident' ? await getOfficerIncident(item.id) : await getOfficerSos(item.id);
      if (requestId !== detailRequestId.current) return;
      setDetail(payload.data);
      setTargetStatus('');
      setCriticalConfirmation(false);
      setNote('');
      setPublicMessage(false);
      if (payload.data.assignedOfficer) setAssignee(payload.data.assignedOfficer.id);
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
    if (!filterSheetOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterSheetOpen(false);
      if (event.key !== 'Tab') return;
      const focusable = Array.from(filterSheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => filterSheetRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [filterSheetOpen]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (filter === 'all') url.searchParams.delete('kind'); else url.searchParams.set('kind', filter);
    if (scope === 'attention') url.searchParams.delete('scope'); else url.searchParams.set('scope', scope);
    if (sort === 'priority') url.searchParams.delete('sort'); else url.searchParams.set('sort', sort);
    if (mobilePane === 'map') url.searchParams.delete('pane'); else url.searchParams.set('pane', mobilePane);
    if (selectedKey) url.searchParams.set('case', selectedKey); else url.searchParams.delete('case');
    window.history.replaceState({}, '', url);
  }, [filter, mobilePane, scope, selectedKey, sort]);

  const openFilterSheet = () => {
    setDraftScope(scope);
    setDraftFilter(filter);
    setDraftSort(sort);
    setFilterSheetOpen(true);
  };

  const applyFilters = () => {
    setScope(draftScope);
    setFilter(draftFilter);
    setSort(draftSort);
    setFilterSheetOpen(false);
  };

  const resetDraftFilters = () => {
    setDraftScope('all');
    setDraftFilter('all');
    setDraftSort('priority');
  };

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

  const submitTransition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !targetStatus || note.trim().length < requiredNoteLength) return;
    const needsConfirmation = terminalStatuses.has(targetStatus) || (detail.kind === 'sos' && targetStatus === 'cancelled_by_citizen');
    if (needsConfirmation && !criticalConfirmation) {
      setCriticalConfirmation(true);
      return;
    }
    setTransitioning(true);
    setError('');
    try {
      const assignedOfficerId = targetStatus === 'assigned' || ['acknowledged', 'responding'].includes(targetStatus) ? assignee : undefined;
      const payload = detail.kind === 'incident'
        ? await transitionOfficerIncident(detail.id, targetStatus as IncidentStatus, note, assignedOfficerId, publicMessage)
        : await transitionOfficerSos(detail.id, targetStatus as SosStatus, note, assignedOfficerId, publicMessage);
      setDetail(payload.data);
      setTargetStatus('');
      setCriticalConfirmation(false);
      setNote('');
      setPublicMessage(false);
      await loadQueue(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTransitioning(false);
    }
  };

  const sosCount = queue.filter((item) => item.kind === 'sos' && !['resolved', 'closed', 'cancelled_by_citizen'].includes(item.status)).length;
  const unassignedCount = queue.filter((item) => !item.assignedOfficer).length;
  const activeCount = queue.filter((item) => ['verifying', 'processing', 'acknowledged', 'responding', 'escalated'].includes(item.status)).length;
  const overdueCount = queue.filter(isOverdue).length;
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;
  const activeFilterCount = Number(scope !== 'all') + Number(filter !== 'all') + Number(sort !== 'priority');

  return (
    <div className="police-portal" data-mobile-pane={mobilePane}>
      <a className="skip-link" href="#police-main">Đến hàng đợi xử lý</a>
      <header className="police-topbar">
        <a className="police-brand" href="./" aria-label="Cổng nghiệp vụ CSKV" onClick={(e) => { e.preventDefault(); onSignOut(); }}>
          <img src={directoryLogoUrl} alt="" width="38" height="38" />
          <span><strong>Cổng nghiệp vụ CSKV</strong><small>{currentActor?.displayName ?? 'CSKV trực địa bàn'}</small></span>
        </a>
        <div className="topbar-right-actions">
          <button
            className="topbar-icon-btn"
            type="button"
            onClick={() => setMobilePane('operations')}
            aria-pressed={mobilePane === 'operations'}
            aria-label="Mở công cụ nghiệp vụ"
            title="Nghiệp vụ địa bàn"
          >
            <ClipboardList size={19} aria-hidden="true" />
          </button>
          <button
            className="topbar-icon-btn police-map-shortcut"
            type="button"
            onClick={() => setMobilePane('map')}
            aria-pressed={mobilePane === 'map'}
            aria-label="Mở bản đồ trực ban"
            title="Bản đồ trực ban"
          >
            <MapPinned size={19} aria-hidden="true" />
          </button>
          <button
            className="topbar-icon-btn notification-button"
            type="button"
            onClick={() => { setScope('attention'); setMobilePane('queue'); }}
            title="Thông báo cần xử lý"
            aria-label={`${unreadNotificationCount} thông báo chưa đọc, mở việc cần làm ngay`}
          >
            {unreadNotificationCount ? <BellRing size={18} aria-hidden="true" /> : <RadioTower size={18} aria-hidden="true" />}
            {unreadNotificationCount > 0 && <span>{Math.min(unreadNotificationCount, 99)}</span>}
          </button>
          <button className="topbar-icon-btn logout" type="button" onClick={onSignOut} aria-label="Đăng xuất" title="Đăng xuất">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="police-main" id="police-main">
        <section className="police-command-strip" aria-label="Tổng quan hàng đợi">
          <div className="logged-in-actor">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              <small>CÁN BỘ ĐĂNG NHẬP</small>
              <strong>{currentActor?.displayName ?? 'CSKV trực địa bàn'}</strong>
            </span>
          </div>
          <div className="command-metrics" aria-label="Chỉ số hàng đợi hiện tại">
            <article className="critical"><span><strong>{sosCount}</strong><small>SOS đang mở</small></span></article>
            <article><span><strong>{queue.length}</strong><small>Tổng hồ sơ</small></span></article>
            <article><span><strong>{unassignedCount}</strong><small>Chưa phân công</small></span></article>
            <article className={overdueCount ? 'warning' : ''}><span><strong>{overdueCount || activeCount}</strong><small>{overdueCount ? 'Quá SLA' : 'Đang xử lý'}</small></span></article>
          </div>
          <div className="sos-alert-control">
            <button type="button" className={alerts.enabled ? 'sos-alert-toggle on' : 'sos-alert-toggle'} aria-pressed={alerts.enabled} onClick={alerts.enabled ? alerts.disable : () => void alerts.enable()}>
              {alerts.enabled ? <Bell size={17} aria-hidden="true" /> : <BellOff size={17} aria-hidden="true" />}
              <span>Cảnh báo SOS: {alerts.enabled ? 'Bật' : 'Tắt'}</span>
            </button>
            {alerts.enabled && alerts.permission !== 'granted' && <small>Chưa cấp quyền thông báo trình duyệt: chỉ có âm thanh khi tab đang mở.</small>}
            {!alerts.enabled && <small>Bật để nghe chuông và nhận thông báo khi có SOS mới.</small>}
          </div>
        </section>
        {alerts.pendingCount > 0 && (
          <p className="sos-alert-banner" role="alert"><Siren size={18} aria-hidden="true" /> Có {alerts.pendingCount} SOS đang chờ tiếp nhận.</p>
        )}

        <div className="police-workspace">
          <aside className="police-queue-pane" aria-label="Hàng đợi địa bàn">
            <div className="queue-toolbar">
              <div>
                <span>Hàng đợi</span>
                <strong>{filteredQueue.length} hồ sơ</strong>
                {lastUpdated && <small>Cập nhật {timeFormatter.format(lastUpdated)}</small>}
              </div>
              <button type="button" onClick={() => void loadQueue()} disabled={loading} aria-label="Tải lại hàng đợi"><RefreshCw size={18} aria-hidden="true" /></button>
            </div>
            <div className="queue-search-row">
              <label className="queue-search">
                <span className="sr-only">Tìm trong hàng đợi</span>
                <Search size={18} aria-hidden="true" />
                <input name="queueQuery" type="search" autoComplete="off" value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} placeholder="Tìm mã hồ sơ, nội dung, địa bàn…" />
              </label>
              <button className="queue-filter-trigger" type="button" onClick={openFilterSheet} aria-expanded={filterSheetOpen} aria-controls="queue-filter-sheet" aria-label="Mở bộ lọc hồ sơ">
                <Filter size={19} aria-hidden="true" />
                {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
              </button>
            </div>
            <div className="queue-scopes" role="group" aria-label="Phạm vi hàng đợi">
              {(['attention', 'mine', 'unassigned', 'all'] as const).map((value) => (
                <button type="button" key={value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>
                  {value === 'attention' ? 'Cần làm ngay' : value === 'mine' ? 'Của tôi' : value === 'unassigned' ? 'Chưa giao' : 'Tất cả'}
                </button>
              ))}
            </div>
            <div className="queue-filters" role="group" aria-label="Lọc hàng đợi">
              {(['all', 'sos', 'incident'] as const).map((value) => (
                <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                  {value === 'all' ? 'Tất cả' : value === 'sos' ? 'SOS' : 'Phản ánh'}
                </button>
              ))}
            </div>
            <div className="queue-list">
              {loading && <div className="queue-loading"><span className="loader" /> Đang tải hàng đợi…</div>}
              {!loading && filteredQueue.length === 0 && <div className="queue-empty"><ShieldCheck size={28} aria-hidden="true" /><strong>Không có hồ sơ đang mở</strong><span>Hàng đợi sẽ tự cập nhật mỗi 8 giây.</span></div>}
              {filteredQueue.map((item) => (
                <button key={`${item.kind}:${item.id}`} type="button" className={selectedKey === `${item.kind}:${item.id}` ? `queue-card ${item.kind} active` : `queue-card ${item.kind}`} onClick={() => selectItem(item)}>
                  <span className="queue-kind-icon">{item.kind === 'sos' ? <Siren size={19} aria-hidden="true" /> : <FileWarning size={19} aria-hidden="true" />}</span>
                  <span className="queue-card-copy">
                    <span className="queue-card-meta"><em>{item.kind === 'sos' ? 'SOS' : 'Phản ánh'}</em><time dateTime={item.createdAt}>{ageLabel(item.createdAt)}</time></span>
                    <strong>{item.title}</strong>
                    <small>{item.serviceAreaName ?? item.localityName}</small>
                    <span className="queue-card-status">
                      <span className={`priority-chip ${item.priority}`}>{priorityLabels[item.priority]}</span>
                      <span className={`status-chip ${item.status}`}>{statusLabels[item.status] ?? item.status}</span>
                      {isOverdue(item) && <span className="sla-chip">Quá SLA</span>}
                    </span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          </aside>

          <section className="police-case-pane" aria-label="Chi tiết hồ sơ">
            {detailLoading && <div className="case-loading"><span className="loader" /> Đang tải hồ sơ…</div>}
            {!detailLoading && !detail && <div className="case-placeholder"><ListFilter size={40} aria-hidden="true" /><h2>Chọn một hồ sơ</h2><p>Chi tiết, vị trí, lịch sử và hành động xử lý sẽ hiển thị tại đây.</p></div>}
            {!detailLoading && detail && (
              <>
                <button className="mobile-back-queue" type="button" onClick={() => setMobilePane('queue')}><ArrowLeft size={18} aria-hidden="true" /> Hàng đợi</button>
                <div className={detail.kind === 'sos' ? 'case-hero sos' : 'case-hero incident'}>
                  <div className="case-hero-icon">{detail.kind === 'sos' ? <AlertOctagon size={28} aria-hidden="true" /> : <FileWarning size={28} aria-hidden="true" />}</div>
                  <div><span>{detail.kind === 'sos' ? 'Yêu cầu SOS local' : 'Phản ánh của người dân'}</span><h2>{workTitle(detail)}</h2><code>{detail.receiptCode}</code></div>
                  <span className={`status-chip ${detail.status}`}>{statusLabels[detail.status] ?? detail.status}</span>
                </div>

                <div className="case-quick-actions" aria-label="Thao tác nhanh hồ sơ">
                  {detail.contactPhone ? <a href={`tel:${detail.contactPhone}`}><PhoneCall size={18} aria-hidden="true" /><span>Gọi người dân</span></a> : <span className="disabled"><PhoneCall size={18} aria-hidden="true" /><span>Không có SĐT</span></span>}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${detail.location.latitude},${detail.location.longitude}`} target="_blank" rel="noreferrer"><Navigation size={18} aria-hidden="true" /><span>Mở vị trí</span></a>
                  {nextStatuses.length > 0 && <button type="button" onClick={() => actionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><CheckCircle2 size={18} aria-hidden="true" /><span>Xử lý hồ sơ</span></button>}
                </div>

                <ol className="case-flow" aria-label="Tiến độ xử lý hồ sơ">
                  {detailFlow.map((status, index) => (
                    <li key={status} className={index < detailFlowIndex ? 'done' : index === detailFlowIndex ? 'current' : ''} aria-current={index === detailFlowIndex ? 'step' : undefined}>
                      <span>{index + 1}</span><small>{statusLabels[status]}</small>
                    </li>
                  ))}
                  {!detailFlow.includes(detail.status as never) && <li className="current exceptional"><span>!</span><small>{statusLabels[detail.status]}</small></li>}
                </ol>

                <div className="case-content-grid">
                  <div className="case-primary-content">
                    <section className="ops-card case-overview-card">
                      <div className="ops-card-title"><h3>Thông tin tiếp nhận</h3><span>{categoryLabels[detail.category] ?? detail.category}</span></div>
                      {detail.kind === 'incident' ? <p>{detail.description}</p> : <p>{detail.note || 'Người dân không nhập mô tả bổ sung.'}</p>}
                      <dl className="ops-facts">
                        <div><dt>Thời điểm</dt><dd>{timeFormatter.format(new Date(detail.createdAt))}</dd></div>
                        <div><dt>Liên hệ</dt><dd>{detail.contactPhone || 'Không cung cấp'}</dd></div>
                        <div><dt>Địa bàn</dt><dd>{detail.location.serviceAreaName ?? detail.location.localityName}</dd></div>
                        <div><dt>Phụ trách</dt><dd>{detail.assignedOfficer?.displayName ?? 'Chưa phân công'}</dd></div>
                        {detail.kind === 'incident' && <div><dt>Ảnh hiện trường</dt><dd>{detail.attachments.length ? `${detail.attachments.length} ảnh đã lưu` : 'Không có ảnh'}</dd></div>}
                      </dl>
                    </section>

                    {detail.kind === 'incident' && detail.satisfactionRating && (
                      <section className="ops-card officer-rating-card" aria-labelledby="officer-rating-title">
                        <div className="ops-card-title"><h3 id="officer-rating-title">Đánh giá của người dân</h3><span>{detail.satisfactionRating.score}/5</span></div>
                        <div className="officer-rating-stars" aria-label={`${detail.satisfactionRating.score} trên 5 sao`}>
                          {[1, 2, 3, 4, 5].map((score) => <Star key={score} size={21} fill={score <= detail.satisfactionRating!.score ? 'currentColor' : 'none'} aria-hidden="true" />)}
                        </div>
                        <p>{detail.satisfactionRating.comment || 'Người dân không nhập góp ý bổ sung.'}</p>
                        <small>Gửi lúc {timeFormatter.format(new Date(detail.satisfactionRating.createdAt))}</small>
                      </section>
                    )}

                    {detail.kind === 'incident' && <IncidentCollaboration incident={detail} onAttachmentAdded={(attachment) => setDetail((current) => current?.kind === 'incident' ? { ...current, attachments: [...current.attachments, attachment] } : current)} />}

                    <section className="ops-card case-timeline-card">
                      <div className="ops-card-title"><h3>Lịch sử không thể sửa ngược</h3><BadgeCheck size={20} aria-hidden="true" /></div>
                      <WorkflowTimeline history={detail.history} statusLabels={statusLabels} />
                    </section>
                  </div>

                  <aside className="case-action-column">
                    <section className="ops-card location-card">
                      <div className="ops-card-title"><h3>Vị trí</h3><LocateFixed size={20} aria-hidden="true" /></div>
                      <div className="coordinate-tile"><MapPin size={19} aria-hidden="true" /><span><strong>{detail.location.latitude.toFixed(6)}, {detail.location.longitude.toFixed(6)}</strong><small>{detail.location.accuracyM ? `Sai số khoảng ${Math.round(detail.location.accuracyM)} m` : 'Không có độ chính xác GPS'}</small></span></div>
                      <a className="maps-link" href={`https://www.google.com/maps/search/?api=1&query=${detail.location.latitude},${detail.location.longitude}`} target="_blank" rel="noreferrer">Mở Google Maps <ExternalLink size={15} aria-hidden="true" /></a>
                    </section>

                    <form className="ops-card transition-form" onSubmit={submitTransition} ref={actionFormRef}>
                      <div className="ops-card-title"><h3>Chuyển trạng thái</h3><CheckCircle2 size={20} aria-hidden="true" /></div>
                      {nextStatuses.length ? (
                        <>
                          <fieldset className="next-action-fieldset">
                            <legend>Chọn hành động tiếp theo</legend>
                            <div className="next-action-grid">
                              {nextStatuses.map((status) => <button type="button" key={status} className={targetStatus === status ? 'active' : ''} aria-pressed={targetStatus === status} onClick={() => { setTargetStatus(status); setCriticalConfirmation(false); }}>{transitionLabels[status] ?? statusLabels[status] ?? status}</button>)}
                            </div>
                          </fieldset>
                          {targetStatus && <p className="transition-guidance">{transitionGuidance[targetStatus]}</p>}
                          {(targetStatus === 'assigned' || ['acknowledged', 'responding'].includes(targetStatus)) && (
                            <label>Cán bộ phụ trách
                              <select name="assignedOfficerId" autoComplete="off" value={assignee} onChange={(event) => setAssignee(event.target.value)} required>
                                {assignableActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
                              </select>
                            </label>
                          )}
                          <label>Ghi chú xử lý *
                            <textarea name="transitionNote" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} minLength={requiredNoteLength} maxLength={500} rows={4} placeholder="Nêu việc đã kiểm tra, căn cứ và hướng xử lý; mặc định chỉ cán bộ nhìn thấy." required />
                            <span className={note.trim().length > 0 && note.trim().length < requiredNoteLength ? 'field-hint invalid' : 'field-hint'}>{note.trim().length}/{requiredNoteLength} ký tự tối thiểu</span>
                          </label>
                          <label className="consent-row visibility-choice">
                            <input name="publicMessage" type="checkbox" checked={publicMessage} onChange={(event) => setPublicMessage(event.target.checked)} />
                            <span><strong>Thông báo ghi chú này cho người dân</strong> Bỏ chọn để lưu nội bộ; người dân vẫn nhìn thấy trạng thái hiện tại.</span>
                          </label>
                          {criticalConfirmation && (
                            <div className="critical-confirmation" role="alert">
                              <AlertOctagon size={19} aria-hidden="true" />
                              <span><strong>Kiểm tra lần cuối</strong> Chỉ xác nhận khi đã kiểm tra kết quả và ghi rõ căn cứ trong timeline.</span>
                            </div>
                          )}
                          <button className={detail.kind === 'sos' ? 'ops-submit danger' : 'ops-submit'} type="submit" disabled={transitioning || !targetStatus || note.trim().length < requiredNoteLength}>
                            {transitioning ? <span className="loader light" /> : <CheckCircle2 size={18} aria-hidden="true" />}
                            {transitioning ? 'Đang ghi nhận…' : criticalConfirmation ? 'Xác nhận lần cuối' : 'Xác nhận chuyển trạng thái'}
                          </button>
                        </>
                      ) : <p className="terminal-state"><ShieldCheck size={20} aria-hidden="true" /> Hồ sơ đã ở trạng thái kết thúc, không còn hành động tiếp theo.</p>}
                    </form>
                  </aside>
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

          <PoliceOperations />
        </div>
      </main>

      {filterSheetOpen && (
        <div className="queue-filter-layer">
          <button className="queue-filter-scrim" type="button" onClick={() => setFilterSheetOpen(false)} aria-label="Đóng bộ lọc" />
          <section ref={filterSheetRef} className="queue-filter-sheet" id="queue-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="queue-filter-title">
            <span className="filter-sheet-grip" aria-hidden="true" />
            <header>
              <div><small>Hàng đợi địa bàn</small><h2 id="queue-filter-title">Bộ lọc hồ sơ</h2></div>
              <button type="button" onClick={() => setFilterSheetOpen(false)} aria-label="Đóng bộ lọc"><X size={21} aria-hidden="true" /></button>
            </header>

            <fieldset className="filter-sheet-group">
              <legend><UserRoundCheck size={18} aria-hidden="true" /> Phạm vi công việc</legend>
              <div className="filter-option-grid four">
                {(['attention', 'mine', 'unassigned', 'all'] as const).map((value) => (
                  <button type="button" key={value} className={draftScope === value ? 'active' : ''} onClick={() => setDraftScope(value)} aria-pressed={draftScope === value}>
                    {value === 'attention' ? 'Cần làm ngay' : value === 'mine' ? 'Của tôi' : value === 'unassigned' ? 'Chưa giao' : 'Tất cả'}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="filter-sheet-group">
              <legend><ClipboardList size={18} aria-hidden="true" /> Loại hồ sơ</legend>
              <div className="filter-option-grid three">
                {(['all', 'sos', 'incident'] as const).map((value) => (
                  <button type="button" key={value} className={draftFilter === value ? 'active' : ''} onClick={() => setDraftFilter(value)} aria-pressed={draftFilter === value}>
                    {value === 'all' ? 'Tất cả' : value === 'sos' ? 'SOS' : 'Phản ánh'}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="filter-sheet-group sort-group">
              <legend><Clock3 size={18} aria-hidden="true" /> Sắp xếp danh sách</legend>
              <div className="sort-options">
                {(['priority', 'newest', 'oldest'] as const).map((value) => (
                  <button type="button" key={value} className={draftSort === value ? 'active' : ''} onClick={() => setDraftSort(value)} aria-pressed={draftSort === value}>
                    <span>{value === 'priority' ? 'Ưu tiên nghiệp vụ' : value === 'newest' ? 'Mới nhất trước' : 'Cũ nhất trước'}</span><i aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>

            <footer>
              <button className="filter-reset" type="button" onClick={resetDraftFilters}><RotateCcw size={18} aria-hidden="true" /> Đặt lại</button>
              <button className="filter-apply" type="button" onClick={applyFilters}>Áp dụng bộ lọc</button>
            </footer>
          </section>
        </div>
      )}

      <nav className="police-mobile-nav" aria-label="Điều hướng workspace">
        <button type="button" className={mobilePane === 'queue' ? 'active' : ''} onClick={() => setMobilePane('queue')}><ClipboardList size={21} aria-hidden="true" />Hàng đợi</button>
        <button type="button" className={mobilePane === 'map' ? 'active' : ''} onClick={() => setMobilePane('map')}><MapPinned size={21} aria-hidden="true" />Bản đồ</button>
        <button type="button" className={mobilePane === 'detail' ? 'active' : ''} onClick={() => setMobilePane('detail')} disabled={!detail}><FileWarning size={21} aria-hidden="true" />Hồ sơ</button>
        <button type="button" className={mobilePane === 'operations' ? 'active' : ''} onClick={() => setMobilePane('operations')}><RadioTower size={21} aria-hidden="true" />Nghiệp vụ</button>
      </nav>
    </div>
  );
}
