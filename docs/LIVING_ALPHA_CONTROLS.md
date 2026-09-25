# Living Alpha controls candidate

The semantic Enhanced Input context drives ordinary movement, combat and menus. Canonical
movement/contact remains in `src/sim`; client prediction changes presentation, never hits.

| Action | Keyboard / mouse | Xbox | DualSense |
|---|---|---|---|
| Move / look | WASD / mouse | Left / right stick | Left / right stick |
| Sprint | Shift | L3 | L3 |
| Interact | E | A | Cross |
| Light / heavy strike | Left mouse / Mouse4 | X / Y | Square / Triangle |
| Guard / timed parry | Right mouse | LB | L1 |
| Directional dodge | Alt + movement | B + stick | Circle + stick |
| Focus | Mouse5 | LT | L2 |
| Lock / switch target | F or middle mouse / T | R3 / D-pad right | R3 / D-pad right |
| Hush / quick item | Q / R | RT / RB | R2 / R1 |
| Abilities / items | Tab / I | D-pad down / left or up | D-pad down / left or up |
| Journal / pause | J / Escape | View / Menu | Create or touchpad / Options |

Training, meditation, breakthrough, rest and crouch are available from Abilities and Journal.
Butchering, dialogue and nearby objects use the contextual Interact prompt. Optional development
shortcuts remain available. Jump/vault is not an implemented canonical mechanic in this slice.

Pause → Settings exposes mouse sensitivity, separate controller X/Y sensitivity, movement/look
dead zones, invert Y, vibration and sprint/focus hold or toggle. Select a rebind action and press
its new key/button; a conflicting gameplay binding exchanges with the previous key. Menu escape
is reserved. Analog sticks stay analog. Menu focus is retained when gameplay input is removed.
The sign-in form has an on-screen keyboard reached through the Enter button beside each field.
Right stick scrolls long menu text; keyboard Page Up/Down does the same. Pause also exposes
sign-out/reconnect and quit without developer commands.

Guard mitigates actual frontal contact, consumes effort and can break. A newly raised guard has
a 160 ms parry window against a human strike; holding or rapidly re-raising cannot repeatedly
renew it. A boar charge can be braced but not parried. Heavy strikes increase commitment and
force; they do not increase reach. Guard ends when a committed attack/defense begins.

## Evidence and limits

- Native semantic-input tests cover analog response, Xbox/PlayStation labels, rebind conflicts,
  preservation of the other device's binding, and reserved menu inputs.
- Rendered arena probes exercise the input layer with keyboard, gamepad and switching sequences.
  These use an isolated test arena; their resets are not ordinary packaged-play evidence.
- Native presentation integration: 15 passed, 2 existing content warnings, zero failures.
- Rendered analog travel: half-stick walking averaged 185.3 cm/s; full-stick sprint
  averaged 522.3 cm/s, with exploration facing and lock released through input.
- The normal Windows backend registered the actual USB device as `GameInput::DualSense`
  (054c:0ce6, Connected and HapticInfoReady).
- The USB DualSense is present. Physical button/stick/rumble and automatic device-detection
  acceptance still requires its actual use. An injected input probe is not that hardware pass.
- Xbox hardware was not reported available. Its physical pass remains external.

## Human packaged session

Use `unreal/scripts/Start-HumanPlaySession.ps1` with the final packaged executable, a private
profile, a new output directory, and `-Minutes 50`. This opens an ordinary visible client and
records frame times, connection time and active device families. It neither sends input nor
moves the camera. A partial report is written every 30 seconds and on exit.

Over 45–60 minutes: sign in, navigate and talk, trade, inspect items and progression, eat/drink/rest,
travel beyond the settlement, respond to naturally available danger/work, return and reconnect.
Use DualSense alone for a complete segment, then switch to keyboard/mouse and back. Check slow
walk, full-stick travel, sprint, guard/parry, dodge, ability use and every menu's focus/back path.
Record missing opportunities honestly. No developer rescue belongs in this session.

The observer report is telemetry, not a fabricated human playtest. Canonical before/after
checkpoints must also establish items, wealth, knowledge, trust, needs/injuries, requests and time.
