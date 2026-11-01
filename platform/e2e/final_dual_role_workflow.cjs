const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173/';
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS = path.join(__dirname, 'artifacts', 'final-workflow');

function env() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

async function enterCitizen(page) {
  const entry = page.getByRole('button', { name: 'Người dân' });
  if (await entry.count()) await entry.click();
  await page.waitForSelector('.app-shell');
}

function collectConsoleError(target, role, message) {
  if (message.type() !== 'error' || message.text().includes('401 (Unauthorized)')) return;
  const sourceUrl = message.location().url || '';
  const isExternalMapNetwork = (sourceUrl && !sourceUrl.startsWith(BASE_URL))
    || /tiles\.openfreemap\.org|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET/.test(message.text());
  if (!isExternalMapNetwork) target.push(`${role}: ${message.text()}`);
}

async function citizenLogin(page, credentials) {
  await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
  await page.getByRole('button', { name: /Đăng nhập hoặc đăng ký/ }).click();
  await page.locator('.citizen-auth-sheet input[name="username"]').fill(credentials.API_CITIZEN_USERNAME);
  await page.locator('.citizen-auth-sheet input[name="password"]').fill(credentials.API_CITIZEN_PASSWORD);
  await page.locator('.citizen-auth-sheet form button[type="submit"]').click();
  await page.locator('.citizen-auth-sheet').waitFor({ state: 'detached' });
  await page.getByText('Đã đăng nhập', { exact: true }).waitFor();
}

async function officerLogin(page, credentials) {
  await page.goto(`${BASE_URL}?portal=police`, { waitUntil: 'networkidle' });
  const entry = page.getByRole('button', { name: 'Cán bộ Công an' });
  if (await entry.count()) await entry.click();
  await page.locator('input[name="username"]').fill(credentials.API_OFFICER_USERNAME);
  await page.locator('input[name="password"]').fill(credentials.API_OFFICER_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForSelector('.police-portal');
  // A citizen SOS is already waiting, so the full-screen red alarm comes up: open the case from it.
  const alarm = page.locator('.sos-emergency-overlay');
  try { await alarm.waitFor({ timeout: 10_000 }); } catch { return; }
  await alarm.getByRole('button', { name: 'Xem hồ sơ trước' }).click();
  await alarm.waitFor({ state: 'detached' });
}

async function transition(page, action, note, terminal = false) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const textarea = page.locator('.transition-form textarea[name="transitionNote"]');
  await textarea.fill(note);
  if (action === 'Ghi nhận kết quả') {
    const publicToggle = page.locator('.transition-form input[name="publicMessage"]');
    if (!(await publicToggle.isChecked())) await publicToggle.check();
  }
  const submit = page.locator('.transition-form button[type="submit"]');
  const transitioned = page.waitForResponse(response => response.url().endsWith('/transitions') && response.request().method() === 'POST');
  await submit.click();
  if (terminal) {
    await page.getByText('Kiểm tra lần cuối', { exact: true }).waitFor();
    await submit.click();
  }
  const response = await transitioned;
  if (!response.ok()) throw new Error(`Transition ${action} failed: ${response.status()}`);
  console.log(`PASS transition ${action}`);
  await page.waitForTimeout(250);
}

async function cleanup(receipts, databaseUrl) {
  if (!receipts.length) return;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('BEGIN');
    const ids = await pool.query(
      `SELECT id FROM incident_reports WHERE receipt_code=ANY($1::text[])
       UNION ALL SELECT id FROM sos_events WHERE receipt_code=ANY($1::text[])`, [receipts],
    );
    if (ids.rows.length) await pool.query('DELETE FROM workflow_outbox WHERE aggregate_id=ANY($1::uuid[])', [ids.rows.map((row) => row.id)]);
    await pool.query('DELETE FROM incident_reports WHERE receipt_code=ANY($1::text[])', [receipts]);
    await pool.query('DELETE FROM sos_events WHERE receipt_code=ANY($1::text[])', [receipts]);
    await pool.query("DELETE FROM operational_map_points WHERE name LIKE 'E2E final %'");
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally { await pool.end(); }
}

async function main() {
  if (!['127.0.0.1', 'localhost'].includes(new URL(BASE_URL).hostname)) throw new Error('Loopback QA only; production writes forbidden');
  const health = await (await fetch(new URL('api/health', BASE_URL))).json();
  if (!health.releaseValidation) throw new Error('Requires explicitly isolated release-validation database');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const credentials = env();
  const receipts = [];
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const browserErrors = [];
  try {
    const citizenContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', geolocation: { latitude: 11.944, longitude: 108.441 }, permissions: ['geolocation'], reducedMotion: 'reduce' });
    const citizen = await citizenContext.newPage();
    citizen.on('console', (message) => collectConsoleError(browserErrors, 'citizen', message));
    await citizen.goto(BASE_URL, { waitUntil: 'networkidle' });
    await enterCitizen(citizen);

    await citizen.waitForSelector('.citizen-tour');
    for (let index = 0; index < 5; index += 1) {
      await citizen.getByRole('button', { name: /Tiếp theo|Bắt đầu khám phá/ }).click();
      await citizen.waitForTimeout(100);
    }
    await citizen.screenshot({ path: path.join(ARTIFACTS, '01-citizen-tour-account-highlight.png') });
    await citizen.getByRole('button', { name: /Hoàn tất/ }).click();
    await citizenLogin(citizen, credentials);
    await citizen.screenshot({ path: path.join(ARTIFACTS, '02-citizen-account.png'), fullPage: true });

    await citizen.getByRole('button', { name: 'Phản ánh', exact: true }).click();
    await citizen.locator('input[name="summary"]').fill('E2E final phản ánh trật tự');
    await citizen.locator('textarea[name="description"]').fill('Kiểm thử cuối luồng hai vai trò tại Phường Xuân Hương.');
    await citizen.locator('input[name="evidence"]').setInputFiles({ name: 'e2e-final.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=', 'base64') });
    const gps = citizen.getByRole('button', { name: 'Dùng GPS' });
    if (await gps.count()) { await gps.click(); await citizen.getByText('Đã có vị trí gửi kèm').waitFor(); }
    await citizen.locator('input[name="contactPhone"]').fill('0912345678');
    await citizen.locator('input[name="truthfulnessConsent"]').check();
    await citizen.getByRole('button', { name: 'Gửi phản ánh', exact: true }).click();
    await citizen.waitForSelector('.case-detail-card code');
    const incidentReceipt = (await citizen.locator('.case-detail-card code').first().textContent()).trim();
    receipts.push(incidentReceipt);
    await citizen.screenshot({ path: path.join(ARTIFACTS, '03-citizen-report-receipt.png'), fullPage: true });

    await citizen.getByRole('button', { name: 'Bản đồ', exact: true }).click();
    await citizen.waitForSelector('.map-sos-button');
    await citizen.locator('.map-sos-button').click();
    await citizen.waitForSelector('.sos-hold-button');
    await citizen.getByText(/GPS sẵn sàng/).waitFor({ timeout: 15_000 });
    const hold = citizen.locator('.sos-hold-button');
    await hold.hover(); await citizen.mouse.down(); await citizen.waitForTimeout(3_250); await citizen.mouse.up();
    await citizen.waitForSelector('.sos-receipt-card h2', { timeout: 15_000 });
    const sosReceipt = (await citizen.locator('.sos-receipt-card h2').textContent()).trim();
    receipts.push(sosReceipt);
    await citizen.screenshot({ path: path.join(ARTIFACTS, '04-citizen-sos-receipt.png'), fullPage: true });

    const officerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN', reducedMotion: 'reduce' });
    const officer = await officerContext.newPage();
    officer.on('console', (message) => collectConsoleError(browserErrors, 'officer', message));
    await officerLogin(officer, credentials);
    await officer.getByRole('button', { name: 'Nghiệp vụ', exact: true }).click();
    await officer.getByRole('heading', { name: 'Báo cáo tình hình địa bàn' }).waitFor();
    await officer.screenshot({ path: path.join(ARTIFACTS, '05-officer-statistics.png'), fullPage: true });

    await officer.getByRole('tab', { name: 'Bản đồ', exact: true }).click();
    await officer.getByRole('button', { name: 'Thêm điểm' }).click();
    const mapForm = officer.locator('.map-data-sheet');
    await mapForm.locator('input[name="name"]').fill('E2E final điểm tuần tra');
    await mapForm.locator('select[name="pointType"]').selectOption('patrol_checkpoint');
    await mapForm.locator('input[name="latitude"]').fill('11.944');
    await mapForm.locator('input[name="longitude"]').fill('108.441');
    await mapForm.getByRole('button', { name: 'Lưu điểm bản đồ' }).click();
    await officer.getByText('E2E final điểm tuần tra', { exact: true }).waitFor();
    await officer.getByRole('button', { name: 'Sửa E2E final điểm tuần tra' }).click();
    await officer.locator('.map-data-sheet select[name="status"]').selectOption('maintenance');
    await officer.locator('.map-data-sheet').getByRole('button', { name: 'Lưu điểm bản đồ' }).click();
    await officer.getByText(/Bảo trì/).waitFor();
    await Promise.all([
      officer.waitForEvent('dialog').then((dialog) => dialog.accept()),
      officer.getByRole('button', { name: 'Xóa E2E final điểm tuần tra' }).click(),
    ]);
    await officer.waitForTimeout(250);

    await officer.locator('.police-mobile-nav').getByRole('button', { name: 'Hàng đợi', exact: true }).click();
    const queueSearch = officer.locator('input[name="queueQuery"]');
    await queueSearch.fill(incidentReceipt);
    await officer.locator('.queue-card').first().click();
    await transition(officer, 'Xác nhận tiếp nhận', 'Đã kiểm tra nội dung và vị trí phản ánh.');
    await transition(officer, 'Phân công xử lý', 'CSKV Xuân Hương trực tiếp nhận xử lý hồ sơ.');
    await transition(officer, 'Bắt đầu xác minh', 'Đã liên hệ người dân và xác minh thông tin ban đầu.');
    await transition(officer, 'Chuyển sang xử lý', 'Đang triển khai biện pháp xử lý tại địa bàn.');
    await transition(officer, 'Ghi nhận kết quả', 'Đã kiểm tra hiện trường, xử lý ổn định và thông báo người dân.', true);
    await officer.screenshot({ path: path.join(ARTIFACTS, '06-officer-report-resolved.png'), fullPage: true });

    await officer.locator('.police-mobile-nav').getByRole('button', { name: 'Hàng đợi', exact: true }).click();
    await queueSearch.fill(sosReceipt);
    await officer.locator('.queue-card').first().click();
    if (await officer.getByRole('button', { name: 'Đưa vào hàng đợi', exact: true }).count()) await transition(officer, 'Đưa vào hàng đợi', 'Đã đưa tín hiệu SOS vào hàng đợi ưu tiên.');
    await transition(officer, 'Xác nhận SOS', 'Đã xác nhận tín hiệu và liên hệ người dân khẩn cấp.');
    await transition(officer, 'Đang triển khai lực lượng', 'Lực lượng CSKV đang di chuyển đến vị trí phát SOS.');
    await transition(officer, 'Ghi nhận kết quả', 'Đã tiếp cận vị trí, tình huống an toàn và hoàn tất hỗ trợ.', true);
    await officer.screenshot({ path: path.join(ARTIFACTS, '07-officer-sos-resolved.png'), fullPage: true });

    await citizen.goto(`${BASE_URL}?feature=feedback`, { waitUntil: 'networkidle' });
    await citizen.getByRole('heading', { name: 'Đánh giá hài lòng' }).waitFor();
    await citizen.locator('select[name="case-id"]').selectOption(`incident:${incidentReceipt}`);
    await citizen.locator('input[name="rating"][value="5"]').check();
    await citizen.locator('textarea[name="comment"]').fill('Quy trình rõ ràng, cán bộ phản hồi đầy đủ.');
    const [ratingResponse] = await Promise.all([
      citizen.waitForResponse((response) => response.url().includes('/rating') && response.request().method() === 'POST'),
      citizen.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click(),
    ]);
    if (!ratingResponse.ok()) throw new Error(`Rating failed ${ratingResponse.status()}: ${await ratingResponse.text()}`);
    await citizen.getByText(/Đánh giá đã được ghi nhận/).waitFor();
    await citizen.screenshot({ path: path.join(ARTIFACTS, '08-citizen-rating.png'), fullPage: true });

    await officer.locator('.police-mobile-nav').getByRole('button', { name: 'Hàng đợi', exact: true }).click();
    await officer.locator('.queue-scopes').getByRole('button', { name: 'Tất cả', exact: true }).click();
    await queueSearch.fill(incidentReceipt);
    await officer.locator('.queue-card').first().click();
    await officer.getByRole('heading', { name: 'Đánh giá của người dân' }).waitFor();
    await officer.screenshot({ path: path.join(ARTIFACTS, '09-officer-sees-rating.png'), fullPage: true });

    const overflows = await Promise.all([citizen, officer].map((page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)));
    if (overflows.some((value) => value > 0)) throw new Error(`Horizontal overflow in final workflow: ${overflows.join(',')}`);
    if (browserErrors.length) throw new Error(`Browser console errors: ${browserErrors.join(' | ')}`);
    console.log(JSON.stringify({ ok: true, incidentReceipt, sosReceipt, screenshots: 9, overflows }, null, 2));
    await officerContext.close(); await citizenContext.close();
  } finally {
    await browser.close();
    // Keep evidence in the isolated release DB. Never run cleanup on a DB URL
    // loaded from the developer environment (which may point to production).
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
