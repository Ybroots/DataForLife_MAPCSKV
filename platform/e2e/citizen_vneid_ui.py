from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5173/"
ARTIFACTS = Path(__file__).parent / "artifacts"


def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            geolocation={"latitude": 11.944, "longitude": 108.441},
            permissions=["geolocation"],
        )
        page = context.new_page()
        created_sos_requests = []
        failed_map_requests = []
        browser_errors = []
        page.on("requestfailed", lambda request: failed_map_requests.append(f"{request.url}: {request.failure}"))
        page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        page.on(
            "request",
            lambda request: created_sos_requests.append(request.url)
            if request.method == "POST" and request.url.endswith("/v1/citizen/sos")
            else None,
        )

        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        vneid_button = page.get_by_role("button", name="Đăng nhập hoặc đăng ký")
        assert vneid_button.is_enabled(), "Nút tài khoản người dân phải thao tác được"
        vneid_button.click()
        page.screenshot(path=str(ARTIFACTS / "citizen-vneid-entry-mobile.png"), full_page=True)
        page.get_by_label("Số điện thoại").fill("0912345678")
        page.get_by_label("Mật khẩu", exact=True).fill("VNeID@2026")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        page.wait_for_selector(".app-shell")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector('button[title="Trợ lý ảo"]', timeout=15_000)

        assert page.locator(".map-sos-button").is_visible(), "SOS phải là nút nổi riêng trên bản đồ"
        assert page.get_by_title("Trợ lý ảo").is_visible(), "Chatbot phải nổi riêng trên bản đồ"
        officer_markers = page.locator(".cskv-demo-marker")
        assert officer_markers.count() == 5, "Bản đồ Xuân Hương phải hiện đủ 5 điểm CSKV minh họa"
        assert all(
            position == "absolute"
            for position in officer_markers.evaluate_all(
                "elements => elements.map(element => getComputedStyle(element).position)"
            )
        ), "Marker CSKV phải giữ hệ tọa độ tuyệt đối của MapLibre"
        assert "API KEY REQUIRED" not in page.locator("body").inner_text(), "Bản đồ không được hiện cảnh báo API key"
        assert not [url for url in failed_map_requests if "openfreemap" in url], failed_map_requests
        assert not [error for error in browser_errors if "source layer" in error.lower() or "openfreemap" in error.lower()], browser_errors
        assert page.locator(".mobile-tabs button").count() == 3, "SOS không được nằm lẫn trong thanh điều hướng"
        page.screenshot(path=str(ARTIFACTS / "citizen-map-actions-mobile.png"), full_page=True)

        page.locator(".map-sos-button").click()
        page.wait_for_url("**feature=sos")
        assert not created_sos_requests, "Mở SOS không được tự động gửi yêu cầu"
        assert page.locator(".map-sos-button").count() == 0, "Nút SOS chỉ được hiện trên bản đồ chính"
        assert page.locator(".workflow-map-canvas").count() == 0, "Trang SOS không được tải bản đồ tương tác"
        assert page.locator(".sos-current-location").is_visible(), "Trang SOS phải hiện vị trí GPS hiện tại"
        assert page.locator(".sos-hold-button").is_visible(), "SOS phải dùng nút tròn nhấn giữ 3 giây"
        page.locator(".sos-hold-button").dispatch_event("pointerdown", {"pointerId": 1, "pointerType": "touch", "button": 0})
        page.wait_for_timeout(650)
        page.locator(".sos-hold-button").dispatch_event("pointerup", {"pointerId": 1, "pointerType": "touch", "button": 0})
        assert not created_sos_requests, "Thả trước 3 giây không được gửi SOS"
        page.locator(".feature-workspace").evaluate("(element) => { element.scrollTop = 0 }")
        page.wait_for_timeout(180)
        page.screenshot(path=str(ARTIFACTS / "citizen-sos-hold-mobile.png"), full_page=True)
        page.route("**/v1/citizen/sos", lambda route: route.abort())
        page.locator(".sos-hold-button").hover()
        page.mouse.down()
        page.wait_for_timeout(3_250)
        page.mouse.up()
        assert len(created_sos_requests) == 1, "Giữ đủ 3 giây phải gửi đúng một yêu cầu SOS"
        page.unroute("**/v1/citizen/sos")

        anonymous_context = browser.new_context(viewport={"width": 390, "height": 844})
        anonymous_page = anonymous_context.new_page()
        anonymous_page.goto(f"{BASE_URL}?feature=sos")
        anonymous_page.wait_for_load_state("networkidle")
        anonymous_page.get_by_role("button", name="Người dân").click()
        assert anonymous_page.locator(".workflow-map-canvas").count() == 0
        assert anonymous_page.locator(".sos-current-location").count() == 0
        assert anonymous_page.locator(".sos-hold-button").count() == 0
        assert anonymous_page.locator(".citizen-feature-auth-gate").is_visible()
        anonymous_page.locator(".citizen-feature-auth-gate").get_by_role("button", name="Đăng nhập hoặc đăng ký").click()
        assert anonymous_page.locator(".citizen-auth-sheet").is_visible(), "Nút tài khoản phải mở biểu mẫu đăng nhập"
        assert anonymous_page.get_by_label("Số điện thoại", exact=True).is_visible()
        anonymous_page.screenshot(path=str(ARTIFACTS / "citizen-vneid-gate-mobile.png"), full_page=True)

        public_context = browser.new_context(viewport={"width": 390, "height": 844})
        public_page = public_context.new_page()
        public_page.goto(BASE_URL)
        public_page.wait_for_load_state("networkidle")
        public_page.get_by_role("button", name="Người dân").click()
        public_page.wait_for_selector(".app-shell")
        public_page.wait_for_selector(".map-sos-button", timeout=15_000)
        assert public_page.locator(".map-canvas").is_visible(), "Người dân chưa đăng nhập vẫn phải xem được bản đồ"
        assert public_page.locator(".map-sos-button").is_visible(), "SOS phải hiện trên bản đồ công khai"
        public_page.get_by_role("button", name="Đăng nhập hoặc đăng ký tài khoản người dân").click()
        assert public_page.get_by_label("Số điện thoại", exact=True).is_visible()

        report_context = browser.new_context(viewport={"width": 375, "height": 667})
        report_page = report_context.new_page()
        report_page.goto(f"{BASE_URL}?feature=reports")
        report_page.wait_for_load_state("networkidle")
        report_page.get_by_role("button", name="Người dân").click()
        assert report_page.locator(".workflow-map-canvas").count() == 0, "Chưa đăng nhập không được dựng bản đồ biểu mẫu"
        assert report_page.locator(".citizen-feature-auth-gate").is_visible(), "Phản ánh phải yêu cầu tài khoản trước khi hiện biểu mẫu"
        assert report_page.locator(".map-sos-button").count() == 0, "SOS không được lặp lại ngoài bản đồ chính"
        assert report_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Trang phản ánh không được tràn ngang trên mobile"
        report_page.screenshot(path=str(ARTIFACTS / "citizen-report-public-mobile.png"), full_page=True)

        landscape_context = browser.new_context(viewport={"width": 844, "height": 390}, reduced_motion="reduce")
        landscape_page = landscape_context.new_page()
        landscape_page.goto(f"{BASE_URL}?feature=sos")
        landscape_page.wait_for_load_state("networkidle")
        landscape_page.get_by_role("button", name="Người dân").click()
        assert landscape_page.locator(".citizen-feature-auth-gate").is_visible()
        assert landscape_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "SOS không được tràn ngang ở chế độ landscape"
        landscape_page.evaluate("document.body.style.zoom = '1.15'")
        assert landscape_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "SOS không tràn ngang khi tăng cỡ hiển thị"
        landscape_page.screenshot(path=str(ARTIFACTS / "citizen-sos-landscape-reduced-motion.png"), full_page=True)

        small_phone_context = browser.new_context(viewport={"width": 320, "height": 568})
        small_phone_page = small_phone_context.new_page()
        small_phone_page.goto(f"{BASE_URL}?feature=sos")
        small_phone_page.wait_for_load_state("networkidle")
        small_phone_page.get_by_role("button", name="Người dân").click()
        assert small_phone_page.locator(".citizen-feature-auth-gate").is_visible()
        assert small_phone_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "SOS không được tràn ngang ở 320 px"
        small_phone_page.screenshot(path=str(ARTIFACTS / "citizen-sos-small-phone.png"), full_page=True)

        small_phone_context.close()
        landscape_context.close()
        report_context.close()
        public_context.close()
        anonymous_context.close()
        context.close()
        browser.close()
        print("citizen-vneid-ui-ok")


if __name__ == "__main__":
    main()
