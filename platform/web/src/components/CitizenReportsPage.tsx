import { FormEvent, useEffect, useMemo, useState } from 'react';
import { readDevicePosition, supportsDeviceLocation } from '../device-location';
import {
  CheckCircle2,
  FilePlus2,
  LocateFixed,
  MapPin,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Send,
} from 'lucide-react';
import { addCitizenIncidentAttachment, addCitizenIncidentMessage, ApiError, createIncident, getCitizenIncident, listCitizenIncidentMessages, listCitizenIncidents, withdrawCitizenIncident } from '../api';
import type { Incident, IncidentAttachment, IncidentMessage, IncidentStatus } from '../types';
import { WorkflowTimeline } from './WorkflowTimeline';
import { IncidentMediaGallery } from './IncidentMediaGallery';
import { WorkflowLocationMap } from './WorkflowLocationMap';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { createRequestId } from '../request-id';

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

const categoryLabels: Record<Incident['category'], string> = {
  security: 'An ninh trật tự',
  traffic: 'Giao thông',
  public_order: 'Trật tự đô thị',
  administrative: 'Thủ tục hành chính',
  environment: 'Môi trường',
  other: 'Nội dung khác',
};

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Chưa thể kết nối quy trình phản ánh local.';
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

function mediaError(file: File): string | null {
  if (!acceptedMediaTypes.has(file.type)) return 'Chỉ nhận ảnh JPEG/PNG/WebP hoặc video MP4/WebM.';
  const limit = file.type.startsWith('video/') ? 20 : 5;
  return file.size > limit * 1024 * 1024 ? `${file.type.startsWith('video/') ? 'Video' : 'Ảnh'} không vượt quá ${limit} MB.` : null;
}

export function CitizenReportsPage({ selectedPosition, isAuthenticated, onRequireLogin }: CitizenReportsPageProps) {
  const [view, setView] = useState<'create' | 'tracking'>(() => new URL(window.location.href).searchParams.get('reportTab') === 'tracking' ? 'tracking' : 'create');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(() => new URL(window.location.href).searchParams.get('reportReceipt'));
  const [category, setCategory] = useState<Incident['category']>('security');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [contactPhone, setContactPhone] = useState('');
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

  useEffect(() => {
    if (isAuthenticated) void loadIncidents();
    else { setIncidents([]); setSelectedReceipt(null); }
  }, [isAuthenticated]);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAuthenticated) { onRequireLogin(); return; }
    if (!position || !consent || !evidenceFile) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const invalidMedia = mediaError(evidenceFile);
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
        attachments: [{
          fileName: evidenceFile.name,
          mimeType: evidenceFile.type as IncidentAttachment['mimeType'],
          sizeBytes: evidenceFile.size,
          dataBase64: await encodeMedia(evidenceFile),
        }],
      });
      setNotice(`Đã lưu phản ánh local với mã ${payload.data.receiptCode}.`);
      setIncidents((current) => [payload.data, ...current.filter((item) => item.id !== payload.data.id)]);
      selectReceipt(payload.data.receiptCode);
      setClientRequestId(createRequestId());
      setSummary('');
      setDescription('');
      setLocationNote('');
      setEvidenceFile(null);
      setFileInputKey((value) => value + 1);
      setConsent(false);
      changeView('tracking');
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
        <form className="operational-form" onSubmit={submit}>
          <div className="form-section-heading">
            <div><span>Bước 1–3</span><h2 id="report-workflow-title">Nội dung, vị trí và xác nhận</h2></div>
          </div>
          <label><span>Nhóm phản ánh <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <select name="category" autoComplete="off" value={category} onChange={(event) => setCategory(event.target.value as Incident['category'])}>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label><span>Tiêu đề ngắn <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <input name="summary" autoComplete="off" value={summary} onChange={(event) => setSummary(event.target.value)} minLength={10} maxLength={180} placeholder="Ví dụ: Tụ tập gây ồn sau 23 giờ" required />
            <small>{summary.length}/180 ký tự</small>
          </label>
          <label><span>Mô tả sự việc <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <textarea name="description" autoComplete="off" value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={4000} rows={5} placeholder="Nêu thời gian, diễn biến và dấu hiệu cần xác minh. Không đưa thông tin không cần thiết về người khác." required />
          </label>
          <label><span>Ảnh hoặc video hiện trường <strong style={{ color: 'red', fontSize: '1.2em' }}>*</strong></span>
            <input
              key={fileInputKey}
              name="evidence"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setEvidenceFile(file);
                setError(file ? mediaError(file) ?? '' : '');
              }}
              required
            />
            <small>{evidenceFile ? `${evidenceFile.name} · ${(evidenceFile.size / 1024 / 1024).toFixed(2)} MB` : 'Ảnh tối đa 5 MB · video tối đa 20 MB'}</small>
          </label>
          <WorkflowLocationMap position={position} onSelect={(nextPosition) => { setPosition(nextPosition); setAccuracyM(null); }} />
          <div className={position ? 'workflow-location ready' : 'workflow-location'}>
            <MapPin size={21} aria-hidden="true" />
            <div>
              <strong>{position ? 'Đã có vị trí gửi kèm' : 'Chưa có vị trí'}</strong>
              <span>{position ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}${accuracyM ? ` · sai số khoảng ${Math.round(accuracyM)} m` : ''}` : 'Chọn điểm trên bản đồ hoặc dùng GPS của thiết bị.'}</span>
            </div>
            <button type="button" onClick={locate} disabled={locating}><LocateFixed size={17} aria-hidden="true" /> {locating ? 'Đang lấy…' : 'Dùng GPS'}</button>
          </div>
          {import.meta.env.DEV && !position && (
            <button className="text-action" type="button" onClick={() => { setPosition({ latitude: 11.944, longitude: 108.441 }); setAccuracyM(15); }}>
              Dùng điểm demo Xuân Hương
            </button>
          )}
          <div className="form-grid">
            <label>Mô tả vị trí
              <input name="locationNote" autoComplete="off" value={locationNote} onChange={(event) => setLocationNote(event.target.value)} maxLength={500} placeholder="Mốc dễ nhận biết, số nhà…" />
            </label>
            <label>Số liên hệ
              <input name="contactPhone" type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={30} placeholder="Dùng khi cần làm rõ" />
            </label>
          </div>
          <label className="consent-row">
            <input name="truthfulnessConsent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>Tôi xác nhận nội dung phản ánh là đúng theo hiểu biết của mình, đồng ý gửi vị trí và chịu trách nhiệm về thông tin đã cung cấp. Tôi hiểu việc cố ý báo tin sai sự thật có thể bị xử lý theo pháp luật.</span>
          </label>
          {!isAuthenticated && <VneIdLoginPrompt action="gửi phản ánh" onLogin={onRequireLogin} compact />}
          <button className="primary-action" type={isAuthenticated ? 'submit' : 'button'} onClick={isAuthenticated ? undefined : onRequireLogin} disabled={isAuthenticated && (submitting || !position || !consent || !evidenceFile)}>
            {submitting ? <span className="loader light" /> : <Send size={18} aria-hidden="true" />}
            {submitting ? 'Đang lưu phản ánh…' : isAuthenticated ? 'Gửi phản ánh' : 'Đăng nhập để gửi'}
          </button>
        </form>
      ) : (
        !isAuthenticated ? <VneIdLoginPrompt action="theo dõi phản ánh" onLogin={onRequireLogin} /> : <div className="case-tracking-layout">
          <div className="case-list" aria-label="Danh sách phản ánh">
            <div className="case-list-heading"><strong>Phản ánh của tôi</strong><button type="button" onClick={() => void loadIncidents()} disabled={loading} aria-label="Tải lại danh sách"><RefreshCw size={17} aria-hidden="true" /></button></div>
            {incidents.length === 0 && !loading && <p className="workflow-empty">Chưa có phản ánh nào trong tài khoản local này.</p>}
            {incidents.map((item) => (
              <button key={item.id} type="button" className={selectedIncident?.id === item.id ? 'case-list-item active' : 'case-list-item'} onClick={() => selectReceipt(item.receiptCode)}>
                <span className={`status-dot ${item.status}`} aria-hidden="true" />
                <span><strong>{item.summary}</strong><small>{item.receiptCode} · {statusLabels[item.status]}</small></span>
              </button>
            ))}
          </div>
          {selectedIncident && (
            <article className="case-detail-card">
              <div className="case-detail-head">
                <div><span className={`status-chip ${selectedIncident.status}`}>{statusLabels[selectedIncident.status]}</span><h2>{selectedIncident.summary}</h2><code>{selectedIncident.receiptCode}</code></div>
                <CheckCircle2 size={27} aria-hidden="true" />
              </div>
              <p>{selectedIncident.description}</p>
              <dl className="case-facts">
                <div><dt>Địa bàn</dt><dd>{selectedIncident.location.serviceAreaName ?? selectedIncident.location.localityName}</dd></div>
                <div><dt>Phụ trách</dt><dd>{selectedIncident.assignedOfficer?.displayName ?? 'Chưa phân công'}</dd></div>
                <div><dt>Minh chứng</dt><dd>{selectedIncident.attachments.length ? `${selectedIncident.attachments.length} tệp đã lưu` : 'Chưa có tệp'}</dd></div>
              </dl>
              {['submitted', 'received'].includes(selectedIncident.status) && (
                <div className="case-withdraw">
                  {withdrawConfirmation && <p className="inline-notice error" role="alert">Rút phản ánh sẽ đóng hồ sơ và không thể hoàn tác. Bạn chắc chắn chứ?</p>}
                  <button type="button" className="danger-outline" disabled={threadBusy} onClick={() => void withdraw()}>
                    {withdrawConfirmation ? 'Xác nhận rút phản ánh' : 'Rút phản ánh'}
                  </button>
                </div>
              )}
              <section className="case-subsection" aria-labelledby="citizen-media-title">
                <h3 id="citizen-media-title"><Paperclip size={18} aria-hidden="true" /> Minh chứng hồ sơ</h3>
                <IncidentMediaGallery scope="citizen" incidentKey={selectedIncident.receiptCode} attachments={selectedIncident.attachments} />
                <div className="supplement-row">
                  <input aria-label="Chọn tệp bổ sung" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => setSupplementFile(event.target.files?.[0] ?? null)} />
                  <button className="secondary-action" type="button" disabled={!supplementFile || threadBusy} onClick={() => void uploadSupplement()}><Paperclip size={16} /> Bổ sung</button>
                </div>
              </section>
              <section className="case-subsection" aria-labelledby="citizen-thread-title">
                <h3 id="citizen-thread-title"><MessageSquareText size={18} aria-hidden="true" /> Trao đổi với cán bộ</h3>
                <div className="case-thread" aria-live="polite">
                  {messages.length === 0 && <p className="workflow-empty">Chưa có nội dung trao đổi.</p>}
                  {messages.map((entry) => <article key={entry.id} className={`thread-message ${entry.authorRole}`}><strong>{entry.authorLabel}</strong><p>{entry.message}</p>{entry.requestMedia && <span>Yêu cầu bổ sung ảnh/video</span>}<time>{new Date(entry.createdAt).toLocaleString('vi-VN')}</time></article>)}
                </div>
                <form className="thread-compose" onSubmit={sendMessage}>
                  <label className="sr-only" htmlFor="citizen-message">Nội dung trao đổi</label>
                  <textarea id="citizen-message" value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={2} maxLength={2000} placeholder="Bổ sung thông tin cho cán bộ…" required />
                  <button className="primary-action" type="submit" disabled={threadBusy || messageText.trim().length < 2}><Send size={17} /> Gửi</button>
                </form>
              </section>
              <WorkflowTimeline history={selectedIncident.history} statusLabels={statusLabels} />
            </article>
          )}
        </div>
      )}

      {notice && <p className="inline-notice success" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {notice}</p>}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </section>
  );
}
