# Public map and directory

Updated: 2026-08-27. Inherits the conservative product rules in `../MASTER.md`.

## Main task

Help people find an area and the correct public contact. Keep the map visible and
make Search, Location and SOS easy to identify. Do not substitute decorative UI
for geographic information.

## Layout

- Map fills the workspace under the original red institutional header.
- One compact search surface in the upper-left; the directory opens only when
  requested, after choosing a search result, or after a coordinate lookup.
- Desktop directory: 340px overlay with bounded scrolling, not a permanent wide column.
- Mobile: search leaves room for the layers control; directory expands to the viewport
  width minus 24px and remains scrollable above the navigation.
- Closing the directory returns to the unobstructed map without discarding its data.
- Layers stay behind one upper-right control.
- Location and the labelled red SOS button share one lower-right dock.
- Map attribution is a small, readable source disclosure at lower-left.
- No floating assistant, auto-opening AI prompt or background watermark.
- Hướng dẫn sử dụng and Đăng nhập CSKV are in the Tính năng menu.
- AI remains accessible through Tính năng with its existing development-state disclosure.
- Preserve the mobile Bản đồ / Danh bạ / Phản ánh / Tài khoản navigation.

## Map details

- Geographic zone colors communicate spatial categories only. The original red
  is the UI primary; location and CSKV markers retain geographic blue.
- A selected zone opens a bounded panel (bottom sheet on mobile), not another dashboard.
- Directory metrics and contact sections use type, spacing and dividers instead of nested cards.
- Keep demo/reference-boundary and public-source disclosures in the relevant detail panels.
- Location shows progress and a recoverable, announced error when permission or GPS fails.
- The map remains mounted behind the directory and resizes even when the directory is open.
- All map components import `maplibre-runtime.ts`, which configures Vite's bundled
  MapLibre 6 worker. A visible canvas or DOM marker is NOT proof that the map loaded:
  release QA must verify worker JavaScript, vector tile responses, GIS sources and
  an actual screenshot from the production build.

## Tour and safety

The existing six-step tour uses a static spotlight with legible instructions.
Its location step points to the current location control, not the removed AI button.
The SOS action opens the workflow; pressing it does not itself submit an emergency.
Authentication and the deliberate three-second hold remain unchanged.
Quick-call in the citizen SOS workflow only opens the device dialer for 112/113;
it is visually separated from the local three-second SOS submission.

## Responsive review

Verify 320×568, 375×812, 768×1024, 1024×768, 1440×900 and 812×375.
There must be no horizontal page overflow. The compact phone title is Bản đồ CSKV.
Keep safe-area padding and touch targets; do not allow map overlays to cover navigation.
Preserve map dominance while closed panels remain out of the way.
