import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficerQueueItem } from './types';

const STORAGE_KEY = 'cskv-officer-sos-alerts';
const REMINDER_MS = 30_000;
/** A full-screen alarm the officer set aside comes back if the SOS is still unacknowledged after this long. */
export const OVERLAY_REPEAT_MS = 120_000;

export type AlertPermission = NotificationPermission | 'unsupported';
type AudioStatus = AudioContextState | 'unavailable' | 'idle';

export function isPendingSos(item: OfficerQueueItem): boolean {
  return item.kind === 'sos' && (item.status === 'triggered' || item.status === 'dispatched');
}

/** Pending SOS that should cover the screen now, oldest first (the one waiting longest is shown first). */
export function overlaySosItems(
  pending: readonly OfficerQueueItem[],
  hiddenAt: ReadonlyMap<string, number>,
  now: number,
): OfficerQueueItem[] {
  return pending
    .filter((item) => {
      const at = hiddenAt.get(item.id);
      return at === undefined || now - at >= OVERLAY_REPEAT_MS;
    })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

/** "35 giây trước", "4 phút trước", "2 giờ trước". */
export function elapsedLabel(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  return `${Math.floor(minutes / 60)} giờ trước`;
}

// Sound is on unless the officer turned it off on this device.
function readEnabled(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) !== '0'; } catch { return true; }
}

function writeEnabled(value: boolean): void {
  try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* storage may be unavailable */ }
}

function currentPermission(): AlertPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Three short 880 Hz pulses, used as a reminder while an SOS waits but the alarm screen is set aside. */
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

/** Continuous wailing siren (sweeps about 570–1330 Hz every ~2 s) until stop() is called. */
function startSiren(context: AudioContext): { stop: () => void } {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(0.22, start + 0.15);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2600;
  const tone = context.createOscillator();
  tone.type = 'sawtooth';
  tone.frequency.value = 950;
  const sweep = context.createOscillator();
  sweep.type = 'sine';
  sweep.frequency.value = 0.45;
  const depth = context.createGain();
  depth.gain.value = 380;
  sweep.connect(depth);
  depth.connect(tone.frequency);
  tone.connect(filter).connect(master).connect(context.destination);
  tone.start(start);
  sweep.start(start);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const at = context.currentTime;
        master.gain.cancelScheduledValues(at);
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), at);
        master.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
        tone.stop(at + 0.15);
        sweep.stop(at + 0.15);
      } catch { /* context already closed */ }
      window.setTimeout(() => { try { master.disconnect(); } catch { /* already disconnected */ } }, 400);
    },
  };
}

/**
 * Alerts the officer when an SOS is waiting for acknowledgement:
 * - a full-screen red alarm (rendered by the portal from `overlayItems`) with a continuous siren and vibration;
 * - once the officer sets the alarm aside, a short reminder beep every 30 s and the screen returns after 2 minutes;
 * - tab title counter and, in a background tab with permission, a browser notification.
 * Polling still happens in the portal. Browsers only play sound after the officer has clicked or typed on the page,
 * so `soundBlocked` tells the alarm screen to ask for one tap.
 */
export function useSosAlerts(queue: OfficerQueueItem[], loaded: boolean) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [permission, setPermission] = useState<AlertPermission>(currentPermission);
  const [hiddenAt, setHiddenAt] = useState<Map<string, number>>(() => new Map());
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => new Set());
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle');
  const [now, setNow] = useState(() => Date.now());
  const audioRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const baseTitleRef = useRef(typeof document === 'undefined' ? '' : document.title);
  const pending = queue.filter(isPendingSos);
  const pendingKey = pending.map((item) => item.id).join(',');
  const overlayItems = loaded ? overlaySosItems(pending, hiddenAt, now) : [];
  const sirenWanted = enabled && overlayItems.some((item) => !mutedIds.has(item.id));
  const sirenOn = sirenWanted && audioStatus === 'running';
  const soundBlocked = sirenWanted && audioStatus !== 'running';

  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      if (!audioRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setAudioStatus('unavailable');
          return null;
        }
        const context = new Ctor();
        context.onstatechange = () => setAudioStatus(context.state);
        audioRef.current = context;
        setAudioStatus(context.state);
      }
      const context = audioRef.current;
      if (context.state === 'suspended') {
        void context.resume().then(() => setAudioStatus(context.state), () => setAudioStatus(context.state));
      }
      return context;
    } catch {
      setAudioStatus('unavailable');
      return null;
    }
  }, []);

  // Browsers block audio until a click or key press on the page (e.g. after a reload): unlock on the first one.
  useEffect(() => {
    if (audioStatus === 'running' || audioStatus === 'unavailable') return undefined;
    const unlock = () => { ensureAudio(); };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [audioStatus, ensureAudio]);

  // Try to start audio as soon as an alarm is needed (allowed when the officer already interacted, e.g. at sign-in).
  useEffect(() => {
    if (sirenWanted && audioStatus !== 'running') ensureAudio();
  }, [sirenWanted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clock for the 2-minute return of a set-aside alarm.
  useEffect(() => {
    if (!pending.length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [pending.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // New SOS: background notification, and forget state of SOS that are no longer pending.
  useEffect(() => {
    if (!loaded) return;
    setNow(Date.now());
    const fresh = pending.filter((item) => !seenRef.current.has(item.id));
    pending.forEach((item) => seenRef.current.add(item.id));
    const pendingIds = new Set(pending.map((item) => item.id));
    setHiddenAt((current) => {
      const kept = [...current].filter(([id]) => pendingIds.has(id));
      return kept.length === current.size ? current : new Map(kept);
    });
    setMutedIds((current) => {
      const kept = [...current].filter((id) => pendingIds.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
    if (fresh.length === 0) return;
    if (currentPermission() === 'granted' && document.hidden) {
      try {
        const first = fresh[0]!;
        new Notification(`SOS mới chờ tiếp nhận (${fresh.length})`, {
          body: `${first.receiptCode} · ${first.serviceAreaName ?? first.localityName}`,
          tag: 'cskv-sos',
          requireInteraction: true,
        });
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [pendingKey, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Siren and vibration while the alarm screen is up and not silenced.
  useEffect(() => {
    if (!sirenOn) return undefined;
    const context = audioRef.current;
    if (!context) return undefined;
    const siren = startSiren(context);
    const pattern = [700, 300, 700];
    navigator.vibrate?.(pattern);
    const vibration = window.setInterval(() => navigator.vibrate?.(pattern), 2_000);
    return () => {
      siren.stop();
      window.clearInterval(vibration);
      navigator.vibrate?.(0);
    };
  }, [sirenOn]);

  // Reminder beep while an SOS waits but the alarm screen was set aside or silenced.
  useEffect(() => {
    if (!enabled || pending.length === 0 || sirenOn) return undefined;
    const timer = window.setInterval(() => {
      const context = audioRef.current;
      if (context?.state === 'running') beep(context);
    }, REMINDER_MS);
    return () => window.clearInterval(timer);
  }, [enabled, pending.length, sirenOn]);

  useEffect(() => {
    document.title = pending.length > 0
      ? `(${pending.length}) SOS chờ tiếp nhận · ${baseTitleRef.current}`
      : baseTitleRef.current;
  }, [pending.length]);

  useEffect(() => () => { document.title = baseTitleRef.current; }, []);

  const enable = async () => {
    const context = ensureAudio();
    if (context?.state === 'running') beep(context); // audible confirmation
    setEnabled(true);
    writeEnabled(true);
  };

  const disable = () => {
    setEnabled(false);
    writeEnabled(false);
  };

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try { setPermission(await Notification.requestPermission()); } catch { setPermission(currentPermission()); }
  };

  /** Set the alarm screen aside for these SOS; it returns after 2 minutes if they are still unacknowledged. */
  const hide = (ids: readonly string[]) => {
    const at = Date.now();
    setHiddenAt((current) => {
      const next = new Map(current);
      ids.forEach((id) => next.set(id, at));
      return next;
    });
    setMutedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  /** Stop the siren for the SOS on screen now; a new SOS starts it again. */
  const mute = () => {
    setMutedIds((current) => new Set([...current, ...overlayItems.map((item) => item.id)]));
  };

  return {
    enabled,
    permission,
    enable,
    disable,
    requestPermission,
    pendingCount: pending.length,
    overlayItems,
    sirenOn,
    soundBlocked,
    unlockSound: () => { ensureAudio(); },
    hide,
    mute,
  };
}
