"""Read-only live-site smoke test for bandosocskv.com using Playwright.

No production writes. Checks branding, map loading, directory, responsive
viewports, API health, SEO tags, navigation, and captures screenshots.
"""
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect, TimeoutError as PwTimeout

ROOT = Path(__file__).resolve().parents[3]
TARGET = os.environ.get('QA_LIVE_URL', 'https://bandosocskv.com')
OUTPUT = ROOT / 'tmp' / 'live-site-review'
SIZES = {
    'phone': (375, 812),
    'tablet': (768, 1024),
    'desktop': (1440, 900),
    'landscape': (812, 375),
}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks = []
    warnings = []
    page_errors = []
    console_errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # ── 1. API Health ──
        print('─── 1. API Health ───', flush=True)
        api = pw.request.new_context(base_url=TARGET)
        try:
            health_resp = api.get('/api/health')
            if health_resp.ok:
                health = health_resp.json()
                checks.append(f'API health: HTTP {health_resp.status}, dataSource={health.get("dataSource","?")}')
                print(f'  PASS  /api/health → {health}', flush=True)
            else:
                warnings.append(f'API health returned HTTP {health_resp.status}')
                print(f'  WARN  /api/health → HTTP {health_resp.status}', flush=True)
        except Exception as exc:
            warnings.append(f'API health unreachable: {exc}')
            print(f'  WARN  /api/health unreachable: {exc}', flush=True)

        # ── 2. API overview (124 boundaries) ──
        print('─── 2. Area Overview ───', flush=True)
        try:
            overview_resp = api.get('/api/v1/areas/overview')
            if overview_resp.ok:
                overview = overview_resp.json()
                features = overview.get('data', {}).get('features', [])
                count = len(features)
                if count == 124:
                    checks.append(f'Area overview: {count} boundaries ✓')
                    print(f'  PASS  {count}/124 boundaries', flush=True)
                else:
                    warnings.append(f'Area overview: expected 124, got {count}')
                    print(f'  WARN  {count}/124 boundaries', flush=True)
            else:
                warnings.append(f'Area overview HTTP {overview_resp.status}')
                print(f'  WARN  /api/v1/areas/overview → HTTP {overview_resp.status}', flush=True)
        except Exception as exc:
            warnings.append(f'Area overview error: {exc}')
            print(f'  WARN  overview error: {exc}', flush=True)

        # ── 3. Hotlines ──
        print('─── 3. Hotlines ───', flush=True)
        try:
            hotline_resp = api.get('/api/v1/hotlines')
            if hotline_resp.ok:
                hotlines = hotline_resp.json().get('data', [])
                checks.append(f'Hotlines: {len(hotlines)} entries')
                print(f'  PASS  {len(hotlines)} hotlines', flush=True)
            else:
                warnings.append(f'Hotlines HTTP {hotline_resp.status}')
        except Exception as exc:
            warnings.append(f'Hotlines error: {exc}')

        # ── 4. Search API ──
        print('─── 4. Search API ───', flush=True)
        try:
            search_resp = api.get('/api/v1/areas', params={'query': 'Đà Lạt'})
            if search_resp.ok:
                results = search_resp.json().get('data', [])
                checks.append(f'Search "Đà Lạt": {len(results)} results')
                print(f'  PASS  search returned {len(results)} results', flush=True)
            else:
                warnings.append(f'Search HTTP {search_resp.status}')
        except Exception as exc:
            warnings.append(f'Search error: {exc}')

        api.dispose()

        # ── 5. Browser Tests ──
        print('─── 5. Browser Loading ───', flush=True)
        context = browser.new_context(
            reduced_motion='reduce',
            locale='vi-VN',
        )
        context.set_default_timeout(30000)
        page = context.new_page()
        page.on('pageerror', lambda err: page_errors.append(str(err)))
        page.on('console', lambda msg: console_errors.append(f'[{msg.type}] {msg.text}') if msg.type in ('error', 'warning') else None)

        # Track network responses for map resources
        map_responses = []
        page.on('response', lambda resp: map_responses.append({
            'url': resp.url, 'status': resp.status,
            'type': resp.headers.get('content-type', '')
        }) if any(k in resp.url for k in ['maplibre', '.pbf', 'tile', 'maptiler', 'sprite', 'glyphs']) else None)

        # ── 5a. Homepage load ──
        try:
            response = page.goto(TARGET, wait_until='domcontentloaded')
            checks.append(f'Homepage load: HTTP {response.status if response else "?"}')
            print(f'  PASS  Homepage → HTTP {response.status if response else "?"}', flush=True)
        except Exception as exc:
            warnings.append(f'Homepage load failed: {exc}')
            print(f'  FAIL  Homepage load: {exc}', flush=True)
            page.screenshot(path=OUTPUT / 'homepage-fail.png')
            context.close()
            browser.close()
            _report(checks, warnings, page_errors, console_errors)
            return

        page.screenshot(path=OUTPUT / 'landing-page.png')

        # ── 5b. SEO / meta tags ──
        print('─── 6. SEO Meta Tags ───', flush=True)
        title = page.title()
        meta_desc = page.locator('meta[name="description"]').get_attribute('content') if page.locator('meta[name="description"]').count() > 0 else None
        meta_viewport = page.locator('meta[name="viewport"]').get_attribute('content') if page.locator('meta[name="viewport"]').count() > 0 else None
        charset = page.locator('meta[charset]').count() > 0
        checks.append(f'Title: "{title}"')
        if meta_desc:
            checks.append(f'Meta description present ({len(meta_desc)} chars)')
        else:
            warnings.append('Missing meta description')
        if meta_viewport:
            checks.append(f'Viewport meta: {meta_viewport}')
        else:
            warnings.append('Missing viewport meta')
        if charset:
            checks.append('charset meta present')
        print(f'  Title: {title}', flush=True)
        print(f'  Description: {meta_desc}', flush=True)

        # ── 5c. Login / landing screen ──
        print('─── 7. Landing Screen ───', flush=True)
        citizen_btn = page.locator('.login-role-card.citizen')
        try:
            citizen_btn.wait_for(timeout=15000)
            checks.append('Landing screen: citizen entry visible')
            print('  PASS  Citizen entry button found', flush=True)
            citizen_btn.click()
        except PwTimeout:
            # Maybe already in citizen view (session restored)
            warnings.append('Citizen entry button not found; may already be in app')
            print('  WARN  No landing screen; might be already authenticated', flush=True)

        page.screenshot(path=OUTPUT / 'after-citizen-entry.png')

        # ── 5d. App shell ──
        print('─── 8. App Shell ───', flush=True)
        try:
            page.locator('.app-shell').wait_for(timeout=15000)
            checks.append('App shell rendered')
            print('  PASS  .app-shell visible', flush=True)
        except PwTimeout:
            warnings.append('App shell not found within timeout')
            print('  WARN  .app-shell not found', flush=True)

        # ── 5e. Branding ──
        print('─── 9. Branding ───', flush=True)
        try:
            topbar = page.locator('.topbar')
            expect(topbar).to_be_visible(timeout=10000)
            bg_color = topbar.evaluate('(el) => getComputedStyle(el).backgroundColor')
            brand_text = page.locator('.brand-copy strong').inner_text()
            checks.append(f'Topbar background: {bg_color}')
            checks.append(f'Brand title: "{brand_text}"')
            if bg_color == 'rgb(215, 25, 53)':
                print(f'  PASS  Red header: {bg_color}', flush=True)
            else:
                warnings.append(f'Header color is {bg_color}, expected rgb(215, 25, 53)')
                print(f'  WARN  Header color: {bg_color}', flush=True)
        except Exception as exc:
            warnings.append(f'Branding check failed: {exc}')
            print(f'  WARN  Branding: {exc}', flush=True)

        # ── 5f. Map loading ──
        print('─── 10. Map Loading ───', flush=True)

        # Skip tour if it auto-opened
        skip_btn = page.get_by_role('button', name='Bỏ qua hướng dẫn', exact=True)
        try:
            if skip_btn.is_visible():
                skip_btn.click()
                print('  INFO  Skipped onboarding tour', flush=True)
        except:
            pass

        try:
            map_el = page.locator('.map-canvas[data-map-loaded="true"]')
            map_el.wait_for(timeout=45000)
            overview_count = map_el.get_attribute('data-overview-count')
            checks.append(f'Map loaded, overview-count={overview_count}')
            print(f'  PASS  Map loaded, overview-count={overview_count}', flush=True)
        except PwTimeout:
            warnings.append('Map did not report data-map-loaded="true" within 45s')
            print('  WARN  Map did not fully load within timeout', flush=True)

        page.screenshot(path=OUTPUT / 'map-loaded.png')

        # Check map worker & vector tiles
        worker_ok = any(r['url'] and 'maplibre' in r['url'] and 'worker' in r['url'] and r['status'] == 200 for r in map_responses)
        tile_ok = any('.pbf' in r['url'] and r['status'] == 200 for r in map_responses)
        if worker_ok:
            checks.append('MapLibre worker loaded (JS)')
            print('  PASS  MapLibre worker response', flush=True)
        else:
            warnings.append('MapLibre worker not detected')
            print('  WARN  No MapLibre worker response', flush=True)
        if tile_ok:
            tile_count = sum(1 for r in map_responses if '.pbf' in r['url'] and r['status'] == 200)
            checks.append(f'Vector tiles loaded: {tile_count} responses')
            print(f'  PASS  {tile_count} vector tile responses', flush=True)
        else:
            warnings.append('No vector tiles (.pbf) received')
            print('  WARN  No vector tiles received', flush=True)

        # ── 5g. Horizontal overflow ──
        overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
        if not overflow:
            checks.append('No horizontal overflow (desktop)')
            print('  PASS  No horizontal overflow', flush=True)
        else:
            warnings.append('Horizontal overflow detected on desktop')
            print('  WARN  Horizontal overflow!', flush=True)

        # ── 5h. Directory panel ──
        print('─── 11. Directory Panel ───', flush=True)
        try:
            dir_toggle = page.get_by_role('button', name='Mở danh bạ địa bàn', exact=True)
            dir_toggle.click()
            expect(page.locator('#directory-results')).to_be_visible(timeout=5000)
            checks.append('Directory panel opens')
            print('  PASS  Directory opens', flush=True)

            collapse = page.get_by_role('button', name='Thu gọn danh bạ', exact=True).first
            collapse.click()
            expect(page.locator('#directory-results')).not_to_be_visible()
            checks.append('Directory panel collapses')
            print('  PASS  Directory collapses', flush=True)
        except Exception as exc:
            warnings.append(f'Directory toggle failed: {exc}')
            print(f'  WARN  Directory: {exc}', flush=True)

        # ── 5i. Province selector ──
        print('─── 12. Province Selector ───', flush=True)
        try:
            selector = page.locator('select[aria-label="Chọn xã/phường"]')
            if selector.count() > 0:
                options = selector.locator('option').count()
                checks.append(f'Province selector: {options} options')
                print(f'  PASS  Province selector has {options} options', flush=True)
        except Exception as exc:
            warnings.append(f'Province selector: {exc}')

        # ── 5j. SOS feature ──
        print('─── 13. SOS Feature ───', flush=True)
        try:
            page.goto(f'{TARGET}/?feature=sos', wait_until='domcontentloaded')
            citizen_btn2 = page.locator('.login-role-card.citizen')
            if citizen_btn2.count() > 0 and citizen_btn2.is_visible():
                citizen_btn2.click()
            page.locator('.app-shell').wait_for(timeout=15000)
            sos_screen = page.locator('.sos-emergency-screen, .citizen-feature-auth-gate')
            sos_screen.wait_for(timeout=10000)
            checks.append('SOS feature page loads')
            print('  PASS  SOS screen visible', flush=True)
            page.screenshot(path=OUTPUT / 'sos-screen.png')
        except PwTimeout:
            warnings.append('SOS feature page did not load')
            print('  WARN  SOS screen timeout', flush=True)

        # ── 5k. Reports feature ──
        print('─── 14. Reports Feature ───', flush=True)
        try:
            page.goto(f'{TARGET}/?feature=reports', wait_until='domcontentloaded')
            citizen_btn3 = page.locator('.login-role-card.citizen')
            if citizen_btn3.count() > 0 and citizen_btn3.is_visible():
                citizen_btn3.click()
            page.locator('.app-shell').wait_for(timeout=15000)
            report_screen = page.locator('.citizen-workflow, .citizen-feature-auth-gate')
            report_screen.wait_for(timeout=10000)
            checks.append('Reports feature page loads')
            print('  PASS  Reports screen visible', flush=True)
            page.screenshot(path=OUTPUT / 'reports-screen.png')
        except PwTimeout:
            warnings.append('Reports feature page did not load')
            print('  WARN  Reports screen timeout', flush=True)

        # ── 5l. Account feature ──
        print('─── 15. Account Feature ───', flush=True)
        try:
            page.goto(f'{TARGET}/?feature=account', wait_until='domcontentloaded')
            citizen_btn4 = page.locator('.login-role-card.citizen')
            if citizen_btn4.count() > 0 and citizen_btn4.is_visible():
                citizen_btn4.click()
            page.locator('.app-shell').wait_for(timeout=15000)
            page.locator('.citizen-account-page').wait_for(timeout=10000)
            checks.append('Account page loads')
            print('  PASS  Account page visible', flush=True)
            page.screenshot(path=OUTPUT / 'account-screen.png')
        except PwTimeout:
            warnings.append('Account page did not load')
            print('  WARN  Account page timeout', flush=True)

        # ── 5m. Police portal gate ──
        print('─── 16. Police Portal ───', flush=True)
        try:
            page.goto(f'{TARGET}/?portal=police', wait_until='domcontentloaded')
            # Should show login or police portal
            police_login = page.locator('.police-login-screen, .police-portal')
            police_login.wait_for(timeout=15000)
            checks.append('Police portal gate loads')
            print('  PASS  Police portal / login visible', flush=True)
            page.screenshot(path=OUTPUT / 'police-portal.png')
        except PwTimeout:
            warnings.append('Police portal page did not load')
            print('  WARN  Police portal timeout', flush=True)

        # ── 6. Responsive Viewports ──
        print('─── 17. Responsive Viewports ───', flush=True)
        page.goto(TARGET, wait_until='domcontentloaded')
        citizen_btn5 = page.locator('.login-role-card.citizen')
        try:
            if citizen_btn5.count() > 0 and citizen_btn5.is_visible():
                citizen_btn5.click()
        except:
            pass

        for label, (width, height) in SIZES.items():
            page.set_viewport_size({'width': width, 'height': height})
            page.goto(TARGET, wait_until='domcontentloaded')
            try:
                citizen_btn6 = page.locator('.login-role-card.citizen')
                if citizen_btn6.count() > 0 and citizen_btn6.is_visible():
                    citizen_btn6.click()
            except:
                pass
            try:
                page.locator('.app-shell, .login-screen').wait_for(timeout=15000)
            except:
                pass
            overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
            if not overflow:
                checks.append(f'No overflow at {label} ({width}x{height})')
            else:
                warnings.append(f'Horizontal overflow at {label} ({width}x{height})')
                print(f'  WARN  Overflow at {label}', flush=True)
            page.screenshot(path=OUTPUT / f'viewport-{label}-{width}x{height}.png')
            print(f'  PASS  Screenshot {label} {width}x{height}', flush=True)

        # ── 7. HTTPS / Certificate ──
        print('─── 18. HTTPS Check ───', flush=True)
        is_https = TARGET.startswith('https://')
        if is_https:
            checks.append('Site uses HTTPS')
            is_secure = page.evaluate('isSecureContext')
            if is_secure:
                checks.append('Browser reports isSecureContext=true')
                print('  PASS  Secure context', flush=True)
            else:
                warnings.append('isSecureContext is false despite HTTPS URL')
                print('  WARN  isSecureContext=false', flush=True)
        else:
            warnings.append(f'Site is HTTP, not HTTPS: {TARGET}')
            print(f'  WARN  HTTP only: {TARGET}', flush=True)

        context.close()
        browser.close()

    _report(checks, warnings, page_errors, console_errors)


def _report(checks, warnings, page_errors, console_errors):
    report = {
        'target': TARGET,
        'checksCount': len(checks),
        'checks': checks,
        'warningsCount': len(warnings),
        'warnings': warnings,
        'pageErrorsCount': len(page_errors),
        'pageErrors': page_errors[:20],
        'consoleErrorsCount': len(console_errors),
        'consoleErrors': console_errors[:30],
    }

    report_path = OUTPUT / 'report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    print('\n' + '═' * 60, flush=True)
    print(f'TARGET: {TARGET}', flush=True)
    print(f'CHECKS PASSED: {len(checks)}', flush=True)
    for c in checks:
        print(f'  ✓ {c}', flush=True)
    if warnings:
        print(f'\nWARNINGS: {len(warnings)}', flush=True)
        for w in warnings:
            print(f'  ⚠ {w}', flush=True)
    if page_errors:
        print(f'\nPAGE ERRORS ({len(page_errors)}):', flush=True)
        for e in page_errors[:10]:
            print(f'  ✗ {e}', flush=True)
    if console_errors:
        print(f'\nCONSOLE ERRORS/WARNINGS ({len(console_errors)}):', flush=True)
        for e in console_errors[:15]:
            print(f'  ⚠ {e}', flush=True)
    print('═' * 60, flush=True)
    print(f'Screenshots and report saved to: {OUTPUT}', flush=True)

    if page_errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
