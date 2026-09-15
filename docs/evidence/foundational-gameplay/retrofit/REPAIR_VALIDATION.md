# Resumed repair — verified changes, incomplete ordinary walkthrough

2026-09-15. PR #43 is unmerged and not human-approved.
Worktree: C:/Users/green/Desktop/projects/torn-veil-online-foundational.
Gameplay/native source checkpoint: 8190ebaf0320a328ea9a123f6d5b25f0d183ebc4.
Final DLL SHA256: 8f10b194355946c3a4163ebf6c70cfa1c8926f84b739018b9b720190208e259d.
Later commits may add evidence/docs only; earlier captures identify their own DLL.

## Control repair

The lease race retained a closing socket until its delayed close callback, denying a legitimate
reconnect control. Non-open owners now release before claim; open owners cannot be stolen, and
an old close cannot release its successor. Queued/buffered input clears at binding/focus/modal
boundaries. Disconnected prediction remains bounded.

Ordinary PIE proved the remaining disconnect trigger: 161 inputs counted across 23,972.75 ms
because the timer-based one-second reset was starved. Receive-time monotonic windows preserve
160 realtime / 80 legacy / 80 presentation messages per second. Urgent command wakes coalesce
asynchronously instead of stepping the simulation inline for every buffered socket message.
Canonical scheduler, debt, expiry and ownership are unchanged.

Actual same-PIE shutdown/restart passed: control false while disconnected, clear
“Reconnecting — movement paused”, then control true with a new epoch and the same b_141.
An X attack tap while disconnected was not replayed: attackSeq stayed 28, no live action,
and position unchanged. A second client received controls=false.
Sources: same-pie-*.json, disconnected-attack-ignored.json, active-owner-protected.json.

## Actually integrated

- Real CommonUI activatable screens/stacks and Enhanced Input contexts, not an AHUD substitute.
  Fixed unreadable fonts, missing prompt text, late-bound Back/Resume, nine-choice dialogue exit,
  inventory/container partition refresh, focus-bounds initialization and explicit Save menu.
- Local GASP 36-sample directional blendspace, starts/stops/pivots, root-displacement rejection,
  and existing combat handoffs. Epic binaries remain ignored/local.
- CC0 Quaternius skeletal deer with idle/walk/gallop/eating/death clips, body-keyed lifecycle,
  and continuous same-activity playback. Drink/rest/sleep use head-low fallback. Native tests
  pass; ordinary animal observation did not finish, so visual quality remains unverified.
- Item/open/closed chest support-plane offsets derive from displayed dimensions.

Not implemented: equipment slots, settings/rebinding controls, device-specific glyph art,
dedicated deer drink/rest/sleep clips. No physical gamepad or animation-quality approval.

## Ordinary walkthrough

Used the generated settlement, matching Launch/bridge/native build and separate test save
.debug/playable-repair-test.save.json. No arena, teleports, spawned test items, clock cheats
or canonical position edits substituted for traversal. OS taps/clicks were combined with
existing bounded native held-key and yaw/pitch input hooks because Computer Use lacks key-hold
duration. This was not an entirely physical-input walkthrough.

Observed: backward/forward/diagonal/sprint/strafe and stop; highlighted person → talk despite
nearby item → close → movement; repeated inventory/container/menu Back; ordinary trade for bread
i_2414; chest Store → same-item Take; menu Save → reload with same player/body and bread;
actual disconnect/reconnect. Item changes remained canonical.

FAILED/INCOMPLETE: later Drop requests expired under loaded-save backlog. Full pickup/drop/eat,
final dodge/combat-return, region-boundary crossing, deer encounter/activity/flee/return did not
complete. Passing fixture acceptance is not a substitute. A file labeled region-boundary-travel
records an attempt, not a successful crossing. Immediate screenshots can show pending requests;
labels alone are not pass assertions. Earlier failures are retained: inventory-return,
movement-after-inventory, prompt-empty-failure, dialogue-no-visible-back, and others.

## Blocking performance evidence and remaining defects

Read-only isolated profile of the same loaded save: 120 interaction ticks took 7,906.5 ms;
NPC thinking consumed 7,471.3 ms, p95 tick 301 ms, max 394 ms; wildlife 0.18 ms total.
Live scheduler debt exceeded 200 seconds. See BRIDGE_SAVE_PROFILE.md. This blocks reliable
ordinary play. No cognition rewrite, scheduler change, relaxed deadline or fresh-world
substitution hid it. NPC overlap, flat/sparse terrain, roof/wall seams and dark interiors remain;
grounding repair does not solve all environmental geometry.

## Verification and evidence

- Focused TS: 16 relevant tests plus 4 new rate/wake tests passed; final control rerun 7/7.
- Typecheck/production build passed after transport changes.
- UE 5.8.2 Editor build passed; 12 distinct native presentation tests passed across focused runs.
  Final CommonUIProjection passed after final header/dialogue repair.
- foundational:accept passed earlier this run and remains valid: fixture, not ordinary play.
- Ordinary Lit verifier passed: 9 regions, valid lighting/PCG/geometry, luma 0.400,
  readable fraction 95.48%. ../repair-final-lit.png and matching JSON.
- Five 24-second MP4s preserve wall-clock timing at approximately 4 Hz capture. Readback adds
  overhead. These are neither 60 FPS nor proof of smooth movement.

Normal save SHA256 remained 815E2D0926D58A69AF600198930C5617C0F00B5DBAFE9376FBBA678A63BC4587.
Next: separately scoped canonical loaded-save cognition investigation, then unfinished ordinary
steps. No merge or human-approval claim.
