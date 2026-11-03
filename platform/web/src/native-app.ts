import { Capacitor } from '@capacitor/core';
import { App as AndroidApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';

const CLOSE_BUTTON = 'button[aria-label^="Đóng"]';
// Non-modal panels that were already closable with the Back button before modal handling was generalised.
const PANEL_CLOSERS = [
  '.citizen-auth-sheet header button',
  '.feature-drawer-header button',
  '.map-assistant-header button',
  '.citizen-notification-inbox button[aria-label*="Đóng"]',
  'button[aria-label="Đóng thông tin khu vực"]',
];

/**
 * Closes the top-most overlay, if any. Modal dialogs win (last in DOM order is the top-most),
 * then the known non-modal panels. Returns true when a close control was activated.
 */
export function closeTopOverlay(root: Pick<ParentNode, 'querySelector' | 'querySelectorAll'>): boolean {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).reverse();
  for (const dialog of dialogs) {
    // The close control is either inside the dialog or its scrim sibling (e.g. "Đóng đăng nhập").
    const button = dialog.querySelector<HTMLButtonElement>(CLOSE_BUTTON)
      ?? dialog.parentElement?.querySelector<HTMLButtonElement>(CLOSE_BUTTON);
    if (button) { button.click(); return true; }
  }
  for (const selector of PANEL_CLOSERS) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (button) { button.click(); return true; }
  }
  return false;
}

type ScrollTarget = { scrollTop: number; scrollLeft: number };

/**
 * Đưa các khung bị cuộn nhầm về 0. Khi bàn phím mở hoặc khi quay lại từ trình chọn ảnh/video, WebView có thể cuộn
 * chính khung gốc (dù đã overflow: hidden) làm thanh tiêu đề và thanh dưới trượt khỏi màn hình, để lại vùng trống.
 */
export function resetShellScroll(targets: ReadonlyArray<ScrollTarget | null | undefined>): void {
  for (const target of targets) {
    if (!target) continue;
    if (target.scrollTop !== 0) target.scrollTop = 0;
    if (target.scrollLeft !== 0) target.scrollLeft = 0;
  }
}

const VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';
const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select';

function shellTargets(): Array<Element | null> {
  return [document.scrollingElement, document.documentElement, document.body, document.getElementById('root'), document.querySelector('.app-shell')];
}

function stabilizeViewport(): void {
  // Giữ cỡ khung ổn định: không phóng to theo cử chỉ, và để bàn phím thu nhỏ vùng nội dung (không đẩy cả trang).
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', VIEWPORT);
  const settle = () => resetShellScroll(shellTargets());
  // Chạy lại sau khi bố cục ổn định (bàn phím/trình chọn tệp đổi cỡ WebView theo từng bước).
  const settleSoon = () => { settle(); window.setTimeout(settle, 120); window.setTimeout(settle, 450); };
  document.addEventListener('scroll', (event) => {
    const target = event.target;
    if (target === document || (target instanceof Element && shellTargets().includes(target))) settle();
  }, true);
  window.addEventListener('resize', settleSoon);
  window.addEventListener('focus', settleSoon);
  window.visualViewport?.addEventListener('resize', settleSoon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') settleSoon(); });
  document.addEventListener('focusin', (event) => {
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches(FIELD)) return;
    // Đợi bàn phím mở xong rồi đưa ô đang nhập vào giữa vùng nhìn thấy, trong chính khung cuộn của nó.
    window.setTimeout(() => {
      if (document.activeElement === field) field.scrollIntoView({ block: 'center', inline: 'nearest' });
      settle();
    }, 300);
  });
  void Keyboard.addListener('keyboardDidShow', settleSoon);
  void Keyboard.addListener('keyboardDidHide', settleSoon);
  void AndroidApp.addListener('appStateChange', ({ isActive }) => { if (isActive) settleSoon(); });
}

export function initializeNativeApp(): void {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.dataset.native = 'android';
  stabilizeViewport();
  void Keyboard.addListener('keyboardWillShow', () => { document.documentElement.dataset.keyboard = 'open'; });
  void Keyboard.addListener('keyboardWillHide', () => { delete document.documentElement.dataset.keyboard; });
  void AndroidApp.addListener('backButton', ({ canGoBack }) => {
    if (closeTopOverlay(document)) return;
    const input = document.activeElement;
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) { input.blur(); return; }
    if (canGoBack) { window.history.back(); return; }
    void AndroidApp.minimizeApp();
  });
}
