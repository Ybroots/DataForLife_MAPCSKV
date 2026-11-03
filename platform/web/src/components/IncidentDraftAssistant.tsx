import { useEffect, useState } from 'react';
import { PhoneCall, Sparkles } from 'lucide-react';
import { ApiError, draftIncidentWithAi, getAiStatus } from '../api';
import type { Incident, IncidentDraft } from '../types';

interface IncidentDraftAssistantProps {
  isAuthenticated: boolean;
  categoryLabels: Record<Incident['category'], string>;
  onRequireLogin: () => void;
  onDraft: (draft: IncidentDraft) => void;
}

interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Trình duyệt hỗ trợ nhận giọng nói tiếng Việt (Chrome, Edge). WebView trong app Android thường không có. */
export function speechRecognitionCtor(target: unknown = typeof window === 'undefined' ? undefined : window): SpeechRecognitionCtor | null {
  const scope = target as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor } | undefined;
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition ?? null;
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * "Kể lại sự việc": người dân gõ lời kể, AI điền sẵn nhóm, tiêu đề, mô tả (kèm thời điểm) và mô tả vị trí.
 * Không tự gửi: người dân xem lại từng ô, tự chọn vị trí trên bản đồ, đính kèm ảnh rồi mới bấm gửi.
 */
export function IncidentDraftAssistant({ isAuthenticated, categoryLabels, onRequireLogin, onDraft }: IncidentDraftAssistantProps) {
  const [available, setAvailable] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IncidentDraft | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus(controller.signal)
      .then((status) => setAvailable(status.configured && status.features.includes('incident_draft')))
      .catch(() => setAvailable(false));
    return () => { controller.abort(); };
  }, []);

  if (!available) return null;

  const draft = async () => {
    if (!isAuthenticated) { onRequireLogin(); return; }
    setBusy(true);
    setError('');
    try {
      const value = await draftIncidentWithAi(text.trim());
      setResult(value);
      onDraft(value);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onRequireLogin();
      setError(caught instanceof ApiError ? caught.message : 'Chưa kết nối được AI. Bạn vẫn có thể tự điền phiếu.');
    } finally {
      setBusy(false);
    }
  };

  const length = text.trim().length;
  return (
    <section className="incident-draft-assistant" aria-labelledby="incident-draft-title">
      <div className="incident-draft-head">
        <span aria-hidden="true"><Sparkles size={20} /></span>
        <div>
          <h3 id="incident-draft-title">Kể lại sự việc, AI điền giúp</h3>
          <p>AI chỉ điền sẵn các ô bên dưới. Bạn kiểm tra lại, chọn vị trí và gửi.</p>
        </div>
      </div>
      <label className="incident-draft-input">
        <span className="sr-only">Lời kể sự việc</span>
        <textarea
          name="draftText"
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))}
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder="Ví dụ: Khoảng 21 giờ 30 tối nay tôi bị mất ví ở cổng chợ đêm Đà Lạt, trong ví có giấy tờ và tiền."
        />
      </label>
      <div className="incident-draft-actions">
        <button type="button" className="incident-draft-submit" onClick={() => void draft()} disabled={busy || length < MIN_LENGTH}>
          {busy ? <span className="loader" /> : <Sparkles size={17} aria-hidden="true" />}
          {busy ? 'AI đang đọc…' : 'Điền giúp tôi'}
        </button>
      </div>
      {error && <p className="incident-draft-error" role="alert">{error}</p>}
      {result && (
        <div className="incident-draft-result" role="status">
          <strong>AI đã điền sẵn — hãy kiểm tra lại trước khi gửi</strong>
          <ul>
            <li><span>Nhóm</span>{categoryLabels[result.category]}</li>
            <li><span>Thời gian</span>{result.occurredAt ?? 'Chưa nói rõ'}</li>
            <li><span>Địa điểm</span>{result.locationNote ?? 'Chưa nói rõ — hãy ghi mốc dễ nhận biết'}</li>
          </ul>
          <small>Vị trí trên bản đồ không do AI chọn: hãy bấm vào bản đồ hoặc dùng GPS.</small>
        </div>
      )}
      {result?.emergency && (
        <div className="incident-draft-emergency" role="alert">
          <strong>Nội dung có dấu hiệu khẩn cấp.</strong>
          <span>Nếu đang nguy hiểm, hãy gọi ngay hoặc dùng nút SOS thay vì gửi phản ánh.</span>
          <a href="tel:113"><PhoneCall size={16} aria-hidden="true" /> Gọi 113</a>
        </div>
      )}
    </section>
  );
}
