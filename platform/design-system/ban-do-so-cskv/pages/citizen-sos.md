# Citizen SOS page override

## Single job

Help an authenticated citizen send one location-bound emergency request with a
deliberate three-second hold. The page must never turn a normal tap into a request.

## Layout order

1. Short emergency instruction.
2. Large circular SOS hold control with visible progress and live status.
3. VNeID sign-in prompt when no citizen session exists.
4. Current-location map and GPS recovery action.
5. Optional incident category, note and callback phone.
6. Legal truthfulness notice.

The existing application header and bottom navigation remain unchanged.

## Visual refinement (2026-08-27)

Inherit the neutral surfaces and typography in `../MASTER.md`. Reserve the red
accent for SOS and serious warnings. Use a solid hold control with functional
progress, no decorative pulse or glowing shadow. Separate location and optional
details with dividers instead of nested cards. Keep all safety instructions,
GPS recovery and pilot limitations visible. Quick-call remains available before
authentication, opens the device dialer for 112/113 and must never imply that
the application dispatches those calls.

## Interaction rules

- Pointer, touch and keyboard press-and-hold all use the same 3,000 ms threshold.
- Releasing, leaving or cancelling before the threshold resets progress and sends nothing.
- Completing the hold sends exactly once, gives vibration feedback when supported and opens the receipt view.
- Without a citizen session, pressing the SOS control opens the VNeID-labelled authentication sheet and never calls the SOS API.
- Missing/low-quality GPS produces an announced recovery message and does not start the timer.
- The progress ring is supplemental: the core label and live status communicate state without relying on color.
