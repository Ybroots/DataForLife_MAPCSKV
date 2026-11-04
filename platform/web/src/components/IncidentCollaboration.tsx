import { FormEvent, useEffect, useState } from 'react';
import { MessageSquareText, Paperclip, Send, Sparkles } from 'lucide-react';
import { addOfficerIncidentAttachment, addOfficerIncidentMessage, ApiError, draftIncidentReply, getAiStatus, listOfficerIncidentMessages } from '../api';
import type { Incident, IncidentAttachment, IncidentMessage } from '../types';
import { IncidentMediaGallery } from './IncidentMediaGallery';
import { TranslateButton } from './TranslateButton';

/** Tin nhắn không có dấu tiếng Việt và đủ dài: nhiều khả năng viết bằng tiếng nước ngoài, cho phép dịch sang tiếng Việt. */
const vietnameseMarks = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const looksForeign = (text: string) => text.length >= 12 && /[a-z]{3}/i.test(text) && !vietnameseMarks.test(text);

interface Props {
  incident: Incident;
  onAttachmentAdded: (attachment: IncidentAttachment) => void;
}

const mediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);

function encode(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

export function IncidentCollaboration({ incident, onAttachmentAdded }: Props) {
  const [messages, setMessages] = useState<IncidentMessage[]>([]);
  const [message, setMessage] = useState('');
  const [requestMedia, setRequestMedia] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    listOfficerIncidentMessages(incident.id).then(setMessages).catch(() => setMessages([]));
  }, [incident.id]);

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus(controller.signal).then((status) => setAiReady(status.configured && status.features.includes('reply_draft'))).catch(() => setAiReady(false));
    return () => controller.abort();
  }, []);

  /** AI chỉ điền nháp vào ô soạn: cán bộ đọc, sửa rồi tự bấm gửi. */
  const draftReply = async () => {
    if (message.trim().length >= 2 && !window.confirm('Thay nội dung đang soạn bằng bản nháp của AI?')) return;
    setDrafting(true); setNotice('');
    try {
      const draft = await draftIncidentReply(incident.id);
      setMessage(draft.message); setRequestMedia(draft.requestMedia);
      setNotice('AI đã soạn nháp. Hãy đọc và sửa trước khi gửi.');
    } catch (error) { setNotice(error instanceof ApiError ? error.message : 'Chưa soạn được nháp. Bạn có thể tự viết.'); } finally { setDrafting(false); }
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 2) return;
    setBusy(true); setNotice('');
    try {
      const created = await addOfficerIncidentMessage(incident.id, message.trim(), requestMedia);
      setMessages((current) => [...current, created]);
      setMessage(''); setRequestMedia(false);
    } catch (error) { setNotice(error instanceof ApiError ? error.message : 'Chưa gửi được nội dung trao đổi.'); } finally { setBusy(false); }
  };

  const upload = async () => {
    if (!file) return;
    const limit = file.type.startsWith('video/') ? 20 : 5;
    if (!mediaTypes.has(file.type) || file.size > limit * 1024 * 1024) { setNotice(`Tệp không hợp lệ hoặc vượt ${limit} MB.`); return; }
    setBusy(true); setNotice('');
    try {
      const created = await addOfficerIncidentAttachment(incident.id, { fileName: file.name, mimeType: file.type as IncidentAttachment['mimeType'], sizeBytes: file.size, dataBase64: await encode(file) });
      onAttachmentAdded(created); setFile(null); setNotice('Đã lưu tệp nghiệp vụ vào hồ sơ.');
    } catch (error) { setNotice(error instanceof ApiError ? error.message : 'Chưa tải được tệp.'); } finally { setBusy(false); }
  };

  return (
    <section className="ops-card collaboration-card">
      <IncidentMediaGallery scope="officer" incidentKey={incident.id} attachments={incident.attachments} />
      <details className="case-thread-details">
      <summary><MessageSquareText size={18} aria-hidden="true" /> Trao đổi với người dân{messages.length > 0 ? ` (${messages.length})` : ''}</summary>
      <div className="supplement-row officer-upload">
        <input aria-label="Chọn ảnh hoặc video nghiệp vụ" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <button className="secondary-action" type="button" disabled={!file || busy} onClick={() => void upload()}><Paperclip size={16} /> Lưu minh chứng</button>
      </div>
      <div className="case-thread">
        {messages.length === 0 && <p className="workflow-empty">Chưa có trao đổi với người dân.</p>}
        {messages.map((entry) => <article key={entry.id} className={`thread-message ${entry.authorRole}`}><strong>{entry.authorLabel}</strong><p>{entry.message}</p>{entry.authorRole === 'citizen' && looksForeign(entry.message) && <TranslateButton text={entry.message} target="vi" resetKey={entry.id} />}{entry.requestMedia && <span>Đã yêu cầu bổ sung ảnh/video</span>}<time>{new Date(entry.createdAt).toLocaleString('vi-VN')}</time></article>)}
      </div>
      <form className="thread-compose" onSubmit={submitMessage}>
        <label className="sr-only" htmlFor="officer-message">Nội dung trao đổi</label>
        <textarea id="officer-message" value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={2000} placeholder="Yêu cầu bổ sung hoặc thông báo tiến độ…" required />
        <label className="compact-check"><input type="checkbox" checked={requestMedia} onChange={(event) => setRequestMedia(event.target.checked)} /> Yêu cầu ảnh/video</label>
        {aiReady && <button className="secondary-action" type="button" disabled={busy || drafting} onClick={() => void draftReply()}><Sparkles size={16} aria-hidden="true" /> {drafting ? 'AI đang soạn…' : 'AI soạn nháp'}</button>}
        <button className="ops-submit" type="submit" disabled={busy || drafting || message.trim().length < 2}><Send size={17} /> Gửi người dân</button>
      </form>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      </details>
    </section>
  );
}
