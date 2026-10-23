"""Read-only browser coverage for public SOS emergency dialer links."""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


VIEWPORTS = (
    (320, 568),
    (375, 812),
    (768, 1024),
    (1024, 768),
    (1440, 900),
    (812, 375),
)


def main() -> int:
    artifacts = Path(__file__).parent / "artifacts" / "sos-quick-call"
    artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    console_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in VIEWPORTS:
            context = browser.new_context(
                viewport={"width": width, "height": height},
                locale="vi-VN",
                geolocation={"latitude": 11.944, "longitude": 108.441},
                permissions=["geolocation"],
            )
            context.add_init_script("localStorage.setItem('cskv-citizen-tour-v1', 'completed')")
            page = context.new_page()
            page.on(
                "console",
                lambda message: console_errors.append(message.text)
                if message.type == "error" and "401 (Unauthorized)" not in message.text
                else None,
            )
            page.goto("http://127.0.0.1:5173/?feature=sos", wait_until="networkidle")

            citizen_entry = page.get_by_role("button", name="Người dân")
            if citizen_entry.count():
                citizen_entry.click()
                page.wait_for_load_state("networkidle")

            call_112 = page.get_by_role("link", name="Gọi Tổng đài khẩn cấp quốc gia 112")
            call_113 = page.get_by_role("link", name="Gọi Công an 113")
            call_112.wait_for()
            assert call_112.get_attribute("href") == "tel:112"
            assert call_113.get_attribute("href") == "tel:113"
            assert page.locator(".citizen-feature-auth-gate").count() == 1
            assert page.locator(".sos-hold-button").count() == 0

            layout = page.evaluate(
                """() => ({
                  scrollWidth: document.documentElement.scrollWidth,
                  clientWidth: document.documentElement.clientWidth,
                  workspace: document.querySelector('.feature-workspace').getBoundingClientRect().toJSON(),
                  loginButton: document.querySelector('.citizen-feature-auth-gate button').getBoundingClientRect().toJSON(),
                  call112: document.querySelector('a[href="tel:112"]').getBoundingClientRect().toJSON(),
                  call113: document.querySelector('a[href="tel:113"]').getBoundingClientRect().toJSON(),
                })"""
            )
            assert layout["scrollWidth"] <= layout["clientWidth"] + 1, layout
            for key in ("call112", "call113"):
                box = layout[key]
                assert box["left"] >= 0 and box["right"] <= width + 1, (key, box, width)
                assert box["height"] >= 44, (key, box)
            if width <= 640 and height <= 650:
                assert layout["loginButton"]["bottom"] <= layout["workspace"]["bottom"] + 1, layout

            if (width, height) in ((320, 568), (1440, 900)):
                page.screenshot(path=str(artifacts / f"{width}x{height}.png"), full_page=True)

            results.append({"viewport": f"{width}x{height}", "overflow": False, "dialerLinks": True})
            context.close()
        browser.close()

    if console_errors:
        raise AssertionError(f"Browser console errors: {console_errors}")
    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
