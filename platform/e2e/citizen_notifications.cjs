const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { Pool } = require('pg');
const BASE = 'http://127.0.0.1:5173/';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'artifacts', 'citizen-notifications');
const credentials = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const created = [];

async function api(context, endpoint, data) {
  const response = data === undefined ? await context.request.get(BASE+'api'+endpoint) : await context.request.post(BASE+'api'+endpoint, {data});
  assert(response.ok(), `${endpoint}: ${response.status()} ${await response.text()}`);
  return (await response.json()).data;
}
async function openInbox(page) {
  if(!await page.locator('.citizen-notification-inbox').count()) await page.locator('.citizen-notification-bell').click();
  await page.locator('.citizen-notification-inbox').waitFor();
  await page.waitForFunction(() => document.querySelector('.citizen-notification-scroll')?.getAttribute('aria-busy') === 'false');
}
async function officerCase(page, receipt) {
  await page.locator('.police-mobile-nav').getByRole('button',{name:'Hàng đợi',exact:true}).click();
  await page.locator('input[name="queueQuery"]').fill(receipt);
  await page.locator('.queue-card').first().click();
  await page.locator('.case-hero').filter({hasText:receipt}).waitFor();
}
async function transition(page, label, note, publicMessage=false, confirm=false) {
  const card=page.locator('.case-action-card');
  const others=card.locator('.case-action-others');
  if(!(await card.getByRole('button',{name:label,exact:true}).count()) && await others.count()) {
    await others.locator('summary').click();
    await others.getByRole('button',{name:label,exact:true}).click();
  }
  const textarea=card.locator('textarea[name="transitionNote"]');
  if(note) {
    if(!(await textarea.count())) await card.getByRole('button',{name:'Nhắn người dân'}).click();
    await textarea.fill(note);
    await card.locator('input[name="publicMessage"]').setChecked(publicMessage);
  }
  const submit=card.locator('.case-action-button');
  const done=page.waitForResponse(r=>r.url().endsWith('/transitions') && r.request().method()==='POST' && r.ok());
  await submit.click();
  if(confirm) { await page.getByText('Việc này không hoàn tác được.',{exact:true}).waitFor(); await submit.click(); }
  await done;
  await page.waitForTimeout(400);
}
async function cleanup() {
  if(!created.length) return;
  const pool=new Pool({connectionString:credentials.DATABASE_URL});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const receipts=created.map(x=>x.receiptCode), ids=created.map(x=>x.id);
    await client.query('DELETE FROM citizen_notification_reads WHERE notification_id IN (SELECT id FROM citizen_notification_events WHERE receipt_code=ANY($1::text[]))',[receipts]);
    await client.query('DELETE FROM workflow_notifications WHERE aggregate_id=ANY($1::uuid[])',[ids]);
    await client.query('DELETE FROM workflow_outbox WHERE aggregate_id=ANY($1::uuid[])',[ids]);
    await client.query('DELETE FROM workflow_audit_events WHERE aggregate_id=ANY($1::uuid[])',[ids]);
    await client.query('DELETE FROM incident_reports WHERE id=ANY($1::uuid[])',[ids]);
    await client.query('DELETE FROM sos_events WHERE id=ANY($1::uuid[])',[ids]);
    await client.query('COMMIT');
    console.log(JSON.stringify({cleanedTestCases:created.length}));
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally {client.release();await pool.end();}
}
async function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const errors=[];
  let citizen;
  try {
    const context=await browser.newContext({viewport:{width:375,height:667},locale:'vi-VN',reducedMotion:'reduce'});
    citizen=await context.newPage(); citizen.setDefaultTimeout(15000);
    citizen.on('pageerror',e=>errors.push(e.message));
    citizen.on('console',m=>{if(m.type()==='error' && !m.text().includes('401 (Unauthorized)')) errors.push(m.text());});
    await citizen.addInitScript(()=>localStorage.setItem('cskv-citizen-tour-v1','completed'));
    await citizen.goto(BASE,{waitUntil:'networkidle'});
    await citizen.getByRole('button',{name:/^Người dân/}).click();
    await citizen.locator('.citizen-notification-bell').click();
    await citizen.getByText('Nhận cập nhật từ cán bộ',{exact:true}).waitFor();
    await citizen.locator('.citizen-notification-inbox').getByRole('button',{name:'Đăng nhập hoặc đăng ký'}).click();
    await citizen.locator('.citizen-auth-sheet input[name="username"]').fill(credentials.API_CITIZEN_USERNAME);
    await citizen.locator('.citizen-auth-sheet input[name="password"]').fill(credentials.API_CITIZEN_PASSWORD);
    await citizen.locator('.citizen-auth-sheet button[type="submit"]').click();
    await citizen.getByText('Đăng nhập tài khoản thành công.',{exact:true}).waitFor();
    const initial=await api(context,'/v1/citizen/notifications');
    const report=await api(context,'/v1/citizen/incidents',{
      clientRequestId:randomUUID(),category:'security',summary:'E2E chuông thông báo Xuân Hương',
      description:'Hồ sơ kiểm thử riêng: thông báo xử lý của cán bộ tới người dân.',latitude:11.944,longitude:108.441,
      contactPhone:'0912345678',accuracyM:10,attachments:[{fileName:'notification.png',mimeType:'image/png',sizeBytes:4,dataBase64:'dGVzdA=='}],
    }); created.push(report);
    const sos=await api(context,'/v1/citizen/sos',{idempotencyKey:randomUUID(),category:'security',note:'E2E kiểm tra thông báo SOS',latitude:11.944,longitude:108.441,accuracyM:10,deviceTimestamp:new Date().toISOString()}); created.push(sos);

    const officerContext=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN',reducedMotion:'reduce'});
    const officer=await officerContext.newPage();
    await officer.goto(BASE+'?portal=police',{waitUntil:'networkidle'});
    await officer.locator('input[name="username"]').fill(credentials.API_OFFICER_USERNAME);
    await officer.locator('input[name="password"]').fill(credentials.API_OFFICER_PASSWORD);
    await officer.locator('form button[type="submit"]').click();
    await officer.locator('.police-portal').waitFor();
    // The citizen SOS already waiting raises the full-screen alarm: close it before opening cases.
    const alarm=officer.locator('.sos-emergency-overlay');
    try { await alarm.waitFor({timeout:8000}); await alarm.getByRole('button',{name:'Xem hồ sơ trước'}).click(); await alarm.waitFor({state:'detached'}); } catch {}
    await officerCase(officer,report.receiptCode);
    await transition(officer,'Nhận hồ sơ','INTERNAL_NOTIFICATION_SECRET không công khai');
    await citizen.locator('.citizen-notification-count').filter({hasText:String(initial.unreadCount+2)}).waitFor({timeout:20000});
    await openInbox(citizen);
    const reportItem=citizen.locator('.citizen-notification-item').filter({hasText:report.receiptCode}).filter({hasText:'Phản ánh đã được tiếp nhận'}).first(); // "Nhận hồ sơ" sends two notices (received, assigned)
    await reportItem.getByText('Phản ánh đã được tiếp nhận',{exact:true}).waitFor();
    assert(!(await citizen.locator('.citizen-notification-inbox').innerText()).includes('INTERNAL_NOTIFICATION_SECRET'));
    const notificationId=await reportItem.getAttribute('data-notification-id');
    // Simulate an older case outside the recent-list window, keeping detail API real.
    await citizen.route('**/api/v1/citizen/incidents',route=>route.request().method()==='GET' ? route.fulfill({json:{data:[]}}) : route.continue());
    await reportItem.click();
    await citizen.locator('.case-detail-card code').filter({hasText:report.receiptCode}).waitFor();
    await citizen.unroute('**/api/v1/citizen/incidents');
    assert.equal(new URL(citizen.url()).searchParams.get('reportReceipt'),report.receiptCode);
    await citizen.reload({waitUntil:'networkidle'});
    await citizen.locator('.case-detail-card code').filter({hasText:report.receiptCode}).waitFor();
    const afterRead=await api(context,'/v1/citizen/notifications');
    assert(afterRead.items.find(n=>n.id===notificationId).readAt,'read status persists after reload');

    await officer.locator('.case-thread-details > summary').click();
    await officer.locator('#officer-message').fill('Vui lòng bổ sung ảnh hiện trường để cán bộ xác minh.');
    await officer.getByLabel('Yêu cầu ảnh/video').check();
    await Promise.all([officer.waitForResponse(r=>r.url().endsWith('/messages') && r.request().method()==='POST' && r.ok()),officer.getByRole('button',{name:'Gửi người dân',exact:true}).click()]);
    await openInbox(citizen);
    await citizen.getByText('Cán bộ yêu cầu bổ sung thông tin',{exact:true}).first().waitFor();
    await citizen.getByRole('button',{name:'Đóng thông báo'}).click();
    await transition(officer,'Bắt đầu xử lý','Đang xử lý nội dung phản ánh.',true);
    await transition(officer,'Đã xử lý xong','Đã hoàn tất kiểm tra và xử lý phản ánh.',true);
    await officerCase(officer,sos.receiptCode);
    await transition(officer,'Nhận SOS ngay','',true);
    await openInbox(citizen);
    await citizen.getByRole('button',{name:'Làm mới thông báo'}).click();
    await citizen.getByText('Cán bộ đã tiếp nhận SOS',{exact:true}).first().waitFor();
    await citizen.route('**/api/v1/citizen/sos',route=>route.request().method()==='GET' ? route.fulfill({json:{data:[]}}) : route.continue());
    await citizen.locator('.citizen-notification-item').filter({hasText:sos.receiptCode}).first().click();
    await citizen.locator('.sos-receipt-card h2').filter({hasText:sos.receiptCode}).waitFor();
    await citizen.unroute('**/api/v1/citizen/sos');
    await openInbox(citizen);
    const resolved=citizen.locator('.citizen-notification-item').filter({hasText:'Phản ánh đã có kết quả'}).filter({hasText:report.receiptCode});
    assert((await resolved.innerText()).includes('gửi đánh giá'));

    // Mouse/touch layout, keyboard trap, no horizontal overflow, and restore focus.
    for(const viewport of [{width:320,height:568},{width:375,height:667},{width:844,height:390},{width:768,height:1024},{width:1440,height:900}]) {
      await citizen.setViewportSize(viewport);
      const overflow=await citizen.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.equal(overflow,0,JSON.stringify(viewport));
      const box=await citizen.locator('.citizen-notification-inbox').boundingBox();
      assert(box && box.x>=0 && box.x+box.width<=viewport.width+1 && box.height<=viewport.height+1);
      await citizen.screenshot({path:path.join(OUT,`${viewport.width}x${viewport.height}.png`)});
    }
    await citizen.getByRole('button',{name:'Đóng thông báo'}).focus();
    await citizen.keyboard.press('Shift+Tab');
    assert(await citizen.evaluate(()=>!!document.activeElement.closest('.citizen-notification-inbox')));
    await citizen.keyboard.press('Escape');
    assert(await citizen.locator('.citizen-notification-bell').evaluate(el=>el===document.activeElement));
    assert(!(await citizen.locator('.app-shell').evaluate(el=>el.inert)));

    // Pagination and privacy against the real PostgreSQL API, without altering other users' read state.
    const first=await api(context,'/v1/citizen/notifications?limit=1');
    const next=await api(context,'/v1/citizen/notifications?limit=1&cursor='+encodeURIComponent(first.nextCursor));
    assert.notEqual(first.items[0].id,next.items[0].id);
    const {createCitizenSession}=await import('../api/dist/citizen-auth.js');
    const other=await browser.newContext();
    await other.addCookies([{name:'cskv_citizen_session',value:createCitizenSession('e2e-other-notifications',credentials.API_CITIZEN_SESSION_SECRET||credentials.API_OFFICER_SESSION_SECRET),url:BASE,httpOnly:true,sameSite:'Lax'}]);
    const foreign=await api(other,'/v1/citizen/notifications');
    assert.equal(foreign.items.length,0);
    assert.equal((await api(other,'/v1/citizen/notifications/read',{ids:[first.items[0].id]})).updated,0);
    assert(!(JSON.stringify(await api(context,'/v1/citizen/notifications'))).includes('INTERNAL_NOTIFICATION_SECRET'));
    await context.request.post(BASE+'api/v1/auth/citizen/logout');
    await citizen.locator('.citizen-notification-bell').click();
    await citizen.locator('.citizen-notification-login').waitFor();
    assert.equal(await citizen.locator('.citizen-notification-item').count(),0,'Expired session clears private inbox');
    await citizen.locator('.citizen-notification-login').click();
    await citizen.locator('.citizen-auth-sheet input[name="username"]').waitFor();
    await citizen.getByRole('button',{name:'Đóng đăng nhập'}).click();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,automaticDelivery:true,privateNotesHidden:true,incidentDeepLink:true,sosDeepLink:true,readPersisted:true,officerMessage:true,viewports:5,foreignAccessBlocked:true}));
  } catch(error) {
    if(citizen) await citizen.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});
    throw error;
  } finally { await browser.close(); await cleanup(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
