# Combined world/Tower verification — October 8, 2026

This report covers the isolated connected-realms candidate after merging authorized Tower checkpoint
**e7cd628** as **0d12c7a** and implementing the world-bound expedition adapter in **48ff6c2**. Earlier independent-world
results remain in `RESULTS.md`; they are not substituted for checks of this combination.

## Actual browser journey

**11/11 checks passed, no browser errors.** `combined/journey.json` contains the result and identity evidence.
The harness used an isolated headed Chrome profile, ordinary keyboard/mouse/buttons and read-only route
queries. It did not teleport actors, force kills or unlock floors. A legacy checkpoint sentinel is the one
explicit fixture; it proves bound runs leave the standalone Tower checkpoint untouched.

Observed sequence:

1. Walk to the Tower, open its real doorway, enter the atrium and ascend.
2. Bind the Tower climber to world Person `p_5` and the existing Body, including actor metadata.
3. Fight floor one with ordinary inputs, acquire gear, reach floor two and receive a durable checkpoint.
4. Reload the actual Tower page and recover the same run, floor and equipment. R does not replace the run.
5. Return to the same world Person/Body with identical inventory and rank.
6. Cancel a portal choice, then cross to Cinderveil and enter its Tower anchor.
7. Resume the same floor-two expedition, return again, and reload with the same world identity/progression.

The actual traversal video is `.debug/realms/combined-journey/traversal.webm`: **121.84 seconds**, VP8,
1440×900, **15,052,320 bytes**. It is local, not uploaded or presented as a visual mockup.
The video and main journey stills precede moving the expedition control bar to the right; the later recovery
captures show that compact panel. The travel/checkpoint behavior is the same.

## Recovery and adverse cases

**9/9 browser recovery checks passed, no unhandled browser exceptions.** `combined/recovery.json` records
second-tab rejection, reopening an active expedition, same-run resumption, failed-return pause/retry,
lost-acknowledgement retry after a durable return, and direct return from the world recovery screen.

Two HTTP 503 responses were deliberately injected by the harness: one before the host received a return,
and one after the host had durably committed it. These are labelled fault fixtures, not observed disk failures.
The unit suite separately exercises a disk-writer exception and verifies rollback and retained saves.
An early recovery harness wait dereferenced a not-yet-arrived state; its null-safe wait was corrected before
the final passing run. This was a harness error, not an unhandled game exception.

## Code and launch verification

- Focused combined realm, expedition, persistence, standalone checkpoint and browser-boundary suite:
  **36/36 tests passed again on the final code state**.
- TypeScript check and the final production web build passed (1m 50s for bundling). The emitted realm bundle was checked for the final rotated-input normalization; the Tower bundle includes return retry and compact controls. Registered creator bodies staged with exact
  provenance hashes: male `869ebb8070c94f981a6e09ba002216011c9365e0b12c8b6566d6883784d0e6cd`,
  female `c69e97f5d4caccd2cf1b48afa1e70577982e09a14784639f9d21f436873e033e`.
- `Play Torn Veil.cmd -CheckOnly` passed. The actual launcher stages registered creator assets before boot.
- Actual rotated diagonal movement smoke passed: 4.42 metres through the canonical collision path with ordinary keys.
- Full combined aggregate **2,050/2,050 tests across 204/204 files passed**, with zero failed or pending
  tests (529 nested Vitest suites). The original run, session 95780, completed with exit code 0 in
  **34m 52.33s**; it was not restarted. `combined/aggregate.json` records each file's result, UTC times
  and the raw report's SHA-256. This checks the final code represented by documentation checkpoint
  **88d8eba**. Earlier worker checks and the independent foundation's 1,917 tests are separate evidence.

## Actual frames and visual gate

- `combined/world-before-ascent.png`: the real Tower approach after the doorway-aperture correction.
- `combined/tower-floor-two.png`: actual gameplay after reaching floor two, with provisional creator body.
- `combined/returned-atrium.png`: world atrium after returning, with working Ascend control.
- `combined/failed-return-retained.png`: explicit injected failure and paused encounter; latest compact panel.

**Visual gate NOT PASSED.** Repetitive building forms, flat pale/black materials, sparse streets and atrium,
lighting/contact issues and provisional character geometry remain visible. No image is retouched or claimed
to match Gigacity. The separate character owner is responsible for the later high-quality body/face/clothing
handoff; no competing mesh was authored here.

## Delivery and remaining limits

Earlier independent screenshots and the inspected floor-two capture remain local,
with private delivery provenance retained separately. Other combined reports remain
here; the traversal video stays local.

**Combat authority remains incomplete.** The host saves scoped browser encounter checkpoints but does not
accept them as proof of global rank, items, health or death. The realm pauses during the encounter and keeps
the canonical body anchored at the saved landing. Full trusted combat/reward integration needs the host-owned
action/provenance contract described in `CONNECTED_REALMS_INTEGRATION.md`.

No new performance benchmark is claimed for the combined run: the CPU suite and build shared the machine,
and recording adds overhead. Earlier independent-world frame/upload/heap observations remain explicitly scoped
to that earlier revision. No VRAM measurement, populated-city scale proof or long stability soak was completed.
