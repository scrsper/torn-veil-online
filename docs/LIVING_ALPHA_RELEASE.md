# Living Alpha v0.1 — release record

One record for the Living Alpha release: baseline, gates, plan, budgets, blockers and evidence.
Update in place; do not fork planning documents.

## Baseline (established 2026-09-23)

| Item | Observed |
|---|---|
| Integration base | `origin/main` @ `5171eba` (PR #49 merged). The old local `claude/v0.2.2-scale-readiness` had 0 unique commits (all in main), so that branch was restarted from `origin/main`; release work happens on it. |
| Other work preserved | Clones/worktrees under `Documents\ChatGPT\TornVeilOnline*`, `Desktop\projects\torn-veil-online*` untouched. Unpushed local commit `ce76bfa` (codex/integration-playtest-current: Ashford playtest launchers, 1 MiB text limit for authored Ashford) exists only in `TornVeilOnline-playtest`; not merged here. |
| Running services | No Torn Veil bridge/server running. No existing live world. Existing `.debug/*.save.json` files in other clones are developer/test saves and are not touched. |
| Host | Windows 11 Home, Ryzen 5 9600X (6C/12T), 31 GB RAM, RX 6650 XT, C: 208 GB free, D: 311 GB free. AC sleep/hibernate = never (host stays awake on mains). Session user is **not** an administrator. |
| Toolchain | Node 22.23.2 (the PATH `node.exe` already has an inbound-allow firewall rule), UE 5.8 at `C:\Program Files\Epic Games\UE_5.8`, VS 18 Community, Windows SDK 10.0.22621/26100. |
| Network | Tailscale up (`100.86.43.22`, tailnet with Linux/Android/iOS/macOS peers). Wi-Fi is a *Public* profile — the server must never bind 0.0.0.0. |
| Licensed content | Not in git. 3.5 GB Unreal `Content/` present in `Desktop\projects\torn-veil-online` and `TornVeilOnline-playtest` (+ `D:\TornVeilAssetCache`). This worktree has none; the release client build provisions by copy only. |
| Headless startup | `npx tsx src/headless/bridge/playableStartup.ts` → PASS, 71 checks; first snapshot 44 ms, first centre region 3.0 s, max snapshot gap 722 ms. |
| Sim throughput | Regional world seed 918271: 128 persons, generation 3.5 s, 60 Hz stepping at ~20× real time on this host (first 400 physical s). Save 150 ms / 22.9 MB; load 2.9 s; heap 641 MB. |

### Baseline failures against this contract

1. Server is single-player: one `world.playerId`, one controller lease, one command queue, one dialogue,
   snapshots filtered for that one person; additional connections only observe that person's view.
2. Loopback only (`127.0.0.1`), no authentication beyond a header, no accounts, no character creation/selection.
3. Save is one file written with rename (no fsync, no generations, no manifest, no backup, no validated recovery);
   a missing save silently generates a fresh world; nothing fingerprints the seeded generator, so a generator
   change would silently alter a reloaded world.
4. No supervisor, autostart, drain, readiness, bounded logs, release/staging/live separation or update procedure.
5. Unreal client hard-codes `ws://127.0.0.1:<port>`; no packaged build has ever been produced.
6. No supernatural capability; Normal→Iron exists only as a gated reference path.
7. Disconnect policy undefined: the controlled person is never released and would starve while offline.

## Selected release configuration

| Item | Choice |
|---|---|
| World | Regional playable world, seed **918271**: 7 settlements, 127 generated residents, 24.6 km square, roads, rivers, woodland/stone resources, wildlife (hare, roe deer, boar). |
| Destinations | Home settlement + wilderness + a second settlement along the regional road + resource sites (timber/stone/forage/water). |
| Server budget | 60 Hz interaction tick with zero accumulated debt at steady state; snapshot fan-out 10 Hz; save stall ≤ 250 ms per checkpoint; RSS < 2 GB. |
| Client budget | ≥ 30 FPS sustained (target 60) at 1080p on RX 6650 XT in village and combat; p99 frame time recorded. |
| Deployment | This workstation. Live service bound to `127.0.0.1` + Tailscale `100.86.43.22` only; private allowlisted accounts. |
| State location | Outside source trees: `%LOCALAPPDATA%\TornVeilAlpha\<env>\` (state, logs, credentials); backups on second disk `D:\TornVeilAlpha\backups\<env>\`. |

## Work packages (dependency order)

1. **WP1 Live authority service** — multi-person session (per-connection control/dialogue/snapshot/appearance delta),
   accounts + allowlist + character ownership, durable checkpoint store with manifest/fingerprint/generations,
   backups, validated recovery and refusal to silently regenerate, disconnect/uncontrolled-body policy,
   readiness/health/metrics, drain/checkpoint admin on loopback.
2. **WP2 Release & update pipeline** — immutable bundled server releases, dev/staging/live separation,
   supervisor with crash restart and bounded logs, autostart, rehearse-on-copy → drain → capture → fenced cutover
   → verify, migration hook, recovery path.
3. **WP3 Packaged client** — connection/login/character screen, configurable host/credentials, compatibility errors,
   BuildCookRun Win64 package with provisioned licensed content.
4. **WP4 Opportunities & social loop** — player-legible requests/shortages through legitimate knowledge, accept →
   canonical work → conserved payment, commitments journal, two approaches.
5. **WP5 Capability, danger & the supernatural** — distinct creature threat behaviour, smallest coherent
   supernatural mechanic (cost/limit/counterplay, shared by eligible people), two development approaches,
   Normal→Iron through ordinary accelerated simulation.
6. **WP6 Evidence & handoff** — soak, 7-day × 3-seed continuations, contested multiplayer probes,
   persistence/recovery drills, update rehearsal, regression, operator/player guide.

## Acceptance matrix

Status values: PASS (observed, evidence linked), FAIL, UNVERIFIED, BLOCKED (external).

| Gate | Status | Evidence / note |
|---|---|---|
| G1 Packaged entry & visible world | UNVERIFIED | Client candidate-06 includes scale, materials, hair, calf coverage, roof camera queries, complete dialogue choices and decorative arrival clearance. Fresh village capture against server candidate-08 reviewed: 49.7 FPS / p99 31.2 ms at 1080p for 60 s, zero loading/stale frames. Sixteen native presentation tests pass. Ordinary UI/input and final visual acceptance remain unverified. |
| G2 45–60 min ordinary session | UNVERIFIED | Requires packaged client + human input. |
| G3 Emergence, 3 episodes, 2 approaches, 3 seeds | UNVERIFIED | Ordinary player discovery/consequence episodes across all three seeds are not demonstrated. Synthetic opportunities and continuation event traces do not replace those episodes. |
| G4 Capabilities & advancement | FAIL | Hush, teaching, hunting and activity credit implemented and tested headlessly. Legitimate Iron journey unproved; current vitality development lower bound is ~93 world years for start 8/potential 10, even with ideal daily practice. Calibration decision pending. |
| G5 Shared-world multiplayer | UNVERIFIED | Two independent candidate-04 packaged clients simultaneously possess distinct people and render each other (pair-03). Real-process protocol drill-05 passes all 13 checks, including ordinary trade, concurrent pickup with exactly one winner, saved possessions, private-state isolation, ownership, reconnect and stale-epoch rejection. Packaged contested UI and remote-device reachability remain unverified. |
| G6 Persistence & recovery | PASS | Disposable real-process drill: 14 checks, forced writer crash/restart in 9.475 s, durable person/ownership, corrupt-newest fallback, interrupted-write cleanup, backup restore into a new generation. See recovery evidence below. |
| G7 Development & update continuity | PASS | Disposable three-environment drill runs old r1 → actual newer protection gameplay bundle; rehearses first, makes later live movement/save, verifies final-live payload hash/position/ownership, excludes rehearsal character and leaves dev untouched. Existing deployment cutover remains pending release readiness. |
| G8 Sustained operation | FAIL | Candidate-04 completed 7200.013 s / 719 samples with no status error, restart or world change, peak RSS 752 MB and debt clearing. Save serialization still fails: 474.216 ms against 250 ms (older baseline 1564 ms). Three candidate-06 continuations have passed two world days without findings; no seven-day pass. Candidate-07 later crashed on an unsettled traveler's missing square; candidate-08 repairs this and resumes the exact retained generation, but has no completed soak. Village capture: 49.7 FPS; attack/crouch presentation: 48.6 FPS, without opponent contacts. |
| G9 Regression & integrity | PASS | Full run-04: 124 files / 1172 tests pass in 1712.67 s at 06:16Z, unchanged assertions/timeouts. Subsequent dialogue changes: 8 affected tests pass. Candidate-08 planner/operator changes: 29 affected tests in 4 files, exact crash-save replay, typecheck and production build pass. Resume harness: 3 tests plus real CLI stop/resume pass. Native presentation: 16 tests pass. Earlier failures and interruptions remain retained. |
| G10 Usable handoff | FAIL | Current package, human profile, launch/operator guide and recovery checkpoint are prepared. Release activation, real boot continuity, off-host backup, ordinary play and remote-device checks remain incomplete; per-user scheduled execution also has the recorded path-visibility failure. |

## Blockers and external requirements

- Boot-time start before any user logs on needs an administrator to register the provided task
  (the session user is not an administrator). A per-user logon task can be registered without elevation.
- Off-host backup: the only other host visible is the user's NAS media share (`M:`); not written to without
  explicit authorization. Backups on `D:` protect against C: disk loss only.
- A second physical device/network for G5 and the human 45–60 minute session for G2 need the user.

## Next concrete action

Complete the three bounded continuations (resume their final checkpoints if the four-hour limit is
reached), investigate the 474 ms checkpoint stall without deleting history or changing budgets, and
obtain the pending progression calibration decision and ordinary packaged-play evidence. Candidate-08
also needs a fresh sustained observation after its crash repair. Headless intentions and rendered
observations do not substitute for ordinary UI/input acceptance.

## Implementation handoff recovery and native repair (2026-09-23)

- Actual checkout: `C:\Users\green\Documents\Codex\2026-09-23\please-wake-up-the-claude-desktop\torn-veil-online`.
  Branch `claude/v0.2.2-scale-readiness`, HEAD `0346386aaacb61c8c03710aa23daaa2f7953c3ca`, draft PR #51.
  Inherited 33 staged files, no unstaged tracked changes, one untracked `packaged-alice-first.png`.
  Recovery bundle, staged binary patch, index/status manifests and screenshot copied to
  `%LOCALAPPDATA%\TornVeilAlpha\handoff-checkpoints\20260923-213033`; no reset/checkout/clean used.
- Inherited service remains unchanged: supervisor PID 28536, server PID 8468, immutable bundle
  `.debug/alpha-play/releases/r1`, port 7441, state `.debug/alpha-play/dev/state/world`, backups
  `.debug/alpha-play/dev/backups`. This historical developer deployment is inside the checkout;
  it is not the final external live-state layout. Trial client PIDs 25028/15668 were already running.
- Recovered original mandate and latest Opus transcript from its local project session
  `806502bf-cf1f-5186-a50e-9bb6b557a072.jsonl`. The affected run completed: **17 files / 160 tests passed**,
  plus **2 protection-opportunity tests** and TypeScript typecheck. No subsequent inherited source edits
  were reported beyond staging. These are retained results, not reruns by the new implementation owner.
- Inherited gameplay inventory: rest/wake, boar defense/injuries, carcasses/butchering, hush and NPC use,
  paid technique teaching, concern-based protection requests, capability credit and client feedback are
  implemented with headless evidence; all still need current packaged gameplay verification. The hunt
  test uses declared placement/item/direct-hit fixtures; it is not an ordinary player adventure.
- Native reproduction through `Run-EditorPython.ps1`: `.debug/unreal/scale-before.json` measures actual
  TVCharacter attachment composition with explicit scale fixtures. 0.82 became 0.6724; 1.18 became
  1.3924. Corrected scale ownership in TVCharacter: Foundry scale on visible child with unit driver;
  fallback scale on driver, proxies inherit once. Also fixed appearance grammar string comments being
  interpreted as JSON objects (five errors exposed by the new native test).
- Native editor build succeeds: `.debug/unreal/alpha-capture-build.log`. Four embodiment tests pass,
  zero warnings/failures: `.debug/unreal/scale-tests-02/index.json`. Real Project() paths cover full
  profiles, deltas, modular parts, fallback transitions, adult and child dimensions. The first run
  (`scale-tests-01`) failed on the parser errors; it is retained, not hidden.
- Offscreen path proved on installed UE 5.8 / RX 6650 XT: graphics-enabled `-game -RenderOffscreen`,
  native `TV.AlphaCapture`, fresh frame and report in `.debug/unreal/offscreen-smoke-02/`. Map
  TornVeilWorld, 9 streamed regions, five resolved characters, unit driver transforms, single realized
  scales, valid daylight, 32.23 seconds to capture. Image reviewed: world/people visible, ground repair
  present. One unresolved character slot and primitive/white props remain for investigation. The first
  launch had malformed argument spacing and was stopped by its specific PID; capture runner corrected.
- Isolated candidate: `%LOCALAPPDATA%\TornVeilAlpha\candidate-20260923`, immutable dirty bundle
  `releases/candidate-01`, separate dev world/credentials on loopback 7451. Native client uses
  `%LOCALAPPDATA%\TornVeil\Client\alpha-candidate-alice.json`; token is never committed. This is a
  separate generated test world, not a copy promoted over inherited progress.
- Progression calculation: `.debug/progression-calculation.{ts,json}`. Analytical lower bounds only,
  not an advancement journey. Caps use world-day units; practice adapters use documented activity
  equivalents. At potential 10, 8→15 needs 30,337 effective hours; maximum existing adult vitality
  practice (weight .1, intensity .7, instruction 1.6, 8 hours/day) needs 33,858 days. Rates unchanged
  pending explicit resolution of the prior long-horizon design versus the release requirement.
- Pending calibration proposal (not applied): shared development curve base effort **500 → 5 hours**
  and vitality activity weight **0.1 → 0.5**, retaining prerequisites, caps and causal practice
  provenance. The same ideal vitality calculation becomes approximately **68 world days**;
  this is not a demonstrated all-foundations Iron journey. The unresolved design decision was
  requested separately; no answer or elapsed wait is treated as approval.
- Automation workflow recorded in `.ai/TESTING.md`: scripted operations first, rendered captures for
  visuals, separately authorized physical-input/UI testing when required. No desktop control or OS
  keyboard/mouse injection used in this continuation.
- Restored missing generated local material wrappers using the existing asset scripts: 41 prop
  materials and 12 village instances. Fixed probing a missing output with load_asset (41 commandlet
  errors), unsaved duplicate base materials, and reruns deriving a copy from an earlier generated
  copy. Final generator run `.debug/unreal/local-village-materials-03.log` succeeds; stable vendor
  parents and both base packages now exist. Generated vendor-derived assets remain ignored.
- Fixed ignored groom-simulation disable: UE 5.8 requires SimulationSettings.bOverrideSettings.
  Native build `.debug/unreal/material-groom-build.log` passes. Added per-slot unresolved diagnostics.
  Read-only assembly report `.debug/unreal/assembly-assets.json` proves selected f_003 Updo and the
  f_004 Updo referenced by installed groom bindings are distinct assets (remaining repair).
- Packaged candidate built in 6m53s, exit 0:
  `%LOCALAPPDATA%\TornVeilAlpha\clients\candidate-20260923-01\Windows\TornVeilOnline.exe`.
  Build log/result `.debug/unreal/package-candidate-01.log{,.result.json}`. Build/package jobs now use
  bounded hidden processes with explicit logs/result and cleanup limited to their own process tree.
- Fresh packaged runtime capture `.debug/unreal/packaged-candidate-01/`: 4 frames in 35.14 s, 9 regions,
  actual gameplay world and ordinary newly created `capture-bob` person. Images inspected: ground,
  benches, barrels and lamps have materials; multiple adult/child appearances have single scale.
  Detached-looking footwear/missing lower-leg coverage, clothing fit and two unresolved hair slots
  remain. This is native rendered evidence, not normal UI/physical-input acceptance or sustained FPS.
  Earlier editor closeups `.debug/unreal/offscreen-people-02/` show only one person after ordinary
  offline autonomy moved the person away; they do not prove demographic coverage.
- G6 evidence `%LOCALAPPDATA%\TornVeilAlpha\recovery-20260923-01\recovery-report.json`, 46.306 s,
  staging port 7452, service stopped. `scripts/alpha/recovery-drill.ts` creates a new disposable root,
  uses ordinary protocol movement/save/reconnect, kills only its verified writer PID, and deliberately
  corrupts only its stopped staging generation for the recovery drill. Existing service untouched.
- G7 evidence `%LOCALAPPDATA%\TornVeilAlpha\update-20260923-03\update-report.json`, 54.624 s,
  ports 7453–7455, services stopped. Old `.debug/alpha-play/releases/r1` lacks protection.ts; new
  immutable `candidate-02` is `0.1.0-alpha.2+0346386aaacb.dirty`. Both use schema 24. Earlier -01/-02
  reports retain failed post-restart position assertions: restart deliberately releases external
  control, so autonomous movement before reconnection is expected. Final proof compares the exact
  final-live backup payload and saved post-rehearsal position, then verifies person reconnect.
- Read-only two-hour observation: `.debug/alpha-soak-20260923`, PID 17744, started
  2026-09-24T03:07:33Z, intended end 05:07:33Z. `observe-soak.mjs` samples every 10 seconds and writes
  a final report/exit status. Candidate service remains port 7451; no simulation acceleration.
- Regional continuation first failed in observer-only full-map flood fill (Map maximum size), not
  in simulation. Sparse targeted connectivity avoids materialising 604 million columns; exhausted
  search is explicitly inconclusive, never an invented path or disconnection. Ten locality tests
  pass. `.debug/alpha-continuation-918271-03` runs the unmodified 60 Hz BridgeSession.stepAll path
  at scale 6 with no skipped systems, no controlled player and no injected goals/items. Earlier
  attempts remain retained. Seven days and the other two seeds are still pending.
- Assembly repairs: `repair_updo_bindings.py` generated the six exact f_003 Updo-to-female-face
  bindings and updated only the local presentation palette. The imported City Sample body is a
  hands fragment, not a complete bare body; the missing calves were a real gap between short
  hakama and ankle-height tabi. Extended the existing generated calf wraps to overlap the hem.
  Selective garment generation/import rebuilt 18 footwear meshes without deleting the rest of
  the wardrobe. Import report has zero missing meshes or unresolved material sections.
- `.debug/unreal/assembly-repaired-02`: five fresh images, 9 regions, 65.3 seconds; inspected all
  frames. Hair and continuous lower-leg coverage are present; eight visible characters report
  zero unresolved slots and unit driver scales. Clothing fit/style and poses still need polish.
  These images are 888×500: Unreal reduced the requested window to the host work area. The runner
  now uses installed-engine `-ForceRes` and verifies PNG dimensions before accepting resolution.
- Candidate-02 package succeeded in 5m59s at
  `%LOCALAPPDATA%\TornVeilAlpha\clients\candidate-20260923-02\Windows\TornVeilOnline.exe`.
  The new stationary frame sampler is being corrected to include streaming/stale intervals after
  warmup; candidate-02 timing results cannot establish an uninterrupted performance interval.
- Fixed `propose` ignoring its existing 90-world-second duration. It now remains a conversation,
  revalidates proximity and emits once on completion. Two focused tests cover pacing/refusal and
  departure; 11 tests pass with existing demographic/performance regressions. This is the first
  simulation behavior change by the new implementation owner; prior inherited results alone no
  longer cover the whole current candidate.
- Synchronous save preparation no longer deep-clones plain cognition immediately before JSON
  serialization. Exact normalized output hash on the retained 42.8 MB fixture is identical:
  `e6e4b515368e98e5e4cbcee29462ae7d2dc0c3ac2309ff4a1772369c201abb98` (savedAt excluded).
  All 15 persistence/demography/ecology regressions pass. Offline profiling remains above the
  250 ms budget; this optimization is not a performance pass. Reports `.debug/alpha-save-profile-0{1,2,3}.json`.
- Current server source bundled as immutable candidate-03, `0.1.0-alpha.3+0346386aaacb.dirty`;
  running candidate-01 soak remains unchanged. No inherited service or world was replaced.
- Continuation -03 stopped at 0.0854 world days: Maren Hart and Lark Hart use Mosswick's own well,
  266 m from home, beyond the home-anchored 256 m invariant. Water selection instead uses the
  current position. Goal now records a fixed water-choice origin; work/haul still use home.
  Twelve locality tests and `.debug/alpha-continuation-origin-check` pass through 0.15 days.
  Baseline run -04 retains all findings and its durable day-one save. Stopped at 04:21Z after
  observation 1.0597 days because newer behavior fixes superseded it; `termination.json` records
  the reason/checkpoint hash. It is not a seven-day pass.
- The short run exposed 48,515 retained `chop` completions: resource goals shared `chop:` identity,
  so finding a new tree still rebuilt the old exhausted source's plan. Goal identity now includes
  the node ID. A failing-then-passing autonomous test proves traversal to and extraction from the
  next source. Its continuation then exposed real 280–311 m timber choices; selectors now retain
  the existing 256 m home-locality bound. No timer/range relaxation or historical event deletion.
  62 focused tests passed after identity repair; 22 after the locality constraint; typecheck passes.
- Candidate-03 client packaged in 7m14s at `clients/candidate-20260923-03` under the alpha root.
  `.debug/unreal/packaged-1080p01`: 1920×1080, 120 s, 33.56 FPS, p99 42.12 ms, visible village;
  older sampler could reset on stale/streaming intervals. Corrected candidate-03 capture -02:
  120 s, 47.67 FPS, p99 31.86 ms, zero async/stale frames, but mostly occluded by a low roof;
  this is a visual failure and cannot establish village/combat performance acceptance.
- Native camera diagnosis: the actual camera at Z=2661 cm lies in a stall roof spanning
  Z=2597–2906 cm. Regional meshes had no camera collision. Added query-only wall/floor/ceiling
  slabs and pitched roof slabs, including open stalls. Pawn/navigation channels remain ignored.
  Native presentation tests: 15 pass (2 warnings); focused revised roof test passes with a
  missing optional local roof-palette warning. `.debug/unreal/camera-tests-0{1,2}` retains reports.
- Temporary autostart registrations were removed and staging stopped after each attempt.
  `.debug/alpha-autostart-qa-02.json`: task failed `4294770688`; executing the identical runner
  directly succeeded. A read-only scheduled probe exits 42 successfully but cannot see the runner
  path (exit 44). No permissions/security settings changed; task activation remains unproved.
- Roof repair verified at the same Carol position: `.debug/unreal/stall-roof-camera-02/frame-00.png`,
  1920×1080, image reviewed. Closed kit roof wedges require an underside query slab as well as
  pitched slabs. Camera retracts below the roof; walls, door clearance and ignored pawn channels
  have native trace coverage. Candidate-04 package completes in 6m59s, result/log in
  `.debug/unreal/package-candidate-04.log{,.result.json}`; no desktop input was dispatched.
- New-world household locality is explicitly versioned as `playable-2`; old `playable-1` fingerprints
  match exactly for all three acceptance seeds. Save round trips retain people, bodies, places,
  history, clocks and RNG for both versions. Unknown versions fail. 29 generator/playable-world/live
  server tests pass; current typecheck passes. Immutable server `releases/candidate-04` is
  `0.1.0-alpha.4+0346386aaacb.dirty` (schema 24, protocol 1); baseline candidate-01 remains unchanged.
- `.debug/alpha-continuation-current-918273` retains the 0.424-day legacy home-to-tavern failure and
  final save. The new generator constrains the offending civic/work distances without moving any
  existing world's homes. New-layout seed 918272 continues in `.debug/alpha-continuation-housing-918272`;
  existing-layout seed 918271 continues separately. Neither is a seven-day pass yet.
- Two candidate-04 packaged processes connected as p_128/p_129 in the isolated staging world on
  7456. `.debug/unreal/packaged-pair-01` failed rendering because this new server lacked its
  character catalogue; simultaneous connection proof is retained. Server stopped, catalogue copied
  and configured, then restarted preserving its world and people. Corrected capture -02 is running.
- Latest update drill -04 correctly refused to run old r1 against a new generator-2 world: the
  harness initialized using the after-bundle by mistake. Harness now initializes with the before-bundle
  and tracks cleanup before starting. New isolated drill -05 is running; no fingerprint guard weakened.
- Corrected update drill `%LOCALAPPDATA%/TornVeilAlpha/update-20260924-05/update-report.json` passes
  in 67.712 s: old generator-1 world → candidate-04 executable, exact final-live payload/position,
  ownership, reconnect and development isolation. All three drill services stopped afterward.
- `.debug/unreal/packaged-pair-0{2,3}` both pass independent-person/body, simultaneous connection,
  same-world and mutual rendering checks. Both pairs' images reviewed. Pair-02 exposed 1.4 FPS
  under GPU contention; the inherited `.debug/client-trial` used 94.5% GPU and 3061 MB VRAM.
  Verified only its executable paths/PIDs 15668/25028 and closed those obsolete clients at 04:56Z;
  inherited server 8468/supervisor 28536 and save remain running. Audit: `trial-client-retired.json`.
  Pair-03 then measures 34.49/34.13 FPS at 1280×720 for 60 s each, p99 41.71/41.30 ms.
- `.debug/unreal/current-village-1080p02`: current package/server, fresh reviewed 1920×1080 village,
  120.01 s, 5880 frames, 49.00 FPS, p99 32.32 ms, no async-load or stale-snapshot frames. Earlier
  -01 with the old trial competing measured 3.28 FPS and is retained. Combat performance remains open.
- `.debug/unreal/native-realtime-01` passes ten alternating walk/sprint bouts through Unreal's
  PlayerController InputKey: 30 dispatches, 433 cm travel, released-tail stop. This is engine input
  automation, not physical keyboard, login, menu or end-to-end ordinary-play acceptance.
- `.debug/alpha-multiplayer-04` passes distinct ordinary people, own-person-only inventory/needs,
  forbidden developer inspection, ownership denial, superseded connection fencing, stale epoch
  rejection and reconnect identity. Contest remains failed/unverified: travelers have no starting
  items and the bounded dialogue visits found no offered trade. No item was injected to force a pass.
  Earlier -01 rejects invalid numeric names, -02 exposes the empty-inventory assumption; both retained.
- Current full regression exposes a family-trace setup defect: the selected victim was already in
  custody, so canonical nonlethal protection correctly refused the staged assault. The harness now
  selects a free married pair with an injurable subject; it never clears custody or alters the seed.
  Same six causal assertions pass (`motive-family-repaired.log`), and the existing focused test passes
  in 43.64 s. Full run remains ongoing; living-universe's divergence case times out at 32.78 s/30 s.
- New-layout seven-day runs for seeds 918271/918272/918273 are in
  `.debug/alpha-continuation-housing-<seed>`. Legacy 918271 retained its day-one checkpoint before
  being stopped to allocate coverage to the new generator (`termination.json` records hash/reason).
  Current release two-hour observation: `.debug/alpha-soak-current-20260924`, started about 05:04Z,
  staging 7456. No completion or performance pass is implied by starting these jobs.
- Baseline `.debug/alpha-soak-20260923/report.json` is complete: 7200.008 s, 719 samples, no
  status errors/restart/world change, peak RSS 1.23 GiB. FAIL: max serialization 1563.83 ms and
  final sampled debt 2.83 ms (earlier debt clears were observed, but the final zero-debt check fails).
- Weak-worker regression originally let another villager take the open haul, then looked for the
  intended worker's commitment in a compacted event window. The fixture now explicitly claims via
  the shared canonical function, records emitted commitment/delivery events and additionally proves
  multiple trips by that worker account for all delivered cargo. Existing progress/commitment
  assertions remain; `.debug/weak-worker-03.log` passes in 6.69 s. No simulation mechanics changed.
- Attempting to install candidate-04 over an installed dev release was refused by the first-install
  guard. Old dev candidate was restarted unchanged, with its backup and world preserved; see
  `.debug/alpha-candidate-update-04.json`. No manual release-pointer override was used. Human review
  now has a separate `alpha-human-current` profile for the running candidate-04 staging server, 7456.
- Dialogue projection previously truncated the canonical menu to nine choices, hiding a valid
  request and Goodbye in an 11-option conversation. It now projects every revision-fenced choice.
  The native scroll panel follows focus and labels only the first nine numeric shortcuts. A causal
  bridge test selects the late request, verifies learned provenance and rejects replay; five focused
  tests and typecheck pass. `TornVeil.Presentation.CommonUIProjection` passes (1 test, zero warnings)
  in `.debug/unreal/dialogue-overflow-tests`; editor build 49.98 s. This is not ordinary UI acceptance.
- Candidate-05 client packaged in 6m44s to `clients/candidate-20260924-05`; matching server bundle
  `candidate-20260923/releases/candidate-05` is `0.1.0-alpha.5+0346386aaacb.dirty`, schema 24,
  protocol 1, generator playable-2. No progression rates changed.
- `.debug/alpha-multiplayer-05/report.json` passes all 13 real-service protocol checks (4.675 s).
  Existing ordinary accounts `contest04-a/b` were reused, acquired flour through a projected Trade
  menu, dropped it and concurrently requested pickup. One request applied and one was rejected;
  exactly one holder and both inventories survived save/reconnect. No objects, money, placement or
  developer permissions were injected. Earlier failed acquisition attempts remain retained.
  The harness now sends movement at receipt cadence rather than inadvertently limiting it to the
  10 Hz snapshot rate. Native UI and second-device acceptance remain separate.
- Offline checkpoint experiments retain exact JSON output but do not establish the stall budget:
  `.debug/binary-capture-profile-01.json` takes 381–393 ms for binary capture versus 329–350 ms
  direct JSON; no worker was implemented. A checksum-verified portable Node 26.10.0 was downloaded
  outside the checkout for profiling only; no PATH, live runtime or firewall change. Default
  serialization still takes 300–327 ms on the retained 63.8 MB day-one save. Splitting JSON encoding
  into root fields/array batches measures 145–222 ms on Node 26, but not on installed Node 22.
  Reports `.debug/node26-save-profile-01.json` and `.debug/json-chunks-node{22,26}.json`.
  This remains an experiment, not deployed code or a G8 pass. Runtime rationale:
  [V8 JSON encoding optimization](https://v8.dev/blog/json-stringify),
  [Node 26 engine update](https://nodejs.org/en/blog/release/v26.0.0).
- CPU profile of a separate day-one save continuation (`.debug/runtime-day1.cpuprofile`) identifies
  perception/knowledge pruning as the largest measured simulation cost. It does not alter the three
  acceptance continuations. The older candidate-01 baseline dev service on 7451 was cleanly stopped
  after its completed soak, preserving generation 170 and all state; inherited service 7441 is untouched.
- Full regression-03 started 05:31Z, PID 22076, bounded to one hour, one Vitest worker and unchanged
  assertions/timeouts. Evidence `.debug/alpha-regression-03.log{,.stderr,.result.json}`. Current
  release observation 7456 and all three continuation processes remain independent.
- Candidate-05 fresh rendered capture `.debug/unreal/candidate05-village` passes readiness/freshness
  and image review: 1920x1080, 60.01 s / 2,978 frames, 49.624 FPS, p99 31.436 ms, no stale or
  asynchronous-loading frames during measurement. Clothing remains a rough prototype; this is
  neither a visual-polish signoff nor an ordinary play session.
- New continuation failure: `.debug/alpha-continuation-housing-918273` stopped at 1.144444 days.
  Orla Juniper selected an idle sawpit 8,342 m from home because the regional vacancy scorer allowed
  other motives to outweigh a zero proximity score. `standInCandidacy` now applies the existing
  daily locality bound before scoring. Two regressions failed on the old behavior; all three new
  tests plus existing locality/adaptive tests pass (37 total). The untouched failing save, stepped
  for 30 physical seconds under the fix, naturally chose local work and passed the locality check
  (`.debug/stand-in-restored-check.json`). No person, goal or history was edited to achieve that.
- Earlier housing runs for 918271/918272 were cooperatively stopped at 1.195833/1.455556 days with
  exact final saves. Run-03 regression was stopped at 05:40Z before the source edit; its interruption
  record explains the nonzero exit, and it is not a suite pass. Fresh seven-day runs under the fix:
  `.debug/alpha-continuation-standin-91827{1,2,3}`, started 05:43Z, four-hour bounds each.
- Server candidate-06 (`0.1.0-alpha.6+0346386aaacb.dirty`) contains the locality fix; client code is
  unchanged from candidate-05. The disposable update-06 drill passed 12 checks for candidate-04
  to -05 (53.674 s). That same isolated world subsequently rehearsed and updated -05 to -06,
  preserving world `tvo-live-d9acc7c7-5e3f-43a7-80b6-0880b96e60b0`, generation 25 and 755.7 physical
  seconds. Backup `live/backups/20260924T054703Z-gen-00000025`; evidence
  `.debug/candidate06-rehearsal.json` and `.debug/candidate06-update.log`.
- At 06:20Z the isolated review service became candidate-07 on loopback 7458; candidate-08 supersedes
  it below after a reproduced autonomous-planning crash.
  Root `%LOCALAPPDATA%/TornVeilAlpha/update-20260924-06`; live state, credentials and backups remain
  under its `live/` directory. Staging is stopped. `alpha-human-candidate05` is an ordinary unused
  account/profile for this service; the name identifies the compatible client package, not server code.
  Inherited service 7441 remains untouched; candidate-04 soak service 7456 was cleanly stopped after
  its completed observation at 07:04Z, preserving final generation 158 and its multiplayer world/backups.
- Full regression-04 completed at 06:16:08Z: 124 files / 1172 tests pass in 1712.67 s, one worker,
  unchanged assertions/timeouts. `.debug/alpha-regression-04.log{,.stderr,.result.json}`. No canonical
  edits occurred while it was running; the subsequent dialogue changes have affected coverage below.
  A further offline event-prefix cache experiment was slower (438–546 ms, byte-identical JSON);
  `.debug/event-cache-node22.json`. It was not added to the serializer.
- Packaged candidate-05 against server candidate-06 completed 120 native input dispatches
  (60 attacks, 60 crouches) in the ordinary review village. The 140.013 s ready-render interval
  contains 6,811 frames: 48.646 FPS at 1920x1080, p99 32.031 ms, zero loading/stale frames.
  `.debug/unreal/candidate05-combat-actions` contains reports, log and reviewed fresh image.
  Sixty predicted attacks rendered; the final canonical attack sequence was 22.
  No hit contacts occurred; dispatch count alone does not prove every request executed. This proves sustained action presentation, not combat
  with an opponent, an ordinary UI session, or a physical input-to-photon measurement.
- An ordinary socket-only lesson probe created Mira Vale (`p_130`) on the isolated 7458 review
  world with the normal 20 silver. Attempts 01–03 did not find a teacher: initial perception
  needed a snapshot, then observed children/other travelers supplied no lesson. Attempt 03
  walked 12 bounded exploration waypoints in 138.762 s without injecting a teacher or supplies.
  Attempt 04 followed chapel geometry received through the normal regional presentation protocol,
  opened its actual door and arrived inside in 87.238 s; no teacher was observed and no lesson occurred.
  These attempts are retained under `.debug/ordinary-lesson-0*`; none is a gameplay pass.
- Dialogue boundary reproduction `.debug/dialogue-boundary-before.json` found twelve identical
  unfamiliar-person contact choices and accepted a previously offered knowledge transfer after
  the player moved 30 m away. Three new regressions failed on the old code (departed, sleeping,
  named-contact provenance). Dialogue choices now revalidate the stored speaker body against the
  current canonical talk affordance; failure closes the menu without applying its closure. Contact
  lists transmit names known by the speaker through a causal told event, retaining source, confidence,
  hops and false aliases rather than reading canonical names. Unknown-to-both contacts remain unnamed.
  All eight affected tests in three files pass (`dialogue-boundary-after.log`); typecheck and production
  build pass. These edits followed full run-04 completion and do not affect NPC-only continuations.
- Immutable server candidate-07 (`0.1.0-alpha.7+0346386aaacb.dirty`, schema 24/protocol 1) was built
  at 06:18:27Z. Rehearsal passed in 21.78 s; real update passed in 13.28 s, preserving the review world
  and generation 62 / physical time 2736.9833. Pre-update backup:
  `update-20260924-06/live/backups/20260924T062013Z-gen-00000062`. Evidence:
  `.debug/candidate07-rehearsal.log{,.result.json}`, `.debug/candidate07-update.log{,.result.json}`.
  Client candidate-05 remains compatible and unchanged. No progression rates or runtime were changed.
- Additional bounded ordinary lesson probes 05-10 used only projected geography, visible bodies,
  enumerated door interactions and dialogue. The harness initially mishandled fence gaps and narrow
  doorways; those navigation failures are retained, not attributed to canonical movement. Attempt 08
  observed the deployed source-preserving contact names in live conversation; none completed a paid
  lesson. Attempt 09 timed out after its connection was superseded by attempt 10; it is not independent
  acceptance evidence. Attempt 10 completed its 260 s bound after three accepted conversations,
  still without a teacher. No skills, wealth, position, NPCs or items were injected.
- A deep-validated full event-cache experiment also failed the save budget: warm encodes 385-424 ms,
  cold 531 ms, 1.85 GB RSS, despite byte equality and eight nested/scalar mutation checks. Evidence:
  `.debug/validated-event-cache-node22.json`. It remains offline and was not deployed.
- Read-only scheduled-task diagnostic `.debug/alpha-autostart-path-03.json` confirms the same
  `BERNHALDT\\green` identity executes, but `Test-Path` cannot see the isolated alpha root (exit 45).
  The temporary task was removed. No ACL, elevation, execution-policy or network changes were made;
  scheduled startup remains unproved, with a task-context filesystem visibility blocker.
- Candidate-05's attack capture also shows the avatar overlapping an exterior table bench. Canonical
  arrival checks across eight slots and all three seeds find no voxel furniture/solid overlap
  (`.debug/arrival-space-before.json`). The offending bench is decorative place dressing; its clearance
  checked only a guessed radius and ignored the place's canonical arrival/activity point. The native
  regression first fails on an intruding streetlight (`dressing-before-tests`). Dressing now measures
  the installed mesh at its actual uniform scale and protects canonical inside points, doors and whole
  path/fence cells. Native presentation suite passes all 16 tests (two existing warnings: isolated-world
  light teardown and an optional roof-palette fallback)
  in `.debug/unreal/dressing-after-tests`; the new test checks actual installed instance bounds against
  eight arrival slots, rebasing, retained decoration, and the no-collision/no-navigation boundary.
  Editor builds pass (`dressing-{before,after}-build.log`); candidate-06 client packaging completed
  at 07:09:37Z in 450.48 s (`.debug/unreal/package-candidate-06.log{,.result.json}`).
  No player save is relocated and no simulation code changed.
- `.debug/alpha-soak-current-20260924/report.json` completed at 07:04Z: 7200.013 s / 719 samples,
  eight of nine checks pass. Same world, uninterrupted service, advancing clock, zero-client periods,
  debt clearing and RSS 752,193,536 bytes are observed. Serialization is the sole failed check,
  474.2161 ms. The candidate-04 staging service on 7456 was then stopped through its installed ops
  command, final generation 158; no current review or inherited deployment was stopped.
- Candidate-06's first observation (`candidate06-village`) was fresh but showed open terrain:
  observer p_129 had moved after disconnect under autonomous life. It is not village-clearance
  acceptance. A new ordinary account `arrival-observer06` / profile `alpha-arrival06` created p_131
  through the native connection. The first arrival capture failed during a server crash; its timeout
  and missing frame are retained in `candidate06-arrival`.
- Candidate-07 began crashing at 07:09Z and entered a restart loop after generation 114. Exact
  checkpoint replay (`.debug/offline-crash-before/report.json`) identifies p_129, no home/work,
  hungry in wilderness, selecting a food search with no known square. The fallback dereferenced
  undefined `inside`. Wandering now uses the current body when no known square/home exists;
  worship likewise supports no known chapel/home. No place, knowledge or relocation is invented.
  Both focused cases fail before the repair (`unsettled-before-02`); known-square RNG behavior
  remains unchanged. Exact unchanged generation 114 advances 120 physical seconds after the fix
  (`offline-crash-after`, 14.57 s). Its SHA256 is
  `093b7d6d9c4bf870008be24ba83992c604ccafdbd4373caf978bad02a156e807`.
  The save/meta and crash logs are additionally retained outside git at
  `%LOCALAPPDATA%/TornVeilAlpha/failure-evidence/20260924-0714-offline-traveler`.
- The crash exposed an operator stop defect: candidate-07's `ops.mjs stop --env live` timed out
  waiting for the exited writer's stale lock. Stop now waits for supervisor exit, refuses a live or
  unidentifiable writer, and releases a known dead writer through the existing fence API. It reports
  the latest verified durable generation and whether a fresh clean shutdown actually occurred.
  Real recovery: `candidate08-stale-stop.log`, generation 114, cleanShutdown=false, stale fence
  released; no historical state or checkpoint was modified.
- Candidate-08 verification: `.debug/unsettled-after.log` passes 29 tests in 4 files (75.92 s);
  `alpha-typecheck-08.log` and `alpha-production-build-08.log` pass. Immutable server
  `candidate-20260923/releases/candidate-08` is `0.1.0-alpha.8+0346386aaacb.dirty`, schema 24,
  protocol 1, Node 22.23.2. Rehearsal on the crash checkpoint passes in 23.74 s, then update passes
  in 8.85 s (`candidate08-{rehearsal,update}.log{,.result.json}`). Same world and all ownership,
  generation 114 / physical time 5801.35 preserved; pre-update backup
  `live/backups/20260924T072512Z-gen-00000114`. Current review service: supervisor **27544**,
  writer **5940**, port **7458**, same external `update-20260924-06/live` state. Staging is stopped.
- Fresh packaged `candidate06-arrival-02` against server candidate-08 completed at 07:26:50Z:
  60.0099 s / 2981 frames, **49.675 FPS**, p99 **31.156 ms**, 1920×1080, nine regions, zero loading
  or stale-snapshot frames. Image reviewed: village and nearby people visible; arrival character
  clear of the former overlapping table/bench. This is rendered-observer evidence, not ordinary
  input, interface, combat or final art acceptance. First mismatched-scene/failed captures remain.
- `scripts/alpha/continue-world.ts --resume <finished-segment-directory>` now resumes only the
  final save paired with a finished report, checks seed/target/cadence/geometry/ticks and available
  save hash, carries findings/event counts/episodes/original time and population, and records source
  hashes. Legacy reports disclose the absent prior hash and recover population from their first
  retained observation. Never resume a running segment or use a day-save with its later report.
  Three tests pass (including restored scheduler/RNG/event continuity and mismatched-source
  rejection); `.debug/continuation-resume-cli/report.json` proves a real cooperative stop and
  resume to the same .002-day total. This small harness proof is not seven-day acceptance.
  The existing three four-hour continuations were not restarted or silently upgraded.
- Handoff observation at 07:29Z: candidate-08 has zero supervisor restarts, generation 118,
  RSS 442 MB and zero sampled debt; worst serialization already 308.624 ms, so the performance
  gate is still failed. No packaged client/build/cook process remains active.
  The continuing seed 918271/918272/918273 jobs are PID 28304/22440/15012 at
  2.923611/3.008333/3.008333 days, with no findings so far. They retain separate logs/day saves
  in `.debug/alpha-continuation-standin-91827{1,2,3}` and stop at their four-hour bound near
  09:43Z. The new resume option is available only after their final report/save is complete:

  ```powershell
  node --import tsx scripts/alpha/continue-world.ts --seed 918271 --days 7 `
    --timeout-seconds 14400 --resume .debug/alpha-continuation-standin-918271 `
    --out .debug/alpha-continuation-resumed-918271
  ```

  Repeat with each matching seed and a new output directory; inspect retained findings rather
  than bypassing them. Resumed runs disclose their source report/save hashes and are not uninterrupted
  service-soak evidence. Inherited service 7441 remains untouched.

## 50/100 continuation (2026-09-25)

Recovery. The authoritative checkout was verified (branch, HEAD `0346386`, 96 dirty paths, mixed
staging) and pinned without touching index or worktree: `refs/checkpoints/living-alpha-resume-20260924`
(stash-commit object) plus staged/unstaged binary patches and an untracked archive in
`%USERPROFILE%\TornVeilAlpha\source-checkpoints`. `%LOCALAPPDATA%\TornVeilAlpha` does not exist for
ordinary processes: every earlier alpha root, package, world and client profile was written inside
the MSIX Codex app's private store (`...\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local`).
That also explains the scheduled-task "cannot see the alpha root" failure. All earlier services
had stopped at 17:57 CDT with durable saves; none was restarted or unlocked. Operator state now
defaults to `%USERPROFILE%\TornVeilAlpha`.

Slice 1 (PR #51, commit `0dd7827`): capture fencing, honest readiness, operator home, stop repair,
and the continuity repairs. Isolated tree of exactly that commit: typecheck clean, 366 files /
1188 tests pass, production build passes, WorldLab smoke DEGRADED without failures (`main` FAIL).
The six hosted-gate timeouts reproduce with equal durations on `main`
(`docs/evidence/living-alpha/PR-GATE-DISPOSITION.md`).

Findings fixed in this session (each with a regression that fails on the unfixed code):
- Critical thirst never overrode perceived threat, so a frightened villager dehydrated for six hours.
- Introductions repeated every ~150 world seconds for days, because the check read bounded
  memories: 27,055 introduction events among 131 people, 17 MB of knowledge, much of the
  128 MB, 745 ms checkpoint of the candidate-08 world.
- Combat could never touch an animal: humanoid-only hurt volumes, and animals were not contact
  candidates. The earlier hunt test only passed through injected `applyHit`.
- 30-day-old piglets charged and gored at adult force.
- Ordinary life produced seconds of development per day. Iron needed ~30,000 effective hours and
  all seven foundations; martial practice was never wired into the running world; see
  `docs/LIVING_ALPHA_PROGRESSION.md`.
- An Ashford villager in a body with baked-in modern clothing (resolver forbade `modern` only on garments).
- Boars and hares rendered with the deer mesh; the client never received an animal's display,
  charge or strike wind-up, so dodges could not be timed.
- The regional world had no purchasable blade (the old village did), so a hunt could not be prepared.

- A paid lesson could be forgotten within days. Technique knowledge sat in the generic retention
  tier, so a busy mind evicted it silently: the seed-918271 Iron journey lost the veil on world
  day 2.8 while hushing daily. Techniques now share the practical tier (`80c9317`).
- The martial Iron path could never pass. The assessment read a trade `skill` field that martial
  knowledge doesn't have; its test had hand-built the wrong shape of claim (`3a90e20`).
- A protection request out in the open said nothing about where to look. It now says where the
  requester saw the animal, from their own claims: "north-east of Pikewick" (`bbcc2cb`).
- The tavern's skinning knife lay off the display, so a stranger could only take it (`27bde48`).
- A refused suitor proposed again on every decision cycle: 1,426 courtship events in six days on
  seed 918271 (`5cab848`).
- Livelihood prospects scanned every workplace in the region. An elder on seed 918272 set off
  for a mill 11 km away (WorldLab `WL-LOCALITY-DISTANT`) (`e71a654`).
- Kosode collar: a plank across the nape, then an X across the chest; now a wrap that tucks under
  (`d89b35e`, `6c7ba90`).

### Acceptance record (2026-09-25)

Full suite at `e71a654`: **1216/1216**. Typecheck clean. Each fix above has a regression test that
fails on the unfixed code.

| Area | Result | Evidence |
|---|---|---|
| Server release | `0.1.0-alpha.12+1c8b317f6075` built clean | `%USERPROFILE%\TornVeilAlpha\releases` |
| Live update | PASS. alpha.10 → alpha.12, rehearsed on a live capture first; drain, clean stop at generation 348, pre-update backup `D:\TornVeilAlpha\backups\live\20260925T131125Z-gen-00000348`, same world, clock continues (20516.87 → 20517.23 s) | ops output |
| Reconnect after update | PASS. The packaged client at `1c8b317` rejoined live as its existing person | `.debug/unreal/1c8b317-village` |
| Recovery drill (alpha.12) | PASS, 14/14 in 53 s: writer crash, restart, corrupt-newest fallback, interrupted write, backup restore, same-person reconnect | `%USERPROFILE%\TornVeilAlpha\drill-recovery-alpha12\recovery-report.json` |
| Two packaged clients | PASS on staging (the pair script refuses live by design): one world, separate people and bodies, overlapping connections, each sees the other | `.debug/unreal/pair-1c8b317-b/pair.json` |
| 2 h soak, zero-player period | **FAIL** on one check. Pass: full duration, same world, uninterrupted, clock advancing, RSS peak 541 MB, scheduler debt clears, event-loop p99 32.6 ms, zero-client period observed. Fail: checkpoint serialization peaked at 311 ms (limit 250 ms) | `.debug/soak-live-alpha10/report.json` |
| Emergent adventure | See below | `.debug/adventure-*-918273` |
| Normal → Iron | **Not demonstrated.** Measured: see below | `.debug/iron-estimate.ts`, `.debug/iron-journey-veil-918271` |
| 7-day continuations | See below | `.debug/alpha-continuation-1c8b317-*` |
| Autostart | Prepared; **needs you**. Registering the logon task was refused to this agent as persistence | `Install-Autostart.ps1 -CheckOnly` |

**Soak finding.** With nobody connected, the checkpoint grew from 8 MB to 34.5 MB in two hours of
a fresh world (about half a world day). Serialization grew with it, stalling the loop for 0.3 s
once a minute. Compaction keeps the latest 4,000 events plus every event that living
cognition references. Knowledge and memories pin routine `perceived`/`told` events: 13.5k of
35.9k retained. Encounter observations (about 600 B) are stored in the event and again in the
knowledge claim. Growth levels off only when every mind's 400-item knowledge cap is full:
estimated ~55 MB and ~450 ms. That needs a persistence change (incremental or off-thread
serialization, or leaner provenance pins). It has not been made.

**The emergent adventure** (seed 918273; seed 918271 raised no animal threat in seven days). A
boar menaces villagers north-east of Pikewick in the world's first hours. Asking around for work
turns up the request: "A woodland boar is menacing people north-east of Pikewick … 8 silver".
- *Hush approach* (`stilled_unpaid`): the player learned the hush from the keeper for a fee, found
  the same boar, was resisted six times across two strain cycles, rested, and calmed it on the next
  session; it now avoids people. The requester would not pay: nobody saw the hush, and their trust
  in a stranger (0.03) is below what a word needs (0.35) — "I'll believe it when I see it. Bring
  me proof it's done". Silver conserved (0 moved). The request stays open until they learn
  otherwise or it expires.
- *Hunt approach*: see the hunt report (`.debug/adventure-hunt-918273/report.json`). An earlier run
  without a blade fought the boar bare-handed, was downed repeatedly and could not kill it.

**Iron.** Under the current curve an ordinary adult needs ~140 (potential 13) to ~280 (potential
11) world days of deliberate daily practice. Support foundations reach 11 in ~20–40 days; the long
pole is two core foundations at 15, which beyond 13 develop only through strain-limited hush
attempts or equivalent real challenge. The live time scale is 6, so a world day is 4 real hours;
that is hundreds of hours of play for the first rank. The balanced 10-day journey matches the
estimator (day 3: strength 8, dexterity 9, endurance 9, vitality 8, will 11). This is a pacing
decision about the canonical curve, which also governs every NPC. It is left for you, not retuned
to fit a demonstration. Options: a higher rate for challenge above routine (NPC routine work would
be unchanged), lower Iron cores (for example 13 core / 10 support), or both.

**Known presentation defects** (packaged client, `1c8b317`): new arrivals spawn almost on top of
one another; the sash knot reads as a lump on the back; a villager can stand inside a crate block
(crates are solid but walkable at cost 20, and the body stays at ground height); the player body is
still the plain mannequin.

## Local player review and operator commands

State lives in `%USERPROFILE%\TornVeilAlpha` (not `%LOCALAPPDATA%`, which MSIX apps virtualize).
Live runs `0.1.0-alpha.12+1c8b317f6075` on port 7400 (loopback and the Tailscale address), with
backups on `D:\TornVeilAlpha\backups\live`.

Play from the packaged client (profiles `green` and `green-second` target live):

```powershell
& ./unreal/scripts/Start-AlphaClient.ps1 -Package "$env:USERPROFILE/TornVeilAlpha/clients/client-1c8b317" -Profile green
```

| Control | Action |
|---|---|
| WASD, mouse, wheel | Move, look, zoom |
| Shift | Sprint |
| E | Talk / interact (ask "Any work going?") |
| I | Inventory |
| P / Escape | Menu / close |
| Left mouse / X | Light attack; dodge and duck keys for evasion |
| Z | Rest / wake |
| H | Hush (requires learning it from a keeper) |
| V | Meditate on the veil |
| G | Train alone (drills) |
| B | Attempt the Iron breakthrough |
| F5 | Request a durable save |

Operator commands (use the ops of the installed release):

```powershell
$ops = "$env:USERPROFILE/TornVeilAlpha/releases/0.1.0-alpha.12+1c8b317f6075/ops.mjs"
node $ops status --env live
node $ops backup --env live
node $ops rehearse --release <new-release-dir>   # capture live → staging, run, probe, stop
node $ops update --release <new-release-dir> --seconds 60
```

Never run `init` against existing state. Restore needs the service stopped (`backups`, `restore
<name>`, `start`). Never copy staging back into live.

Autostart at logon needs no administrator rights, but you must register it yourself:

```powershell
& ./scripts/alpha/Install-Autostart.ps1 -AlphaRoot "$env:USERPROFILE/TornVeilAlpha" -Environment live -Trigger Logon
```

Boot-time start (`-Trigger Boot`) needs an elevated shell and a real reboot to prove. Off-host
backup needs a destination you choose; `D:` protects only against losing `C:`.
