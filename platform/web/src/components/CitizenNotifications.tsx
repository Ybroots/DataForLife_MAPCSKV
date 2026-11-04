import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, ChevronRight, FileWarning, RefreshCw, Siren, X } from 'lucide-react';
import { ApiError, listCitizenNotifications, markCitizenNotificationsRead } from '../api';
import type { CitizenNotification } from '../types';
import vneidLogoUrl from '../../../../assets/images/vneid-logo.png';
import './citizen-notifications.css';

interface Props {
  sessionId: string | null;
  onRequireLogin: () => void;
  onOpenCase: (notification: CitizenNotification) => void;
}

export function CitizenNotifications({ sessionId, onRequireLogin, onOpenCase }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CitizenNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [newNotice, setNewNotice] = useState('');
  const latestRef = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let fetching = false;
    const load = async () => {
      if (fetching || document.visibilityState === 'hidden' || !navigator.onLine) return;
      fetching = true;
      const controller = new AbortController();
      abortRef.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
      try {
        const collected: CitizenNotification[] = [];
        let cursor: string | undefined;
        let unread = 0;
        let more = false;
        for (let page = 0; page < (open ? pageCount : 1); page++) {
          const payload = await listCitizenNotifications({ cursor, unreadOnly: open && unreadOnly, signal: controller.signal });
          collected.push(...payload.items);
          unread = payload.unreadCount;
          cursor = payload.nextCursor ?? undefined;
          more = Boolean(cursor);
          if (!cursor) break;
        }
        if (cancelled || controller.signal.aborted) return;
        setItems(collected); setUnreadCount(unread); setHasMore(more); setError(''); setNeedsLogin(false);
        if (!open || !unreadOnly) {
          const newest = collected[0];
          if (latestRef.current !== undefined && newest && newest.id !== latestRef.current && !newest.readAt && !open) {
            setNewNotice('Có cập nhật mới từ cán bộ. Mở chuông thông báo để xem.');
          }
          latestRef.current = newest?.id ?? null;
        }
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && [401, 403].includes(caught.status)) {
          setItems([]); setUnreadCount(0); setNeedsLogin(true);
          setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để xem thông báo.');
        } else if (!controller.signal.aborted) {
          setError('Chưa tải được thông báo. Vui lòng thử lại.');
        } else if (timedOut) {
          setError('Kết nối chậm. Vui lòng thử lại.');
        }
      } finally {
        window.clearTimeout(timeout);
        fetching = false;
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    const resume = () => { if (document.visibilityState === 'visible') void load(); };
    const offline = () => { setError('Bạn đang mất kết nối. Thông báo sẽ được cập nhật khi có mạng.'); setLoading(false); };
    if (!navigator.onLine) offline();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true; abortRef.current?.abort(); window.clearInterval(interval);
      window.removeEventListener('focus', resume); window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume);
    };
  }, [sessionId, open, unreadOnly, pageCount, refresh]);

  useEffect(() => {
    if (!newNotice) return;
    const timer = window.setTimeout(() => setNewNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [newNotice]);

  useEffect(() => {
    if (!open) return;
    const app = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const targets = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])];
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      if (app) app.inert = wasInert;
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard, true);
      bellRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const markRead = async (selected: CitizenNotification[]) => {
    const ids = selected.filter((item) => !item.readAt).map((item) => item.id).slice(0, 100);
    if (!ids.length) return true;
    setBusy(true); setError('');
    abortRef.current?.abort();
    try {
      await markCitizenNotificationsRead(ids);
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, readAt } : item));
      setUnreadCount((current) => Math.max(0, current - ids.length));
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) {
        setItems([]); setUnreadCount(0); setNeedsLogin(true);
      }
      setError(caught instanceof ApiError ? caught.message : 'Chưa lưu được trạng thái đã đọc. Vui lòng thử lại.');
      return false;
    } finally { setBusy(false); setRefresh((value) => value + 1); }
  };

  const openItem = async (item: CitizenNotification) => {
    if (!await markRead([item])) return;
    setOpen(false); onOpenCase(item);
  };

  return <>
    <button ref={bellRef} type="button" className="citizen-notification-bell" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? 'citizen-notification-inbox' : undefined}
      aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ''}`} title="Thông báo"
      onClick={() => { setOpen(true); setNewNotice(''); setPageCount(1); }}>
      <Bell size={20} aria-hidden="true" />
      {unreadCount > 0 && <span className="citizen-notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {newNotice && !open && createPortal(<div className="citizen-notification-toast" role="status"><Bell size={20} aria-hidden="true" />{newNotice}</div>, document.body)}
    {open && createPortal(<div className="citizen-notification-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={sheetRef} className="citizen-notification-inbox" id="citizen-notification-inbox" role="dialog" aria-modal="true" aria-labelledby="citizen-notification-title">
        <header><div><span>CẬP NHẬT HỒ SƠ</span><h2 id="citizen-notification-title">Thông báo</h2></div>
          <button ref={closeRef} type="button" aria-label="Đóng thông báo" onClick={() => setOpen(false)}><X size={22} /></button></header>
        {(!sessionId || needsLogin) ? <div className="citizen-notification-empty">
          <Bell size={36} aria-hidden="true" /><h3>Nhận cập nhật từ cán bộ</h3>
          <p>{needsLogin ? error : 'Đăng nhập để xem tiến trình xử lý phản ánh và SOS của bạn.'}</p>
          <button className="citizen-notification-login" type="button" onClick={() => { setOpen(false); onRequireLogin(); }}><img src={vneidLogoUrl} width="28" height="28" alt="" />Đăng nhập hoặc đăng ký</button>
        </div> : <>
          <div className="citizen-notification-tools">
            <div role="group" aria-label="Lọc thông báo">
              <button type="button" aria-pressed={!unreadOnly} onClick={() => { setUnreadOnly(false); setPageCount(1); }}>Tất cả</button>
              <button type="button" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly(true); setPageCount(1); }}>Chưa đọc <span>{unreadCount}</span></button>
            </div>
            <button type="button" disabled={loading || busy} aria-label="Làm mới thông báo" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button>
          </div>
          <div className="citizen-notification-summary"><span role="status">{loading ? 'Đang cập nhật…' : `${unreadCount} thông báo chưa đọc`}</span>
            <button type="button" disabled={busy || !items.some((item) => !item.readAt)} onClick={() => void markRead(items)}><CheckCheck size={16} aria-hidden="true" />Đọc các mục đang hiện</button></div>
          {error && <p className="citizen-notification-error" role="alert">{error}</p>}
          <div className="citizen-notification-scroll" aria-busy={loading}>
            {!items.length && !loading && !error && <div className="citizen-notification-empty"><Bell size={36} aria-hidden="true" /><h3>{unreadOnly ? 'Bạn đã đọc hết thông báo' : 'Chưa có thông báo xử lý'}</h3><p>Khi cán bộ tiếp nhận, cập nhật kết quả hoặc yêu cầu bổ sung, thông tin sẽ được lưu tại đây.</p></div>}
            <ol>{items.map((item) => <li key={item.id}>
              <button type="button" className={`citizen-notification-item ${!item.readAt ? 'unread' : ''}`} data-notification-id={item.id} disabled={busy} onClick={() => void openItem(item)}>
                <span className={`citizen-notification-icon ${item.kind}`} aria-hidden="true">{item.kind === 'sos' ? <Siren size={21} /> : <FileWarning size={21} />}</span>
                <span className="citizen-notification-copy">
                  <span className="citizen-notification-meta">{item.kind === 'sos' ? 'SOS' : 'Phản ánh'} · {item.readAt ? 'Đã đọc' : 'Chưa đọc'}</span>
                  <strong>{item.title}</strong><span>{item.caseTitle}</span>
                  {item.message && <span className="citizen-notification-message">{item.message}</span>}
                  {item.kind === 'incident' && ['resolved', 'closed'].includes(item.status ?? '') && <span>Bạn có thể xem kết quả và gửi đánh giá.</span>}
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}</time>
                </span><ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>)}</ol>
            {hasMore && <button className="citizen-notification-more" type="button" disabled={loading || busy} onClick={() => setPageCount((value) => value + 1)}>Xem thông báo cũ hơn</button>}
          </div>
          <footer>Tự cập nhật khi ứng dụng đang mở.</footer>
        </>}
      </section>
    </div>, document.body)}
  </>;
}
