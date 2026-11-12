# Playable town foundation — local implementation candidate

**21 October 2026, 22:36 CT. Not play-accepted.** Source is implemented and passes full TypeScript compiler API diagnostics. The requested launch/walk/door/fight/quit/Continue loop has **not** been exercised: the process runner rejects Bash before it starts. No foundation build, host, save or browser session was created. Git staging could not be completed or verified.

This resumes only Jacob's new foundation in `maestro/playable-town-foundation-oct21`, based on `56d9c3db36f617b1d2a79c289880a04ee7daa425`. Cancelled universe publication/merge remains cancelled. The old port7533 writer and other worktrees were untouched. Executor: Codex with three bounded Codex subagents. No separate Claude worker output or branch was merged.

## Launch and save isolation

With a working shell in this checkout, first run:

```bash
npm ci
npm run foundation:build
```

Then run **Play Torn Veil Foundation.cmd** (equivalent: `npm run foundation:play`). The launcher prints NEW or Continue and the exact save path before opening the game. `npm run foundation:play -- --continue` requires an existing save; missing Continue is an error, never a new-world fallback.

- Ordinary foundation: `.debug/foundation-player/world.json`, adjacent journal store and identity marker.
- QA: `npm run foundation:play -- --acceptance --no-open` selects a unique new directory under `.debug/foundation-acceptance/` and prints it.
- Same-save QA restart: set `TV_FOUNDATION_SAVE` to that exact acceptance path, then use `npm run foundation:play -- --continue --no-open`. The override accepts only paths under this checkout's acceptance directory.
- Default loopback port **7541**; override with `TV_FOUNDATION_PORT`. It was free and immediately released at the 22:32 CT probe. Every launch rechecks; it never attaches to or stops another listener.
- Inherited `TV_REALMS_SAVE`, campaign defaults and external model fallback paths do not select this foundation's save/assets. Seed is explicitly918271.
- Source, allowed asset bytes, bundle outputs and exact runtime are hashed. Save identity refuses changed source/assets/runtime even after a full checkpoint. There is no reset, migration or fingerprint bypass. Keep the matching checkout/build/runtime for Continue.
- Build and launcher share an exclusive lock. Stop the owned host before changing source or rebuilding. An abandoned lock requires ownership investigation; it is never automatically stolen.

The scoped build cooks existing focused geometry, stages/verifies tracked CC0 UAL, typechecks, and bundles to ignored `dist-foundation/`. It copies only `FOUNDATION_PUBLIC_ALLOWLIST` into new staging. Existing `play:build` and private motion gates remain unchanged. **The build and .cmd have not yet been executed here.**

## Controls and changes

WASD moves through host collision; X walks; middle mouse orbits; wheel zooms. Tab selects an observed body. LMB is a light high strike; K heavy; L low; G/RMB guard; Space dodge. E interacts with supported nearby doors/thresholds. I opens character and real nearby pickup/equipment actions.

Guard renewals share the existing100ms policy instead of every50ms input sample. Escape, blur, hidden tab, pointer cancellation, menus and transitions release held movement/guard/crouch; key repeats cannot reacquire cleared input.

**Save and quit** appears only when the host grants foundation mode. It releases input, fences late commands and waits for final journal checkpoint completion. UI success requires a saved receipt plus normal socket close; save failure propagates and exits nonzero. Ctrl+C or typing `shutdown` in the launcher also stops only its owned child gracefully. **Closing a browser tab alone does not stop the host.**

The canonical chain remains realm client → bound commands → RealmRuntime → existing simulation/physical combat → RealmJournal/worker → snapshots. Wildlife rendering/targeting consumes existing observed body projections and creature rigs; it owns no ecology, attack, damage, reward or gameplay schedule. Boar feedback now projects actual impact and causal guard receipts instead of reporting zero.

The founder operation places one finite, unowned **Weathered trail knife**, condition0.65, on supported paving near `(11312.5,1.0625,3116.5)`, about2.8m from spawn. This is a disclosed initial world object, not earned loot or an inventory grant. Ordinary hand actions take/equip it; founded worlds do not replenish it. John Smith's reserve, reward history and Tower progression code remain unchanged.

## Route candidates and unresolved door gate

Spawn is approximately `(11312.5,1.0625,3113.7)`. The first existing boar initially stands near `(11321.5,3166.5)` and can move under ecology. A candidate approach follows the path toward `(11312.5,3156.5)`, then the observed animal. Use low strikes against its actual body, face it to guard, release, then retreat. These are source-derived aids, **not tested routes or permission to teleport**. Corran the outlaw initially stands at the eastern ruins near `(11354.5,3154.5)`. No enemy reset, health grant or synthetic gameplay hit endpoint was added.

**Focused Omnius GLB door leaves are static.** Their collision is canonical, but the focused town suppresses overlapping procedural buildings and these leaves do not consume persisted door state. This session did not invent a visual/collision mapping.

A candidate real door in the surrounding procedural district is Copper Archive, cell `(11480,1,3128)`: approach through `(11312.5,3126)` then `(11480.5,3126)`, approximately169m east. The ordinary walk, E interaction and restart retention remain untested. This is **not** proof of an interactive Omnius tavern door. If this route is unsuitable, a correctly pinned focused-door adapter remains necessary.

## Validation and current media

Evidence: [results](evidence/playable-town-foundation/RESULTS.md), [compiler](evidence/playable-town-foundation/typecheck.json), [launcher safety](evidence/playable-town-foundation/launcher-safety.json), [lifecycle review](evidence/playable-town-foundation/lifecycle-review.json), [execution failures](evidence/playable-town-foundation/execution-blockers.json), [review files](evidence/playable-town-foundation/review-files.json).

- PASS: TypeScript5.6.3 compiler API across the full tsconfig,936 files, zero diagnostics. This is not a claimed CLI `npx tsc` run.
- PASS: eight direct module checks for save/path isolation, missing Continue, bad port, exact/changed identity and junction refusal. This is not a Vitest-suite pass.
- Source lifecycle review found and corrected late-request authorization, unbounded notification wait and premature failure wording.
- UNRUN: npm ci, Vitest, real journal-worker regressions, bundle, .cmd, browser loop, actual-rig tests and same-save restart. Dependencies were present; npm ci reproducibility was not re-established.
- Guard and shutdown tests were authored first. `.debug/foundation-input/test-first-red.json` records expected missing-helper compiler diagnostics, **not executed behavioral red/green proof**.
- **No current screenshots/video.** Earlier foundation probes and universe captures remain historical. A retained probe shows exhaustion during boar retreat; that is not successful disengagement.

After execution is restored and all owned hosts are stopped:

```bash
node scripts/web/cook-focused-assets.mjs
node scripts/web/stage-human-motion.mjs
npx tsc --noEmit
npx vitest run tests/realm-held-input.test.ts tests/web-input.test.ts tests/guard.test.ts tests/realm-shared-controller.test.ts tests/realm-journal.test.ts tests/realms.test.ts tests/foundation-launch.test.ts tests/foundation-shutdown.test.ts tests/foundation-encounter.test.ts tests/web-boundary.test.ts tests/human-motion-staging.test.ts tests/radial-footplant-import.test.ts
npm run foundation:build
npm run foundation:play -- --acceptance --no-open
```

Do not relax assertions/deadlines or count an imported-rig skip as a pass. UAL, hero and Wren inputs are present; the actual-rig check must execute. Preserve failed outputs.

Use one controlling headed Chrome/Edge tab at the printed URL. Capture cold town, ordinary door route, actual target contact, reduced guarded damage, release, retreat and saved closure. The existing `scripts/web/focused-input-driver.mjs` drives ordinary keys; it is not itself route proof. Keep source frozen, wait for launcher exit, restart the **same** acceptance path and Continue.

Compare Person/Body IDs, complete carried item objects/equipment, health/injuries, neutral input, door states, quest receipts and full John Smith history in checkpoints and browser projections. Synthetic unit contacts/rewards do not count as ordinary gameplay. No save fixture edits, debug relocation or inventory injection may satisfy these gates.

## Assets and provenance

[asset-inputs.json](evidence/playable-town-foundation/asset-inputs.json) records732 allowlisted local files /414,683,238 bytes. It is an input inventory, not a build, render-coverage report, license grant or publication permission. Relevant scene objects are loaded; all item models are not placed into town.

- Existing46-GLB focused pack:21 spaces +25 loose parts; pinned layouts/cooked host geometry. No binary changed.
- Existing Ranger/Wren and clothing obligations: `web/public/arena/people/CREDITS.md`. Temporary art; no new VRM integration. Existing KayKit fallbacks remain explicit.
- Tracked Quaternius CC0 UAL:7,618,436 bytes, SHA256 `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`. See [CHARACTER_MOTION](CHARACTER_MOTION.md).
- Existing procedural boar/deer/hare: provenance in `docs/web/WEB_ASSETS.md` and `art/tools/web_characters/`; current hashes in input inventory differ from an older creature manifest. No binary changed. Adapter diagnostics distinguish temporary placeholders.
- Existing items/arsenal/textures retain their credit records. No licensing assumptions or downloads added.
- Full external Atlas remains1850 decoded unique /1249 static-compatible models and was not copied. The12-model donor and active character worktrees are unchanged. Bootstrap-only character-studio supplied no payload. No Aion/NCSoft input was used.

## Maestro handoff

Source is on disk; **staging was blocked, not completed or verified**. No commit, Git identity change, push, deployment, CI/workflow trigger, merge, vault write, save migration or host launch occurred. Review the exact file list/hashes, run the scoped checks and build, then stage only reviewed source/docs; never ignored QA saves.

First remaining gate: restore scoped process execution. Bash fails before start with `CreateProcessAsUserW failed:5 (Access is denied.)`; Node subprocesses return `EPERM`. No alternate-control or permission bypass was attempted. Then establish the ordinary door/combat/retreat/Continue loop, addressing the fixed focused-door limitation explicitly.

Daily entry for Maestro (not appended concurrently to vault):

> ## Codex foundation session (22:36 CT, 2026-10-21)
> - [Codex] Implemented isolated foundation launcher/build identity, owned checkpointed Save-and-Quit, bounded guard/releases, nearby pickup, finite trail knife and observed forest creature presentation. Full TypeScript API diagnostics pass (936 files); eight direct launcher safety checks pass.
> - Build/Vitest/browser/restart/staging remain blocked by process execution errors. No playable-loop acceptance or current media claimed. Focused GLB leaves are not persisted toggles; candidate procedural door route is untested. Handoff: torn-veil-foundation/docs/PLAYABLE_TOWN_FOUNDATION.md. No host/save/other-worktree/publication changes; cancelled universe release remains cancelled.
