import { Capacitor } from '@capacitor/core';
import { registerOfficerPushDevice, registerPushDevice, removePushDevice } from './api';

/** Vite thay bằng true/false lúc build (xem vite.config.ts). Khai báo lại ở đây để bộ test không phụ thuộc vite-env.d.ts. */
declare const __OFFICER_APP__: boolean;

/**
 * Thông báo ngoài màn hình điện thoại (thanh trạng thái) cho ứng dụng Android.
 *
 * Chỉ hoạt động khi build có cấu hình Firebase (VITE_PUSH_ENABLED=true, do scripts/build-android.ps1 tự đặt khi
 * android-native/app/google-services.json có đúng mã ứng dụng của bản đang build). Không có thì không gọi plugin nào.
 * Người dân: gửi lên máy chủ mã thiết bị FCM và mã địa bàn theo dõi. Cán bộ: mã thiết bị gắn với phiên cán bộ.
 * Không gửi vị trí GPS.
 */

export interface FollowedArea { code: string; name: string }
export interface PushPrefs { enabled: boolean; asked: boolean; areas: FollowedArea[] }

export const MAX_FOLLOWED_AREAS = 3;
const KEY = 'cskv-push-v1';

export type PushTarget =
  | { type: 'alert'; areaCode: string }
  | { type: 'citizen'; kind: 'incident' | 'sos'; receiptCode: string }
  | { type: 'officer'; kind: 'incident' | 'sos'; id: string };

export const PUSH_EVENT = 'cskv:push';
export interface PushEventDetail {
  phase: 'received' | 'opened';
  title: string;
  body: string;
  target: PushTarget | null;
}

export function pushSupported(): boolean {
  return import.meta.env.VITE_PUSH_ENABLED === 'true' && Capacitor.isNativePlatform();
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function isFollowedArea(value: unknown): value is FollowedArea {
  if (typeof value !== 'object' || value === null) return false;
  const { code, name } = value as Record<string, unknown>;
  return typeof code === 'string' && /^[\w-]{3,80}$/.test(code) && typeof name === 'string' && name.length > 0 && name.length <= 120;
}

export function readPushPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): PushPrefs {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<PushPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return { enabled: false, asked: false, areas: [] };
    return {
      enabled: parsed.enabled === true,
      asked: parsed.asked === true,
      areas: Array.isArray(parsed.areas) ? parsed.areas.filter(isFollowedArea).slice(0, MAX_FOLLOWED_AREAS) : [],
    };
  } catch {
    return { enabled: false, asked: false, areas: [] };
  }
}

export function writePushPrefs(prefs: PushPrefs, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* bộ nhớ bị chặn: giữ trạng thái trong phiên */ }
}

/** Thêm địa bàn theo dõi (mới nhất đứng đầu). Quá giới hạn thì bỏ mục cũ nhất. */
export function followArea(prefs: PushPrefs, area: FollowedArea): PushPrefs {
  const areas = [{ code: area.code, name: area.name }, ...prefs.areas.filter((item) => item.code !== area.code)].slice(0, MAX_FOLLOWED_AREAS);
  return { ...prefs, areas };
}

export function unfollowArea(prefs: PushPrefs, code: string): PushPrefs {
  return { ...prefs, areas: prefs.areas.filter((item) => item.code !== code) };
}

/** Dữ liệu đi kèm thông báo là đầu vào không tin cậy: chỉ nhận đúng các dạng đã biết. */
export function parsePushTarget(data: unknown): PushTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Record<string, unknown>;
  if (value.type === 'alert' && typeof value.areaCode === 'string' && /^[\w-]{3,80}$/.test(value.areaCode)) {
    return { type: 'alert', areaCode: value.areaCode };
  }
  if (value.type === 'citizen' && (value.kind === 'incident' || value.kind === 'sos')
    && typeof value.receiptCode === 'string' && /^[\w-]{3,64}$/.test(value.receiptCode)) {
    return { type: 'citizen', kind: value.kind, receiptCode: value.receiptCode };
  }
  if (value.type === 'officer' && (value.kind === 'incident' || value.kind === 'sos') && typeof value.id === 'string' && /^[\w-]{8,64}$/.test(value.id)) {
    return { type: 'officer', kind: value.kind, id: value.id };
  }
  return null;
}

type PushPlugin = typeof import('@capacitor/push-notifications').PushNotifications;
// Không bao giờ để Promise trả về chính đối tượng plugin: Capacitor dựng plugin bằng Proxy và coi mọi tên, kể cả
// `then`, là một phương thức plugin, nên Promise sẽ treo vĩnh viễn. Luôn bọc trong đối tượng thường.
let pluginPromise: Promise<{ push: PushPlugin }> | null = null;
function loadPlugin(): Promise<{ push: PushPlugin }> {
  pluginPromise ??= import('@capacitor/push-notifications').then((module) => ({ push: module.PushNotifications }));
  pluginPromise.catch(() => { pluginPromise = null; });
  return pluginPromise;
}

let deviceToken: string | null = null;
let initialized = false;
let pendingOpen: PushTarget | null = null;

/** Lấy (một lần) mục tiêu của thông báo mà người dùng vừa bấm, kể cả khi bấm lúc ứng dụng đang tắt. */
export function takePendingPushOpen(): PushTarget | null {
  const target = pendingOpen;
  pendingOpen = null;
  return target;
}

function announce(detail: PushEventDetail): void {
  window.dispatchEvent(new CustomEvent<PushEventDetail>(PUSH_EVENT, { detail }));
}

/** Đồng bộ mã thiết bị, các địa bàn đang theo dõi và tài khoản đang đăng nhập (nếu có) lên máy chủ. */
export async function syncPushDevice(): Promise<void> {
  if (!pushSupported() || !deviceToken) return;
  const prefs = readPushPrefs();
  if (!__OFFICER_APP__ && !prefs.enabled) return;
  try {
    if (__OFFICER_APP__) await registerOfficerPushDevice(deviceToken);
    else await registerPushDevice(deviceToken, prefs.areas.map((area) => area.code));
  } catch {
    // Mất mạng hoặc máy chủ bận: lần mở ứng dụng sau sẽ đồng bộ lại.
  }
}

export async function initPush(): Promise<void> {
  if (!pushSupported() || initialized) return;
  initialized = true;
  try {
    const { push } = await loadPlugin();
    await push.addListener('registration', ({ value }) => { deviceToken = value; void syncPushDevice(); });
    await push.addListener('registrationError', () => { /* thiếu Google Play Services hoặc mất mạng: thử lại lần sau */ });
    await push.addListener('pushNotificationReceived', (notification) => {
      announce({ phase: 'received', title: notification.title ?? '', body: notification.body ?? '', target: parsePushTarget(notification.data) });
    });
    await push.addListener('pushNotificationActionPerformed', (action) => {
      const target = parsePushTarget(action.notification.data);
      pendingOpen = target;
      announce({ phase: 'opened', title: action.notification.title ?? '', body: action.notification.body ?? '', target });
    });
    // Từ Android 8 thông báo phải thuộc một kênh; mã kênh khớp với máy chủ (alerts, cases).
    await push.createChannel({ id: 'alerts', name: 'Cảnh báo khu vực', description: 'Cảnh báo an ninh, trật tự, giao thông tại khu vực bạn theo dõi', importance: 5, visibility: 1, vibration: true });
    await push.createChannel({ id: 'cases', name: 'Cập nhật hồ sơ', description: 'Tiến trình xử lý phản ánh và SOS của bạn', importance: 4, visibility: 0, vibration: true });
    if (__OFFICER_APP__) {
      await push.createChannel({ id: 'sos', name: 'SOS khẩn cấp', description: 'Tín hiệu SOS tại địa bàn bạn phụ trách', importance: 5, visibility: 0, vibration: true });
      await push.createChannel({ id: 'officer', name: 'Phản ánh mới', description: 'Phản ánh mới tại địa bàn bạn phụ trách', importance: 4, visibility: 0, vibration: true });
    }
    const granted = (await push.checkPermissions()).receive === 'granted';
    if (granted && (__OFFICER_APP__ || readPushPrefs().enabled)) await push.register();
  } catch {
    initialized = false;
  }
}

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'error';

/** Xin quyền thông báo (Android 13+) rồi đăng ký thiết bị với FCM. Người gọi lưu tùy chọn và gọi syncPushDevice. */
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    await initPush();
    const { push } = await loadPlugin();
    let status = await push.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') status = await push.requestPermissions();
    if (status.receive !== 'granted') return 'denied';
    await push.register();
    return 'enabled';
  } catch {
    return 'error';
  }
}

export async function currentPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!pushSupported()) return 'unknown';
  try {
    const { receive } = await (await loadPlugin()).push.checkPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unknown';
  }
}

/** Tắt nhận thông báo: gỡ thiết bị khỏi máy chủ và hủy mã FCM (mã bị hủy cũng khiến máy chủ tự xóa thiết bị). */
export async function disablePush(): Promise<void> {
  const token = deviceToken;
  deviceToken = null;
  try { if (token) await removePushDevice(token); } catch { /* mã bị hủy ở bước sau, máy chủ sẽ tự dọn */ }
  try { await (await loadPlugin()).push.unregister(); } catch { /* không có plugin: không còn gì để hủy */ }
}
