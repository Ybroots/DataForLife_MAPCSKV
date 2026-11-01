import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, Sparkles } from 'lucide-react';
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
 * "Kể lại sự việc": người dân gõ hoặc nói, AI điền sẵn nhóm, tiêu đề, mô tả (kèm thời điểm) và mô tả vị trí.
 * Không tự gửi: người dân xem lại từng ô, tự chọn vị trí trên bản đồ, đính kèm ảnh rồi mới bấm gửi.
 */
export function IncidentDraftAssistant({ isAuthenticated, categoryLabels, onRequireLogin, onDraft }: IncidentDraftAssistantProps) {
  const [available, setAvailable] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IncidentDraft | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const Speech = speechRecognitionCtor();

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus(controller.signal)
      .then((status) => setAvailable(status.configured && status.features.includes('incident_draft')))
      .catch(() => setAvailable(false));
    return () => { controller.abort(); recognitionRef.current?.stop(); };
  }, []);

  if (!available) return null;

  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    if (!Speech) return;
    setError('');
    const recognition = new Speech();
    recognition.lang = 'vi-VN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let heard = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const item = event.results[index];
        if (item?.isFinal) heard += item[0].transcript;
      }
      if (heard.trim()) setText((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${heard.trim()}`.slice(0, MAX_LENGTH));
    };
    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Trình duyệt chưa cho dùng micro. Bạn có thể gõ nội dung.' : 'Không nghe rõ. Hãy nói lại hoặc gõ nội dung.');
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Không bật được micro. Bạn có thể gõ nội dung.');
    }
  };

  const draft = async () => {
    if (!isAuthenticated) { onRequireLogin(); return; }
    recognitionRef.current?.stop();
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
        {Speech && (
          <button type="button" className={listening ? 'incident-draft-voice on' : 'incident-draft-voice'} onClick={toggleVoice} aria-pressed={listening} disabled={busy}>
            {listening ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
            {listening ? 'Dừng nghe' : 'Nói'}
          </button>
        )}
        <button type="button" className="incident-draft-submit" onClick={() => void draft()} disabled={busy || length < MIN_LENGTH}>
          {busy ? <span className="loader" /> : <Sparkles size={17} aria-hidden="true" />}
          {busy ? 'AI đang đọc…' : 'Điền giúp tôi'}
        </button>
      </div>
      {listening && <p className="incident-draft-status" role="status">Đang nghe… Nói rõ thời gian, địa điểm và sự việc.</p>}
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
