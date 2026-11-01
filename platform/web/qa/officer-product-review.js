// Run after local officer login, with at least one fixture case in the queue.
// playwright-cli -s=design-officer run-code --filename=platform/web/qa/officer-product-review.js
async page => {
  const {origin, hostname} = await page.evaluate(() => ({origin: location.origin, hostname: location.hostname}));
  if (!['127.0.0.1','localhost'].includes(hostname)) throw new Error('Local fixture only');
  const checks = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const [width,height] of [[320,568],[375,812],[768,1024],[1024,768],[1440,900],[812,375]]) {
    await page.setViewportSize({width,height});
    for (const pane of ['queue','detail','operations']) {
      await page.goto(`${origin}/?portal=police&pane=${pane}`);
      await page.locator('.police-portal').waitFor();
      await page.locator('.queue-card').first().waitFor({state:'attached'});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`${pane} overflow at ${width}x${height}`);
      if (pane === 'detail') {
        await page.locator('.case-hero').waitFor();
        if (!await page.locator('.case-action-card').isVisible()) throw new Error('Case action form missing');
      }
      checks.push(`${pane} ${width}x${height}: pass`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {checks,pageErrors:errors};
}
