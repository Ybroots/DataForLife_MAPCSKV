import { describe, expect, it, vi } from 'vitest';
import { closeTopOverlay } from '../src/native-app';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), minimizeApp: vi.fn() } }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: vi.fn() } }));

type Fake = { click: () => void };
const button = (): Fake & { clicks: number } => { const b = { clicks: 0, click() { b.clicks += 1; } }; return b; };
function dialog(inside: Fake | null, sibling: Fake | null = null) {
  return {
    querySelector: () => inside,
    parentElement: { querySelector: () => sibling },
  };
}
function root(dialogs: ReturnType<typeof dialog>[], panels: Record<string, Fake> = {}) {
  return {
    querySelectorAll: () => dialogs,
    querySelector: (selector: string) => panels[selector] ?? null,
  } as unknown as Pick<ParentNode, 'querySelector' | 'querySelectorAll'>;
}

describe('Android Back button overlay handling', () => {
  it('closes the top-most modal dialog first', () => {
    const lower = button(), upper = button();
    expect(closeTopOverlay(root([dialog(lower), dialog(upper)]))).toBe(true);
    expect(upper.clicks).toBe(1);
    expect(lower.clicks).toBe(0);
  });
  it('uses the scrim next to a dialog that has no close control inside', () => {
    const scrim = button();
    expect(closeTopOverlay(root([dialog(null, scrim)]))).toBe(true);
    expect(scrim.clicks).toBe(1);
  });
  it('falls back to known non-modal panels', () => {
    const panel = button();
    expect(closeTopOverlay(root([], { '.map-assistant-header button': panel }))).toBe(true);
    expect(panel.clicks).toBe(1);
  });
  it('reports nothing to close so the app can go back or minimise', () => {
    expect(closeTopOverlay(root([dialog(null, null)]))).toBe(false);
  });
});
