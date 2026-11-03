/* Prototype tương tác — Bản đồ số CSKV.
   Dùng lại 100% HTML của thư viện màn hình (../03-screens/assets/ui-lib.js).
   Màn hình khai báo hành vi bằng thuộc tính: data-go (đi tới màn), data-set (đặt trạng thái),
   data-act (hành động cán bộ), data-login (đăng nhập). Phần còn lại do engine này bổ sung. */
(function () {
  'use strict';
  const { SCREENS } = window.CSKV_UI;
  const byId = Object.fromEntries(SCREENS.map((s) => [s.id, s]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FLOWS = {
    citizen: {
      start: 'c01',
      device: 'phone',
      intro: 'Thử hành trình của người dân: tra cứu, phản ánh, theo dõi và SOS. Bạn có thể bấm trực tiếp vào màn hình như dùng thật.',
      steps: [
        ['enter-c03', 'Ở màn Chào mừng, chọn “Người dân” để vào bản đồ.'],
        ['area', 'Chạm vào một vùng màu trên bản đồ để xem Cảnh sát khu vực phụ trách.'],
        ['c04-detail', 'Bấm “Xem chi tiết” để mở danh bạ của địa bàn.'],
        ['login', 'Mở tab “Phản ánh”. Vì chưa đăng nhập, tờ trượt đăng nhập hiện ra — bấm “Đăng nhập”.'],
        ['report-error', 'Bấm “Gửi phản ánh” khi chưa điền gì để xem thông báo lỗi.'],
        ['report-sent', 'Bấm micro (nói để nhập) hoặc gõ nội dung, rồi bấm “Gửi phản ánh”.'],
        ['enter-c07', 'Bấm “Theo dõi hồ sơ” để xem tiến trình.'],
        ['sos-sent', 'Quay về tab “Bản đồ”, bấm SOS rồi GIỮ nút 3 giây (thả sớm = huỷ).'],
        ['sos-ack', 'Trong khung “Mô phỏng sự kiện”, bấm “Cán bộ nhận SOS”.'],
      ],
      events: [
        ['sos-ack', 'Cán bộ nhận SOS'],
        ['result', 'Hồ sơ có kết quả'],
        ['offline', 'Bật / tắt mạng'],
        ['error', 'Lỗi tải màn này'],
      ],
    },
    officer: {
      start: 'o01',
      device: 'desk',
      intro: 'Thử một ca trực: đăng nhập, nhận và xử lý hồ sơ, nhận báo động SOS, phát cảnh báo, xuất báo cáo.',
      steps: [
        ['enter-o02', 'Bấm “Đăng nhập” để vào hàng đợi.'],
        ['take', 'Bấm “Nhận hồ sơ” (nút duy nhất cần làm ở bước này).'],
        ['start', 'Bấm “Bắt đầu xử lý”.'],
        ['done-error', 'Xoá bớt ô kết quả (dưới 20 ký tự) rồi bấm “Đã xử lý xong” để thấy báo lỗi.'],
        ['done-ok', 'Nhập lại đủ nội dung rồi bấm “Đã xử lý xong”.'],
        ['closed', 'Bấm “Bấm lần nữa để đóng” để đóng hồ sơ (thao tác không hoàn tác).'],
        ['sos-taken', 'Bấm “SOS mới tới” ở khung Mô phỏng, rồi “Nhận SOS ngay”.'],
        ['alert-sent', 'Mở “Nghiệp vụ”, bấm “Phát cảnh báo”.'],
        ['exported', 'Mở tab “Lưu trữ & báo cáo”, bấm “Xuất báo cáo PDF”.'],
      ],
      events: [
        ['sos-new', 'SOS mới tới'],
        ['sos-late', 'SOS quá 2 phút'],
        ['error', 'Lỗi tải màn này'],
      ],
    },
  };

  // Màn hình cần đăng nhập (người dân). Màn có sẵn trạng thái “khách” thì dùng trạng thái đó.
  const NEED_LOGIN = { c06: 'gate', c07: 'gate' };
  const GUEST_STATE = { c09: 'login', c10: 'guest' };
  const SET_ALIAS = { reg: 'register' };
  const SAMPLE_TEXT = 'Đèn đường đoạn gần ngã ba Phan Đình Phùng bị hỏng từ tối qua, rất tối, người đi bộ khó thấy đường.';

  let S;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  function fresh(flow) {
    clearTimers();
    S = { flow, screen: FLOWS[flow].start, st: {}, loggedIn: false, online: true, returnTo: null, done: new Set(), form: {}, hold: null };
  }

  /* ---------- trạng thái ---------- */
  const screenOf = (id) => byId[id];
  const stateKeys = (id) => screenOf(id).states.map((s) => s.key);
  function currentKey() { return S.st[S.screen] || stateKeys(S.screen)[0]; }
  function stateOf(id, key) { return screenOf(id).states.find((s) => s.key === key) || screenOf(id).states[0]; }

  function emit(ev) {
    if (!S.done.has(ev)) { S.done.add(ev); renderSteps(); }
  }

  /* ---------- điều hướng ---------- */
  function go(to, set) {
    if (set) set = SET_ALIAS[set] || set;
    if (S.flow === 'citizen' && !S.loggedIn) {
      if (NEED_LOGIN[to] && !set) { S.returnTo = { to, set }; set = NEED_LOGIN[to]; to = 'c02'; }
      else if (GUEST_STATE[to] && !set) set = GUEST_STATE[to];
    }
    if (to !== S.screen) { S.form[S.screen] = null; clearTimers(); }
    S.screen = to;
    S.st[to] = set && stateKeys(to).includes(set) ? set : stateKeys(to)[0];
    if (to === 'c01' && !S.online) S.st[to] = 'offline';
    render();
  }

  function setState(key) {
    S.st[S.screen] = key;
    render();
  }

  /* ---------- hiển thị ---------- */
  function render() {
    const stage = $('#stage');
    const sc = screenOf(S.screen);
    const key = currentKey();
    stage.innerHTML = stateOf(S.screen, key).html;
    applyForm();
    postRender(sc, key);
    if (S.screen === 'c03') emit('enter-c03');
    if (S.screen === 'c04' && key === 'detail') emit('c04-detail');
    if (S.screen === 'c07') emit('enter-c07');
    if (S.screen === 'o02' && S.flow === 'officer') emit('enter-o02');
    fit();
    renderStates();
    renderSteps();
    $('#screen-name').textContent = `${sc.id.toUpperCase()} · ${sc.name}`;
    $('#live').textContent = `Màn hình ${sc.name}, trạng thái ${stateOf(S.screen, key).label}`;
    const h1 = $('h1', stage) || $('h3', stage);
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }

  function postRender(sc, key) {
    const stage = $('#stage');
    // Gỡ liên kết “#” để không nhảy trang; liên kết tel: chỉ hiển thị thông báo.
    $$('a[href="#"]', stage).forEach((a) => a.setAttribute('role', 'button'));
    if (S.screen === 'c08' && key === 'sent') later(() => { if (S.screen === 'c08' && currentKey() === 'sent') ackSos(); }, 6000);
  }

  function fit() {
    const stage = $('#stage');
    const frame = $('#frame');
    const el = stage.firstElementChild;
    if (!el) return;
    stage.style.transform = 'none';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const availW = $('.pt-stage').clientWidth || window.innerWidth;
    const availH = Math.max(480, window.innerHeight - $('.pt-top').offsetHeight - 48);
    const k = Math.min(1, availW / w, S.flow === 'citizen' ? availH / h : 1);
    stage.style.transform = k < 1 ? `scale(${k})` : 'none';
    frame.style.width = `${w * k}px`;
    frame.style.height = `${h * k}px`;
  }

  function renderStates() {
    const box = $('#states');
    box.innerHTML = '';
    const sc = screenOf(S.screen);
    sc.states.forEach((st) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip ${st.key === currentKey() ? 'is-on' : ''}`;
      b.textContent = st.label;
      b.setAttribute('aria-pressed', st.key === currentKey() ? 'true' : 'false');
      b.addEventListener('click', () => setState(st.key));
      box.appendChild(b);
    });
  }

  function renderSteps() {
    const f = FLOWS[S.flow];
    const ol = $('#steps');
    ol.innerHTML = '';
    let now = -1;
    f.steps.forEach(([ev], i) => { if (now < 0 && !S.done.has(ev)) now = i; });
    f.steps.forEach(([ev, text], i) => {
      const li = document.createElement('li');
      li.textContent = text;
      if (S.done.has(ev)) li.className = 'is-done';
      else if (i === now) { li.className = 'is-now'; li.setAttribute('aria-current', 'step'); }
      ol.appendChild(li);
    });
    $('#flow-intro').textContent = f.intro;
  }

  function renderEvents() {
    const box = $('#events');
    box.innerHTML = '';
    FLOWS[S.flow].events.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary';
      b.textContent = id === 'offline' ? (S.online ? 'Tắt mạng' : 'Bật lại mạng') : label;
      b.dataset.event = id;
      box.appendChild(b);
    });
  }

  /* ---------- toast ---------- */
  function toast(text, tone = '') {
    const frame = $('#stage .phone, #stage .desk');
    if (!frame) return;
    $$('.toast', frame).forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = `toast ${tone} floating`;
    t.setAttribute('role', 'status');
    t.style.left = 'var(--space-4)';
    t.style.right = 'var(--space-4)';
    t.style.top = 'var(--space-4)';
    t.style.zIndex = 'var(--z-toast)';
    t.textContent = text;
    frame.appendChild(t);
    later(() => t.remove(), 3500);
  }

  /* ---------- lưu nội dung đã gõ khi đổi trạng thái trong cùng màn ---------- */
  const fields = () => $$('#stage textarea, #stage input:not([type=checkbox]):not([type=radio])');
  function rememberForm() { S.form[S.screen] = fields().map((f) => f.value); }
  function applyForm() {
    const saved = S.form[S.screen];
    if (!saved) return;
    fields().forEach((f, i) => { if (saved[i] !== undefined && saved[i] !== '') f.value = saved[i]; });
  }

  /* ---------- hành vi riêng từng màn ---------- */
  function ackSos() {
    go('c08', 'ack');
    toast('Cán bộ đã nhận SOS của bạn.', 'ok');
    emit('sos-ack');
  }

  function citizenClick(e) {
    const t = e.target;
    // Chạm vào bản đồ ở màn C03 → thẻ địa bàn
    if (S.screen === 'c03' && currentKey() === 'default' && t.closest('.map') && !t.closest('button, a, .floating')) {
      S.st.c03 = 'area'; render(); emit('area'); return true;
    }
    // Micro: nói để nhập
    if (S.screen === 'c06' && t.closest('.iconbtn[aria-label="Nói để nhập"]')) {
      rememberForm(); S.st.c06 = 'listening'; render();
      later(() => { S.form.c06 = [SAMPLE_TEXT]; S.st.c06 = 'empty'; render(); }, 1800);
      return true;
    }
    // Ảnh: nén ảnh rồi quay lại
    if (S.screen === 'c06' && t.closest('button.btn-secondary') && /Chụp ảnh|Chọn từ máy/.test(t.closest('button').textContent)) {
      rememberForm(); S.st.c06 = 'compress'; render();
      later(() => { S.st.c06 = 'empty'; render(); }, 1400);
      return true;
    }
    // Gửi phản ánh: kiểm tra → gửi
    if (S.screen === 'c06' && t.closest('[data-set="done"]')) {
      rememberForm();
      const text = (S.form.c06 && S.form.c06[0] || '').trim();
      if (text.length < 10) { S.st.c06 = 'error'; render(); emit('report-error'); return true; }
      if (!S.online) { S.st.c06 = 'offline'; render(); return true; }
      S.st.c06 = 'sending'; render();
      later(() => { S.st.c06 = 'done'; S.form.c06 = null; render(); emit('report-error'); emit('report-sent'); }, 1100);
      return true;
    }
    if (S.screen === 'c06' && currentKey() === 'offline' && t.closest('button.btn-primary')) {
      S.online = true; renderEvents(); go('c06', 'done'); emit('report-sent'); return true;
    }
    // Đăng nhập
    if (t.closest('[data-login]')) {
      S.loggedIn = true;
      const back = S.returnTo; S.returnTo = null;
      S.st.c02 = 'loading'; render();
      later(() => { go(back ? back.to : 'c03', back && back.set); toast('Đăng nhập thành công.', 'ok'); emit('login'); }, 700);
      return true;
    }
    // Chọn loại việc (chip), dấu tích, công tắc, sao
    if (t.closest('.chip') && !t.closest('[data-go]') && t.closest('#stage')) {
      const chip = t.closest('.chip');
      $$('.chip', chip.parentElement).forEach((c) => c.classList.toggle('is-on', c === chip));
      return true;
    }
    const chk = t.closest('.check');
    if (chk) { chk.classList.toggle('is-checked'); return true; }
    const sw = t.closest('.switch');
    if (sw) { sw.classList.toggle('is-on'); return true; }
    const star = t.closest('.stars button');
    if (star) {
      const all = $$('.stars button', star.parentElement);
      const n = all.indexOf(star);
      all.forEach((b, i) => { b.classList.toggle('on', i <= n); b.setAttribute('aria-checked', i === n ? 'true' : 'false'); });
      return true;
    }
    // Tab ngoài điều hướng (không có data-go): đổi mục đang chọn
    const tab = t.closest('.tab');
    if (tab && !tab.hasAttribute('data-go')) {
      $$('.tab', tab.parentElement).forEach((x) => x.classList.toggle('is-active', x === tab));
      return true;
    }
    // Gọi điện / chỉ đường / nút chưa có hành vi → thông báo minh hoạ
    const a = t.closest('a[href^="tel:"]');
    if (a) { e.preventDefault(); toast(`Đang gọi ${a.getAttribute('href').slice(4)} (minh hoạ)`); return true; }
    return false;
  }

  function officerClick(e) {
    const t = e.target;
    if (S.screen === 'o03') {
      const b = t.closest('button');
      if (b && /Nhận SOS ngay/.test(b.textContent)) { go('o02', 'start'); toast('Đã nhận SOS-0007. Người dân đã được báo.', 'ok'); emit('sos-taken'); return true; }
      if (b && /Tắt còi/.test(b.textContent)) { toast('Đã tắt tiếng 30 giây — báo động vẫn hiển thị đến khi có người nhận.'); return true; }
      return true;
    }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'take') { go('o02', 'start'); emit('take'); return true; }
      if (a === 'start') { go('o02', 'done-form'); emit('start'); return true; }
      if (a === 'done') {
        const ta = $('#stage textarea');
        const val = ta ? ta.value.trim() : '';
        if (val.length < 20) { S.form.o02 = [val]; S.st.o02 = 'done-err'; render(); emit('done-error'); return true; }
        S.form.o02 = null; S.st.o02 = 'saving'; render();
        later(() => { S.st.o02 = 'close-confirm'; render(); emit('done-error'); emit('done-ok'); }, 900);
        return true;
      }
      if (a === 'close') { go('o02', 'empty'); toast('Đã đóng hồ sơ PA-241102-0042. Xem trong tab “Đã đóng”.', 'ok'); emit('closed'); return true; }
    }
    const setEl = t.closest('[data-set^="sel"]');
    if (setEl) {
      const n = Number(setEl.dataset.set.slice(3));
      if (n === 0) { go('o03', 'new'); return true; }
      go('o02', ['take', 'take', 'done-form', 'close-confirm'][n]);
      return true;
    }
    // O01 đăng nhập: hỏi mật khẩu nếu ô trống
    if (S.screen === 'o01' && t.closest('button.btn-primary')) {
      const pw = $('#stage input[type=password]');
      if (pw && !pw.value) { S.st.o01 = 'error'; render(); return true; }
      S.st.o01 = 'loading'; render();
      later(() => go('o02', 'take'), 700);
      return true;
    }
    // O05: phát cảnh báo
    if (S.screen === 'o05' && t.closest('button.btn-primary.lg')) {
      const title = $('#stage input.input');
      if (title && !title.value.trim()) { S.st.o05 = 'error'; render(); return true; }
      S.st.o05 = 'sending'; render();
      later(() => { S.st.o05 = 'ok'; render(); emit('alert-sent'); }, 1000);
      return true;
    }
    // O06: xuất báo cáo
    if (S.screen === 'o06' && t.closest('button')) {
      const b = t.closest('button');
      if (/Xuất báo cáo PDF/.test(b.textContent)) {
        S.st.o06 = 'exporting'; render();
        later(() => { S.st.o06 = 'default'; render(); toast('Đã tạo báo cáo PDF (minh hoạ).', 'ok'); emit('exported'); }, 1400);
        return true;
      }
      if (/Xuất CSV/.test(b.textContent)) { toast('Đã tạo tệp CSV (minh hoạ).', 'ok'); return true; }
    }
    // Chọn tab hàng đợi
    const tab = t.closest('.tab');
    if (tab && !tab.hasAttribute('data-go')) {
      $$('.tab', tab.parentElement).forEach((x) => x.classList.toggle('is-active', x === tab));
      return true;
    }
    return false;
  }

  /* ---------- sự kiện toàn cục ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('#stage')) return;
    if (t.closest('.sos-big')) return; // do pointerdown xử lý (giữ 3 giây)
    const handled = S.flow === 'citizen' ? citizenClick(e) : officerClick(e);
    if (handled) return;
    const el = t.closest('[data-go]');
    if (el) { e.preventDefault(); go(el.dataset.go, el.dataset.set); return; }
    const onlySet = t.closest('[data-set]');
    if (onlySet) { setState(SET_ALIAS[onlySet.dataset.set] || onlySet.dataset.set); return; }
    if (t.closest('a[href="#"]')) { e.preventDefault(); return; }
    const btn = t.closest('button.btn:not([disabled]), a.btn');
    if (btn && !btn.matches('[data-event]')) toast('Chức năng này chỉ minh hoạ trong prototype.');
  });

  document.addEventListener('input', (e) => {
    if (e.target.closest('#stage')) rememberForm();
  });

  /* SOS giữ 3 giây (chuột/chạm/phím) */
  function holdStart() {
    if (S.screen !== 'c08' || !['ready', 'cancel', 'nogps', 'noduty'].includes(currentKey()) || S.hold) return;
    S.st.c08 = 'holding'; render();
    const t0 = performance.now();
    S.hold = { t0 };
    const tick = () => {
      if (!S.hold) return;
      const dt = performance.now() - t0;
      const bar = $('#stage .progress i');
      const msg = $('#stage .t-h3');
      if (bar) bar.style.width = `${Math.min(100, (dt / 3000) * 100)}%`;
      if (msg) msg.textContent = `Giữ nguyên… còn ${Math.max(1, Math.ceil((3000 - dt) / 1000))} giây`;
      if (dt >= 3000) { S.hold = null; if (navigator.vibrate) navigator.vibrate([50, 100, 50]); S.st.c08 = 'sent'; render(); emit('sos-sent'); return; }
      S.hold.raf = requestAnimationFrame(tick);
    };
    S.hold.raf = requestAnimationFrame(tick);
  }
  function holdEnd() {
    if (!S.hold) return;
    cancelAnimationFrame(S.hold.raf);
    S.hold = null;
    S.st.c08 = 'ready'; render();
    toast('Đã huỷ — chưa gửi gì.');
  }
  document.addEventListener('pointerdown', (e) => { if (e.target.closest('#stage .sos-big')) { e.preventDefault(); holdStart(); } });
  window.addEventListener('pointerup', holdEnd);
  window.addEventListener('pointercancel', holdEnd);
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && e.target.closest && e.target.closest('#stage .sos-big')) { e.preventDefault(); holdStart(); } });
  window.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') holdEnd(); });

  /* khung điều khiển bên trái */
  $('#events').addEventListener('click', (e) => {
    const id = e.target.closest('[data-event]')?.dataset.event;
    if (!id) return;
    if (id === 'sos-ack') { ackSos(); return; }
    if (id === 'result') {
      if (!S.loggedIn) { toast('Hãy đăng nhập và gửi một phản ánh trước.'); return; }
      go('c07', 'done'); toast('Hồ sơ PA-241031-0018 đã có kết quả.', 'ok'); return;
    }
    if (id === 'offline') { S.online = !S.online; renderEvents(); if (S.screen === 'c01') go('c01'); else toast(S.online ? 'Đã có mạng trở lại.' : 'Đang mất kết nối.'); return; }
    if (id === 'sos-new') { go('o03', 'new'); return; }
    if (id === 'sos-late') { go('o03', 'late'); return; }
    if (id === 'error') { const keys = stateKeys(S.screen); if (keys.includes('error')) setState('error'); else toast('Màn này không có trạng thái lỗi riêng.'); }
  });

  function setFlow(flow) {
    fresh(flow);
    $$('.pt-flows .tab').forEach((b) => { const on = b.dataset.flow === flow; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    renderEvents();
    render();
    history.replaceState(null, '', flow === 'officer' ? '#can-bo' : '#nguoi-dan');
  }

  $$('.pt-flows .tab').forEach((b) => b.addEventListener('click', () => setFlow(b.dataset.flow)));
  $('#reset').addEventListener('click', () => setFlow(S.flow));
  window.addEventListener('resize', fit);
  setFlow(location.hash === '#can-bo' ? 'officer' : 'citizen');
  window.__proto = { get state() { return S; }, go, setFlow };
})();
