"""Local production-build UI tests; provider responses are mocked, no paid calls.

Run with an isolated fixture API on 3001 and Vite preview on 4173.
No production writes, incidents or SOS. Actual map network/worker remain enabled.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('QA_PREVIEW_URL', 'http://127.0.0.1:4173')
assert urlsplit(BASE).hostname in ('localhost', '127.0.0.1'), 'Loopback only'
OUT = Path(__file__).resolve().parents[1] / 'test-results' / 'map-assistant'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        request = pw.request.new_context(base_url=BASE)
        assert request.get('/api/health').json()['dataSource'] == 'fixture', 'Isolated fixture API required'
        area = request.get('/api/v1/lookup/by-code/DEMO-DA-LAT').json()['data']
        canonical_answer = {
            'message': 'Kết quả kiểm thử từ dữ liệu công khai của hệ thống.',
            'intent': 'directory', 'needsClarification': False,
            'areas': [{key: area[key] for key in ('code', 'name', 'population', 'areaKm2', 'directory')} |
                      {'station': area['station'], 'alerts': []}],
            'hotlines': [],
            'meta': {'provider': 'OpenAI', 'dataSource': 'fixture', 'retrievedAt': '2026-10-22T00:00:00Z', 'emergencyDispatchConnected': False},
        }
        # Reuse an installed local Chromium when the current Playwright revision is not downloaded.
        launch = {'headless': True}
        executable = os.environ.get('QA_CHROMIUM_EXECUTABLE')
        if executable:
            launch['executable_path'] = executable
        browser = pw.chromium.launch(**launch)
        results = []
        for width, height in [(375, 812), (320, 740), (844, 390), (1440, 900)]:
            context = browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce')
            context.add_init_script("localStorage.setItem('cskv-citizen-tour-v1', 'done')")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            tile_requests = []
            page.on('response', lambda response: tile_requests.append(response.url) if response.status == 200 and ('.pbf' in response.url or '/planet/' in response.url) else None)
            page.goto(BASE)
            page.wait_for_load_state('networkidle')
            page.locator('.login-role-card.citizen').click()
            expect(page.locator('.maplibregl-canvas')).to_have_count(1)
            page.wait_for_function("document.querySelector('[data-map-loaded=\"true\"]') !== null", timeout=45000)
            expect(page.locator('.map-canvas')).to_have_attribute('data-overview-count', '1', timeout=30000)
            page.evaluate("window.qaMapCanvas = document.querySelector('.maplibregl-canvas')")
            expect(page.locator('.province-navigation select')).to_contain_text('1 xã/phường')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Map has horizontal overflow'

            page.get_by_role('button', name='Trợ lý bản đồ', exact=True).click()
            assert page.evaluate("window.qaMapCanvas === document.querySelector('.maplibregl-canvas')"), 'Opening AI must not recreate the map'
            expect(page.locator('.map-canvas')).to_have_attribute('data-overview-count', '1')
            expect(page.get_by_label('Câu hỏi của bạn', exact=True)).to_be_enabled()
            page.get_by_role('button', name='Đóng trợ lý bản đồ').click()
            expect(page.get_by_role('button', name='Trợ lý bản đồ', exact=True)).to_be_focused()

            def mock_status(route):
                route.fulfill(json={'data': {'configured': True, 'provider': 'OpenAI', 'emergencyDispatchConnected': False}})
            context.route('**/api/v1/assistant/status', mock_status)
            mode = {'value': 'success'}
            seen_questions = []

            def mock_query(route):
                seen_questions.append(route.request.post_data_json)
                if mode['value'] == 'error':
                    route.fulfill(status=503, json={'error': 'AI_PROVIDER_UNAVAILABLE', 'message': 'Chưa thể kết nối trợ lý AI.'})
                elif mode['value'] == 'limit':
                    route.fulfill(status=429, json={'error': 'AI_RATE_LIMITED', 'message': 'Trợ lý đã đạt giới hạn tra cứu.'})
                else:
                    route.fulfill(json={'data': canonical_answer})
            context.route('**/api/v1/assistant/query', mock_query)

            page.get_by_role('button', name='Trợ lý bản đồ', exact=True).click()
            field = page.get_by_label('Câu hỏi của bạn', exact=True)
            expect(field).to_be_enabled()
            expect(page.locator('.maplibregl-canvas')).to_have_count(1)
            field.fill('Cho tôi số liên hệ Xuân Hương')
            page.get_by_role('button', name='Gửi câu hỏi', exact=True).click()
            expect(page.locator('.map-assistant-turn')).to_have_count(1)
            expect(page.locator('.map-assistant-turn')).to_contain_text(area['name'])
            expect(page.locator('.map-assistant-turn')).to_contain_text('Dữ liệu kiểm thử')
            expect(page.locator('.map-assistant-compose')).to_contain_text('gửi tới OpenAI')
            assert seen_questions[0]['areaCode'] is None
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Assistant has horizontal overflow'
            panel_box = page.locator('.map-assistant').bounding_box()
            assert panel_box and panel_box['x'] >= 0 and panel_box['x'] + panel_box['width'] <= width + 1
            page.screenshot(path=str(OUT / f'{width}x{height}-result.png'))
            assert page.locator('.map-assistant-header').bounding_box()['width'] >= panel_box['width'] - 2, 'Assistant header must fill the sheet'

            page.get_by_role('button', name='Xem trên bản đồ', exact=True).click()
            expect(page.locator('.map-assistant')).to_have_count(0)
            expect(page.locator('.search-field input')).to_have_value(area['name'])
            expect(page).to_have_url(f'{BASE}/?area={area["code"]}')
            expect(page.locator('.app-shell')).to_have_attribute('data-mobile-view', 'map')
            expect(page.locator('.maplibregl-canvas')).to_have_count(1)
            assert page.evaluate("window.qaMapCanvas === document.querySelector('.maplibregl-canvas')"), 'Selecting an AI result must preserve the map canvas'

            # Current-area context, provider failure and retry keep the user's question.
            page.get_by_role('button', name='Trợ lý bản đồ', exact=True).click()
            field = page.get_by_label('Câu hỏi của bạn', exact=True)
            expect(field).to_be_enabled()
            mode['value'] = 'error'
            field.fill('Cho tôi số liên hệ ở đây')
            page.get_by_role('button', name='Gửi câu hỏi', exact=True).click()
            expect(page.locator('.map-assistant-error')).to_contain_text('Chưa thể kết nối')
            expect(field).to_have_value('Cho tôi số liên hệ ở đây')
            assert seen_questions[-1]['areaCode'] == area['code']
            mode['value'] = 'limit'
            page.get_by_role('button', name='Gửi câu hỏi', exact=True).click()
            expect(page.locator('.map-assistant-error')).to_contain_text('giới hạn')
            field.press('Escape')
            expect(page.locator('.map-assistant')).to_have_count(0)

            page.get_by_role('button', name='Trợ lý bản đồ', exact=True).click()
            expect(page.get_by_role('heading', name='Trợ lý bản đồ', exact=True)).to_be_visible()
            page.get_by_role('button', name='Mở tùy chọn hiển thị bản đồ').click()
            expect(page.locator('.map-assistant')).to_have_count(0)
            expect(page.locator('#map-tool-menu')).to_be_visible()
            assert not errors, errors
            assert tile_requests, 'No actual map tiles loaded'
            results.append({'viewport': [width, height], 'pageErrors': errors, 'tileResponses': len(tile_requests), 'ai': 'mocked', 'unconfiguredState': 'real API'})
            context.close()
        browser.close()
        request.dispose()
    (OUT / 'result.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
