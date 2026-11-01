"""Production-dist regression against LOCAL fixtures, including a real HTTP context.

Requires a fixture API on 3001 and Vite preview on 4173. No production writes.
The reserved .test origin is intercepted and forwarded ONLY to loopback preview;
Chromium therefore disables secure-context APIs just as on the deployed HTTP IP.
"""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
PREVIEW = os.environ.get('QA_PREVIEW_URL', 'http://127.0.0.1:4173')
HTTP = 'http://dataforlife.test'
FEATURES = ['directory', 'reports', 'sos', 'account', 'alerts', 'feedback', 'assistant']
SIZES = [(375, 812), (762, 698), (1440, 900)]
UUID = re.compile(r'^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$')


def credentials():
    values = {}
    for line in (ROOT / 'platform/.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            name, value = line.split('=', 1)
            values[name.strip()] = value.strip().strip('\"\'')
    return values | dict(os.environ)


def local_session(pw, role):
    api = pw.request.new_context(base_url=PREVIEW)
    try:
        assert urlsplit(PREVIEW).hostname in ['127.0.0.1', 'localhost'], 'Loopback preview required'
        health = api.get('/api/health').json()
        assert health['dataSource'] == 'fixture' or health.get('releaseValidation') is True, 'Isolated QA API required; production writes forbidden'
        env = credentials()
        response = api.post(f'/api/v1/auth/{role}/login', data={
            'username': env[f'API_{role.upper()}_USERNAME'],
            'password': env[f'API_{role.upper()}_PASSWORD'],
        })
        assert response.ok, f'Local {role} login failed: {response.status}'
        return api.storage_state()['cookies']
    finally:
        api.dispose()


def context_for(browser, origin, cookies=()):
    state = {'cookies': [dict(cookie, domain=urlsplit(origin).hostname) for cookie in cookies],
             'origins': [{'origin': origin, 'localStorage': [{'name': 'cskv-citizen-tour-v1', 'value': 'done'}]}]}
    context = browser.new_context(storage_state=state, reduced_motion='reduce',
                                  geolocation={'latitude': 11.944, 'longitude': 108.438, 'accuracy': 15})
    context.set_default_timeout(12000)
    if origin == HTTP:
        def forward(route):
            url = urlsplit(route.request.url)
            # The browser sees .test HTTP, but no request goes to that hostname.
            response = route.fetch(url=PREVIEW + url.path + ('?' + url.query if url.query else ''))
            route.fulfill(response=response)
        context.route(HTTP + '/**', forward)
    else:
        context.grant_permissions(['geolocation'])
    return context


def enter(page, origin, feature, role):
    page.goto(f'{origin}/?feature={feature}')
    # External map tiles may keep loading; wait for the application surface,
    # not global network idleness (the map check separately verifies rendering).
    if role == 'guest':
        page.locator('.login-role-card.citizen').click()
    page.locator('.app-shell').wait_for()


def screen(page, feature, role):
    expect(page.locator('.topbar')).to_be_visible()
    expect(page.locator('#screen-error-title')).to_have_count(0)
    if feature == 'directory':
        page.locator('.map-canvas[data-map-loaded="true"][data-overview-count]').wait_for(timeout=35000)
    else:
        expect(page.locator('.feature-page')).to_be_visible()
        selector = {'reports': '.citizen-workflow', 'sos': '.sos-emergency-screen',
                    'account': '.citizen-account-page', 'alerts': '#alerts-title',
                    'feedback': '#feedback-title', 'assistant': '#assistant-title'}[feature]
        if role == 'guest' and feature in ['reports', 'sos']:
            selector = '.citizen-feature-auth-gate'
        expect(page.locator(selector)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{feature}: horizontal overflow'
    assert page.locator('.topbar').evaluate('(el) => getComputedStyle(el).backgroundColor') == 'rgb(215, 25, 53)'


def navigation(page, origin, role):
    page.set_viewport_size({'width': 375, 'height': 812})
    enter(page, origin, 'directory', role)
    screen(page, 'directory', role)
    page.get_by_role('button', name='Mở danh bạ địa bàn', exact=True).click()
    expect(page.locator('#directory-results')).to_be_visible()
    page.get_by_role('button', name='Thu gọn danh bạ', exact=True).first.click()
    expect(page.locator('#directory-results')).not_to_be_visible()
    page.locator('.mobile-tabs').get_by_role('button', name='Phản ánh', exact=True).click()
    screen(page, 'reports', role)
    page.locator('.mobile-tabs').get_by_role('button', name='Tài khoản', exact=True).click()
    screen(page, 'account', role)
    page.locator('.account-actions button').filter(has_text='Đánh giá hài lòng').click()
    screen(page, 'feedback', role)
    for feature in ['alerts', 'assistant', 'reports']:
        page.get_by_role('button', name='Tính năng', exact=True).click()
        page.locator(f'#feature-drawer a[href="?feature={feature}"]').click()
        screen(page, feature, role)
    page.get_by_role('link', name='Về bản đồ', exact=True).click()
    screen(page, 'directory', role)
    page.get_by_role('button', name='Mở quy trình SOS khẩn cấp', exact=True).click()
    screen(page, 'sos', role)
    page.go_back()
    screen(page, 'directory', role)
    page.go_forward()
    screen(page, 'sos', role)


def forms(page, origin, output):
    enter(page, origin, 'reports', 'citizen')
    screen(page, 'reports', 'citizen')
    send = page.get_by_role('button', name='Gửi phản ánh', exact=True)
    expect(send).to_be_disabled()
    page.locator('input[name="summary"]').fill('Kiểm thử local: phản ánh hiện trường')
    page.locator('textarea[name="description"]').fill('Dữ liệu kiểm thử hồi quy local, không phải sự việc thật.')
    page.locator('input[name="evidence"]').set_input_files({
        'name': 'qa-invalid.txt', 'mimeType': 'text/plain', 'buffer': b'not an image'})
    expect(page.get_by_role('alert')).to_contain_text('Chỉ nhận ảnh')
    page.locator('input[name="evidence"]').set_input_files(ROOT / 'assets/images/logo-128.png')
    page.locator('.workflow-map-canvas canvas').click(position={'x': 140, 'y': 100})
    expect(page.locator('.workflow-location.ready')).to_be_visible()
    expect(send).to_be_disabled()
    page.locator('input[name="truthfulnessConsent"]').check()
    with page.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/api/v1/citizen/incidents')) as created:
        send.click()
    assert created.value.ok, 'Local report submission failed'
    first_key = created.value.request.post_data_json['clientRequestId']
    assert UUID.fullmatch(first_key)
    receipt = created.value.json()['data']['receiptCode']
    expect(page.locator('.case-detail-card')).to_contain_text(receipt)
    # Submission success rotates the key; the pre-fix code also crashed here.
    page.get_by_role('tab', name='Tạo phản ánh', exact=True).click()
    expect(page.locator('input[name="summary"]')).to_have_value('')
    screen(page, 'reports', 'citizen')
    page.get_by_role('tab', name=re.compile('Theo dõi')).click()
    expect(page.locator('.case-detail-card')).to_contain_text(receipt)
    page.screenshot(path=output / ('tracking-http.png' if origin == HTTP else 'tracking-secure.png'))

    enter(page, origin, 'sos', 'citizen')
    screen(page, 'sos', 'citizen')
    assert page.locator('a[href^="tel:"]').count() == 0, 'Quick-call UI returned'
    if origin == HTTP:
        expect(page.get_by_role('alert')).to_contain_text('GPS')
        assert not page.locator('.sos-ready-status.ready').count(), 'HTTP falsely reports GPS readiness'
    else:
        expect(page.locator('.sos-ready-status.ready')).to_be_visible()
        sent = []
        page.on('request', lambda r: sent.append(r) if r.method == 'POST' and r.url.endswith('/api/v1/citizen/sos') else None)
        page.locator('.sos-hold-button').focus()
        page.keyboard.press('Space')
        assert not sent, 'A short press must not send SOS'
        with page.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/api/v1/citizen/sos')) as sos:
            page.keyboard.down('Space')
            page.locator('.sos-receipt-card').wait_for()
            page.keyboard.up('Space')
        assert sos.value.ok
        assert UUID.fullmatch(sos.value.request.post_data_json['idempotencyKey'])
        expect(page.locator('.sos-receipt-card')).to_contain_text(sos.value.json()['data']['receiptCode'])
        page.get_by_role('button', name='Tạo một yêu cầu khác', exact=True).click()
        screen(page, 'sos', 'citizen')

    enter(page, origin, 'assistant', 'citizen')
    page.get_by_role('button', name='Cách gửi phản ánh?', exact=True).click()
    page.get_by_role('button', name='Gửi câu hỏi thử nghiệm', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('chưa kết nối')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Optional existing Chromium executable')
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/release-regression')
    parser.add_argument('--reproduce-only', action='store_true', help='Require the original HTTP randomUUID crash')
    parser.add_argument('--flows-only', action='store_true', help='Run navigation/forms without the viewport matrix')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as pw:
        citizen = local_session(pw, 'citizen')
        officer = local_session(pw, 'officer')
        browser = pw.chromium.launch(headless=True, executable_path=args.browser)
        try:
            if args.reproduce_only:
                context = context_for(browser, HTTP, citizen)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(HTTP + '/?feature=reports')
                page.wait_for_load_state('networkidle')
                assert page.evaluate('isSecureContext') is False
                assert any('crypto.randomUUID is not a function' in error for error in errors), errors
                page.screenshot(path=args.output / 'before-blank-http.png')
                print('REPRODUCED: authenticated reports crashes on real HTTP, not localhost', flush=True)
                context.close()
                return
            for origin in [HTTP, PREVIEW]:
                for role, cookies in [('guest', []), ('citizen', citizen)]:
                    context = context_for(browser, origin, cookies)
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    try:
                        for width, height in ([] if args.flows_only else SIZES):
                            page.set_viewport_size({'width': width, 'height': height})
                            for feature in FEATURES:
                                enter(page, origin, feature, role)
                                assert page.evaluate('isSecureContext') == (origin == PREVIEW)
                                screen(page, feature, role)
                                if origin == HTTP:
                                    page.screenshot(path=args.output / f'{role}-{feature}-{width}.png')
                                checks.append(f'{origin} {role} {feature} {width}: pass')
                            print(f'PASS {origin} {role} 7 screens at {width}px', flush=True)
                        navigation(page, origin, role)
                        print(f'PASS {origin} {role} SPA navigation', flush=True)
                        checks.append(f'{origin} {role} SPA navigation + back/forward: pass')
                        if role == 'citizen':
                            forms(page, origin, args.output)
                            print(f'PASS {origin} citizen local forms', flush=True)
                            checks.append(f'{origin} local form workflows: pass')
                        assert not errors, errors
                    except Exception:
                        print(json.dumps({'lastURL': page.url, 'pageErrors': errors}, ensure_ascii=False), flush=True)
                        page.screenshot(path=args.output / 'failure.png')
                        raise
                    finally:
                        context.unroute_all(behavior='wait')
                        context.close()
                context = context_for(browser, origin, officer)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                for width, height in SIZES:
                    page.set_viewport_size({'width': width, 'height': height})
                    for pane in ['queue', 'detail', 'map', 'operations']:
                        page.goto(f'{origin}/?portal=police&pane={pane}')
                        page.wait_for_load_state('networkidle')
                        expect(page.locator('.police-portal')).to_be_visible()
                        expect(page.locator('#screen-error-title')).to_have_count(0)
                        if pane == 'queue':
                            expect(page.locator('.queue-card').first).to_be_visible()
                        elif pane == 'detail':
                            expect(page.locator('.case-hero')).to_be_visible()
                            expect(page.locator('.case-action-card')).to_be_visible()
                        elif pane == 'map':
                            expect(page.locator('.police-duty-map-canvas canvas')).to_be_visible()
                        elif pane == 'operations':
                            for tab in ['Báo cáo', 'Bản đồ', 'Cảnh báo', 'Tuần tra', 'Cuối ca', 'Tích hợp']:
                                page.locator('.operations-tabs').get_by_role('tab', name=tab, exact=True).click()
                                expect(page.locator('.operations-tabs').get_by_role('tab', name=tab, exact=True)).to_have_attribute('aria-selected', 'true')
                                expect(page.locator('.police-operations-pane')).to_be_visible()
                                expect(page.locator('#screen-error-title')).to_have_count(0)
                                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Officer {tab} overflow'
                            if origin == HTTP:
                                page.screenshot(path=args.output / f'officer-{pane}-{width}.png')
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                        checks.append(f'{origin} officer {pane} {width}: pass')
                assert not errors, errors
                print(f'PASS {origin} officer 4 panes + 6 operations tabs at 3 widths', flush=True)
                context.unroute_all(behavior='wait')
                context.close()
            # Missing lazy chunk must show recovery UI, keeping header/navigation.
            context = context_for(browser, HTTP, citizen)
            context.route('**/assets/FeaturePage-*.js', lambda route: route.abort())
            page = context.new_page()
            page.set_viewport_size({'width': 375, 'height': 812})
            enter(page, HTTP, 'directory', 'citizen')
            page.locator('.mobile-tabs').get_by_role('button', name='Phản ánh', exact=True).click()
            expect(page.get_by_role('heading', name='Chưa thể mở tính năng')).to_be_visible()
            expect(page.locator('.topbar')).to_be_visible()
            page.screenshot(path=args.output / 'recovery.png')
            page.locator('.mobile-tabs').get_by_role('button', name='Bản đồ', exact=True).click()
            screen(page, 'directory', 'citizen')
            context.unroute_all(behavior='wait')
            context.close()
            checks.append('Failed lazy chunk: visible recovery and navigation back to map pass')
        finally:
            browser.close()
    print(json.dumps({'checks': checks, 'count': len(checks), 'pageErrors': []}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
