const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS = path.join(__dirname, 'artifacts', 'mobile-audit');

function envValue(name) {
  const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name}`);
  return line.slice(name.length + 1).trim();
}

async function enterCitizen(page) {
  const button = page.getByRole('button', { name: 'Người dân' });
  if (await button.count()) await button.click();
  await page.waitForSelector('.app-shell');
}

async function authenticateCitizen(context) {
  const response = await context.request.post(`${BASE_URL}api/v1/auth/citizen/login`, {
    data: {
      username: envValue('API_CITIZEN_USERNAME'),
      password: envValue('API_CITIZEN_PASSWORD'),
    },
  });
  if (!response.ok()) throw new Error(`Citizen login failed: ${response.status()}`);
}

async function authenticateOfficer(context) {
  const response = await context.request.post(`${BASE_URL}api/v1/auth/officer/login`, {
    data: {
      username: envValue('API_OFFICER_USERNAME'),
      password: envValue('API_OFFICER_PASSWORD'),
    },
  });
  if (!response.ok()) throw new Error(`Officer login failed: ${response.status()}`);
}

async function inspect(page, label, viewport, takeScreenshot = false) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const smallTargets = [...document.querySelectorAll('button, a, summary, input, select, textarea')]
      .filter(visible)
      .filter((element) => {
        if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type)) return true;
        const label = element.closest('label');
        if (!label) return true;
        const rect = label.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, text: (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70), width: Math.round(rect.width), height: Math.round(rect.height) };
      })
      .filter((item) => item.width < 44 || item.height < 44);
    const zoomRiskFields = [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, textarea')]
      .filter(visible)
      .map((element) => ({
        name: element.getAttribute('name') || element.tagName.toLowerCase(),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((item) => item.fontSize < 16);
    return {
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      viewportWidth: root.clientWidth,
      smallTargets,
      zoomRiskFields,
    };
  });
  if (takeScreenshot) {
    await page.screenshot({ path: path.join(ARTIFACTS, `${label}-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
  return { label, viewport: `${viewport.width}x${viewport.height}`, ...result };
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ];
  const citizenRoutes = [
    ['map', ''],
    ['alerts', '?feature=alerts'],
    ['reports', '?feature=reports'],
    ['sos', '?feature=sos'],
    ['feedback', '?feature=feedback'],
    ['assistant', '?feature=assistant'],
    ['account', '?feature=account'],
  ];
  const results = [];

  for (const viewport of viewports) {
    for (const [label, query] of citizenRoutes) {
      const context = await browser.newContext({
        viewport,
        geolocation: { latitude: 11.944, longitude: 108.441 },
        permissions: ['geolocation'],
        reducedMotion: 'reduce',
      });
      await authenticateCitizen(context);
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem('cskv-citizen-tour-v1', 'completed'));
      await page.goto(`${BASE_URL}${query}`, { waitUntil: 'networkidle' });
      await enterCitizen(page);
      if (label === 'map') await page.waitForSelector('.map-canvas');
      results.push(await inspect(page, `citizen-${label}`, viewport, viewport.width === 375 || label === 'sos'));
      await context.close();
    }
  }

  const citizenUiViewport = { width: 375, height: 667 };
  const citizenUiContext = await browser.newContext({ viewport: citizenUiViewport });
  const citizenUi = await citizenUiContext.newPage();
  await citizenUi.addInitScript(() => localStorage.setItem('cskv-citizen-tour-v1', 'completed'));
  await citizenUi.goto(BASE_URL, { waitUntil: 'networkidle' });
  await enterCitizen(citizenUi);
  await citizenUi.getByRole('button', { name: 'Danh bạ', exact: true }).click();
  results.push(await inspect(citizenUi, 'citizen-directory', citizenUiViewport, true));
  await citizenUi.getByRole('button', { name: 'Tính năng' }).click();
  await citizenUi.waitForTimeout(300);
  results.push(await inspect(citizenUi, 'citizen-feature-menu', citizenUiViewport, true));
  await citizenUi.getByRole('button', { name: 'Đóng danh sách tính năng', exact: true }).last().click();
  await citizenUi.waitForTimeout(220);
  await citizenUi.getByRole('button', { name: 'Đăng nhập hoặc đăng ký tài khoản người dân' }).click();
  await citizenUi.waitForTimeout(220);
  results.push(await inspect(citizenUi, 'citizen-auth-sheet', citizenUiViewport, true));
  await citizenUiContext.close();

  const policeViewport = { width: 375, height: 667 };
  const policeContext = await browser.newContext({ viewport: policeViewport, reducedMotion: 'reduce' });
  const police = await policeContext.newPage();
  await police.goto(`${BASE_URL}?portal=police`, { waitUntil: 'networkidle' });
  const officerEntry = police.getByRole('button', { name: 'Cán bộ Công an' });
  if (await officerEntry.count()) await officerEntry.click();
  results.push(await inspect(police, 'police-login', policeViewport, true));
  await police.locator('input[name="username"]').fill(envValue('API_OFFICER_USERNAME'));
  await police.locator('input[name="password"]').fill(envValue('API_OFFICER_PASSWORD'));
  await police.locator('form button[type="submit"]').click();
  await police.waitForSelector('.police-portal');
  results.push(await inspect(police, 'police-map', policeViewport, true));
  await police.getByRole('button', { name: 'Hàng đợi', exact: true }).click();
  await police.waitForSelector('.queue-card');
  results.push(await inspect(police, 'police-queue', policeViewport, true));
  await police.locator('.queue-scopes').getByRole('button', { name: /^Tất cả/ }).click();
  results.push(await inspect(police, 'police-queue-all', policeViewport, true));
  await police.locator('.queue-card').first().click();
  await police.waitForSelector('.case-hero');
  results.push(await inspect(police, 'police-case-detail', policeViewport, true));
  for (const name of ['Bản đồ', 'Nghiệp vụ']) {
    const button = police.getByRole('button', { name, exact: true });
    if (await button.count()) {
      await button.click();
      await police.waitForTimeout(250);
      results.push(await inspect(police, `police-${name === 'Bản đồ' ? 'map-return' : 'operations'}`, policeViewport, true));
    }
  }
  for (const name of ['Bản đồ', 'Cảnh báo', 'Tuần tra', 'Cuối ca', 'Tích hợp']) {
    const tab = police.locator('.operations-tabs').getByRole('tab', { name, exact: true });
    if (await tab.count()) {
      await tab.click();
      await police.waitForTimeout(180);
      results.push(await inspect(police, `police-operations-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').toLowerCase()}`, policeViewport, true));
      if (name === 'Bản đồ') {
        const add = police.getByRole('button', { name: 'Thêm điểm', exact: true });
        if (await add.count()) {
          await add.click();
          results.push(await inspect(police, 'police-map-data-sheet', policeViewport, true));
          await police.locator('.map-data-sheet').getByRole('button', { name: 'Đóng', exact: true }).click();
        }
      }
    }
  }
  await policeContext.close();

  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, locale: 'vi-VN', reducedMotion: 'reduce' });
    await authenticateOfficer(context);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}?portal=police`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.police-portal');
    results.push(await inspect(page, 'police-home', viewport, true));

    if (viewport.width <= 767) {
      await page.locator('.police-mobile-nav').getByRole('button', { name: 'Hàng đợi', exact: true }).click();
    } else {
      await page.locator('.police-topnav').getByRole('button', { name: /^Hàng đợi/ }).click();
    }
    await page.waitForSelector('.queue-search input');
    results.push(await inspect(page, 'police-queue', viewport, true));
    await page.locator('.queue-search input').focus();
    const keyboardSafe = await page.evaluate(() => {
      const nav = document.querySelector('.police-mobile-nav');
      const field = document.querySelector('.queue-search input');
      if (!(nav instanceof HTMLElement) || !(field instanceof HTMLElement)) return false;
      return (innerWidth > 767 || getComputedStyle(nav).pointerEvents === 'none') && field.getBoundingClientRect().bottom <= innerHeight;
    });
    if (!keyboardSafe) throw new Error(`Officer keyboard layout is not safe at ${viewport.width}x${viewport.height}`);
    await page.locator('.queue-search input').blur();

    if (viewport.width <= 767) {
      await page.locator('.police-mobile-nav').getByRole('button', { name: 'Nghiệp vụ', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Mở công cụ nghiệp vụ', exact: true }).click();
    }
    await page.waitForSelector('.operations-tabs');
    results.push(await inspect(page, 'police-operations', viewport, true));
    await page.locator('.operations-tabs').getByRole('tab', { name: 'Cảnh báo', exact: true }).click();
    results.push(await inspect(page, 'police-alert-form', viewport, true));
    await context.close();
  }
  await browser.close();

  const failures = results.filter((item) => item.horizontalOverflow > 0);
  if (failures.length) throw new Error(`Horizontal overflow: ${failures.map((item) => `${item.label}@${item.viewport}=${item.horizontalOverflow}px`).join(', ')}`);
  const zoomRisks = results.filter((item) => item.zoomRiskFields.length > 0);
  if (zoomRisks.length) throw new Error(`Inputs below 16px: ${zoomRisks.map((item) => `${item.label}=${item.zoomRiskFields.map((field) => `${field.name}:${field.fontSize}`).join('|')}`).join(', ')}`);
  const smallTargetRisks = results.filter((item) => item.smallTargets.length > 0);
  if (smallTargetRisks.length) throw new Error(`Targets below 44px: ${smallTargetRisks.map((item) => `${item.label}=${item.smallTargets.map((target) => `${target.text}:${target.width}x${target.height}`).join('|')}`).join(', ')}`);
  console.log(JSON.stringify({ screensChecked: results.length, viewports: [...new Set(results.map((item) => item.viewport))], horizontalOverflow: 0, zoomRiskFields: 0, smallTargets: 0, keyboardSafe: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
