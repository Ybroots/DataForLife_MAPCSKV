// Read-only smoke test against vite preview (4173) or the deployed pilot.
// Pass through Playwright CLI run-code --filename after opening the target origin.
async page => {
  const target = await page.evaluate(() => location.origin);
  if (!['http://127.0.0.1:4173','http://127.0.0.1:4174','http://42.96.15.215','https://42.96.15.215'].includes(target)) throw new Error('Unexpected target');
  const responses = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (/maplibre-gl-worker-|\.pbf(?:\?|$)/.test(response.url())) responses.push({url:response.url(),status:response.status(),type:response.headers()['content-type']});
  });
  await page.setViewportSize({width:1440,height:900});
  await page.reload();
  const citizenEntry = page.getByRole('button',{name:'Người dân Tra cứu địa bàn, gửi phản ánh và cầu cứu khẩn cấp',exact:true});
  if (await citizenEntry.isVisible()) await citizenEntry.click();
  await page.locator('.map-canvas[data-map-loaded="true"][data-overview-count="124"]').waitFor({timeout:45000});
  const skip = page.getByRole('button',{name:'Bỏ qua hướng dẫn',exact:true});
  if(await skip.isVisible()) await skip.click();
  if (!responses.some(r=>r.url.includes('maplibre-gl-worker-') && r.status===200 && /javascript/.test(r.type))) throw new Error('Worker not delivered as JavaScript');
  if (!responses.some(r=>r.url.includes('.pbf') && r.status===200)) throw new Error('No vector tiles received');
  const screens = [];
  for(const [width,height] of [[1440,900],[762,698],[375,812]]) {
    await page.setViewportSize({width,height});
    await page.locator('.map-canvas[data-map-loaded="true"]').waitFor();
    await page.waitForLoadState('networkidle',{timeout:15000});
    const state = await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,header:getComputedStyle(document.querySelector('.topbar')).backgroundColor,title:document.querySelector('.brand-copy strong')?.innerText}));
    if(state.overflow) throw new Error(`Overflow at ${width}`);
    if(state.header!=='rgb(215, 25, 53)') throw new Error('Original red header missing');
    if(!state.title?.trim()) throw new Error(`Header title hidden at ${width}`);
    await page.screenshot({path:`tmp/map-fixed-${target.includes('4173')?'preview':'live'}-${width}.png`,timeout:10000});
    screens.push({width,height,...state});
  }
  await page.getByRole('button',{name:'Mở tùy chọn hiển thị bản đồ',exact:true}).click();
  const zone = page.getByRole('button',{name:'Phường 1',exact:true});
  if(await zone.isVisible()) {
    await zone.click();
    await page.locator('.map-zone-panel').waitFor();
    await page.screenshot({path:'tmp/map-fixed-zone.png',timeout:10000});
    await page.getByRole('button',{name:'Đóng thông tin khu vực',exact:true}).click();
  } else {
    await page.getByRole('button',{name:'Mở tùy chọn hiển thị bản đồ',exact:true}).click();
  }
  if(pageErrors.length) throw new Error(pageErrors.join('\n'));
  return {screens,worker:responses.find(r=>r.url.includes('maplibre-gl-worker-')),vectorTileCount:responses.filter(r=>r.url.includes('.pbf')&&r.status===200).length,pageErrors};
}
