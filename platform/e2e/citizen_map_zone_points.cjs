require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { buildCitizenMapPoints, pointInBoundary, pointsWithinZone } = require('../web/src/citizen-map-points.ts');
const BASE_URL = 'http://127.0.0.1:5173/';
const ARTIFACTS = path.join(__dirname, 'artifacts', 'citizen-map-zone-points');

function checkGeometry(area) {
  const square = [[0,0],[4,0],[4,4],[0,4],[0,0]];
  const hole = [[1,1],[2,1],[2,2],[1,2],[1,1]];
  const boundary = { type:'Polygon', coordinates:[square,hole] };
  assert(pointInBoundary(3,3,boundary));
  assert(!pointInBoundary(1.5,1.5,boundary));
  assert(!pointInBoundary(5,3,boundary));
  assert(pointInBoundary(0,3,boundary));
  assert(pointInBoundary(3,3,{type:'MultiPolygon',coordinates:[[square,hole]]}));
  assert(!pointInBoundary(NaN,3,boundary));
  assert.equal(buildCitizenMapPoints(null).length, 0);
  assert.equal(buildCitizenMapPoints({...area,code:'other-ward'}).length,0);
  const points = buildCitizenMapPoints(area);
  assert.equal(points.filter(p => p.kind === 'station').length,5);
  for (const point of points) {
    const zones = area.serviceAreas.filter(z => pointInBoundary(point.longitude,point.latitude,z.boundary));
    assert.equal(zones.length,1,point.id + ' must lie inside exactly one polygon');
    assert.equal(zones[0].code,point.serviceAreaCode);
    if (point.kind === 'officer') {
      assert.equal(point.latitude,zones[0].center.latitude,'Do not move original CSKV coordinates');
      assert.equal(point.longitude,zones[0].center.longitude);
    }
  }
  return points;
}

async function checkLayout(page,label,selector) {
  const r = await page.evaluate(selector => {
    const panel = document.querySelector(selector)?.getBoundingClientRect();
    const map = document.querySelector('#map-panel').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.map-sos-button,.map-assistant-button,.my-location-button')].map(el => el.getBoundingClientRect());
    return {
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      clipped:!panel || panel.left < map.left-1 || panel.right > map.right+1 || panel.top < map.top-1 || panel.bottom > map.bottom+1,
      covers:panel && controls.some(c => Math.min(panel.right,c.right)>Math.max(panel.left,c.left) && Math.min(panel.bottom,c.bottom)>Math.max(panel.top,c.top)),
    };
  },selector);
  assert.equal(r.overflow,0,label + ': overflow');
  assert(!r.clipped,label + ': clipped panel');
  assert(!r.covers,label + ': panel covers SOS / AI / location');
}

async function selectZone(page,ward) {
  const tool = page.getByRole('button',{name:'Mở tùy chọn hiển thị bản đồ'});
  if (await tool.getAttribute('aria-expanded') !== 'true') await tool.click();
  await page.locator('.service-area-key').getByRole('button',{name:'Phường '+ward+' cũ',exact:true}).click();
  await page.locator('.map-zone-panel').getByText('Khu vực Phường '+ward+' cũ',{exact:true}).waitFor();
}

async function tapPolygon(page,area) {
  // Derive map projection from two visible DOM marker anchors; no app internals or forced clicks.
  await selectZone(page,'3');
  await page.getByRole('button',{name:'Đóng thông tin khu vực'}).click();
  await page.waitForTimeout(350);
  const zone=area.serviceAreas.find(z=>z.legacyWardCode==='3');
  const other=area.serviceAreas.find(z=>z.legacyWardCode==='4');
  const first=await page.locator(`[data-map-point-id="officer:${zone.code}"]`).boundingBox();
  const second=await page.locator(`[data-map-point-id="officer:${other.code}"]`).boundingBox();
  assert(first && second,'Marker anchors must exist');
  const scale=((second.x+second.width/2)-(first.x+first.width/2))/(other.center.longitude-zone.center.longitude);
  const anchor={x:first.x+first.width/2,y:first.y+first.height};
  const mercator=Math.log(Math.tan(Math.PI/4+zone.center.latitude*Math.PI/360));
  let target=null;
  for(const dy of [10,24,-70,45,-100,70]) {
    for(const dx of [0,30,-30,60,-60,90,-90]) {
      const longitude=zone.center.longitude+dx/scale;
      const latitude=(2*Math.atan(Math.exp(mercator-dy/scale*Math.PI/180))-Math.PI/2)*180/Math.PI;
      if(!pointInBoundary(longitude,latitude,zone.boundary)) continue;
      const candidate={x:anchor.x+dx,y:anchor.y+dy};
      if(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',candidate)) {
        target=candidate; break;
      }
    }
    if(target) break;
  }
  assert(target,'A real canvas tap target inside P3 must be reachable');
  if(page.viewportSize().width<1024) await page.touchscreen.tap(target.x,target.y);
  else await page.mouse.click(target.x,target.y);
  await page.locator('.map-zone-panel').getByText('Khu vực Phường 3',{exact:true}).waitFor();
}

async function inspect(browser,viewport,area,points) {
  const label = viewport.width+'x'+viewport.height;
  const context = await browser.newContext({viewport,locale:'vi-VN',reducedMotion:viewport.width===390?'no-preference':'reduce',hasTouch:viewport.width<1024});
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  page.on('console',m => { if(m.type()==='error' && !m.text().includes('401 (Unauthorized)')) errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('cskv-citizen-tour-v1','completed'));
  try {
    await page.goto(BASE_URL,{waitUntil:'networkidle'});
    const entry = page.getByRole('button',{name:/^Người dân/});
    if(await entry.count()) await entry.click();
    await page.waitForSelector('.map-canvas[data-boundary-rendered="24781"]');
    assert.equal(await page.locator('.station-demo-marker').count(),5);
    assert.equal(await page.locator('.cskv-demo-marker').count(),5);

    // Marker click must open exactly one popup without also selecting a coordinate.
    const stationMarker=page.locator('.station-demo-marker').first();
    await stationMarker.click();
    await page.waitForSelector('.station-demo-popup');
    assert.equal(await page.locator('.citizen-point-popup').count(),1);
    await page.getByRole('button',{name:'Đóng thông tin điểm'}).click();
    await tapPolygon(page,area);

    for(const ward of ['1','2','3','4','10']) {
      await selectZone(page,ward);
      const zone = area.serviceAreas.find(z => z.legacyWardCode===ward);
      assert.equal(await page.locator('.map-zone-point-list > button').count(),pointsWithinZone(points,zone).filter(p=>p.kind!=='alert').length);
      assert.equal(await page.locator('.station-demo-marker.in-selected-zone').count(),1);
      assert.equal(await page.locator('.cskv-demo-marker.in-selected-zone').count(),1);
    }
    await selectZone(page,'3');
    await checkLayout(page,label,'.map-zone-panel');
    await page.screenshot({path:path.join(ARTIFACTS,label+'-zone.png')});
    await page.locator('.map-zone-point-list > button').filter({hasText:'Trụ sở / điểm tiếp dân'}).click();
    await page.waitForSelector('.station-demo-popup');
    await page.waitForTimeout(320);
    assert.equal(await page.locator('.citizen-point-popup').count(),1);
    assert((await page.locator('.station-demo-popup').innerText()).includes(area.station.address));
    assert.equal(await page.locator('.station-demo-phone').getAttribute('href'),'tel:02633822260');
    assert.equal(await page.locator('.station-demo-directions').count(),0);
    await checkLayout(page,label,'.citizen-point-popup');
    await page.screenshot({path:path.join(ARTIFACTS,label+'-station.png')});
    await page.getByRole('button',{name:'Đóng thông tin điểm'}).click();
    await page.locator('.map-zone-panel').waitFor();

    const officer = page.locator('.map-zone-point-list > button').filter({hasText:'Cảnh sát khu vực'}).first();
    await officer.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cskv-demo-popup');
    assert.equal(await page.locator('.citizen-point-popup').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.citizen-point-popup').count(),0);

    await page.getByRole('button',{name:'Mở tùy chọn hiển thị bản đồ'}).click();
    await page.locator('input[name="demoOfficersVisible"]').uncheck();
    assert.equal(await page.locator('.station-demo-marker').count(),0);
    assert.equal(await page.locator('.map-zone-point-list > button').count(),0);
    await page.locator('input[name="demoOfficersVisible"]').check();
    await page.locator('input[name="alertsVisible"]').check();
    for(const ward of ['1','2','3','4','10']) {
      await selectZone(page,ward);
      const zone=area.serviceAreas.find(z=>z.legacyWardCode===ward);
      assert.equal(await page.locator('.map-zone-point-list > button').count(),pointsWithinZone(points,zone).length);
    }
    await page.getByRole('button',{name:'Đóng thông tin khu vực'}).click();
    assert.equal(await page.locator('.map-zone-panel').count(),0);
    assert.equal(await page.locator('.in-selected-zone').count(),0);
    assert.equal(await page.locator('.citizen-point-popup').count(),0);
    assert.deepEqual(errors,[],label+': browser errors');
    return {label,zones:5,stations:5,geometry:'passed',mapTap:'passed',popup:'passed',layout:'passed'};
  } catch(error) {
    await page.screenshot({path:path.join(ARTIFACTS,label+'-failure.png')}).catch(()=>{});
    throw error;
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(ARTIFACTS,{recursive:true});
  const response=await fetch('http://127.0.0.1:3001/v1/lookup/by-code/24781');
  assert(response.ok);
  const {data:area}=await response.json();
  const points=checkGeometry(area);
  const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  try {
    const results=[];
    for(const viewport of [{width:375,height:667},{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1440,height:900}]) {
      const result=await inspect(browser,viewport,area,points);
      results.push(result);
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ok:true,geometryPoints:points.length,results}));
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
