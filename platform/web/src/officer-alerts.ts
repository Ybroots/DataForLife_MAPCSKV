import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficerQueueItem } from './types';

const STORAGE_KEY = 'cskv-officer-sos-alerts';
const REMINDER_MS = 30_000;

export type AlertPermission = NotificationPermission | 'unsupported';

export function isPendingSos(item: OfficerQueueItem): boolean {
  return item.kind === 'sos' && (item.status === 'triggered' || item.status === 'dispatched');
}

function readEnabled(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function writeEnabled(value: boolean): void {
  try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

function currentPermission(): AlertPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Three short 880 Hz pulses. Needs an AudioContext that was unlocked by a user gesture. */
function beep(context: AudioContext): void {
  const start = context.currentTime;
  for (let pulse = 0; pulse < 3; pulse += 1) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 880;
    const at = start + pulse * 0.28;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.22);
  }
}

/**
 * Alerts the officer when an SOS is waiting for acknowledgement: sound (repeated every 30 s while any is
 * pending), vibration, tab title counter and, when the tab is in the background, a browser notification.
 * Polling still happens in the portal; this only makes a new SOS noticeable in an idle tab.
 */
export function useSosAlerts(queue: OfficerQueueItem[], loaded: boolean) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [permission, setPermission] = useState<AlertPermission>(currentPermission);
  const audioRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const baseTitleRef = useRef(typeof document === 'undefined' ? '' : document.title);
  const pending = queue.filter(isPendingSos);
  const pendingKey = pending.map((item) => item.id).join(',');

  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      if (!audioRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        audioRef.current = new Ctor();
      }
      if (audioRef.current.state === 'suspended') void audioRef.current.resume();
      return audioRef.current;
    } catch {
      return null;
    }
  }, []);

  // After a page reload the browser blocks audio until the first gesture: unlock on it.
  useEffect(() => {
    if (!enabled) return undefined;
    const unlock = () => { ensureAudio(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled, ensureAudio]);

  useEffect(() => {
    if (!loaded) return;
    const fresh = pending.filter((item) => !seenRef.current.has(item.id));
    pending.forEach((item) => seenRef.current.add(item.id));
    if (!enabled || fresh.length === 0) return;
    const context = ensureAudio();
    if (context) beep(context);
    navigator.vibrate?.([250, 120, 250, 120, 250]);
    if (currentPermission() === 'granted' && document.hidden) {
      try {
        const first = fresh[0]!;
        new Notification(`SOS mới chờ tiếp nhận (${fresh.length})`, {
          body: `${first.receiptCode} · ${first.localityName}`,
          tag: 'cskv-sos',
          requireInteraction: true,
        });
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [pendingKey, loaded, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || pending.length === 0) {
      document.title = baseTitleRef.current;
      return undefined;
    }
    document.title = `(${pending.length}) SOS chờ tiếp nhận · ${baseTitleRef.current}`;
    const timer = window.setInterval(() => {
      const context = audioRef.current;
      if (context) beep(context);
    }, REMINDER_MS);
    return () => window.clearInterval(timer);
  }, [enabled, pending.length]);

  useEffect(() => () => { document.title = baseTitleRef.current; }, []);

  const enable = async () => {
    const context = ensureAudio();
    if (context) beep(context); // audible confirmation and unlocks audio
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { setPermission(await Notification.requestPermission()); } catch { setPermission(currentPermission()); }
    } else {
      setPermission(currentPermission());
    }
    setEnabled(true);
    writeEnabled(true);
  };

  const disable = () => {
    setEnabled(false);
    writeEnabled(false);
  };

  return { enabled, permission, enable, disable, pendingCount: pending.length };
}
