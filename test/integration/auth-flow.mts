/**
 * Kiểm thử tích hợp: dùng ĐÚNG mã của app Expo (apiClient/AuthService/DirectoryService/Adapter)
 * với một API chạy cục bộ ở chế độ fixture. KHÔNG chạy với production (có tạo tài khoản công dân).
 *
 *   # terminal 1 (trong platform/api): npm run dev:fixture   (cần biến API_* như platform/.env.example)
 *   # terminal 2 (thư mục gốc):
 *   EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 OFFICER_USER=... OFFICER_PASS=... npx tsx test/integration/auth-flow.mts
 *
 * Lưu ý: Node không có kho cookie như điện thoại, nên script tự giữ cookie bằng một lớp bọc fetch.
 * Script kiểm hợp đồng (đường dẫn, JSON, mã lỗi, vòng đời phiên), không kiểm kho cookie của React Native.
 */
import assert from 'node:assert/strict';

const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d+)?/.test(base)) {
  throw new Error('Chỉ chạy với API cục bộ (EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001). Từ chối chạy với production.');
}

// Giữ cookie thay cho kho cookie của điện thoại.
const jar = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const response = await realFetch(input, { ...init, headers });
  for (const line of response.headers.getSetCookie()) {
    const [pair = '', ...attrs] = line.split(';');
    const [name = '', ...value] = pair.split('=');
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (expired) jar.delete(name.trim()); else jar.set(name.trim(), value.join('='));
  }
  return response;
}) as typeof fetch;

const { ApiError } = await import('../../src/services/apiClient.ts');
const auth = await import('../../src/services/AuthService.ts');
const dir = await import('../../src/services/DirectoryService.ts');
const adapter = await import('../../src/services/DirectoryAdapter.ts');

const officerUser = process.env.OFFICER_USER ?? '';
const officerPass = process.env.OFFICER_PASS ?? '';
const phone = `09${Math.floor(10000000 + Math.random() * 89999999)}`;
const password = 'KiemThu12345a';
const results: string[] = [];
const ok = (name: string) => { results.push(name); console.log('✓', name); };
async function status(promise: Promise<unknown>): Promise<number> {
  try { await promise; return 200; } catch (e) { if (e instanceof ApiError) return e.status; throw e; }
}

// --- Phiên khi chưa đăng nhập
assert.equal(await auth.getOfficerSession(), null); assert.equal(await auth.getCitizenSession(), null);
ok('chưa đăng nhập: cả hai phiên trả null (401 được chuyển thành null)');

// --- Cán bộ
if (officerUser && officerPass) {
  assert.equal(await status(auth.signInOfficer(officerUser, 'sai-mat-khau')), 401);
  const actor = await auth.signInOfficer(officerUser, officerPass);
  assert.ok(actor.id && actor.displayName && ['officer', 'supervisor'].includes(actor.actorType));
  assert.deepEqual(await auth.getOfficerSession(), actor);
  await auth.signOutOfficer();
  assert.equal(await auth.getOfficerSession(), null);
  ok('cán bộ: sai mật khẩu 401, đăng nhập, khôi phục phiên, đăng xuất (204)');
} else console.log('- bỏ qua cán bộ (thiếu OFFICER_USER/OFFICER_PASS)');

// --- Công dân
const created = await auth.registerCitizen(phone, 'Người Dùng Kiểm Thử', password);
assert.ok(created.id && created.displayName === 'Người Dùng Kiểm Thử');
assert.deepEqual(await auth.getCitizenSession(), created);
await auth.signOutCitizen(); assert.equal(await auth.getCitizenSession(), null);
assert.equal(await status(auth.signInCitizen(phone, 'MatKhauSai123')), 401);
assert.deepEqual(await auth.signInCitizen(phone, password), created);
assert.equal(await status(auth.registerCitizen(phone, 'Trùng', password)), 409);
assert.equal(await status(auth.registerCitizen('123', 'Ngắn', password)), 400);
await auth.signOutCitizen();
ok('công dân: đăng ký, phiên, đăng xuất, đăng nhập lại, sai mật khẩu 401, trùng 409, số sai 400');

// --- Danh bạ qua adapter với phản hồi thật của server
const [units, hotlines, overview] = await Promise.all([dir.listUnitContacts(), dir.listHotlines(), dir.getAreaOverview()]);
for (const u of units) { assert.equal(typeof u.unitCode, 'string'); assert.equal(typeof u.unitName, 'string'); assert.equal(typeof u.displayName, 'string'); }
for (const h of hotlines) { assert.equal(typeof h.categoryCode, 'string'); assert.equal(typeof h.categoryLabel, 'string'); }
const places = adapter.adaptAreaPlaceholders(overview);
assert.ok(places.length > 0 && places.every((p) => p.placeholder && p.ma_xa && p.ten_xa));
adapter.adaptUnitContacts(units); adapter.adaptHotlines(hotlines);
const lookup = await dir.lookupByCode(places[0]!.ma_xa);
assert.equal(lookup.data.code, places[0]!.ma_xa);
assert.ok(Array.isArray(lookup.data.directory));
adapter.adaptAreaLookup(lookup.data); adapter.communeFromLookup(lookup.data);
assert.equal(await status(dir.lookupByCode('khong-ton-tai')), 404);
ok(`danh bạ: ${units.length} đầu mối đơn vị, ${hotlines.length} hotline, ${places.length} địa bàn; lookup + adapter khớp phản hồi thật, mã không tồn tại 404`);

console.log(`\n${results.length} nhóm kiểm thử đạt.`);
