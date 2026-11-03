import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { readDevicePosition, supportsDeviceLocation } from '../device-location';
import { showToast } from '../toast';
import {
  AlertTriangle,
  CheckCircle2,
  LocateFixed,
  MapPin,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  Siren,
  XCircle,
} from 'lucide-react';
import { ApiError, cancelCitizenSos, createSos, getCitizenSos, getDutyCoverage, listCitizenSos, lookupByLocation, reportCitizenSosSafe } from '../api';
import type { SosEvent, SosStatus } from '../types';
import { WorkflowTimeline } from './WorkflowTimeline';
import { SosRatingInline } from './SosRatingInline';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { createRequestId } from '../request-id';

interface CitizenSosPageProps {
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

type Step = 'prepare' | 'receipt';

interface SosDraft {
  category: SosEvent['category'];
  note: string;
  contactPhone: string;
  position: { latitude: number; longitude: number } | null;
  accuracyM: number | null;
  idempotencyKey: string;
}

const SOS_DRAFT_KEY = 'cskv-citizen-sos-draft';
const HOLD_DURATION_MS = 3_000;

const statusLabels: Record<SosStatus, string> = {
  triggered: 'Đã tạo trên thiết bị',
  dispatched: 'Đã vào hàng đợi trực ban local',
  acknowledged: 'Cán bộ đã xác nhận tiếp nhận',
  responding: 'Đang triển khai xử lý',
  escalated: 'Đã chuyển tuyến',
  resolved: 'Đã có kết quả',
  closed: 'Đã đóng',
  cancelled_by_citizen: 'Người dân đã hủy',
};

function validPhone(value: string): boolean {
  if (!value.trim()) return true;
  return /^\+?\d{8,15}$/.test(value.trim().replace(/[\s().-]/g, ''));
}

const categoryLabels: Record<SosEvent['category'], string> = {
  security: 'Nguy cơ an ninh, trật tự',
  traffic_accident: 'Tai nạn giao thông',
  fire_rescue: 'Cháy, cứu nạn hoặc cứu hộ',
  medical: 'Cấp cứu y tế',
  other_emergency: 'Tình huống nguy cấp khác',
};

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Chưa thể kết nối quy trình SOS local.';
}

function readSosDraft(): SosDraft | null {
  try {
    const raw = window.sessionStorage.getItem(SOS_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SosDraft>;
    const category = typeof value.category === 'string' && value.category in categoryLabels
      ? value.category as SosEvent['category']
      : null;
    const position = value.position
      && Number.isFinite(value.position.latitude)
      && Number.isFinite(value.position.longitude)
      && value.position.latitude >= -90 && value.position.latitude <= 90
      && value.position.longitude >= -180 && value.position.longitude <= 180
      ? value.position
      : null;
    if (!category || typeof value.idempotencyKey !== 'string') return null;
    return {
      category,
      note: typeof value.note === 'string' ? value.note.slice(0, 500) : '',
      contactPhone: typeof value.contactPhone === 'string' ? value.contactPhone.slice(0, 30) : '',
      position,
      accuracyM: typeof value.accuracyM === 'number' && Number.isFinite(value.accuracyM) ? value.accuracyM : null,
      idempotencyKey: value.idempotencyKey,
    };
  } catch {
    window.sessionStorage.removeItem(SOS_DRAFT_KEY);
    return null;
  }
}

export function EmergencyCallStrip() {
  return (
    <div className="official-emergency-strip">
      <div><ShieldAlert size={20} aria-hidden="true" /><span><strong>Đang nguy hiểm? Gọi ngay</strong><small>SOS trong ứng dụng đang chạy thử.</small></span></div>
      <nav className="emergency-call-actions" aria-label="Gọi số khẩn cấp chính thức">
        <a href="tel:112" aria-label="Gọi Tổng đài khẩn cấp quốc gia 112">
          <PhoneCall size={18} aria-hidden="true" />
          <span><strong>Gọi 112</strong><small>Khẩn cấp quốc gia</small></span>
        </a>
        <a href="tel:113" aria-label="Gọi Công an 113">
          <PhoneCall size={18} aria-hidden="true" />
          <span><strong>Gọi 113</strong><small>Công an</small></span>
        </a>
      </nav>
    </div>
  );
}

export function CitizenSosPage({ isAuthenticated, onRequireLogin }: CitizenSosPageProps) {
  const initialDraft = useMemo(readSosDraft, []);
  const [step, setStep] = useState<Step>(() => {
    const requested = new URL(window.location.href).searchParams.get('sosStep');
    return requested === 'receipt' ? requested : 'prepare';
  });
  const [category, setCategory] = useState<SosEvent['category']>(initialDraft?.category ?? 'security');
  const [note, setNote] = useState(initialDraft?.note ?? '');
  const [contactPhone, setContactPhone] = useState(initialDraft?.contactPhone ?? '');
  const [position, setPosition] = useState(initialDraft?.position ?? null);
  const [accuracyM, setAccuracyM] = useState<number | null>(initialDraft?.accuracyM ?? null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [safeBusy, setSafeBusy] = useState(false);
  // 'uncovered' = locality known but no officer is on duty in this system; 'outside' = not inside any locality boundary.
  const [duty, setDuty] = useState<{ state: 'unknown' | 'covered' | 'uncovered' | 'outside'; areaName: string }>({ state: 'unknown', areaName: '' });
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<string | null>(() => new URL(window.location.href).searchParams.get('sosReceipt'));
  const [idempotencyKey, setIdempotencyKey] = useState(() => initialDraft?.idempotencyKey ?? createRequestId());
  const [error, setError] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdFrame = useRef<number | null>(null);
  const holdStartedAt = useRef<number | null>(null);
  const holdCompleted = useRef(false);

  const activeEvent = useMemo(
    () => activeReceipt ? events.find((item) => item.receiptCode === activeReceipt) ?? null : events[0] ?? null,
    [activeReceipt, events],
  );

  useEffect(() => {
    if (step === 'receipt') {
      window.sessionStorage.removeItem(SOS_DRAFT_KEY);
      return;
    }
    window.sessionStorage.setItem(SOS_DRAFT_KEY, JSON.stringify({
      category, note, contactPhone, position, accuracyM, idempotencyKey,
    } satisfies SosDraft));
  }, [accuracyM, category, contactPhone, idempotencyKey, note, position, step]);

  const changeStep = (nextStep: Step) => {
    const url = new URL(window.location.href);
    if (nextStep === 'prepare') url.searchParams.delete('sosStep');
    else url.searchParams.set('sosStep', nextStep);
    window.history.replaceState({}, '', url);
    setStep(nextStep);
  };

  const selectReceipt = (receiptCode: string | null) => {
    const url = new URL(window.location.href);
    if (receiptCode) url.searchParams.set('sosReceipt', receiptCode);
    else url.searchParams.delete('sosReceipt');
    window.history.replaceState({}, '', url);
    setActiveReceipt(receiptCode);
  };

  const loadEvents = async (quiet = false) => {
    if (!isAuthenticated) { setEvents([]); return; }
    if (!quiet) setError('');
    try {
      const payload = await listCitizenSos();
      if (activeReceipt && !payload.data.some((item) => item.receiptCode === activeReceipt)) {
        payload.data.unshift(await getCitizenSos(activeReceipt));
      }
      setEvents(payload.data);
      const requested = activeReceipt ? payload.data.find((item) => item.receiptCode === activeReceipt) : null;
      if (requested || (!activeReceipt && step === 'receipt' && payload.data[0])) {
        selectReceipt(requested?.receiptCode ?? payload.data[0]!.receiptCode);
        changeStep('receipt');
      }
      if (activeReceipt && !requested) setError('Không tìm thấy yêu cầu SOS thuộc tài khoản này.');
    } catch (caught) {
      if (!quiet) setError(message(caught));
    }
  };

  useEffect(() => {
    const restore = () => {
      const params = new URL(window.location.href).searchParams;
      setActiveReceipt(params.get('sosReceipt'));
      setStep(params.get('sosStep') === 'receipt' ? 'receipt' : 'prepare');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (isAuthenticated) void loadEvents();
    else setEvents([]);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeReceipt) return;
    const timer = window.setInterval(() => void loadEvents(true), 5_000);
    return () => window.clearInterval(timer);
  }, [activeReceipt, isAuthenticated]);

  useEffect(() => {
    if (!position) { setDuty({ state: 'unknown', areaName: '' }); return; }
    let cancelled = false;
    void (async () => {
      try {
        const [codes, lookup] = await Promise.all([getDutyCoverage(), lookupByLocation(position.latitude, position.longitude)]);
        if (!cancelled) setDuty({ state: codes.includes(lookup.data.code) ? 'covered' : 'uncovered', areaName: lookup.data.name });
      } catch (caught) {
        if (!cancelled) setDuty({ state: caught instanceof ApiError && caught.status === 404 ? 'outside' : 'unknown', areaName: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [position?.latitude, position?.longitude]);

  const dutyBlockMessage = duty.state === 'uncovered'
    ? `Địa bàn ${duty.areaName} chưa có cán bộ trực trên hệ thống này, nên SOS gửi từ đây sẽ không được xử lý. Hãy gọi 112 hoặc 113 ngay.`
    : duty.state === 'outside'
      ? 'Vị trí này nằm ngoài ranh giới các địa bàn của hệ thống (hoặc sát đường ranh). Hãy gọi 112 hoặc 113, hoặc lấy lại vị trí.'
      : '';

  const locate = () => {
    setError('');
    if (!supportsDeviceLocation()) {
      setError('Thiết bị không hỗ trợ GPS. Hãy gọi số khẩn cấp chính thức nếu đang gặp nguy hiểm.');
      return;
    }
    setLocating(true);
    readDevicePosition(
      (result) => {
        setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude });
        setAccuracyM(Number.isFinite(result.coords.accuracy) ? result.coords.accuracy : null);
        setLocating(false);
      },
      () => {
        setError('Không lấy được GPS. Nếu đang gặp nguy hiểm, hãy gọi trực tiếp số khẩn cấp phù hợp trên điện thoại.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  useEffect(() => {
    locate();
  }, []);

  const validateBeforeHold = (): boolean => {
    if (!position) {
      setError('Cần xác định vị trí trước khi gửi SOS. Hệ thống đang yêu cầu GPS của thiết bị.');
      locate();
      return false;
    }
    if (dutyBlockMessage) { setError(dutyBlockMessage); return false; }
    if (!validPhone(contactPhone)) {
      setError('Số điện thoại phải có từ 8 đến 15 chữ số. Có thể dùng dấu cách hoặc dấu + ở đầu.');
      return false;
    }
    if (accuracyM !== null && accuracyM > 1_000) {
      setError('Độ chính xác GPS đang quá thấp. Hãy lấy lại GPS hoặc gọi trực tiếp 112/113 nếu đang nguy hiểm.');
      return false;
    }
    return true;
  };

  const cancelHold = () => {
    if (holdFrame.current !== null) window.cancelAnimationFrame(holdFrame.current);
    holdFrame.current = null;
    holdStartedAt.current = null;
    if (!holdCompleted.current) setHoldProgress(0);
    setHolding(false);
  };

  const beginHold = () => {
    if (!isAuthenticated) { onRequireLogin(); return; }
    if (submitting || holding || !validateBeforeHold()) return;
    setError('');
    holdCompleted.current = false;
    setHolding(true);
    setHoldProgress(0);
    holdStartedAt.current = performance.now();
    const updateProgress = (now: number) => {
      if (holdStartedAt.current === null) return;
      const progress = Math.min((now - holdStartedAt.current) / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);
      if (progress < 1) {
        holdFrame.current = window.requestAnimationFrame(updateProgress);
        return;
      }
      holdCompleted.current = true;
      holdFrame.current = null;
      holdStartedAt.current = null;
      setHolding(false);
      navigator.vibrate?.([80, 40, 120]);
      void send();
    };
    holdFrame.current = window.requestAnimationFrame(updateProgress);
  };

  const handlePressStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginHold();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat) return;
    event.preventDefault();
    beginHold();
  };

  useEffect(() => () => {
    if (holdFrame.current !== null) window.cancelAnimationFrame(holdFrame.current);
  }, []);

  const send = async () => {
    if (!isAuthenticated) { onRequireLogin(); return; }
    if (!position) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = await createSos({
        idempotencyKey,
        category,
        note: note || null,
        contactPhone: contactPhone || null,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM,
        deviceTimestamp: new Date().toISOString(),
      });
      setEvents((current) => [payload.data, ...current.filter((item) => item.id !== payload.data.id)]);
      showToast({ kind: 'success', topic: 'sos', title: 'Đã gửi yêu cầu SOS', message: `Mã tiếp nhận: ${payload.data.receiptCode}` });
      selectReceipt(payload.data.receiptCode);
      changeStep('receipt');
    } catch (caught) {
      setError(message(caught));
      holdCompleted.current = false;
      setHoldProgress(0);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!activeEvent) return;
    if (!cancelConfirmation) {
      setCancelConfirmation(true);
      return;
    }
    setError('');
    try {
      const payload = await cancelCitizenSos(activeEvent.receiptCode, 'Người dân xác nhận thao tác nhầm và yêu cầu hủy.');
      setEvents((current) => current.map((item) => item.id === payload.data.id ? payload.data : item));
      setCancelConfirmation(false);
      showToast({ kind: 'info', topic: 'sos', title: 'Đã hủy yêu cầu SOS' });
    } catch (caught) {
      setError(message(caught));
    }
  };

  const reportSafe = async () => {
    if (!activeEvent || safeBusy) return;
    setSafeBusy(true);
    setError('');
    try {
      const updated = await reportCitizenSosSafe(activeEvent.receiptCode);
      setEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
      showToast({ kind: 'success', topic: 'sos', title: 'Đã báo an toàn' });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSafeBusy(false);
    }
  };

  const startAnother = () => {
    changeStep('prepare');
    setNote('');
    setHoldProgress(0);
    holdCompleted.current = false;
    setIdempotencyKey(createRequestId());
    selectReceipt(null);
    window.sessionStorage.removeItem(SOS_DRAFT_KEY);
    setCancelConfirmation(false);
  };

  return (
    <section className="citizen-workflow sos-workflow" aria-labelledby="sos-workflow-title">
      <h1 className="sr-only" id="sos-workflow-title">SOS khẩn cấp</h1>
      <EmergencyCallStrip />

      {step === 'prepare' && (
        <div className="sos-emergency-screen">
          <div className="sos-primary-action">
            <button
              type="button"
              className={`sos-hold-button ${holding ? 'holding' : ''}`}
              style={{ '--sos-hold-progress': `${holdProgress * 360}deg` } as CSSProperties}
              onPointerDown={handlePressStart}
              onPointerUp={cancelHold}
              onPointerCancel={cancelHold}
              onPointerLeave={cancelHold}
              onKeyDown={handleKeyDown}
              onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') cancelHold(); }}
              onContextMenu={(event) => event.preventDefault()}
              disabled={submitting || (isAuthenticated && locating)}
              aria-label={isAuthenticated ? 'Nhấn giữ 3 giây để gửi SOS khẩn cấp' : 'Đăng nhập tài khoản để sử dụng SOS'}
              aria-describedby="sos-hold-status sos-legal-hint"
            >
              <span className="sos-hold-ring" aria-hidden="true" />
              <span className="sos-hold-core">
                {submitting ? <span className="loader light" /> : <PhoneCall size={33} aria-hidden="true" />}
                <strong>SOS</strong>
                <small>{submitting ? 'Đang gửi yêu cầu' : holding ? `Giữ thêm ${Math.max(1, Math.ceil((1 - holdProgress) * 3))} giây` : 'Nhấn giữ 3 giây'}</small>
              </span>
            </button>
            <p id="sos-hold-status" className={isAuthenticated && position ? 'sos-ready-status ready' : 'sos-ready-status'} aria-live="polite">
              {isAuthenticated
                ? position ? '' : locating ? 'Đang xác định vị trí…' : 'Cần xác định vị trí để gửi SOS'
                : 'Đăng nhập tài khoản trước khi kích hoạt SOS'}
            </p>
          </div>

          {dutyBlockMessage && <p className="inline-notice error sos-duty-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /> {dutyBlockMessage}</p>}
          {!isAuthenticated && <VneIdLoginPrompt action="sử dụng SOS" onLogin={onRequireLogin} />}

          <section className="sos-location-panel" aria-labelledby="sos-location-title">
            <h2 className="sr-only" id="sos-location-title">Vị trí hiện tại</h2>
            <div className={position ? 'sos-current-location ready' : 'sos-current-location'}>
              <span className="sos-location-fix"><LocateFixed size={24} aria-hidden="true" /></span>
              <div>
                <strong title={position ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : undefined}>{position
                  ? accuracyM !== null ? (accuracyM <= 50 ? `Khá chính xác (sai số khoảng ${Math.round(accuracyM)} m)` : `Chưa thật chính xác (sai số khoảng ${Math.round(accuracyM)} m)`) : 'Đã nhận vị trí từ điện thoại'
                  : locating ? 'Đang xác định vị trí…' : 'Chưa nhận được vị trí'}</strong>
                <span>{position
                  ? accuracyM !== null && accuracyM > 50 ? 'Nếu có thể, ra nơi thoáng rồi bấm "Cập nhật".' : 'Vị trí này sẽ được gửi kèm SOS.'
                  : 'Hãy cho phép truy cập vị trí để gửi SOS.'}</span>
              </div>
              <button type="button" onClick={locate} disabled={locating} aria-label={position ? 'Cập nhật vị trí GPS hiện tại' : 'Lấy vị trí GPS hiện tại'}>
                <LocateFixed size={17} aria-hidden="true" /> {locating ? 'Đang lấy…' : position ? 'Cập nhật' : 'Lấy vị trí'}
              </button>
            </div>
          </section>

          <details className="sos-optional-details">
            <summary><span><Siren size={19} aria-hidden="true" /><strong>Bổ sung thông tin tình huống</strong></span><small>Không bắt buộc</small></summary>
            <div>
              <fieldset className="sos-category-grid">
                <legend>Loại tình huống</legend>
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <label key={value}>
                    <input type="radio" name="sos-category-live" value={value} checked={category === value} onChange={() => setCategory(value as SosEvent['category'])} />
                    <span><Siren size={19} aria-hidden="true" />{label}</span>
                  </label>
                ))}
              </fieldset>
              <label>Mô tả ngắn
                <textarea name="sosNote" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Dấu hiệu nhận biết, số người cần hỗ trợ, nguy cơ hiện tại…" />
              </label>
              <label>Số điện thoại có thể gọi lại
                <input name="sosContactPhone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={30} placeholder="Không bắt buộc" />
              </label>
            </div>
          </details>

          <p className="sos-legal-confirmation" id="sos-legal-hint"><AlertTriangle size={20} aria-hidden="true" /><span><strong>Chỉ dùng khi khẩn cấp.</strong> Giữ đủ 3 giây là bạn xác nhận thông tin gửi đi đúng sự thật.</span></p>
        </div>
      )}

      {step === 'receipt' && activeEvent && (
        <article className="sos-receipt-card">
          <div className="receipt-check"><CheckCircle2 size={30} aria-hidden="true" /></div>
          <span>Đã tạo yêu cầu hỗ trợ</span>
          <h2>{activeEvent.receiptCode}</h2>
          <p className={`status-chip ${activeEvent.status}`}>{statusLabels[activeEvent.status]}</p>
          <div className="receipt-location"><MapPin size={18} aria-hidden="true" /><span>{activeEvent.location.serviceAreaName ?? activeEvent.location.localityName}</span></div>

          <WorkflowTimeline history={activeEvent.history} statusLabels={statusLabels} />
          {cancelConfirmation && (
            <div className="critical-confirmation" role="alert">
              <AlertTriangle size={19} aria-hidden="true" />
              <span><strong>Xác nhận thao tác nhầm</strong> Chỉ hủy khi yêu cầu chưa được cán bộ xác nhận. Nếu đang nguy hiểm, hãy gọi 112 hoặc 113.</span>
            </div>
          )}
          <div className="receipt-actions">
            <button type="button" onClick={() => void loadEvents()}><RefreshCw size={17} aria-hidden="true" /> Cập nhật trạng thái</button>
            {['acknowledged', 'responding', 'escalated'].includes(activeEvent.status) && (
              activeEvent.history.some((entry) => entry.actorRole === 'citizen' && entry.fromStatus === entry.toStatus)
                ? <p className="inline-notice success" role="status"><CheckCircle2 size={17} aria-hidden="true" /> Đã báo an toàn. Cán bộ sẽ xác minh trước khi đóng yêu cầu.</p>
                : <button type="button" disabled={safeBusy} onClick={() => void reportSafe()}><CheckCircle2 size={17} aria-hidden="true" /> {safeBusy ? 'Đang gửi…' : 'Tôi đã an toàn'}</button>
            )}
            {['triggered', 'dispatched'].includes(activeEvent.status) && <button className="danger-outline" type="button" onClick={() => void cancel()}><XCircle size={17} aria-hidden="true" /> {cancelConfirmation ? 'Xác nhận hủy' : 'Hủy thao tác nhầm'}</button>}
          </div>
          {['resolved', 'closed'].includes(activeEvent.status) && (
            <SosRatingInline
              key={activeEvent.id}
              receiptCode={activeEvent.receiptCode}
              rating={activeEvent.satisfactionRating}
              onRated={(rating) => setEvents((current) => current.map((item) => item.id === activeEvent.id ? { ...item, satisfactionRating: rating } : item))}
            />
          )}
          <button className="text-action" type="button" onClick={startAnother}>Tạo một yêu cầu khác</button>
        </article>
      )}

      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </section>
  );
}
