import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { readDevicePosition, supportsDeviceLocation } from '../device-location';
import {
  Camera,
  CheckCircle2,
  Copy,
  FilePlus2,
  History,
  Images,
  LoaderCircle,
  LocateFixed,
  MapPin,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { addCitizenIncidentAttachment, addCitizenIncidentMessage, ApiError, createIncident, getCitizenIncident, listCitizenIncidentMessages, listCitizenIncidents, withdrawCitizenIncident } from '../api';
import type { Incident, IncidentAttachment, IncidentMessage, IncidentStatus } from '../types';
import { WorkflowTimeline } from './WorkflowTimeline';
import { IncidentMediaGallery } from './IncidentMediaGallery';
import { WorkflowLocationMap } from './WorkflowLocationMap';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { createRequestId } from '../request-id';
import { IncidentDraftAssistant } from './IncidentDraftAssistant';
import { prepareImage } from '../image-compress';
import { showToast } from '../toast';
import type { IncidentDraft } from '../types';
import { clearReportDraft, loadReportDraft, saveReportDraft, type ReportDraft } from '../report-draft';

interface CitizenReportsPageProps {
  selectedPosition: { latitude: number; longitude: number } | null;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

const statusLabels: Record<IncidentStatus, string> = {
  submitted: 'Đã gửi',
  received: 'Trực ban đã tiếp nhận',
  assigned: 'Đã phân công',
  verifying: 'Đang xác minh',
  processing: 'Đang xử lý',
  resolved: 'Đã có kết quả',
  closed: 'Đã đóng',
  rejected: 'Không thuộc phạm vi xử lý',
};

// What happens next, in plain words for the person who sent the report.
const nextStepText: Record<IncidentStatus, string> = {
  submitted: 'Phản ánh đã được gửi. Cán bộ khu vực sẽ tiếp nhận, bạn sẽ nhận thông báo khi có cập nhật.',
  received: 'Cán bộ đã tiếp nhận và sẽ phân công người phụ trách.',
  assigned: 'Đã có cán bộ phụ trách. Cán bộ sẽ bắt đầu xử lý và có thể nhắn bạn bổ sung thông tin.',
  verifying: 'Cán bộ đang xác minh thông tin. Bạn có thể bổ sung ảnh hoặc nội dung ở bên dưới.',
  processing: 'Cán bộ đang xử lý. Kết quả sẽ được báo cho bạn khi xong.',
  resolved: 'Phản ánh đã có kết quả. Xem nội dung ở mục "Lịch sử xử lý" ngay bên dưới.',
  closed: 'Hồ sơ đã đóng. Nếu sự việc tái diễn, bạn hãy gửi phản ánh mới.',
  rejected: 'Nội dung này không thuộc phạm vi của Công an khu vực. Xem lý do ở "Lịch sử xử lý" bên dưới.',
};

const dayFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const categoryLabels: Record<Incident['category'], string> = {
  security: 'An ninh trật tự',
  traffic: 'Giao thông',
  public_order: 'Trật tự đô thị',
  administrative: 'Thủ tục hành chính',
  environment: 'Môi trường',
  other: 'Nội dung khác',
};

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Chưa kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';
}

const acceptedMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);

async function encodeMedia(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh hiện trường.'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const separator = value.indexOf(',');
      if (separator < 0) reject(new Error('Định dạng ảnh không hợp lệ.'));
      else resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

/** Chọn tệp → ảnh được thu nhỏ trước; chỉ báo lỗi dung lượng sau khi đã nén. */
async function prepareMedia(file: File): Promise<File> {
  return file.type.startsWith('image/') && acceptedMediaTypes.has(file.type) ? prepareImage(file, IMAGE_LIMIT_BYTES) : file;
}

function mediaError(file: File): string | null {
  if (!acceptedMediaTypes.has(file.type)) return 'Chỉ nhận ảnh JPEG/PNG/WebP hoặc video MP4/WebM.';
  const limit = file.type.startsWith('video/') ? 20 : 5;
  return file.size > limit * 1024 * 1024 ? `${file.type.startsWith('video/') ? 'Video' : 'Ảnh'} không vượt quá ${limit} MB.` : null;
}

export function CitizenReportsPage({ selectedPosition, isAuthenticated, onRequireLogin }: CitizenReportsPageProps) {
  // Bản nháp đã lưu trên máy (nếu app bị tắt giữa chừng) được khôi phục khi mở lại màn này.
  const [initialDraft] = useState<ReportDraft | null>(() => loadReportDraft());
  const [draftRestored, setDraftRestored] = useState(Boolean(initialDraft));
  // Báo lỗi ngay tại từng ô: chỉ hiện sau khi người dân rời ô đó hoặc đã bấm Gửi mà còn thiếu.
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  const [view, setView] = useState<'create' | 'tracking'>(() => new URL(window.location.href).searchParams.get('reportTab') === 'tracking' ? 'tracking' : 'create');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(() => new URL(window.location.href).searchParams.get('reportReceipt'));
  const [category, setCategory] = useState<Incident['category']>(initialDraft && initialDraft.category in categoryLabels ? initialDraft.category as Incident['category'] : 'security');
  const [summary, setSummary] = useState(initialDraft?.summary ?? '');
  const [description, setDescription] = useState(initialDraft?.description ?? '');
  const [locationNote, setLocationNote] = useState(initialDraft?.locationNote ?? '');
  const [contactPhone, setContactPhone] = useState(initialDraft?.contactPhone ?? '');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [position, setPosition] = useState(selectedPosition);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [clientRequestId, setClientRequestId] = useState(createRequestId);
  const [messages, setMessages] = useState<IncidentMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [supplementFile, setSupplementFile] = useState<File | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [sentReceipt, setSentReceipt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!evidenceFile || !evidenceFile.type.startsWith('image/')) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(evidenceFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [evidenceFile]);

  useEffect(() => {
    if (selectedPosition) setPosition(selectedPosition);
  }, [selectedPosition]);

  const changeView = (nextView: 'create' | 'tracking') => {
    const url = new URL(window.location.href);
    if (nextView === 'tracking') url.searchParams.set('reportTab', nextView);
    else url.searchParams.delete('reportTab');
    window.history.replaceState({}, '', url);
    setView(nextView);
  };

  const selectReceipt = (receipt: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('reportReceipt', receipt);
    window.history.replaceState({}, '', url);
    setSelectedReceipt(receipt);
  };

  useEffect(() => {
    const restore = () => {
      const params = new URL(window.location.href).searchParams;
      setView(params.get('reportTab') === 'tracking' ? 'tracking' : 'create');
      setSelectedReceipt(params.get('reportReceipt'));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const selectedIncident = useMemo(
    () => selectedReceipt ? incidents.find((item) => item.receiptCode === selectedReceipt) ?? null : incidents[0] ?? null,
    [incidents, selectedReceipt],
  );

  useEffect(() => {
    if (!selectedIncident) { setMessages([]); return; }
    listCitizenIncidentMessages(selectedIncident.receiptCode).then(setMessages).catch(() => setMessages([]));
  }, [selectedIncident?.id, selectedIncident?.receiptCode]);

  const loadIncidents = async () => {
    if (!isAuthenticated) { setIncidents([]); setSelectedReceipt(null); return; }
    setLoading(true);
    setError('');
    try {
      const payload = await listCitizenIncidents();
      if (selectedReceipt && !payload.data.some((item) => item.receiptCode === selectedReceipt)) {
        payload.data.unshift(await getCitizenIncident(selectedReceipt));
      }
      setIncidents(payload.data);
      if (!selectedReceipt && payload.data[0]) setSelectedReceipt(payload.data[0].receiptCode);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  };

  // Theo dõi hồ sơ "trực tiếp": khi đang mở tab Theo dõi, 30 giây tải lại một lần; trạng thái đổi thì báo bằng popup.
  const statusSnapshot = useRef(new Map<string, string>());
  useEffect(() => {
    statusSnapshot.current = new Map(incidents.map((item) => [item.id, item.status]));
  }, [incidents]);
  useEffect(() => {
    if (!isAuthenticated || view !== 'tracking') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (document.hidden || !navigator.onLine) return;
      void listCitizenIncidents().then((payload) => {
        if (cancelled) return;
        for (const item of payload.data) {
          const before = statusSnapshot.current.get(item.id);
          if (before && before !== item.status) showToast({ kind: 'info', topic: 'report', title: `Hồ sơ ${item.receiptCode} vừa được cập nhật`, message: statusLabels[item.status] });
        }
        setIncidents((current) => {
          const extra = current.filter((item) => !payload.data.some((fresh) => fresh.id === item.id));
          const next = [...payload.data, ...extra];
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        });
      }).catch(() => undefined);
    }, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isAuthenticated, view]);

  useEffect(() => {
    if (isAuthenticated) void loadIncidents();
    else { setIncidents([]); setSelectedReceipt(null); }
  }, [isAuthenticated]);

  // Tự lưu nháp sau khi người dân ngừng gõ ~0,4 giây.
  useEffect(() => {
    const timer = window.setTimeout(() => saveReportDraft({ category, summary, description, locationNote, contactPhone }), 400);
    return () => window.clearTimeout(timer);
  }, [category, summary, description, locationNote, contactPhone]);

  const discardDraft = () => {
    clearReportDraft();
    setCategory('security'); setSummary(''); setDescription(''); setLocationNote(''); setContactPhone('');
    setDraftRestored(false);
  };

  const pickToken = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const pickEvidence = (picked: File | null) => {
    const token = ++pickToken.current;
    if (!picked) { setEvidenceFile(null); setError(''); setPreparing(false); return; }
    const early = acceptedMediaTypes.has(picked.type) ? null : mediaError(picked);
    if (early) { setEvidenceFile(null); setError(early); setFileInputKey((value) => value + 1); return; }
    setError(''); setPreparing(true);
    // Ảnh chất lượng cao được thu nhỏ trước khi xem trước/gửi để không làm treo trang.
    void prepareMedia(picked).then((file) => {
      if (token !== pickToken.current) return;
      const problem = mediaError(file);
      // A file the server would refuse is not kept, so the form never looks ready when it is not.
      setEvidenceFile(problem ? null : file);
      setError(problem ?? '');
      if (problem) setFileInputKey((value) => value + 1);
    }).catch((caught) => {
      if (token !== pickToken.current) return;
      setEvidenceFile(null); setError(caught instanceof Error ? caught.message : 'Không đọc được tệp này.'); setFileInputKey((value) => value + 1);
    }).finally(() => { if (token === pickToken.current) setPreparing(false); });
  };
  const pickSupplement = (picked: File | null) => {
    if (!picked) { setSupplementFile(null); return; }
    setThreadBusy(true); setError('');
    void prepareMedia(picked).then((file) => {
      const problem = mediaError(file);
      if (problem) { setSupplementFile(null); setError(problem); } else setSupplementFile(file);
    }).catch((caught) => { setSupplementFile(null); setError(caught instanceof Error ? caught.message : 'Không đọc được tệp này.'); })
      .finally(() => setThreadBusy(false));
  };

  // What still blocks "Gửi phản ánh", in the order the form is filled.
  const missing: string[] = [];
  if (summary.trim().length < 10) missing.push(summary.trim() ? 'tiêu đề dài hơn (từ 10 ký tự)' : 'tiêu đề');
  if (description.trim().length < 10) missing.push(description.trim() ? 'mô tả dài hơn (từ 10 ký tự)' : 'mô tả');
  if (!position) missing.push('vị trí');
  if (!consent) missing.push('ô xác nhận');
  if (preparing) missing.push('đợi ảnh xử lý xong');

  const fieldErrors: Record<'summary' | 'description' | 'position' | 'consent', string> = {
    summary: summary.trim().length >= 10 ? '' : summary.trim() ? 'Tiêu đề cần từ 10 ký tự trở lên.' : 'Hãy nhập tiêu đề ngắn (từ 10 ký tự).',
    description: description.trim().length >= 10 ? '' : description.trim() ? 'Mô tả cần từ 10 ký tự trở lên.' : 'Hãy mô tả sự việc (từ 10 ký tự).',
    position: position ? '' : 'Chưa có vị trí. Bấm "Dùng GPS" hoặc chạm một điểm trên bản đồ.',
    consent: consent ? '' : 'Cần tích ô cam đoan trước khi gửi.',
  };
  const shown = (field: keyof typeof fieldErrors) => (attempted || touched[field] ? fieldErrors[field] : '');
  const focusField = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => target.focus({ preventScroll: true }), 250);
  };

  const copyReceipt = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(true); showToast({ kind: 'info', topic: 'report', title: 'Đã sao chép mã hồ sơ' }); window.setTimeout(() => setCopied(false), 2500); } catch { setError('Không sao chép được. Bạn hãy chép mã bằng tay.'); }
  };

  const locate = () => {
    setError('');
    if (!supportsDeviceLocation()) {
      setError('Thiết bị không hỗ trợ GPS. Hãy chọn một điểm trên bản đồ trước khi tạo phản ánh.');
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
        setError('Không lấy được GPS. Hãy cấp quyền vị trí hoặc chọn điểm trên bản đồ.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  // AI chỉ điền sẵn: giữ nguyên số liên hệ, vị trí, ảnh và ô xác nhận để người dân tự làm.
  const applyDraft = (draft: IncidentDraft) => {
    setCategory(draft.category);
    setSummary(draft.summary.slice(0, 180));
    setDescription(draft.description.slice(0, 4000));
    if (draft.locationNote) setLocationNote(draft.locationNote.slice(0, 500));
    setNotice('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAuthenticated) { onRequireLogin(); return; }
    if (preparing) { setError('Ảnh đang được xử lý, vui lòng đợi vài giây rồi bấm Gửi lại.'); return; }
    if (!position || !consent || missing.length > 0) {
      // Còn thiếu: báo lỗi tại từng ô rồi đưa người dân tới ô đầu tiên cần sửa (không để nút Gửi "chết" không rõ lý do).
      setAttempted(true);
      const first = fieldErrors.summary ? 'report-summary' : fieldErrors.description ? 'report-description' : fieldErrors.position ? 'report-location' : 'report-consent';
      focusField(first);
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const invalidMedia = evidenceFile ? mediaError(evidenceFile) : null;
      if (invalidMedia) {
        setError(invalidMedia);
        return;
      }
      const payload = await createIncident({
        clientRequestId,
        category,
        summary,
        description,
        locationNote: locationNote || null,
        contactPhone: contactPhone || null,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM,
        attachments: evidenceFile ? [{
          fileName: evidenceFile.name,
          mimeType: evidenceFile.type as IncidentAttachment['mimeType'],
          sizeBytes: evidenceFile.size,
          dataBase64: await encodeMedia(evidenceFile),
        }] : [],
      });
      setNotice('');
      showToast({ kind: 'success', topic: 'report', title: 'Đã gửi phản ánh', message: `Mã hồ sơ: ${payload.data.receiptCode}` });
      setSentReceipt(payload.data.receiptCode);
      setCopied(false);
      setIncidents((current) => [payload.data, ...current.filter((item) => item.id !== payload.data.id)]);
      selectReceipt(payload.data.receiptCode);
      setClientRequestId(createRequestId());
      clearReportDraft();
      setDraftRestored(false);
      setAttempted(false);
      setTouched({});
      setSummary('');
      setDescription('');
      setLocationNote('');
      setEvidenceFile(null);
      setFileInputKey((value) => value + 1);
      setConsent(false);
      changeView('tracking');
      window.setTimeout(() => topRef.current?.closest('.feature-workspace')?.scrollTo({ top: 0 }), 60);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedIncident || !messageText.trim()) return;
    setThreadBusy(true); setError('');
    try {
      const created = await addCitizenIncidentMessage(selectedIncident.receiptCode, messageText.trim());
      setMessages((current) => [...current, created]);
      setMessageText('');
    } catch (caught) { setError(message(caught)); } finally { setThreadBusy(false); }
  };

  const [withdrawConfirmation, setWithdrawConfirmation] = useState(false);
  const withdraw = async () => {
    if (!selectedIncident) return;
    if (!withdrawConfirmation) { setWithdrawConfirmation(true); return; }
    setThreadBusy(true); setError('');
    try {
      const updated = await withdrawCitizenIncident(selectedIncident.receiptCode);
      setIncidents((current) => current.map((item) => item.id === updated.id ? updated : item));
      setWithdrawConfirmation(false);
      setNotice('Đã rút phản ánh. Hồ sơ được đóng và lưu lại trong lịch sử.');
      showToast({ kind: 'info', topic: 'report', title: 'Đã rút phản ánh' });
    } catch (caught) { setError(message(caught)); } finally { setThreadBusy(false); }
  };

  const uploadSupplement = async () => {
    if (!selectedIncident || !supplementFile) return;
    const invalidMedia = mediaError(supplementFile);
    if (invalidMedia) { setError(invalidMedia); return; }
    setThreadBusy(true); setError('');
    try {
      const created = await addCitizenIncidentAttachment(selectedIncident.receiptCode, {
        fileName: supplementFile.name,
        mimeType: supplementFile.type as IncidentAttachment['mimeType'],
        sizeBytes: supplementFile.size,
        dataBase64: await encodeMedia(supplementFile),
      });
      setIncidents((current) => current.map((item) => item.id === selectedIncident.id ? { ...item, attachments: [...item.attachments, created] } : item));
      setSupplementFile(null);
      setNotice('Đã bổ sung tệp minh chứng vào hồ sơ.');
      showToast({ kind: 'success', topic: 'report', title: 'Đã bổ sung tệp vào hồ sơ' });
    } catch (caught) { setError(message(caught)); } finally { setThreadBusy(false); }
  };

  return (
    <section className="citizen-workflow" aria-labelledby="report-workflow-title">

      <div className="segmented-control" role="tablist" aria-label="Phản ánh">
        <button type="button" role="tab" aria-selected={view === 'create'} className={view === 'create' ? 'active' : ''} onClick={() => changeView('create')}>
          <FilePlus2 size={17} aria-hidden="true" /> Tạo phản ánh
        </button>
        <button type="button" role="tab" aria-selected={view === 'tracking'} className={view === 'tracking' ? 'active' : ''} onClick={() => changeView('tracking')}>
          <RefreshCw size={17} aria-hidden="true" /> Theo dõi ({incidents.length})
        </button>
      </div>

      {view === 'create' ? (
        <form className="operational-form" onSubmit={submit} noValidate>
          {draftRestored && <p className="draft-restored" role="status">Đã khôi phục nội dung bạn đang soạn lần trước. <button type="button" onClick={discardDraft}>Xóa bản nháp</button></p>}
          <IncidentDraftAssistant isAuthenticated={isAuthenticated} categoryLabels={categoryLabels} onRequireLogin={onRequireLogin} onDraft={applyDraft} />
          <label><span>Nhóm phản ánh <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <select name="category" autoComplete="off" value={category} onChange={(event) => setCategory(event.target.value as Incident['category'])}>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label><span>Tiêu đề ngắn <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <input id="report-summary" name="summary" autoComplete="off" enterKeyHint="next" value={summary} onChange={(event) => setSummary(event.target.value)} onBlur={() => touch('summary')} aria-invalid={Boolean(shown('summary'))} aria-describedby={shown('summary') ? 'report-summary-error' : undefined} minLength={10} maxLength={180} placeholder="Ví dụ: Tụ tập gây ồn sau 23 giờ" required />
            {summary.length > 150 && <small>{summary.length}/180 ký tự</small>}
            {shown('summary') && <small id="report-summary-error" className="field-error" role="alert">{shown('summary')}</small>}
          </label>
          <label><span>Mô tả sự việc <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <textarea id="report-description" name="description" autoComplete="off" value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => touch('description')} aria-invalid={Boolean(shown('description'))} aria-describedby={shown('description') ? 'report-description-error' : undefined} minLength={10} maxLength={4000} rows={5} placeholder="Nêu thời gian, diễn biến và dấu hiệu cần xác minh. Không đưa thông tin không cần thiết về người khác." required />
            {shown('description') && <small id="report-description-error" className="field-error" role="alert">{shown('description')}</small>}
          </label>
          <div className="evidence-field">
            <span className="evidence-label">Ảnh hoặc video</span>
            {evidenceFile ? (
              <div className="evidence-preview">
                {previewUrl ? <img src={previewUrl} alt="Ảnh bạn đã chọn" /> : <span className="evidence-video" aria-hidden="true"><Paperclip size={22} /></span>}
                <div>
                  <strong>{evidenceFile.name}</strong>
                  <small>{evidenceFile.size < 1024 * 1024 ? `${Math.max(1, Math.round(evidenceFile.size / 1024))} KB` : `${(evidenceFile.size / 1024 / 1024).toFixed(1)} MB`}</small>
                </div>
                <button type="button" className="evidence-remove" onClick={() => { pickEvidence(null); setFileInputKey((value) => value + 1); }} aria-label="Bỏ tệp đã chọn"><X size={18} aria-hidden="true" /> Bỏ</button>
              </div>
            ) : (
              <div className="evidence-actions">
                <label className="evidence-button">
                  <Camera size={20} aria-hidden="true" /> Chụp ảnh
                  <input key={`cam-${fileInputKey}`} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => pickEvidence(event.target.files?.[0] ?? null)} />
                </label>
                <label className="evidence-button">
                  <Images size={20} aria-hidden="true" /> Chọn ảnh / video
                  <input key={`pick-${fileInputKey}`} className="sr-only" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => pickEvidence(event.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}
            {preparing && <small className="evidence-hint" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Đang thu nhỏ ảnh…</small>}
          </div>
          <WorkflowLocationMap position={position} onSelect={(nextPosition) => { setPosition(nextPosition); setAccuracyM(null); }} />
          <div id="report-location" tabIndex={-1} className={position ? 'workflow-location ready' : 'workflow-location'} aria-invalid={Boolean(shown('position'))}>
            <MapPin size={21} aria-hidden="true" />
            <div>
              <strong>{position ? 'Đã có vị trí gửi kèm' : 'Chưa có vị trí'}</strong>
              {position && <span>{accuracyM ? `Sai số khoảng ${Math.round(accuracyM)} m` : 'Đã chọn trên bản đồ'}</span>}
            </div>
            <button type="button" onClick={locate} disabled={locating}><LocateFixed size={17} aria-hidden="true" /> {locating ? 'Đang lấy…' : 'Dùng GPS'}</button>
          </div>
          {shown('position') && <small className="field-error" role="alert">{shown('position')}</small>}
          <div className="form-grid">
            <label>Mô tả vị trí
              <input name="locationNote" autoComplete="off" value={locationNote} onChange={(event) => setLocationNote(event.target.value)} maxLength={500} placeholder="Mốc dễ nhận biết, số nhà…" />
            </label>
            <label>Số liên hệ
              <input name="contactPhone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={30} placeholder="Không bắt buộc" />
            </label>
          </div>
          <label className="consent-row">
            <input id="report-consent" name="truthfulnessConsent" type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); touch('consent'); }} aria-invalid={Boolean(shown('consent'))} />
            <span>Tôi cam đoan nội dung đúng sự thật và đồng ý gửi kèm vị trí. Cố ý báo tin sai có thể bị xử lý theo pháp luật.</span>
          </label>
          {shown('consent') && <small className="field-error" role="alert">{shown('consent')}</small>}
          {!isAuthenticated && <VneIdLoginPrompt action="gửi phản ánh" onLogin={onRequireLogin} compact />}
          <button className="primary-action" type={isAuthenticated ? 'submit' : 'button'} onClick={isAuthenticated ? undefined : onRequireLogin} disabled={isAuthenticated && submitting}>
            {submitting ? <span className="loader light" /> : <Send size={18} aria-hidden="true" />}
            {submitting ? 'Đang lưu phản ánh…' : isAuthenticated ? 'Gửi phản ánh' : 'Đăng nhập để gửi'}
          </button>
        </form>
      ) : (
        !isAuthenticated ? <VneIdLoginPrompt action="theo dõi phản ánh" onLogin={onRequireLogin} /> : <div className="case-tracking-layout">
          <div ref={topRef} className="scroll-anchor" />
          {sentReceipt && (
            <section className="sent-card" role="status" aria-live="polite">
              <CheckCircle2 size={28} aria-hidden="true" />
              <div>
                <h3>Đã gửi phản ánh thành công</h3>
                <p>Mã hồ sơ của bạn: <code>{sentReceipt}</code></p>
                <p>Cán bộ khu vực sẽ tiếp nhận và cập nhật ngay tại mục này. Bạn cũng sẽ nhận thông báo khi có tiến triển.</p>
                <div className="sent-actions">
                  <button type="button" onClick={() => void copyReceipt(sentReceipt)}><Copy size={16} aria-hidden="true" /> {copied ? 'Đã sao chép' : 'Sao chép mã'}</button>
                  <button type="button" onClick={() => setSentReceipt(null)}>Đóng</button>
                </div>
              </div>
            </section>
          )}
          <div className="case-list" aria-label="Danh sách phản ánh">
            <div className="case-list-heading"><strong>Phản ánh của tôi</strong><button type="button" onClick={() => void loadIncidents()} disabled={loading} aria-label="Tải lại danh sách"><RefreshCw size={17} aria-hidden="true" /></button></div>
            {incidents.length === 0 && !loading && <p className="workflow-empty">Bạn chưa gửi phản ánh nào. Chọn "Tạo phản ánh" để bắt đầu.</p>}
            {incidents.map((item) => (
              <button key={item.id} type="button" className={selectedIncident?.id === item.id ? 'case-list-item active' : 'case-list-item'} onClick={() => selectReceipt(item.receiptCode)}>
                <span className={`status-dot ${item.status}`} aria-hidden="true" />
                <span><strong>{item.summary}</strong><small>{statusLabels[item.status]} · {dayFormatter.format(new Date(item.createdAt))}</small></span>
              </button>
            ))}
          </div>
          {selectedIncident && (
            <article className="case-detail-card">
              <div className="case-detail-head">
                <div><span className={`status-chip ${selectedIncident.status}`}>{statusLabels[selectedIncident.status]}</span><h2>{selectedIncident.summary}</h2><code>{selectedIncident.receiptCode}</code></div>
                <CheckCircle2 size={27} aria-hidden="true" />
              </div>
              <p className="next-step"><strong>Tiếp theo:</strong> {nextStepText[selectedIncident.status]}</p>
              <p>{selectedIncident.description}</p>
              <dl className="case-facts">
                <div><dt>Địa bàn</dt><dd>{selectedIncident.location.serviceAreaName ?? selectedIncident.location.localityName}</dd></div>
                {selectedIncident.assignedOfficer && <div><dt>Phụ trách</dt><dd>{selectedIncident.assignedOfficer.displayName}</dd></div>}
              </dl>
              <section className="case-subsection" aria-labelledby="citizen-history-title">
                <h3 id="citizen-history-title"><History size={18} aria-hidden="true" /> Lịch sử xử lý</h3>
                <WorkflowTimeline history={selectedIncident.history} statusLabels={statusLabels} />
              </section>
              {['submitted', 'received'].includes(selectedIncident.status) && (
                <div className="case-withdraw">
                  {withdrawConfirmation && <p className="inline-notice error" role="alert">Rút phản ánh sẽ đóng hồ sơ và không thể hoàn tác. Bạn chắc chắn chứ?</p>}
                  <button type="button" className="danger-outline" disabled={threadBusy} onClick={() => void withdraw()}>
                    {withdrawConfirmation ? 'Xác nhận rút phản ánh' : 'Rút phản ánh'}
                  </button>
                </div>
              )}
              <section className="case-subsection" aria-labelledby="citizen-media-title">
                <h3 id="citizen-media-title"><Paperclip size={18} aria-hidden="true" /> Ảnh / video</h3>
                <IncidentMediaGallery scope="citizen" incidentKey={selectedIncident.receiptCode} attachments={selectedIncident.attachments} />
                <div className="supplement-row">
                  <label className="evidence-button supplement-pick"><Images size={20} aria-hidden="true" /> {supplementFile ? supplementFile.name : 'Chọn ảnh / video bổ sung'}<input className="sr-only" aria-label="Chọn tệp bổ sung" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => pickSupplement(event.target.files?.[0] ?? null)} /></label>
                  {supplementFile && <button className="primary-action" type="button" disabled={threadBusy} onClick={() => void uploadSupplement()}><Paperclip size={16} /> Gửi tệp này</button>}
                </div>
              </section>
              <section className="case-subsection" aria-labelledby="citizen-thread-title">
                <h3 id="citizen-thread-title"><MessageSquareText size={18} aria-hidden="true" /> Trao đổi với cán bộ</h3>
                <div className="case-thread" aria-live="polite">
                  
                  {messages.map((entry) => <article key={entry.id} className={`thread-message ${entry.authorRole}`}><strong>{entry.authorLabel}</strong><p>{entry.message}</p>{entry.requestMedia && <span>Yêu cầu bổ sung ảnh/video</span>}<time>{new Date(entry.createdAt).toLocaleString('vi-VN')}</time></article>)}
                </div>
                <form className="thread-compose" onSubmit={sendMessage}>
                  <label className="sr-only" htmlFor="citizen-message">Nội dung trao đổi</label>
                  <textarea id="citizen-message" value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={2} maxLength={2000} placeholder="Bổ sung thông tin cho cán bộ…" required />
                  {messageText.trim().length >= 2 && <button className="primary-action" type="submit" disabled={threadBusy}><Send size={17} /> Gửi</button>}
                </form>
              </section>
            </article>
          )}
        </div>
      )}

      {notice && <p className="inline-notice success" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {notice}</p>}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </section>
  );
}
