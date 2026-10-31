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

export function initializeNativeApp(): void {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.dataset.native = 'android';
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
