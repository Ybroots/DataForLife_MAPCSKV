"""Focused Chromium regression checks for the pre-pilot P0/P1/P2 fixes."""

import base64
from pathlib import Path
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect


BASE_URL = "http://127.0.0.1:5173"
ARTIFACTS = Path(__file__).resolve().parents[1] / "test-results" / "pilot-regression"
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII="
)


def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS: {label}")


def env_value(name: str) -> str:
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError(f"Missing {name}")


ARTIFACTS.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    citizen_context = browser.new_context(
        viewport={"width": 375, "height": 812},
        geolocation={"latitude": 11.944, "longitude": 108.441},
        permissions=["geolocation"],
    )
    citizen = citizen_context.new_page()
    console_errors: list[str] = []
    citizen.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    citizen.goto(BASE_URL, wait_until="networkidle")
    citizen.locator(".login-role-card.citizen").click()
    citizen.get_by_role("button", name="Đăng nhập hoặc đăng ký tài khoản người dân").click()
    citizen.locator('input[name="username"]').fill(env_value("API_CITIZEN_USERNAME"))
    citizen.locator('input[name="password"]').fill(env_value("API_CITIZEN_PASSWORD"))
    citizen.locator('.citizen-auth-form button[type="submit"]').click()
    expect(citizen.locator(".citizen-session-button")).to_be_visible(timeout=15_000)

    # SOS: Chromium must accept a valid form and move to the review step without requestSubmit workarounds.
    citizen.goto(f"{BASE_URL}/?feature=sos", wait_until="networkidle")
    if citizen.locator(".login-role-card.citizen").count():
        citizen.locator(".login-role-card.citizen").click()
    expect(citizen.locator(".sos-current-location.ready")).to_be_visible(timeout=15_000)
    check(citizen.locator(".workflow-map-canvas").count() == 0, "SOS chỉ hiện vị trí hiện tại, không tải bản đồ")
    citizen.locator(".sos-optional-details summary").click()
    citizen.locator('input[name="sosContactPhone"]').fill("0909 123 456")
    citizen.locator(".sos-hold-button").dispatch_event("pointerdown", {"pointerId": 1, "pointerType": "touch", "button": 0})
    citizen.wait_for_timeout(3_200)
    expect(citizen.get_by_text("Đã tạo yêu cầu hỗ trợ")).to_be_visible(timeout=15_000)
    check("sosStep=receipt" in citizen.url, "Mã tiếp nhận SOS được lưu trong URL")
    check(citizen.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "SOS không tràn ngang ở 375 px")
    check(not any("Invalid regular expression" in item for item in console_errors), "Không còn lỗi regex Chromium ở SOS")
    citizen.reload(wait_until="networkidle")
    if citizen.locator(".login-role-card.citizen").count():
        citizen.locator(".login-role-card.citizen").click()
    expect(citizen.get_by_text("Đã tạo yêu cầu hỗ trợ")).to_be_visible()
    check(citizen.get_by_text("Cập nhật trạng thái").count() > 0, "Reload khôi phục màn theo dõi SOS")

    # Citizen report: the selected image must travel through API/Postgres and return as attachment metadata.
    citizen.goto(f"{BASE_URL}/?feature=reports", wait_until="networkidle")
    if citizen.locator(".login-role-card.citizen").count():
        citizen.locator(".login-role-card.citizen").click()
    citizen.locator('input[name="summary"]').fill("Phản ánh kiểm thử lưu ảnh")
    citizen.locator('textarea[name="description"]').fill("Nội dung kiểm thử xác nhận ảnh hiện trường được lưu cùng hồ sơ PostGIS.")
    citizen.locator('input[name="evidence"]').set_input_files({
        "name": "hien-truong.png", "mimeType": "image/png", "buffer": PNG_1X1,
    })
    demo_location = citizen.get_by_role("button", name="Dùng điểm demo Xuân Hương")
    if demo_location.count():
        demo_location.click()
    citizen.locator('input[name="truthfulnessConsent"]').check()
    citizen.get_by_role("button", name="Gửi phản ánh").click()
    expect(citizen.get_by_text("1 tệp đã lưu")).to_be_visible(timeout=15_000)
    check("reportTab=tracking" in citizen.url, "Tab theo dõi phản ánh được lưu trong URL")
    citizen.reload(wait_until="networkidle")
    if citizen.locator(".login-role-card.citizen").count():
        citizen.locator(".login-role-card.citizen").click()
    expect(citizen.get_by_text("1 tệp đã lưu")).to_be_visible(timeout=15_000)
    check(citizen.get_by_role("tab").nth(1).get_attribute("aria-selected") == "true", "Reload giữ tab theo dõi")
    citizen.screenshot(path=str(ARTIFACTS / "citizen-report-mobile.png"), full_page=True)

    # Officer: login must establish an HttpOnly session; duty map must identify reference-only boundaries.
    officer_context = browser.new_context(viewport={"width": 390, "height": 844})
    officer = officer_context.new_page()
    officer.goto(f"{BASE_URL}/?portal=police", wait_until="networkidle")
    officer.locator('input[name="username"]').fill(env_value("API_OFFICER_USERNAME"))
    officer.locator('input[name="password"]').fill(env_value("API_OFFICER_PASSWORD"))
    officer.get_by_role("button", name="Đăng nhập vào cổng CSKV").click()
    expect(officer.get_by_text("CSKV trực địa bàn Xuân Hương").first).to_be_visible(timeout=15_000)
    cookies = officer_context.cookies("http://127.0.0.1:3001")
    session_cookie = next((cookie for cookie in cookies if cookie["name"] == "cskv_officer_session"), None)
    check(bool(session_cookie and session_cookie["httpOnly"]), "Phiên cán bộ nằm trong cookie HttpOnly")
    expect(officer.get_by_text("ranh tham chiếu", exact=False)).to_be_visible(timeout=15_000)
    check(officer.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Cổng CSKV không tràn ngang ở 390 px")
    officer.screenshot(path=str(ARTIFACTS / "officer-map-mobile.png"), full_page=True)

    # The queue scope (three tabs) must survive reload through URL params.
    officer.get_by_role("button", name="Hàng đợi").last.click()
    officer.locator(".queue-scopes").get_by_role("button", name=re.compile(r"^Tất cả")).click()
    check("scope=all" in officer.url, "Bộ lọc CSKV được lưu trong URL")
    officer.reload(wait_until="networkidle")
    expect(officer.get_by_text("CSKV trực địa bàn Xuân Hương").first).to_be_visible(timeout=15_000)
    check("scope=all" in officer.url, "Reload giữ bộ lọc CSKV và phiên đăng nhập")
    officer.screenshot(path=str(ARTIFACTS / "officer-queue-mobile.png"), full_page=True)

    citizen_context.close()
    officer_context.close()
    browser.close()

print("Pilot regression completed successfully.")
