const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS = path.join(__dirname, 'artifacts', 'citizen-auth-gate');

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

async function loginFromGate(page, credentials) {
  await page.locator('.citizen-feature-auth-gate').getByRole('button', { name: 'Đăng nhập hoặc đăng ký' }).click();
  if (await page.locator('.citizen-auth-intro').count()) throw new Error('The obsolete VNeID intro step must not be displayed');
  await page.locator('.citizen-auth-sheet input[name="username"]').fill(credentials.API_CITIZEN_USERNAME);
  await page.locator('.citizen-auth-sheet input[name="password"]').fill(credentials.API_CITIZEN_PASSWORD);
  await page.locator('.citizen-auth-sheet button[type="submit"]').click();
  await page.getByText('Đăng nhập tài khoản thành công.', { exact: true }).waitFor();
  if (await page.locator('.citizen-feature-auth-gate').count()) throw new Error('The gate must be replaced by the requested feature after login');
}

async function assertHidden(page, selectors) {
  for (const selector of selectors) {
    if (await page.locator(selector).count()) throw new Error(`${selector} must not be mounted before citizen login`);
  }
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const credentials = env();
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  try {
    const reportContext = await browser.newContext({ viewport: { width: 375, height: 667 }, locale: 'vi-VN' });
    const reportPage = await reportContext.newPage();
    reportPage.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401 (Unauthorized)')) errors.push(`reports: ${message.text()}`); });
    await reportPage.addInitScript(() => localStorage.setItem('cskv-citizen-tour-v1', 'completed'));
    await reportPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await enterCitizen(reportPage);
    await reportPage.getByRole('button', { name: 'Phản ánh', exact: true }).click();
    await reportPage.getByText('Bạn cần đăng nhập tài khoản người dân để gửi phản ánh.', { exact: true }).waitFor();
    await assertHidden(reportPage, ['.operational-form', '.workflow-map-canvas', 'input[name="summary"]']);
    await reportPage.screenshot({ path: path.join(ARTIFACTS, '01-report-login-gate.png'), fullPage: true });
    await loginFromGate(reportPage, credentials);
    await reportPage.locator('input[name="summary"]').waitFor();
    await reportPage.screenshot({ path: path.join(ARTIFACTS, '02-report-after-login.png'), fullPage: true });
    await reportContext.close();

    const sosContext = await browser.newContext({ viewport: { width: 375, height: 667 }, locale: 'vi-VN', geolocation: { latitude: 11.944, longitude: 108.441 }, permissions: ['geolocation'] });
    const sosPage = await sosContext.newPage();
    sosPage.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401 (Unauthorized)')) errors.push(`sos: ${message.text()}`); });
    await sosPage.addInitScript(() => localStorage.setItem('cskv-citizen-tour-v1', 'completed'));
    await sosPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await enterCitizen(sosPage);
    await sosPage.locator('.map-sos-button').click();
    await sosPage.getByText('Bạn cần đăng nhập tài khoản người dân để sử dụng SOS.', { exact: true }).waitFor();
    await assertHidden(sosPage, ['.sos-emergency-screen', '.sos-hold-button', '.workflow-map-canvas']);
    const call112 = sosPage.getByRole('link', { name: 'Gọi Tổng đài khẩn cấp quốc gia 112' });
    const call113 = sosPage.getByRole('link', { name: 'Gọi Công an 113' });
    if (await call112.getAttribute('href') !== 'tel:112') throw new Error('112 quick call must open the device dialer before login');
    if (await call113.getAttribute('href') !== 'tel:113') throw new Error('113 quick call must open the device dialer before login');
    await sosPage.screenshot({ path: path.join(ARTIFACTS, '03-sos-login-gate.png'), fullPage: true });
    await loginFromGate(sosPage, credentials);
    await sosPage.locator('.sos-hold-button').waitFor();
    await sosPage.screenshot({ path: path.join(ARTIFACTS, '04-sos-after-login.png'), fullPage: true });
    await sosContext.close();

    if (errors.length) throw new Error(`Browser console errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ ok: true, reportsGate: 'passed', sosGate: 'passed', loginSuccess: 'passed', screenshots: 4 }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
