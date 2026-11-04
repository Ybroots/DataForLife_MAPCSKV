import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUp, LoaderCircle, MapPinned, MessageSquareText, X } from 'lucide-react';
import { ApiError, askMapAssistant, askProcedure, getMapAssistantStatus } from '../api';
import { getLang } from '../i18n';
import type { MapAssistantAnswer, MapAssistantStatus, ProcedureAnswer } from '../types';

interface Props {
  areaCode: string | null;
  areaName: string | null;
  onAreaSelect: (code: string) => void;
  onClose: () => void;
  onOpenSos: () => void;
  onOpenReports: () => void;
}
interface Turn { question: string; answer: MapAssistantAnswer; procedure?: ProcedureAnswer }

/** No approved answer: offer a person instead of leaving the citizen at a dead end. */
function needsHandoff(answer: MapAssistantAnswer): boolean {
  if (answer.intent === 'unsupported') return true;
  if (answer.needsClarification) return false;
  if (answer.intent === 'hotlines') return answer.hotlines.length === 0;
  return (answer.intent === 'area' || answer.intent === 'directory' || answer.intent === 'alerts') && answer.areas.length === 0;
}

export function MapAssistant({ areaCode, areaName, onAreaSelect, onClose, onOpenSos, onOpenReports }: Props) {
  const [status, setStatus] = useState<MapAssistantStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const ready = Boolean(status && (status.configured || status.lookupAvailable !== false));

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    return () => requestRef.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatusFailed(false);
    setStatus(null);
    void getMapAssistantStatus(controller.signal).then(setStatus).catch(() => {
      if (!controller.signal.aborted) setStatusFailed(true);
    });
    return () => controller.abort();
  }, [statusAttempt]);

  useEffect(() => {
    const content = contentRef.current;
    const latest = content?.querySelector<HTMLElement>('.map-assistant-turn:last-of-type');
    if (content && latest) content.scrollTo({ top: content.scrollTop + latest.getBoundingClientRect().top - content.getBoundingClientRect().top, behavior: 'instant' });
  }, [turns]);

  useEffect(() => {
    if (pending || error) contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'instant' });
  }, [pending, error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!ready || pending || value.length < 3) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true); setError('');
    try {
      const answer = await askMapAssistant(value, areaCode, controller.signal);
      if (controller.signal.aborted) return;
      const procedure = await askProcedure(value, needsHandoff(answer), getLang(), controller.signal).then(result => result.matched ? result : undefined).catch(() => undefined);
      if (controller.signal.aborted) return;
      setTurns(previous => [...previous, { question: value, answer, procedure }].slice(-6));
      setQuestion('');
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof ApiError ? caught.message : 'Chưa thể kết nối trợ lý. Hãy thử lại.');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  return (
    <section className="map-assistant" aria-labelledby="map-assistant-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
      <header className="map-assistant-header">
        <MessageSquareText size={20} aria-hidden="true" />
        <div><h2 id="map-assistant-title" tabIndex={-1} ref={headingRef}>Trợ lý bản đồ</h2></div>
        <button type="button" onClick={onClose} aria-label="Đóng trợ lý bản đồ"><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="map-assistant-content" ref={contentRef} aria-busy={pending}>
        {!status && !statusFailed && <p role="status">Đang kiểm tra kết nối AI…</p>}
        {statusFailed && <div role="alert"><p>Chưa kiểm tra được kết nối trợ lý.</p><button className="map-assistant-text-button" type="button" onClick={() => setStatusAttempt(value => value + 1)}>Thử lại</button></div>}
        {ready && turns.length === 0 && <div className="map-assistant-welcome">
          <h3>Bạn cần tìm gì trên bản đồ?</h3>
          <div className="map-assistant-prompts">
            {(areaName ? ['Cho tôi số liên hệ ở đây', 'Ở đây có cảnh báo nào?'] : ['Tìm phường Xuân Hương', 'Thủ tục đăng ký tạm trú']).map(prompt => (
              <button key={prompt} type="button" onClick={() => { setQuestion(prompt); inputRef.current?.focus(); }}>{prompt}</button>
            ))}
          </div>
        </div>}

        {turns.map(({ question: asked, answer, procedure }, index) => <article className="map-assistant-turn" key={index}>
          <h3>{asked}</h3>
          {!(procedure?.procedure && needsHandoff(answer)) && <p>{answer.message}</p>}
          {procedure?.procedure && <div className="map-assistant-procedure">
            <h4>{procedure.procedure.title}</h4>
            <h5>Điều kiện</h5><ul>{procedure.procedure.conditions.map(item => <li key={item}>{item}</li>)}</ul>
            <h5>Hồ sơ</h5><ul>{procedure.procedure.documents.map(item => <li key={item}>{item}</li>)}</ul>
            <h5>Các bước</h5><ol>{procedure.procedure.steps.map(item => <li key={item}>{item}</li>)}</ol>
            <h5>Nơi làm thủ tục</h5><p>{procedure.procedure.where}</p>
            {procedure.procedure.notes.length > 0 && <><h5>Lưu ý</h5><ul>{procedure.procedure.notes.map(item => <li key={item}>{item}</li>)}</ul></>}
            <p className="map-assistant-procedure-note">{procedure.disclaimer}</p>
            <p className="map-assistant-procedure-note">Nguồn: {procedure.procedure.sources.map((source, position) => <span key={source.url}>{position > 0 && ' · '}<a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a></span>)}</p>
          </div>}
          {answer.areas.map(area => <div className="map-assistant-area" key={area.code}>
            <h4>{area.name}</h4>
            <button className="map-assistant-text-button" type="button" onClick={() => onAreaSelect(area.code)}><MapPinned size={16} aria-hidden="true" />Xem trên bản đồ</button>
            {!answer.needsClarification && <>
              {(area.population !== null || area.areaKm2 !== null) && <p className="map-assistant-meta">{area.population !== null && `${area.population.toLocaleString('vi-VN')} người`}{area.population !== null && area.areaKm2 !== null && ' · '}{area.areaKm2 !== null && `${area.areaKm2.toLocaleString('vi-VN')} km²`}</p>}
              {area.station && <p><strong>{area.station.name}</strong><br />{area.station.address ?? 'Chưa có địa chỉ công khai.'}</p>}
              {area.directory.map(contact => <p key={contact.id}>{contact.displayName}{contact.roleTitle && ` · ${contact.roleTitle}`}<br /><a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}>{contact.phone}</a></p>)}
              {answer.intent === 'directory' && area.directory.length === 0 && <p>Chưa có đầu mối liên hệ công khai tại địa bàn này.</p>}
              {answer.intent === 'alerts' && area.alerts.length === 0 && <p>Chưa có cảnh báo công khai đang hiệu lực. Điều này không xác nhận địa bàn không có rủi ro.</p>}
              {area.alerts.map(alert => <div key={alert.id}><strong>{alert.title}</strong><p>{alert.summary}</p><small>Hiệu lực đến {new Date(alert.endsAt).toLocaleString('vi-VN')}</small></div>)}
            </>}
          </div>)}
          {answer.hotlines.map(hotline => <p key={hotline.id}><strong>{hotline.label}</strong><br /><a href={`tel:${hotline.phone.replace(/[^+\d]/g, '')}`}>{hotline.phone}</a></p>)}
          {answer.intent === 'emergency' && <div className="map-assistant-emergency">
            <p><a href="tel:113">Gọi 113 · Công an</a><br /><a href="tel:114">Gọi 114 · Cứu hỏa, cứu nạn</a><br /><a href="tel:115">Gọi 115 · Cấp cứu</a></p>
            <button className="map-assistant-text-button" type="button" onClick={onOpenSos}>Mở quy trình SOS</button>
          </div>}
          {needsHandoff(answer) && !procedure?.procedure && <div className="map-assistant-handoff">
            <p>Trợ lý chưa có câu trả lời đã duyệt cho câu này. Bạn có thể hỏi trực tiếp cán bộ:</p>
            {areaCode && <button className="map-assistant-text-button" type="button" onClick={() => onAreaSelect(areaCode)}><MapPinned size={16} aria-hidden="true" />Xem đầu mối {areaName ?? 'địa bàn đang xem'}</button>}
            <button className="map-assistant-text-button" type="button" onClick={onOpenReports}>Gửi câu hỏi cho cán bộ (mục Phản ánh)</button>
          </div>}
          {answer.meta.dataSource === 'fixture' && <small className="map-assistant-source">Dữ liệu kiểm thử, không dùng thực tế</small>}
        </article>)}
        <div role="status" aria-live="polite" aria-atomic="true" className={pending ? 'map-assistant-progress' : 'sr-only'}>{pending ? <><LoaderCircle size={16} className="spin" aria-hidden="true" /> Đang đối chiếu dữ liệu…</> : turns.length > 0 ? 'Đã trả kết quả tra cứu.' : ''}</div>
        {error && <p role="alert" className="map-assistant-error">{error}</p>}
      </div>

      <form className="map-assistant-compose" onSubmit={event => void submit(event)}>
        <label htmlFor="map-ai-question">Câu hỏi của bạn</label>
        <div className="map-assistant-input">
          <textarea ref={inputRef} id="map-ai-question" name="map-ai-question" rows={2} minLength={3} maxLength={600} required disabled={!ready || pending} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Hỏi về địa bàn, danh bạ… (không ghi thông tin cá nhân)" />
          <button type="submit" disabled={!ready || pending || question.trim().length < 3} aria-label="Gửi câu hỏi"
            // Keep focus in the field: on phones a blur hides the keyboard and shifts the sheet before the tap
            // completes, so the click would land outside the button and the question would not be sent.
            onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}><ArrowUp size={20} aria-hidden="true" /></button>
        </div>
      </form>
    </section>
  );
}
