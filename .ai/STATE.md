# Current candidate: integrated universe traversal release (2026-10-20)

Current published implementation528898c also passes20 independent restart checks and read-only checkpoint21126 restore. Latest21 camera/cutaway/interior/boundary checks, TypeScript and web build pass. The unendowed combat campaign proves actual dagger contact and injury/learning/equipment retention, but town return is correctly rejected while a visible warden threatens (Break contact before returning). Escape/return/reentry and held-guard queue congestion remain acceptance work. [Gameplay evidence](evidence/universe-release/gameplay-follow-up/RESULTS.md).

PR72 stays draft. Current-head CI is running; prior02bb green does not certify corrected code. Original7533 remains untouched and its approved shutdown is tool-policy blocked. Its background tool PTY is not a visible PowerShell terminal; the app open request was only queued. No manual terminal hunt, force kill or alternative-control bypass.

Implementation956e837 passes54 ordinary traversal checks and20 same-save restart
checks on owned7534, plus12 repeated short taps under the unchanged0.75m limit.
67 input/API/QA checks,11 lighting/boundary checks (overlap), TypeScript and final
web build pass. Existing ambient lighting improves night/space readability.
The separate fresh town/Tower/combat pass is in progress. PR72 stays draft:
original7533 exact-save restart remains tool-policy blocked despite explicit
shutdown approval, and corrected final-head CI remains required. Work is in
`torn-veil-universe-input`; old7533 source/save stays frozen. See
`docs/UNIVERSE_RELEASE.md` for evidence, preserved failures and remaining work.

Combines traversal with public main `8a9fa58`, earned progression and the current
John Smith authority. Writer schema 33 preserves both independent schema-32
histories; legacy Tower silver stops after the current authority is initialized.
Published draft PR72 now has browser-verified implementation `4cde1b4`:53 ordinary
journey checks pass, including foreign reload and full town return. Exact host
restart and final-head CI remain required. See `docs/UNIVERSE_RELEASE.md` for current
evidence and remaining limits. Historical private ancestry remains local.

# Previous candidate: Levels and the Normal→Diamond ladder (2026-10-19)

Branch `claude/vigilant-dirac-3f6zc3`. Adds `src/sim/progression/{levels,experience,threat,persistence}.ts`:
exponential levels (ten per rank, Normal–Diamond) fed only by canonical receipts for players and
NPCs, rank vessels applied by every breakthrough, level-gated embodied Bronze–Diamond trials, a
source Diamond row, capability threat for people/animals and item grades, schema 32. Existing
Normal→Iron and Iron–Gold source gates are unchanged. Current Tower content tops out near
Iron-band threat, so higher-band levels and Diamond are reachable mechanically, not yet in play.
`AGENTS.md`, named by `CLAUDE.md`, is absent from this checkout. See `docs/LEVELING_AND_RANKS.md`.

# Previous: Focused Babylon reconciliation (2026-10-14)

The intended game is the canonical third-person town, forest and Tower using the
verified focused asset pack. `a0c8692` preserves both local-main `6114afe` and
ontology `dc9e07c` histories without changing the runtime tree. Retain authored
upright motion, metric imports, earned progression and persistent shared-world
identity. Unreal and historical labs remain preserved. See
`docs/INTEGRATION_OCT14.md` for conflict decisions, asset-storage policy and
verification. This candidate note is not a claim that GitHub main has changed.

# Previous: Consolidated Babylon build (2026-10-11)

The consolidated build combines current human presentation, connected realms, canonical
Tower persistence and input/posture repairs. `6423888` passed 2,237 tests and its
exact compiled 24-check journey. Review then found schema-30 compact-save rejection;
the compatibility repair passes 32 affected tests and TypeScript. Final aggregate
passes 2,248 tests in 230 files; production bundle and World smoke pass (two retained
finite-timber warnings). The exact repaired build/journey is recorded locally in
the delivery receipt (clean1a4ecdc,24checks,0browser errors). Full source ancestry remains private on
`codex/consolidate-main-oct11`; the tree-identical release snapshot uses
`codex/consolidate-main-oct11-sanitized`. Publication is authorized and PR #66
tracks independent final-head CI and main landing. Use the clean main checkout and
primary launcher; its manifest/health report the exact served commit. See
`docs/CURRENT_STATE.md` and `docs/evidence/main-integration/RESULTS.md`. Prior evidence
below stays scoped to its checkpoint. New Gold source promotions are paused. Source
branches and rejected private candidate work remain preserved.

# Previous: Grounded human attention, sound and light (2026-10-10)

Continuation on `codex/ontology-human-motion` from pushed `679ce9a`. The user's
Witcher 3 benchmark now has cross-system acceptance gates and a staged sequence
in `docs/web/QUALITY_TARGET.md`; overall production parity remains open.

Imported adults use bounded per-foot terrain height/normal correction and
additive neck/head attention from projected targets. NPC attention resolves the
actual projected entity to nearby visible bodies (including multiple bodies),
instead of substituting the player. Contact-timed layered surface Foley follows
the shared pose support, including mixed gait fallback, and nearby NPC stereo
stays anchored to the player's hearing position. Projected floor/water lookup
handles raised wood, stone interiors and bridges. Daylight sun/fill balance
improves shaded clothing/facades without raising sky exposure.

65 focused tests across nine files and TypeScript pass. Imported-rig browser
checks passed 18 terrain and 16 gaze cases; canonical keyboard combat/movement,
flat-ground regression, five audio surface renders and six lighting conditions
passed. A fresh GPT-6.1 Sol reviewer found one floor/water sound lookup defect;
it is fixed with integration coverage. The final production build and audio
recheck pass: six walking and seven running contacts, no idle/stopped chatter,
five valid surface renders and zero page errors. Evidence and reproduction are
recorded in `docs/evidence/human-world-quality/README.md`.

Limits: terrain fixtures are controlled, not all-cast moving stairs; no pelvis,
eye/facial/cloth overhaul; audio is synthesized and needs listening review;
faces/interiors, encounter polish, first-hour play and long-session performance
remain production gates. Canonical ontology/movement/combat authority is unchanged.

# Previous: Fluid human motion and fitted adult models (2026-10-10)

Continuation on `codex/ontology-human-motion` after pushed checkpoint `a097d62`.
GPT-6.1 Sol workers improved adult garment fit and imported-rig foot contact.
Wren/Brann exports retain 53 named bones and garment topology, with fitted
trouser coverage and less glossy fabric/leather. Contact-aligned travel clips,
critically damped normalized fades, owned guard-leg crossfades and diagonal
hysteresis reduce pose interruptions. Baked travel contacts supplement bind
ankle calibration; continuous reach projection bounds foot correction.

32 focused tests pass across this slice, including affected foot tests rerun
after the final bounded release adjustment. Controlled 60 Hz imported-rig
comparison measures approximately 55% less walking slide and 30% less running
slide; other directions also improve. Maximum all-frame foot displacement is
no worse than the uncorrected pose in the six controlled scenarios. This is
bounded evidence for one imported rig, not a universal smoothness claim.
Blender reimport checks preserve rigs/topology and reduce garment intersections;
extreme crouch seams still have contacts. Final TypeScript, production build and
headed canonical browser acceptance pass; independent GPT-6.1 Sol review reports
no actionable findings. Evidence is in `docs/evidence/fluid-human-models/README.md`.

Canonical ontology and mechanics retain the preceding checkpoint's boundary.
Further terrain/sole adaptation, clip seam refinement and broader cast wardrobe
work remain; this is not completion of the full ontology or production art.

# Previous: Ontology ownership and human motion (2026-10-10)

Branch `codex/ontology-human-motion` integrates main `10a648b` with the existing
controller/Tower branch. Canonical manifestation attachment validates ownership
and registry identity; living-body selection and graph diagnostics preserve the
zero-or-many body model. Shared adult animation follows canonical action phases
and direction, and resumes ordinary movement after completed actions. Procedural
child/fallback gaits use distance-paced IK; Blender kits have authored faces/eyes
and repaired garment coverage. The visual ontology editor shares motion loading
with bounded asset cleanup. Implementation checkpoint `77dc178` is pushed.

Focused tests, TypeScript, Babylon build, ontology tests/build, real keyboard
combat/movement and 18 measured procedural gait cases passed. Full regression
passed: 195 files / 1,925 tests. The user's walking reference now guides a closer,
lower exploration camera and bounded secondary motion on compatible rigs.
Authored grid-tree canopies now render through shared vegetation instances, with
exact trunk collision retained and no new resource identities. Final build,
TypeScript, tree/streaming checks and third-person browser acceptance passed.
Independent review's outdoor-timber classification finding is fixed; 12 geometry
tests and TypeScript passed afterward. No other actionable findings were reported.
Evidence, reproduction and limits: `docs/evidence/ontology-human-motion/README.md`.
Sharp-turn foot sliding, clip contact calibration and further character-art polish
remain open; this is not completion of the entire ontology or production art.

# Previous checkpoint: lossless late-floor persistence (2026-10-09)

Runtime: `7efb13c4eb06ab30aecea99dc41cbe1a3437a39d`; complete source/runtime
migration fence: `89ed176d95bcb0a38e29a42bdd7a5ed0dda2711c`.
The isolated `codex/connected-realms` host now durably journals ordered operations
and uses one replay worker for lossless gzip checkpoints. Original JSON imports
remain intact; the active save is `<save.json>.store/`. Canonical history, NPC
knowledge, injuries, rewards, identities and earned proofs remain in the full
snapshot. Queued input and portal choices have private continuation metadata;
restart/disconnect releases old input. Idle movement spam is removed, and congested
trailing movement is explicitly cancelled without crossing action barriers.

Focused verification: 50/50 in five files; TypeScript and web build passed.
Final normal aggregate: **2,120/2,120 tests in 213 files**, 31m 17.60s, exit 0,
after the complete-fingerprint repair. The runtime was frozen for this run.
Two actual summit browser recordings passed nine checks each, including repeated
saves, background checkpoints, reload, Tower return and portal round trips.
Real floor-95 and summit replay matched every canonical snapshot field; interrupted
worker and stopped-process recovery retained durable state without duplicate rewards.
No new 100-floor calibration was run. No human playtime claim is made.

On the copied summit save, old synchronous saves measured a 2,307 ms median;
six journal flushes measured 3.97 ms. A 315.6 MB full snapshot compressed to 49.5 MB.
Full capture runs on the worker. Structural Tower transitions still retain one
synchronous rollback capture, and observed simulation/GC spikes remain. Compression
does not bound logical history growth. Two retained compressed generations and the
original import require more total storage than one compressed file.

Gold rules are unchanged. The report explains the lifetime proof-cap lockout and
weak-opponent contribution problem and proposes separating permanent causal proof
from reviewed, stage-relevant current-capacity assessment. Thresholds/rank meaning
were not redesigned. Megacity/art gates and broader human calibration remain open.
See docs/TOWER_PERSISTENCE_OCT9.md and docs/evidence/tower-stability-oct9/RESULTS.json.
No protected Tower-polish worktree was changed. No push, merge or deployment occurred.

# Previous checkpoint: earned source growth and floor residency (2026-10-09)

The isolated `codex/connected-realms` branch extends the same canonical Person/Body
with an explicit finite-source advancement route through Gold, physically stronger
warden kits, eight-litre floor water reserves and bounded inactive-floor updates.
The existing multi-day embodied Iron route and full ontology ladder are preserved.
Gold is not awarded by a floor count; summit recognition requires already-earned
Silver. Save schema 31 reads 24-31 and validates the new receipt/material evidence.
Runtime: 194cc456171b151fefed8def0d9f234d130a0fef; final test-contract update: 39db5ed.

Final normal aggregate: **2,110/2,110 tests in 212 files**, after three old schema
literals were repaired and the complete suite rerun. Focused checks: 46/46;
affected schema files: 20/20. TypeScript and production web build passed.
Three actual recordings passed 23 browser checks: earned Bronze integration/portal
journey, a Silver floor-47 victory, and completed summit reload/return/portal journey.

One retained input-strategy history cleared 100 floors as Silver; another cleared
94 and timed out on floor 95. Silver was earned on floors 44 and 45 respectively.
These accelerated, resumed runs accumulated about 11.0/11.3 physical simulation
hours, including failures and recovery. They do not establish human pacing or Gold
frequency; successful Gold integration is verified by an explicit mechanical fixture.

At the summit 37 people receive detailed simulation and 1,737 remain coarse, but
the save is 314 MB. Global history and synchronous persistence still produce costs
and input backpressure. The lifetime proof ceiling, weak-opponent contribution,
pure-martial advancement beyond Iron, completed-trial revisiting, regional/national
rank meaning and the existing unpassed art gate remain production design/work limits.
See docs/TOWER_GROWTH_OCT9.md and docs/evidence/tower-growth-oct9/RESULTS.json for
exact commands, hashes, failures, measurements and next work.
No other task's worktree was changed; no push, merge or deployment occurred.

The older checkpoints below are historical and are superseded where they describe
missing higher-stage source mechanics, save schema 30 or incomplete final aggregation.

# Previous checkpoint: shared Tower and combat recovery (2026-10-09)

The isolated connected-realms branch now has a host-owned Tower trial, finite
source learning/rewards, ordinary warden minds, physical ascent/return and persistent
injuries on the same world body. Legacy expedition access remains explicitly separate.
See docs/CANONICAL_TOWER_OCT9.md and its evidence manifests for current results.

Save schema 30 includes folded interiors, trial/award provenance and shared short
exertion. The parent approved the recovery tuning after the first-floor fatigue
review: brief action effort recovers over seconds while ordinary lasting fatigue,
food/water, damage and injuries remain real. No higher-rank progression was invented.

Final actual keyboard journey: 22 browser checks across entry, a three-warden victory,
earned finite rewards, ascent, reload and portal return; no browser errors. The fight
took 273.5 elapsed physical seconds and retained damage/injuries. Full default suite:
2,087 passes / 10 failures out of 2,097 tests; all eight failing files were investigated
and rechecked after fixture/assertion repairs. Final affected tests: 141/141 in ten
files, plus four social-trace cases in a separate full-file rerun. TypeScript and web
build passed. Exact initial failures and later scopes remain in the evidence manifest;
there was no second full aggregate after those narrow repairs. Runtime mechanics did
not change after the successful rendered journey. Private media provenance is retained locally.

The previous checkpoint below is historical; its missing shared Tower and unattached
interior statements are superseded. Art quality, higher-rank mechanics, population
simulation budgeting and full legacy encounter parity remain open.

# Active expansion checkpoint: canonical arcana, shared motion/contact (2026-10-09)

The user approved the larger shared-simulation route; this supersedes the October 8
audit's pending scope choice. Branch stays isolated at codex/connected-realms.
Canonical arcana/protection first stage: c98207a. New mechanics are not full Tower parity.

- Shared installed-asset mapping and pose timing now drive real move-specific attacks,
  dodges, hit reactions and stride-paced walking/running. Fixed +Z/-Z adapter facing
  and locomotion blocked by completed retained actions. No Opus v1/v2 asset installed.
- Short contact displacement is canonical, collision swept and persisted (schema 29,
  reads 24–28). Fresh-sight melee spacing joins ordinary attack plans. No global attack
  slot or invulnerability rule. Realm locomotion now respects bodily capability.
- Matched actual six-person review captures: docs/evidence/motion-oct9/RESULTS.md.
  RX 6650 XT, 1440×900, p95 frame interval 7.1 ms both baseline/latest short run;
  not an uncapped benchmark, soak test or reference-quality art acceptance.
- Source-backed abilities, armor and wards resolve through shared World/Simulation.
  Legacy Tower checkpoint rewards remain scoped; the prototype is still separate.
- Larger unfinished work: canonical Tower floor/encounter host, full spell/rider parity,
  higher-rank metaphysical capability and causality, multi-hour balance and actual
  sword/shield/character quality. The documentarian is still design-only.
- Focused arcana, contact, movement, persistence, renderer-state, realm/Tower-adapter,
  guard/combat/ecology/projection checks pass. Full default run at 0ee4660 passed
  2,073 tests / 207 files; final contact hardening + room extraction passed 181 tests /
  17 files, TypeScript and Babylon production build. These are distinct runs.
- Tower's unchanged room grammar now lives in sim/world/interiors. Stable folded
  geometry/cache/edit support is tested but not attached to World saves or a new ascent
  route. Existing realm save indices and all sampled legacy floor descriptors survive.
- The completed checkpoint and remaining direction are in
  docs/CONNECTED_REALMS_CHECKPOINT_OCT9.md. Local review server is stopped; no access blocker.

# Current candidate: connected procedural realms with bound Tower journey (2026-10-08)

Isolated branch `codex/connected-realms`, based on `caeec71`; independent foundation `708adbd`.
Authorized stable Tower checkpoint `e7cd628` and committed ancestors merged as `0d12c7a`.
World-bound expedition adapter and its recovery tests committed as `48ff6c2`.

- Independent visual follow-up improves the representative Tower facade, glazing/door construction,
  flush paving and light in both realms without changing canonical structures or gameplay. Twelve
  original before/after frames and measurements: docs/evidence/connected-realms/ART_OCT8_RESULTS.md.
  Final affected tests 22/22; browser comparison 5/5; door/resource lifecycle 4/4; TypeScript and web
  production build passed. The prior 2,050-test aggregate predates this rendering-only follow-up.
  Art gate remains NOT PASSED. No external upload; characters remain placeholders.

- The original combined aggregate finished: **2,050/2,050 tests in 204 files passed**, zero failed or
  pending, 34m 52.33s. Per-file evidence: docs/evidence/connected-realms/combined/aggregate.json.
- Canonical Tower audit found a substantial mechanics/parity conflict and records the smallest safe
  bridge integration in docs/CONNECTED_REALMS_CANONICAL_TOWER_AUDIT.md. It is a proposal, not implemented.
  Coordinator requested this decision report before replacement if a conflict existed. Existing saves
  and gameplay remain unchanged pending the choice of shared-mechanics slice versus full parity.

- Two versioned realm domains, real doors and Tower atria use ordinary World entities, Navigator and
  movement kernels. The Babylon client projects a bounded 81-chunk residency window and four residents.
- Portals preserve the same Person, Body, inventory and ontology. Schema 27 retains 24/25/26 compatibility.
- Tower ascent/return now works. One host-owned identity/travel binding and scoped floor checkpoint
  live in the world save, with revision/idempotency checks and rollback on failed durable writes.
- The combined real-input browser journey reached floor two, reloaded equipment, returned to the world,
  crossed to Cinderveil, resumed that same floor and returned/reloaded again without browser errors.
- Authority limit: ArenaWorld combat remains browser-owned. Checkpoint claims grant no global items,
  injury/death or ontology. The realm pauses while the encounter projection runs. Full canonical
  combat/reward integration remains unfinished and is documented, not hidden behind tier copying.
- Visual gate NOT PASSED. Repetitive architecture, sparse streets/atrium and provisional characters
  remain below the user's bar. Adopt the dedicated character owner's later validated asset handoff.
- Play Torn Veil.cmd launches this candidate; the prior living-world launch/save and Unreal remain intact.
  No existing live character migration, remote push, main merge or deployment occurred. The Tower worker's
  checkout and untracked draft assets were not edited/copied; only the separately authorized commit was merged.
- Reports: docs/CONNECTED_REALMS.md, docs/CONNECTED_REALMS_INTEGRATION.md,
  docs/CONNECTED_REALMS_ART_GATE.md, docs/evidence/connected-realms/COMBINED_RESULTS.md.

# Integrated handoff: Tower maze, expedition progression and character presentation (2026-10-08)

Branch `codex/tower-visual-polish`, preserving motion commit `b315356` and presentation `67c4dac`.
The combined-world worker owns the integration candidate; no cross-branch merge or remote publication here.

- Connected tall maze rooms/corridors, shared wall/sconce cutaway, actual-prop navigation and bounded encounters.
- Pure simulation expedition rules own practice, loot receipts, levels, tiers and emergent classes. The browser is
  the action/projection adapter. Ordinary-world Person advancement is not silently granted by browser saves.
- Existing MPFB bodies retain their source anatomy/rigs/UVs; finer materials and bounded contact shadows improve
  presentation. They do not yet match the source references' facial/clothing fidelity.
- Checkpoint browser verification passed 23/23 after reproducing and fixing a furniture-navigation stall; 12/12
  final loaded-geometry maze cases passed. Two-minute real-input/orbit recording reached floor 5 with no browser
  errors (recording FPS median 49.4, p10 40.2).
- Final default regression coverage: 2,033 cases across the full run and a six-file/44-test approved retry for
  sandbox user-profile errors and one asset-read timeout. Production `web:build` passed. Five inspected progress
  screenshots and private delivery provenance remain local; scope is in `docs/TOWER_OCT8_QA.md`.
- After the worker's exact commit retry was authorized, its 31-file candidate was committed as `e7cd628`.
  That stable checkpoint and its ancestors are being integrated into the isolated connected-realms candidate.
  The unvalidated character draft remains outside this integration.
- `docs/TOWER_EXPEDITION.md` documents stable APIs, entry routes, persistence and integration limits.
  `docs/TOWER_OCT8_QA.md` records source provenance, validation and honest model/visual limitations.

# Previous: Tower character motion, customization and spell VFX (2026-10-06)

Branch `codex/tower-opus-character-vfx` on PR #63's head `1457160`. Presentation and Tower UI only; canonical simulation,
saves, reach and damage unchanged (one Proving Hall fix noted below).

- **Fists:** the packed Mixamo clips keep constant finger channels as STEP keys, which `Animation.evaluate` did not
  hold, so every bake opened the sword-hand fist after frame 2. The retargeter now holds STEP keys. Live ready-idle
  closure went from 0.05 to 163/153 deg on both creator bodies (`scripts/web/tower-motion.ts`).
- **Feet:** foot pops of 0.4-1.0 m per frame remain at locomotion starts, the run loop and the end of the roll
  (24-31 per motion run). A cross-fade contact rule was tried, measured and reverted. Not fixed.
- **Customization:** body, height 95-105% and hair on both bodies; jaw width and re-roll on the male only. Saved per
  browser and applied live (`scripts/web/tower-creator.ts`, 19/19).
- **Spell VFX:** missile outcome visuals (hit/blocked/wall/expire), a ribbon trail, the nova border at its exact 4.2
  query radius, and field fade-out (`scripts/web/tower-vfx.ts`, 5/5). Proving Hall dummies now leave their spawn
  state; bolts used to fly through them.
- **Checks:** checkpoint E2E 23/23, sword and shield 6/6 per body, a climb bot from floor 1 to 4 on the creator male
  with 0 page errors, focused tests and `web:build`. The full suite runs in PR CI.

# Previous: Tower creator bodies, physical item fit and upright stances (2026-10-05)

Branch `codex/tower-creator-fit` on `caeec71` (PR #62 head). Presentation only; canonical simulation, saves, reach and
damage are unchanged.

- **Hero bodies:** the ontology creator bodies `tv-human-male-v2` / `tv-human-female-v1` (hashes `869ebb80…`,
  `c69e97f5…`), staged byte-for-byte. Each has its own bake of the existing Mixamo/Motifect clips and its own grips.
  The male gets the editor's seeded appearance; the female has none to apply.
- **Crouch diagnosis:** the crouch was measured in the packed source clips (`locomotion/*` 50-55 deg knee bend at
  rest; sword-and-shield idle/walk/run 22-51 deg trunk lean), not added by the retarget. Calm movement now uses the
  upright unarmed clips; near foes, a ready layer keeps the authored arms (resampled to the body cycle).
- **Item fit:** contract in `physicalFit.ts`. KayKit `W_sword` 1.78 m-equivalent becomes 1.14 m and `W_greatsword`
  2.37 becomes 1.82; Widow Cleaver 1.42 becomes 1.15. Other arsenal items stay at their authored size.
- **Shield:** catalog TV-081 render variant with the handle bar turned upright, mounted in each body's fist slot with
  a measured calibration. The finger-joint centre is 1.0-1.1 cm from the bar axis (bar half-thickness 1.5 cm) in
  guard and ready, both bodies. The fist is hidden behind the arm in all inspected views, so visual contact is not
  claimed.
- **Checks:** sword-and-shield 6/6 per body, creator isolation/menu 8/8, checkpoint E2E 23/23, focused tests 37/37,
  and `web:build`.

# Previous: Tower sword-and-shield, checkpoint E2E and compact HUD (2026-10-05)

Branch `codex/tower-expedition` (worktree `<historical-checkout>`): a reviewed
finishing pass on base `22211a0`. External push, PR and Library upload are blocked by auto-review until trusted
approval. Final evidence stays local (only an earlier trial image was uploaded). Presentation and Tower UI only;
canonical simulation unchanged.

- **Gear transfer:** the 0.22 s floating draw blend and its torso arc are removed. None of the licensed clips makes hand
  contact with the slung gear. The great-sword draws are two-handed and overhead (closest palm-to-grip 0.60/0.69 m
  with the sword slung, its hilt hidden behind the slung shield). The sword-and-shield sheaths go to the hip, and no
  clip unslings a shield. So drawing and stowing are an intentional instantaneous transfer, with the existing flash;
  no hand contact is faked.
- **Foot contact (bounded):** the defect is missed stance lock. `FootPlant`'s first-pose ankle band missed planted
  feet in the crouched/rolled sword-and-shield stances. `FootPlant.update` takes an optional per-foot `contact`;
  without it the behaviour is unchanged (`sharedCast`). The Tower/arena hero passes the dominant clip's baked contact
  in idle, move and a still guard, never with the strafe leg layer, lunging attacks or dodges. Live Tower, Proving
  Hall, armed. Before and after are separate live runs, not phase-matched visual A/B, and the earlier before
  feet pixels were partly hidden by toasts; the numbers are the evidence, not a broader claim that foot motion is
  solved:
  - Missed locks went to 0.
  - Clip-planted slide in move: mean 3.80 → 0.88 m/s, p90 4.54 → 0.
  - Jumps over 2 m/s: move 71 → 5, armed idle 45 → 3, guard 48 → 2.
  - Residual: reset spikes over 10 m/s remain (single frames). Attacks are untouched (56 → 57).
  - Relaxed locomotion was not re-measured. On the simpler lower-foot metric, the armed sprint segment still
    averages 3.5 m/s.
  - No vertical-contact claim: the solver keeps the animated foot height. Diagnostic scripts and runs stayed in
    gitignored `.debug/`.
- **Retry floor fix:** after Continue on floor N, a death retry began the new climb on floor N, because `resume()`
  left `startFloor` at the saved floor. It now restores the base start floor; checkpoint restore, non-persistent
  `floor=` previews and death stat semantics are unchanged.
- **HUD:**
  - The routine banner is a compact ribbon at 108 px, and achievements are a 300 px card on the right above the
    radar, keeping name, text and reward.
  - Toasts are a left stack above the weapon row. Expiries are unchanged (2.2 s, 4.2 s queue, 3.2 s). Choice, death
    and recovery modals are unchanged.
  - Below 1060 px wide the floor title moves right of the stats instead of over the HP bars.
- **Browser evidence:** in fresh Playwright contexts, never a player profile:
  - `scripts/web/tower-checkpoint-e2e.ts`: 23/23 checks, 0 page errors. Covers fresh floor-1 write, floor retry
    rollback with exact-once lifetime receipts, a single floor-2 write, floor-2 Continue, Proving Hall isolation,
    death, and corrupt/incompatible recovery with download. Continue and recovery are driven through the real menu
    cards; death and the hall-exit position are harness-forced and labelled.
  - `scripts/web/tower-sword-shield.ts --tower`: 6/6 armed-strip and transfer checks (stow, draw, rapid reversal,
    swap with disposal by object identity), 0 page errors.
  - `scripts/web/tower-hud.ts`: at 760×760 and 1100×700, no missing nodes, overlaps or errors after. Before (HEAD CSS
    re-applied with `--legacy-css`): the title overlaps the HP frame at 760, and the banner overlaps the achievement
    at both sizes.
- **Checks:** typecheck passed; earlier focused tests 14/14. Reviewer reported build:bundle, web:build,
  ontology:check, assets verify and ontology:build passing. Full `npm test`: 192 files, 1,907 tests passed,
  0 failures (1,740.82 s). World smoke (run separately by the reviewer) exited 0: 7 scenarios, 5 PASS, 2 DEGRADED,
  0 FAIL. Both DEGRADED results come only from the WL-TIMBER-HORIZON finite-timber warning, so not every scenario is
  healthy. No CI, merge or publication is claimed.

# Previous: Same-world Observatory workbench (2026-10-03)

Local branch `codex/observatory-workbench`, based on cleanup `968897f` (PR #57).
Movable/resizable/collapsible panels retain local layout; embedded Babylon uses the
same World/Simulation and shared command/prediction/projection paths. Playing an
existing selected person explicitly opts into gameplay scheduling. Old headless
validation remains separate. Runtime version 3; launcher preserves older servers.
Preview: loopback 7482, fresh world paused; original user session on 7480 preserved.
61 focused checks covered, build/typecheck passed; rendered/browser lifecycle and
layout checks recorded in `docs/evidence/observatory-workbench/README.md`.
Scope, workflow, memory-only checkpoint behavior and limits: `docs/OBSERVATORY_WORKBENCH.md`.
Workbench is local; archive and cleanup are pushed and reviewed separately in PR #57.

# Current direction: Babylon retained; Unreal archived (2026-10-03)

User chose to retain Babylon and simplify the project rather than restart the simulation.
Local working branch: `codex/babylon-project-reset`; preserved pre-cleanup branch:
`codex/archive-unreal-2026-10-03`. Full ignored/tracked Unreal files moved to the local
recovery directory documented in `docs/UNREAL_ARCHIVE.md`. The archive branch is pushed
to origin; ignored local assets remain local. No merge or disk-space reclamation is claimed. Canonical simulation and shared bridge code are unchanged.
Root Play launcher now selects Babylon; README describes the actual preview and a
short Observatory walkthrough. Observatory remains a separate test world, not live
inspection of the Babylon world. Historical status below remains evidence, not current
renderer direction. Validation results for this cleanup are in the archive document.

# Previous: Babylon visual fidelity pass locally verified (2026-10-01)

Branch `codex/babylon-visual-fidelity-v1`, tested source `3440bc4c7dd1eee53aa703194809cef2abd1d65b`. Presentation now derives continuous plaster/timber facades and sparse exterior dressing from projected structures, corrects outward face orientation, blends terrain and feathered paths, clusters vegetation with GPU grass wind, improves exploration framing/materials/lighting, and applies reversible rain wetness. Existing canonical apertures, collision and reversible cutaways remain authoritative. Simulation and Unreal source are unchanged; no merge.

- Twelve web test files / 67 tests, typecheck and private production build pass. Independent final review found no actionable issues.
- Disposable real Chrome acceptance: 22 orbit and 20 isometric checks pass, including actual input, doors, interior traversal, combat and cutaway restoration; no browser errors. Fixture staging is disclosed in the evidence. This is automated acceptance, not human/controller acceptance.
- Eight final high-quality 1600x900 WebGL2 captures are error-free. Warmed median frame times range from 6.9 to 10.3 ms on RX 6650 XT (baseline 6.9 to 9.7 ms); these short samples do not establish low-end or streaming performance.
- Evidence, retained iterations, live video and verification details: `docs/evidence/babylon-visual-fidelity-v1/`; open `comparisons/index.html` for the eight before/after sliders and `session.json` for reproduction and performance records. The ordinary orbit comparison intentionally includes the camera change.
- Remaining priorities: more distinct building silhouettes/purpose, richer field margins and forest transitions, better character/interior art and warm night focal points. Water and WebGPU were not validated in this pass. The result improves the existing client but remains visibly procedural.

# Previous: Interior door visibility implemented and locally verified (2026-10-01)

The controlled actor was hidden by unregistered upper door-frame geometry after the building roof/wall cutaway. Frame and hinged leaf now participate in the existing reversible per-building cutaway with owned materials. Canonical collision, automatic door operation, perception, simulation and Unreal source are unchanged.

- Eight focused web files / 55 tests, typecheck and separate private production build pass.
- Disposable real Chrome acceptance: 19 checks pass, no browser errors/inference requests. Actual keyboard entry/traversal/exit/reentry, interrupted menus, automatic door operation, interior head contact (health 80 to 75.00), defense and camera/cutaway restoration pass. Reviewed screenshots show the player throughout.
- The harness's original closed-door assumption contradicted existing canonical automatic opening; its verification now follows the real mechanic. Tightened waypoint approach avoids fixture corner cutting; the adult combat fixture requires clear body space/line of passage. No simulation rule or gameplay assertion was weakened.
- Evidence: docs/evidence/isometric-interior-visibility; details: docs/web/ISOMETRIC_PLAYABLE_SLICE.md. One tavern is covered; other layouts, portrait, human/gamepad and Unreal acceptance remain outside this slice.
- Loader-repair CI 36821844547 at 302aa8c completed RED: worker loading is fixed (Node 20/22 checks pass), but six wall-clock timeouts remain across five other files; 1,805 tests pass. All 68 affected tests pass locally with unchanged budgets. The full gate now uses documented Desktop/live Node 22, retaining Node 20/22 worker compatibility checks. New-head CI is recorded in draft PR56; check its exact-head result before integration. Main stays unchanged.

# Previous: Checkpoint worker loader compatibility repair (2026-10-01)

The isometric slice at 3b8f02b passed local normal regression (168 files / 1,811 tests), but CI run 36817546294 finished RED at npm test: the Node 20 runner could not load checkpointWorker.ts. Its build and smoke steps were skipped. PR56 records the failure.

Source workers now use a JavaScript entry and tsx's scoped import API. The compiled release worker path and all checkpoint capture/packing/ownership/durability behavior are unchanged. All 38 tests in the five CI-failing suites pass locally; typecheck passes. A small actual Node 20/22 worker check precedes the full CI gate. New exact-head CI remains to be verified; no success is inferred from the local Node 22 result.

The actual Node 20/22 compatibility jobs pass. The full gate reached RED from six unrelated wall-clock timeouts; the locally verified door visibility follow-up and execution-environment adjustment are recorded above. Portrait work stays outside that follow-up. Details and prior evidence remain in docs/web/ISOMETRIC_PLAYABLE_SLICE.md.

# Previous: Optional isometric playable slice (2026-10-01)

Branch codex/isometric-playable-slice preserves inherited work in 21be4e2 and licensed source assets in af9eab8. Optional fixed orthographic Babylon presentation, screen-relative walking/running, pointer interaction, canonical dialogue/trade/combat and per-building cutaways are implemented. Third-person remains available; canonical simulation and Unreal mechanics were not changed by this slice.

- Private production build/typecheck passed. Final focused web verification passed 54 tests in eight files; the full invocation was still running at this checkpoint.
- Real isolated Chrome acceptance passes 13 checks, including actual keyboard doorway entry, canonical adult melee damage, repeated menus/dialogue/purchase and camera/cutaway reversal. Root-cause fixture corrections and a stale-pointer interaction fix are disclosed in docs/web/ISOMETRIC_PLAYABLE_SLICE.md.
- Launcher: Play Torn Veil Isometric.cmd; separate bundle/gateway 7492 uses retained isolated web-quality save/world 7490. CheckOnly correctly stopped because the persistent preview world was offline; it started nothing. Ordinary launch can start the existing isolated preview.
- Generated textures have byte-verified provenance; Poly Haven HDR is CC0. Original ZIP archives and generated GLBs remain local. No saves/services were overwritten or stopped.
- Draft review only: main stays unchanged; no merge/deploy. Branch ancestry also includes earlier Observatory and deterministic-dialogue work, not just isometric code. Previous AMBER limits remain.
- Visual review shows interior furniture can hide the player and the inherited portrait is badly framed. Next bounded task should resolve controlled-actor interior visibility with visible entry/traversal/exit/combat evidence; no new art-tool installation is needed.

# Previous: Stage one — deterministic dialogue replacement (2026-09-30)

The authoritative Desktop checkout now uses deterministic dialogue for gameplay and Observatory.
The model transport, endpoint configuration, model toggle, model benchmark and isolation code
have been removed. No isometric conversion was started. Existing unrelated web/art changes
remain in this checkout.

- One weighted parser, bounded canonical intents, player-available references, small follow-up
  context, adjudicated response plans and deterministic templates; no inference worker or API.
- The authenticated web gateway admits free-text dialogue. Player payloads contain only speech
  and status; Observatory exposes the parser evidence and grounded semantic result.
- Purchases use the same dispatcher/transaction from text and suggested choices. Source/time
  follow-ups, uncertainty, occupation testimony and perceptible social speech use canonical state.
- Final focused regression passed 417 tests in 9 files; typecheck, production builds, real Chrome
  Observatory and isolated production-game UI acceptance passed with inference unavailable.
  Broad regression passed 165 files / 1,803 tests; its three dialogue failures were resolved and
  the affected files passed in the final focused run. Full broad suite was not repeated.
- Details and final verification record: `docs/DETERMINISTIC_DIALOGUE.md`.

# Previous: Observatory simulation integrity — reviewed AMBER handoff (2026-09-30)

Authoritative Desktop checkout, branch `codex/observatory-local-language`. Completed prior
Observatory/local-language work was preserved in `e59b7da` / `633a5d2`; original seed-918271
30-day RED was exactly reproduced before simulation edits. Confirmed planning, reporting,
delivery, memory, navigation and persistence repairs are preserved through simulation commit
`187a035`; current test-only fixture commit is `2d79e62`. See `docs/OBSERVATORY_HARDENING.md`.

Revision 20 completed all three 30-day seeds with zero configured hard failures, balanced
edible-unit ledgers, no stuck-path groups or duplicate event identities. Fresh revision-21
primary matches every prior saved value and property order; its only addition is the persisted
compaction cursor. Decision-window reviews are identical. Day-15 reload + 15 days matches every
canonical value and final content hash `461b057fa012be7574cd973a1a4b91366e2b7618cd269eba2e9e0c1f6b7698f4`.
Raw strict comparison retains four optional `situationId` property-order differences inside
fixed concern records. Their exact SHA-bound class-C review is saved; no meaningful values or
collection ordering are normalized. Legacy saves remain best-effort for missing metadata.

Normal coverage: full invocation had 1,409 passes and four living-universe cutoff failures
(162 files / 1,413 tests). Only that fixture changed to five world days; all 11 of its tests
then passed with every assertion retained. Other 161 passing files remain valid. Build and
latest typecheck pass. Real qwen, disabled and offline modes match canonical outcomes.
Quiet three-hour benchmark trials match the primary final hash; maxima 115.766 / 103.353 /
99.181 ms, so the unchanged 100 ms budget remains AMBER. Remaining decision/economy/social
coverage gaps are recorded, not hidden; overall simulation integrity is not universally verified.

Independent revision-21 repeat completed: strict day-1/7/30 comparisons have zero value and
zero property-order differences. The nine-horizon validation summary, raw continuation plus
exact-row review and final verification manifest are checked in under
`docs/evidence/observatory-hardening`. Browser `--hardening` passes with no errors; screenshots
were visually inspected. The exact `Torn Veil Observatory.cmd` launcher started server PID
19672 on port 7481; the reviewed seed-918271 day-30 world is loaded paused at tick 11258400.
Opening it in the Codex browser panel was also requested (queued by the app). Old port 7480 was preserved.

Bounded statuses: DETERMINISM, SAVE/LOAD (canonical values, four disclosed nonsemantic record
field-order differences) and LOCAL LLM ISOLATION VERIFIED. SIMULATION INTEGRITY, ECONOMY
CAUSALITY, NPC DECISION-MAKING, KNOWLEDGE, SOCIAL CAUSALITY, EVENT HEALTH and PERFORMANCE
PARTIAL. Remaining warnings include 16/11/11 worst-window churn actors, incomplete economic
and epistemic coverage, and maximum-step budget overruns. These are visible, not suppressed.
The original RED findings are explained and repaired/classified; no universal correctness claim.

Raw evidence: `D:/TornVeilValidation/observatory-hardening-20260930`. Browser subset is populated
at `.debug/observatory-hardening/reviewed-918271`. Baseline UI files remain under `baseline/replay-918271`;
eleven bulk files moved to D `baseline-bulk` with before/after SHA verification and checked manifest.
Preserve the paused reviewed server on port 7481 and old Observatory on port 7480. No live/staging,
Unreal or web gameplay presentation changes, pushes or merges. C drive is low; large outputs go to D.

# Previous: Observatory and local language — branch `codex/observatory-local-language` (2026-09-29)

Built on the clean web-rebirth checkout at the authoritative Desktop location. Launch with
`Torn Veil Observatory.cmd` (loopback 7480, disposable in-memory Ashford development worlds).
Web/Unreal launchers and save schema are unchanged. Inspectors separate truth and belief;
scenario/time controls, source-backed aggregates, causal graph, WorldLab health, checkpoints,
and local-language debugging are available. Qwen 3 8B Q4_K_M was already installed and was
tested through Ollama with GPU offload; no model was downloaded. Natural speech is constrained
to reviewed grounded realizations. Free text is Observatory-only; unsupported actions refuse.
Guide, exact limitations and status categories: `docs/OBSERVATORY.md`. Evidence: `.debug/observatory/`.
This is instrumentation plus a bounded language slice, not a declaration that the simulation
is correct. Long-run invariant/anomaly findings remain visible and need separate investigation.
The 30-day ordinary run completed (33 alive before/after; food 377→47; 14 pressured households;
five injured manifestations). Final health RED: stuck actor, goal churn, repeated events and a
130.46 ms final step against the 100 ms budget. One-day report/health history also verified.
35 focused tests, production build/typecheck, real-model and offline browser acceptance passed.
Final normal regression: 1,361 tests across 159 files passed (1,808.38 seconds).

# Also in progress: web client (Babylon.js) — branch `claude/web-rebirth` (2026-09-29)

User mandate: a browser client over the unchanged simulation, plus a separate `Play Torn Veil Web.cmd`. Lane A only
(no simulation change; `src/sim` untouched); Lane B (vault/dive) not started. Status, evidence, known defects and the
human test guide (all human verdicts pending): `docs/web/README.md`, `docs/web/PROGRESS.md`. Isolated preview world
on ports 7460 (world) / 7470 (gateway); live, staging and the accepted package are untouched.

# Current: human checkpoint 1 — STOPPED for human review (2026-09-28)

Course correction (user, 2026-09-28): human experience first; no simulation breadth. Delivered and
stopped: one polished conversation, a coherent lineup, readable NPC movement, two player gaits.
Report, play path and five-minute test: `docs/HUMAN_CHECKPOINT_1.md`.
Play: `%USERPROFILE%\TornVeilAlpha\playtests\checkpoint-9a2aa61\Play.cmd` → client
`client-9a2aa61…` + server `0.2.0-inhabit.11` in a fresh world `TornVeilAlpha\checkpoint-human`
(127.0.0.1:7440). Evidence world `TornVeilAlpha\checkpoint-evidence` (7450, probe accounts ev-a..d).
The older dev world (7430) is crowded with ~20 autonomous probe characters: not for human review.
Next action: wait for the human's verdict; then combat inventory/presentation and one environment
reference scene, as the course correction orders.

# Previous: inhabitable alpha work, branch `claude/inhabitable-alpha` (2026-09-27/28)

Continuation checkpoint for the consolidated alpha brief (playable, inhabitable, visually coherent).
Baseline: main `223264d`. Integration branch `claude/inhabitable-alpha` (pushed; no PR yet).
State: **playable checkpoint** — scope incomplete. Coverage: `docs/SIMULATION_TO_PLAYER_COVERAGE.md`.

Protected, untouched: accepted package `client-450b7e5cbc80` + staging `0.1.0-alpha.30` (port 7410,
its preserved fork — never rehearse over it, never `ops update --env staging`); live alpha.12 (port 7400).
Development runs in its own root `%USERPROFILE%/TornVeilAlpha/dev-inhabit` (env `dev`, port 7430, seed
918271, world `tvo-dev-39a6e14c…`), moved between releases with `ops switch --env dev` (backup first).
Probe accounts journey-a/b/c there; profiles `dev-journey-*` in `%LOCALAPPDATA%/TornVeil/Client`.

Done on the branch (each with tests that fail on the old code):
- Carried items and abilities projected from canonical rules (no "Eat" on a knife; no Hush until taught;
  refusals with reasons); a sleeping body can no longer act; interaction-spec check EOL-neutral.
- Butchering is real timed work at the carcass (interrupt keeps progress; contention refused; save mid-work).
- Hunting a wild animal is no longer a witnessed crime (a hunter used to hate and attack the hunter).
- Trade menu grouped by good and price, whole units, paged.
- Canonical sky: sun/moon/exposure/fog from the world clock and weather (night adapts, noon black-out refused).
- TV.JourneyProbe + Run-JourneyProbe.ps1: automated ordinary-input journey (sign-in, walk, talk, trade, eat).
Evidence still valid: full suite 1265/1265 at `2d7f7f9` (later: trade test + native-only changes);
native TornVeil.Presentation 16/16 (2 known warnings) at the sky change; editor journeys 03 and 05 passed.

Local non-git inputs: `Content/TornVeil/Materials/LocalPalette` regenerated in this checkout with
`unreal/scripts/create_local_prop_materials.py` and `create_local_village_materials.py` (their input
`.debug/playable-world-slice2/local-assets/registry.json` copied from the Codex checkout). Without it
props render white in packages.

Milestone 1 packaged checkpoint (see `docs/CANDIDATE_MANIFEST.md`): client `client-4333a46` (clean) +
dev server `0.2.0-inhabit.4`; journey-package-04 passed (sign-in → new life → talk → trade → bread → eat)
and its reconnect run returned the same person.

Since then (all pushed; full suite 1276/1276 at `6468fc5`; native Presentation 16/16):
- Crowd faces keep their authored skin (mirrored head instances, `create_local_crowd_head_material.py`).
- Conversations frame the partner (panel docked right); TV.JourneyProbe reports frame time (p95 30.6 ms).
- Twilight and a reachable moonlight (a natural 20:23 frame was black). Groom PSO ensure fixed.
- Generator `playable-3` (no numeral names); `playable-1/2` baselines pinned and preserved.
- A nap is not a night: workers who nap in their break wake for their shift (tavern food 14–22 h).
Dev world now on server `0.2.0-inhabit.5+6468fc59b54e` (switched with backup; its playable-2
fingerprint was accepted). Client package `client-6468fc5` in progress.

Local non-git inputs this checkout needs (run once, all write only git-ignored content): LocalPalette
(`create_local_prop_materials.py`, `create_local_village_materials.py`), `create_local_crowd_head_material.py`
(75 mirrors), `repair_updo_bindings.py` (else f_003 Updo wearers are bald), and sound:
`node scripts/audio/synthesize-sounds.mjs` then `import_local_sounds.py` (else the world is silent).

Open: mechanisms need a sustained shortfall (diagnosed, not forced); no player mechanism panel;
oversized foot blocks; probe does not enter buildings; multi-seed review not yet run; player
contention/trade not exercised; sounds are synthesized placeholders, unheard by a human.
Done since: mechanism actions in the action panel; camera never inside a body; probe hold + shared-world
record; packaged two-client pair passed (client-f5227fd); soundscape (`1aef56f`, native + editor evidence).
Then: probe route-first mode; packaged evening journey passed at natural 18:32 (tavern food restored by
the nap fix) and packaged dusk at 20:17 reads as twilight; multi-seed run found and fixed an animal-
defence crash (`6729ffa`; full suite 1277/1277). Dev world on server `0.2.0-inhabit.6+4d70f2206c99`;
latest client `client-5730546`. Dev world holds ~15 offline probe characters (journey-a…o).
Next action: native journeys for haul and protection/butchery → player employment → player invention.

# Previous: consolidated GitHub main, 2026-09-27

GitHub `scrsper/torn-veil-online` / `main` is the source baseline. PRs #51, #52, #53
and #54 merged on 2026-09-27 (integration commit `1205973`). Active local development
uses **`<existing-repository>`**, explicitly designated
by the user for every Torn Veil edit, including Unreal assets. `AGENTS.md` section 0
is the permanent path rule. Documents and previous release checkouts are reference
copies. Historical branch tips and local edits are archived; see
`docs/RUNNING_THE_GAME.md` for disposition and recovery.

Living Alpha runtime `450b7e5cbc80` is included in main. Package
`client-450b7e5cbc80` and staging server `0.1.0-alpha.30+450b7e5cbc80` retain their
accepted runtime and saved world. Final two-hour soak, Iron, regression and packaged
automation evidence is recorded in `docs/LIVING_ALPHA_RELEASE.md`; the failed-candidate
notes below are historical. Human play and physical-device acceptance remain external.
The older live alpha.12 deployment is separate and was not replaced.

Run **Play Torn Veil.cmd** at the repository root or the **Play Torn Veil** desktop
shortcut. `-CheckOnly` checks package, profile and staging readiness without launching
the game. Player instructions: `docs/RUNNING_THE_GAME.md`.

# Historical: Living Alpha gate completion, 2026-09-26

Current implementation branch: `codex/living-alpha-50-gates`, PR #54 stacked on
`claude/living-alpha-client` (#53). Human merge order remains #51 → #52 → #53 → #54.
Live remains alpha.12 (`1c8b317f6075`); candidate releases run against the preserved
staging world. Do not recreate staging from live or run a second state writer.

Latest performance result: alpha.28 failed the unchanged 250 ms serialization
budget at one hour (251.516 ms). Its normal backup, rendered connection and bounded
save growth are preserved evidence, not a completed soak. The next candidate reduces
transient JSON batch sizes with byte-identical output; see the persistence document.

The three original seven-day worlds (918271/918272/918273), ordinary hunt adventure,
Hush alternative and shared-world multiplayer remain accepted. Later bounded continuations
identified and corrected actual retry loops; see `docs/LIVING_ALPHA_PERSISTENCE.md`.
The narrowed unreachable-anchor fallback preserves healthy production routes and delivers
the stranded hauler's twelve grain. Integrated revision e9a1f53 passes all 1,247 tests.
The genuine generated trainee reached Iron after 12.1167986 world days with exact reload
continuity; see the progression report. Fresh e9a1f53 packaging and all three automated
keyboard/gamepad/device-switch probes pass. Physical input remains unverified.

Progression calibration and the same generated person's earned journey are documented in
`docs/LIVING_ALPHA_PROGRESSION.md`; no synthetic promotion is accepted. Final two-hour isolated
soak and exact-revision packaging must pass before marking internal acceptance complete.
Native semantic controls and packaged automation are described in `docs/LIVING_ALPHA_CONTROLS.md`.
User requested the 45–60-minute ordinary human session be prepared for later. DualSense is
available; physical controller play, glyphs, rumble and Xbox hardware verification remain
external until performed. Injected-input checks do not certify physical-device acceptance.

Private evidence, live saves, credentials, packages and the current handoff record are outside
tracked source (`.debug/finish50/CURRENT.md` and `%USERPROFILE%/TornVeilAlpha`). Recovery14/14
on alpha.19 and schema24→25 update13/13 are recorded. The alpha.26 soak failed after 28 minutes
at 259.772 ms against the unchanged 250 ms capture budget. Alpha.27 buffer reuse also failed
at 274.925 ms, despite fresh recovery14/14 and exact Iron reload. Streamed synchronous capture
and removal of a redundant identity-file read are the next diagnostic candidate. All 38
persistence/server integration checks and typecheck pass; offline latency remains variable.
A connected preflight and complete isolated soak remain required. Consult fresh manifests
before deployment.

# Historical: autonomous agency, social inference and capability evolution v0.1, 2026-09-19

Branch `codex/autonomous-agency-social-inference-v0-1` is temporarily stacked on PR #48's
remote head (initially `7eb6b66`, updated documentation-only base `709e6b5`). Main remained
`fba1153` at the final fetch. PR #49 is the unmerged draft for this work.
Both PR #47 commits are patch-equivalent to changes already in #48; neither PR was merged
or modified. Work uses a separate `TornVeilOnline-agency` worktree, preserving the original
checkout's local changes and all licensed/ignored Unreal content.

Extends existing KMSI, utility goals, relationships, external control leases, skills, physiology,
and schema-24 snapshots with bounded encounter recognition, embodied structured testimony,
belief-driven caution/cooperation, a paid-fitting experience ledger and a gated Normal→Iron
reference path. Higher ranks remain blocked. Detached agency inspection is exposed in bridge
developer snapshots. No native UI or asset changes.

Food-stress hardening, 2026-09-20: measured PR #49's regression against frozen PR #48,
then preserved semantics with knowledge traversal and bounded spatial/place lookup reuse,
within-call genealogy reuse and an unchanged prerequisite hoist. Final abundance/scarcity
medians are 50.421/45.141 s; 6/6 samples pass unchanged 60-second budgets. Full saved state,
RNG and both separate continuation trajectories match pre-fix PR #49. A conversation-cache
alias discrepancy on original-versus-reloaded food worlds already exists on both bases.

Final build/typecheck, 110 focused tests and deterministic WorldLab pass. The single full
run reports 1,121 passed / 1 failed across 116 files, with no timeouts or skipped tests.
Food tests pass again at 46.879/40.365 s. The sole failure is the theft social-causality
trace: zero living knowers at its observation endpoint. The exact unchanged test passes
on PR #48 and fails identically on pre-fix PR #49, so it is an existing feature regression,
not a baseline failure or a new performance-fix regression. No new gameplay was added.

Theft repair, 2026-09-22: merged onto `main` `5ab3177` (#48 + #50). Nobody ever held the
theft, on either branch. The harness staged it unwatched against an owner arrested during
its six-hour wait. #48 passed only through unrelated arrests attached to the property
situation. The harness now chooses a subject at liberty with a watched workplace.
Speech bends round a post but not through a wall. A refused report is a failed attempt. A
reporter keeps heading to the guard they chose. A second crime for the same guard replaces
the first instead of re-telling it: on `main` that loop re-told one crime more than a
thousand times, and removing it brings the food benchmarks back under 60 s even on a slow
machine. The witness now tells the watch. See `docs/evidence/autonomous-agency/VERIFICATION.md`.
Measurements, attribution and reproducible profiling: `docs/evidence/autonomous-agency/PERFORMANCE.md`.

Design, deliberate limits and schema notes:
`docs/AUTONOMOUS_AGENCY_SOCIAL_INFERENCE_CAPABILITY_EVOLUTION.md`.
Reproducible scenarios: `npm run agency:worldlab -- 741`.
Exact final validation and captured scenario evidence:
`docs/evidence/autonomous-agency/VERIFICATION.md`.

# Slice 3 + Character Foundry reconciliation, 2026-09-17

Branch `claude/embodied-people-visible-life-slice3` is stacked on current PR #46 head `7abb2b6`
without merging either PR to `main`. `Person.appearance.description` is the only semantic source of
appearance. `src/bridge/appearanceProfile.ts` projects that description and calls the shared
`src/foundry/resolve.ts` resolver against an injected machine-local catalogue; it no longer derives
hair, heads or clothing independently from wealth, occupation or `Person.id`.

Slice 3 still owns activity presentation, physical occupancy, delta transport, the visible Unreal
component and animation/retarget execution. The one Foundry audit now inventories both character
parts and activity animations. Unreal consumes concrete Foundry slots; its small local palette is
limited to activity clips and generated retarget AnimBlueprint classes. Missing/unsupported assets
fall back to the Manny driver without mutating canonical state.

Verified after reconciliation: 77 focused appearance/Foundry/embodiment/visual-state tests; 63
bridge/playable-world/embodiment tests; TypeScript typecheck and production build. Python tools
parse under Unreal's bundled Python. Native compilation is blocked before C++ compilation because
Windows SDK 10.0.19041.0 is not installed on this PC; no PIE/visual acceptance claim is made.

# Slice 3 — embodied people & visible daily life, implementation checkpoint, 2026-09-17

Branch `claude/embodied-people-visible-life-slice3` from merged main `1f36ba5` (PR #44), created
in a Linux cloud container. No merge, no human approval, no visual acceptance.

The original #45 checkpoint implemented presentation-side appearance profiles with its own
semantic-token derivation. That appearance path is superseded by the reconciliation record above.
Preserved from the checkpoint: a general activity-presentation
layer (travel/work/eat/drink/rest/socialize/trade/carry/flee/injured/combat/idle derived from
canonical pose, action, goal, velocity and canonical injury capability), and physical occupancy
(stations from `Place.anchors` + voxel geometry, presentation-only reservations, conversation
F-formation, approach slots, bounded `MAX_SETTLE_METRES` = 1.25 m settle offset). Wired into
`BridgeSession.snapshot()` as a per-body `embodiment` block; appearance profiles are delta-sent by
signature. 21 new tests + 40 existing bridge/playable-world tests + typecheck pass.

Written but NOT compiled and NOT run: `TVEmbodiment.h/.cpp`, `TVEmbodimentTests.cpp`, the
`ATVCharacter` hidden-driver/visible-presentation wiring, and four editor scripts
(`audit_character_assets.py`, `build_character_palette.py`, `build_character_retarget.py`,
`capture_life_slice3.py`). This container has no Unreal Engine and none of the licensed human
character library, so THE MANNEQUINS ARE NOT YET REPLACED IN ANY RUNNING BUILD and there is no PIE
screenshot or video for this slice. The checked-in `CharacterPalette.json` resolves no optional
activity clips; an unprovisioned machine keeps the Manny driver and reports `visibleCharacter:false`.

Next session must run on the foundational Desktop worktree: build the editor, run the human asset
audit, generate the palette, then do the work order's initial acceptance (player p_128/b_141 and
one existing canonical resident as real humans through locomotion, dodge, combat, dialogue and
save/reload) before extending to several residents and the life loops. Do not treat this branch's
passing TypeScript tests as visual acceptance. Full limits:
`docs/evidence/embodied-people/README.md`.
# Verification record — appearance + Foundry branch, 2026-09-17

Branch `claude/determined-meitner-w9c23l` @ `f1f1c60`. Full-suite attribution, done properly after
an earlier report of mine quoted a summary line without reading the failures.

Full suite on this branch, machine idle, nothing else running: 20 failed / 1035 passed (108 files).
Attribution, by running the 11 affected files on base `1f36ba5` under the same conditions:

  17 identical on both trees  -> PRE-EXISTING, not this branch.
                                 14 are timeouts; 3 are genuine assertion failures in
                                 tests/living-universe.test.ts (flourDelivered 0 !> 0,
                                 control.baked 5 !< 0, methods.length 1 !> 1). Those are red on
                                 main today. With WorldLab's `recover-item`, four pre-existing
                                 failures the PR gate does not fail on (its CLI exits 0 on FAIL).
   1 agency-frontier           -> MINE. Privacy guard vs `appearance.traits` naming. Fixed in
                                 f1f1c60 by renaming the field to `description`, not by weakening
                                 the assertion.
   2 human-physiology-economy,
     living-world-logistics    -> NOT a tree difference. They appeared to differ only because a
                                 full-suite run (warm JIT, 100+ files ahead of them) was compared
                                 against an 11-file run. Run like-for-like, 2 files isolated on
                                 each tree, BOTH trees fail BOTH tests:
                                   human-physiology-economy  base 201712ms / head 202894ms
                                   living-world-logistics    base  20668ms / head  20730ms
                                 0.6% and 0.3% apart. Both are wall-clock budgets (180s, and
                                 vitest's default 5s over a `step(tw, 1800)`) that this container
                                 is too slow to meet cold.

World generation benchmark, 12 iterations, idle machine, seed 4102, 37 people:
  head 619.23 ms/gen, base 670.67 ms/gen. Appearance generation costs nothing measurable.

Lesson worth keeping: do not compare a full-suite result against a partial-suite result on this
repo. JIT warm-up moves tight-budget tests across the line on its own.

# Character Foundry — slice 2, 2026-09-17

Branch `claude/determined-meitner-w9c23l`, continuing the appearance pipeline (`8f00928`) and its
physiology fix (`422f495`). Nothing merged; PR #46 stays draft.

HARD BLOCKER, stated up front: this environment has NO character assets. `.uasset` files are
unfetched Git LFS pointers and `Content/Characters/` (Mannequins, MetaHuman, modular packs) is
gitignored and absent. No Unreal Engine, no Windows machine. Stage A therefore could not be RUN
here, and no Unreal acceptance claim is made.

Delivered: the Foundry itself, proven against synthesised catalogues. `src/foundry/` holds the
catalogue schema + fail-soft parser, the committed asset-path-free part manifest (requirements,
preferences, and two disqualifying station prohibitions), and the resolver with relaxation and
diagnostics. `unreal/scripts/audit_character_assets.py` is the read-only Stage A inventory that
produces the machine-local, gitignored catalogue. `npm run foundry:report` reports coverage,
population diversity and the unmet-request shopping list.

Real finding from the committed tree: the animation target is UE5 Manny — RTG_TV_CombatRepair
retargets IK_TV_RepairSource -> IK_TV_RepairManny, every RT_* clip lands there, and ATVCharacter
loads SKM_Manny_Simple. HeroTPP and the per-clip Motifect skeletons are sources. Any Foundry body
mesh must reach that skeleton or a character cannot move; `animatableSkeletons()` gates on it.

Two design bugs were found by tests and fixed: a shared selection stream meant uninstalling one
hair pack re-rolled a person's whole outfit (now per-slot streams keyed by the request), and
nothing stopped a well-off person being handed rags (now disqualifying quality bounds).

Verified: typecheck; 30 tests in `tests/character-foundry.test.ts`. Against a synthesised pack,
Ashford seed 1337 realizes 33/33 residents complete, 33 distinct configurations/outfits, 8 bodies,
9 heads, 0 unmet, 9 relaxations (the fixture has only noble-tagged jewellery — the diagnostic
working). NOT verified: anything involving real assets, UE build, PIE, locomotion/combat.
No Unreal C++ was written this slice, deliberately: an apply layer would be written against a data
shape no machine has produced yet, on top of slice 1's still-unbuilt C++.
Full report and next steps: `docs/CHARACTER_FOUNDRY.md`.

# Character appearance pipeline — slice 1, 2026-09-17

Branch `claude/determined-meitner-w9c23l`, based on merged `main` plus the already-merged
Slice 2 history at `1f36ba5`. Nothing merged; no Unreal build or PIE run was possible (no engine
in this environment).

The five committed reference sheets in `art/reference/cultures/ashford/characters/` now drive the
population. `-ren-ayami-shiro.png` is four labelled NPC panels, not one, so five files yield eight
stylistic families (`hana`, `yuki`, `kaito`, `shogun`, `ren`, `ayami`, `shiro`, `ascetic`).
`Person.appearance.description` is a new canonical, persisted, structured description (archetype,
phenotype, costume family, silhouette, accessories, station, wear); the realized colour/scale
channels every renderer already read are derived from it, and authored cast pins still win with
their tokens snapped to match. Generation runs on each person's own `individualRng` stream, so it
consumes no world RNG. Age presentation and role cues are derived at projection time, never stored.
`SAVE_VERSION` deliberately NOT bumped — the field is additive and optional, so existing saves
(including the Fenwick one) stay playable and their people keep the look they had.

Unreal: `FTVAppearanceDescription` parses the description block fail-soft;
`AshfordAppearanceProfiles.json` is schema 2 (silhouette/hair proportions, accessory and role-cue
props, archetype provenance, `proxyVisibility`); `ATVCharacter::ApplyAppearance` applies the
grammar. The primitive hair/garment/prop stand-ins stay hidden behind `proxyVisibility` so the
accepted Slice 2 look does not regress — what changed visibly is that garment/skin/hair colour is
now costume-family and wear driven instead of one random shirt per resident, and height/build vary.

Measured regression and fix: coupling generated stature/frame into `defaultPhysiologyTraitsFor`
gave 34 of Ashford's 37 residents a new `bodySizeFactor` (v0.5 physiology is calibrated against
`AVERAGE_HUMAN_ADULT` at 1.0) and moved `baseline-village`, `food-chain` and `conflict-resolution`
from PASS to FAIL in `npm run world:smoke`. `makePerson` now passes the AUTHORED build/height to
physiology, restoring base values exactly; generated stature/frame stay presentation scale until a
physiology slice promotes them with its own calibration. `recover-item` FAILs on base too
(`WL-CONFLICT-STUCK`) — pre-existing, not this branch. Note the WorldLab CLI exits 0 on a FAIL
verdict, so the PR gate does not catch either.

Verified: `npm run typecheck`; `npm run build:bundle`; 15 new tests in
`tests/character-appearance.test.ts`; `npm run world:smoke` verdict-identical to base.
Evidence: `docs/evidence/character-appearance/ashford-contact-sheet.{svg,png}`
(`npm run appearance:sheet`) — seed 1337, 33 residents, all 8 families present, 29/33 distinct
garment colours, 33/33 distinct trait signatures.
NOT verified: UE build, native automation tests, PIE. Human visual acceptance still required.
Full report: `docs/CHARACTER_APPEARANCE_PIPELINE.md`.
# Slice 2 — visual finish (Claude continuation), 2026-09-17

Branch `claude/playable-world-slice-2-visual-finish` from Codex `ff36e25`, foundational Desktop
worktree. Nothing merged or pushed; Slice 3 not started. Same save (p_128/b_141, 127 residents).
Fenwick now presents zoned Megaplant woodland and a far horizon from canonical forest/geography,
a two-tier timber-frame architecture grammar, functional place dressing, layered scanned ground,
lit interiors (EV100 7–12) and fixed pack materials. Evidence: `after.png`, `before-after.jpg`,
`.debug/playable-world-slice2/after-walk.mp4` (two joined ordinary-PIE takes: woodland → square →
house interior; tavern dialogue → return to walking). Native presentation 14/14, 45 focused TS
tests, typecheck, UE build pass; F5 save → disk reload keeps identities and learned names.
Requires `r.Nanite.AllowAssemblies/AllowVoxels` and local derived assets (recipes in
`unreal/scripts`). Remaining: flat canonical terrain, mannequin people, parkland-like woods, no
prop collision. Human visual acceptance required.
Full report: `docs/evidence/playable-world-slice2/README.md`.

# Slice 2 — local palette integration WIP, 2026-09-16 evening

Branch `codex/playable-world-slice-2`, actual worktree
`<existing-repository>-foundational`. Keep protected `4fd5114`.
Local AssetRegistry audit: 3,714 assets / 39 groups. Selected AdvancedVillage roof,
grass/trees/well/storage, Free Medieval fixtures with owned PBR wrappers, WaterPlane
rock. Derived licensed assets stay local; originals/imports and dirty map excluded.
Fixed terrain material graph wiring and implemented local-phase UVs. Bridge now
projects canonical furnishing cells with table-facing chairs; native projection uses
semantic whole fixtures, optional roof envelope, bounded grass and varied resource trees.
Latest native build (28.19s), nine playable-world tests, and typecheck pass.
Independent review's chair-facing finding repaired and tested. No sim mechanics changed.
Current final palette is NOT visually accepted. Editor quit cleanly for rebuild;
automatic approval review rejected the combined bridge restart/editor relaunch
(`blocked by policy`, no more specific reason). No retry loop. Editor is closed;
old-source bridge PID 10236 still owns 8787 and needs a normal save/restart for new DTO.
The terrain-material repair was seen in ordinary PIE before the final integration;
its UV repair and final asset palette still require AFTER screenshots/video, NPC
movement/dialogue and disk-save reload checks. Nothing merged. Do not start Slice 3.
Full state and evidence limits: `docs/evidence/playable-world-slice2/README.md`.
Local asset provenance: `docs/playable-world-slice2-local-assets.md`.

# Earlier Slice 2 environment checkpoint, 2026-09-16

Branch `codex/playable-world-slice-2`, based on protected `4fd5114`, foundational
Desktop worktree. Paired roof slopes/bounded eaves, terrain-blended canonical paths,
clustered grass with approach exclusions, and a semantic presentation palette are
implemented. No canonical movement/identity/persistence changes; existing Fenwick save.
Typecheck, 13 region/stream tests, 30 bridge tests, UE build and two native environment
tests pass. Visual acceptance is incomplete after GUI automation interruptions.
No Slice 3, merge or quality-complete claim. The pre-existing dirty map stays excluded.
Implementation checkpoint `b17f876` passed independent review. Recovery found no
remaining target editor/bridge. One matching bridge is ready; automatic approval
review blocked the visible editor launch before it started. No relaunch/reconnect
loop was attempted. Editor is not open; exact manual launch/playtest is in the report.
Evidence, asset limits and human playtest: `docs/evidence/playable-world-slice2/README.md`.

# Playable life Slice 1 — restoration checkpoint, 2026-09-16

Branch `codex/playable-life-slice-1`, base `b4dc26e`, in the foundational Desktop
checkout used by the running editor. No merge or human approval. Continued the
existing seven-settlement save (Fenwick, player p_128/b_141); no fresh-world bypass.
Restored nearby canonical human projection, repaired fixed-step locomotion signals,
made dialogue replies/shortcuts usable, and strengthened provenance-bearing name
retention. Shared recent-self-care history lookup reduced the measured 120-tick
profile from 7.99 s to 1.04 s with identical resulting canonical state.

Ordinary PIE includes 13 nearby canonical NPC bodies, recorded skeletal walking,
dialogue and persistent identity checks. Arrival/anchor repair lets the saved resting
crowd walk apart (seven settled residents, minimum 81.4 cm body-centre clearance).
Targeted TS/native tests and builds pass. Overall playable quality is NOT accepted:
weak visuals/activity poses, history growth and sustained scheduling debt remain.
Do not merge on the strength of these restoration checks. Evidence, exact claim limits
and local capture paths: `docs/evidence/playable-life-slice1/README.md`.
The pre-existing dirty `TornVeilWorld.umap` remains outside this change.

# Foundational gameplay presentation v0.1 — resumed repair, 2026-09-15

PR #43 remains unmerged and NOT human-approved. Real CommonUI activatable screens/stacks,
Enhanced Input, GASP-derived local directional blendspace and CC0 skeletal deer are integrated.
Repaired controller lease handoff, stale input clearing, timer-starved rate windows and inline
urgent-wake amplification; ownership limits, command expiry and canonical scheduler are unchanged.
Also fixed unreadable fonts/prompts, modal Back routing, missing dialogue exit, and item/chest
support-plane offsets. Ordinary Lit PIE passes the lighting/geometry/pixel check.

Ordinary test-world walkthrough is INCOMPLETE: talk/close, inventory, store/retrieve, menus and
save/reload/control recovery were observed. Drop expired under growing simulation debt; full
food/pickup/combat/region/deer journey remains unverified. A read-only loaded-save profile measured
7.91 s per 120 interaction ticks, 7.47 s in NPC thinking. Further canonical cognition/scheduling
work is outside this presentation repair. Do not replace the failed ordinary walkthrough with
the passing fixture acceptance. Evidence and capture limitations:
`docs/evidence/foundational-gameplay/retrofit/REPAIR_VALIDATION.md` and `BRIDGE_SAVE_PROFILE.md`.
Normal user save was preserved; verification used `.debug/playable-repair-test.save.json`.

## Earlier milestone checkpoints (historical, superseded by repair status above)

PR #43 human playtest rejected near-black PIE. Fixed the proven 100-lux saved-time sun / EV100-12
mismatch with a shared neutral-daylight setup/startup contract (`TVPlayableLighting`). Launch
rebuilds/validates level infrastructure and rejects a mismatched bridge checkout. Lit PIE capture
now requires complete regional geometry, runtime lighting validation and completed-image luma/
readability checks; the recorded dark frame fails. Native presentation 5/5, focused TS 14/14,
foundational acceptance, typecheck, production and UE builds pass. See the milestone's lighting
correction section and `docs/evidence/foundational-gameplay/lighting-verification-summary.json`.
Canonical clock/weather/save semantics are unchanged; human re-test is still required.

Branch `codex/foundational-gameplay-presentation-v0-1`, base `333665e`. Canonical containers,
semantic container transfers, settlement pickup/chest seeding, body-keyed wildlife projection,
temporary engine-shape deer presentation, locomotion/camera signals, central item visuals and a
controller-capable layered native HUD now form one playable shell. TypeScript retains movement,
interaction, inventory, container, wildlife, combat and persistence authority. Focused TS 81/81,
production build, generated specs, native Editor build, three native Presentation tests and the
61-check playable startup smoke pass. Report: `docs/FOUNDATIONAL_GAMEPLAY_PRESENTATION_V0_1.md`.
Final deer art/rig, explicit equipment slots, true CommonUI widgets and human quality approval are
not claimed. Human launch: `pwsh -File unreal/scripts/Launch.ps1`.

Remote hardening adds no gameplay system: `npm run foundational:accept` objectively traverses the
pickup/container/wilderness/deer/save-reload path, verifies identity/location/topology and duplicate
absence, and writes `docs/evidence/foundational-gameplay/automated-journey.json`. Four labeled PIE
captures cover settlement, container, wildlife and post-reload. Profiles found no optimization
trigger: direct snapshots 1.2–1.8 KB, container projection 0.0031 ms mean, steady region frame 0.95
ms mean, one nearby wildlife actor, and native proxy Tick about 0.025 ms mean. Focused TS 81/81,
build/typecheck, UE build, native Presentation 3/3 and playable startup 61/61 passed.

# Realtime wildlife integration v0.2 — porting in progress, 2026-09-14

Branch `codex/wildlife-realtime-integration-v0-2`, created fresh from consolidated
main `7152abb` (wildlife ecology PR #39 + realtime combat PR #40). The unique
functionality from the older `codex/wildlife-realtime-integration-v0-1` commit
`3a9373e` (itself built on an older combat checkpoint `53901d5`, predating the
continuous-combat-flow and family/robbery precondition work now on main) is being
reapplied here rather than merging that branch's old combined ancestry. See the
v0.1 entry immediately below for what that source functionality is; this section
will be updated once porting/validation on the current main base is complete.

# Realtime combat consolidated with wildlife main — 2026-09-13

Branch `codex/realtime-interaction-v0-1`; normal merge `ee93cff` joins combat `b5693ad`
and wildlife-containing main `5877a72`. Final source checkpoint `b9ba86a`.
Report: `docs/REALTIME_WILDLIFE_MAIN_INTEGRATION.md`; compact evidence:
`docs/evidence/realtime/wildlife-main-integration.json`.

- Both canonical systems are retained. Wildlife advances once through the slow scheduler;
  combat retains its 60 Hz contact authority. Schema 24 keeps ecology and execution remainders,
  RNG, bodies, resource depletion and combat history. Playable load does not reseed wildlife.
- Initial focused checks: 242/242 in 25 files. One full local run: 916/919 in 92 files,
  1438.78 seconds; historical motivated-life family trace passed. All three other failures
  reproduced on pre-merge combat. A pre-start combat interruption timestamp was corrected;
  robbery and assault fixtures now establish physical passage/witness preconditions.
- Final affected checks: 126/126 in 15 files. Typecheck, production build and generated spec
  pass. One native Editor build and all 10 Realtime automation tests pass. Native assets/code
  and contact geometry were not retuned. The PR CI gate supplies final full regression.
- The family experiment is restored uncommitted; original raw evidence/assets and concurrent
  presentation-planning work remain outside integration commits. No family-priority changes.
- User subsequently authorized merging the PR when verification and PR checks permit it.
  No final combat-polish, rendered PvP or human animation approval is claimed.

# Continuous combat flow v0.3 � human playtest checkpoint, 2026-09-13

Branch `codex/realtime-interaction-v0-1`, base `53901d5`, implementation `7fd8f10`.
Report: `docs/CONTINUOUS_COMBAT_FLOW.md`; normal-speed BEFORE/AFTER continuous video,
side-by-side jab/cross and front/round comparisons, and all pose diagnostics are under
`docs/evidence/combat-flow/`. Evaluated pose/velocity residuals, owned chain trims,
carried support footing and nonuniform round-kick timing remove the observed reset paths.
Approved standalone cross/front kick and locomotion/sprint/dodge/hit assets remain unchanged.
TypeScript still owns contact and commitment; revision 1 saves retain their old meaning.
One executed strike may carry through one dodge. The shoulder camera follows body facing.
72 unique focused TS tests across affected runs, typecheck/web build, generated-spec check,
native Editor build and 10 native Realtime tests pass. No full regression was run.
Human arena: `pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 59414`.
Stop for human playtest; approval is not claimed. Existing unrelated local work is preserved.
The older full-suite 851/852 family failure remains unresolved and outside this pass.

# Wildlife / realtime integration v0.1 — 2026-09-13 (source evidence for v0.2 above)

Branch `codex/wildlife-realtime-integration-v0-1` in the dedicated Documents worktree
`TornVeilOnline-wildlife-integration`. Merge `39193ee` has realtime `53901d5` and wildlife
`d991d22` as its parents. Source branches were not modified. No main merge or PR.
Report: `docs/WILDLIFE_REALTIME_INTEGRATION_V0_1.md`.

- Same canonical Creature/Body identities across background and active encounters. Active
  movement follows the interaction clock; sensing runs at 5 Hz, biology at 900 world seconds.
  Persisted per-body activity accounting prevents free/duplicate travel, food or sleep.
- Common physical presence query reuses World's body spatial index. Sight-gated avoidance and
  responsive ecological travel use existing navigation/collision and species walking limits.
- Additive bridge wildlife observation and regional resource quantities preserve identity,
  death vs presentation absence, finite matter and active save/load continuation. Save schema
  remains 24, ecology version 1. No species, animal combat, hunting or ownership were added.
- Focused distinct coverage: 216 passed, one existing humanoid visual-state cooldown assertion
  failed identically on clean realtime base `53901d5`; it remains unchanged. Final selected
  integration/realtime/bridge plus extra visual-state file: 128 passed, the same baseline failure;
  original ecology: 23 passed. Typecheck/build passed.
  Existing resource/physiology coverage passed 65 checks, including its eight-world-day case.
- Active group bound: 128 deer / 60 physical ticks, fewer than 5,120 body broad-phase candidates.
  Full repository regression not run. No Unreal code, assets, startup or acceptance work.
  Native DTO/actor/animation/resource visuals and playtest work remain with the Unreal owner.

# Camera-facing combat refinement — human playtest checkpoint, 2026-09-12

Feature branch `codex/realtime-interaction-v0-1`, base `947761b`.
Report: `docs/COMBAT_CAMERA_REFINEMENT.md`; videos/curated measurements:
`docs/evidence/combat-refinement/`. Independent canonical/native facing, held crouch,
repaired jab derivative, one right-foot body round kick, explicit replant/transition gates,
evaluated-pose blending and arena-only Practice Recovery extend the existing architecture.
The approved cross/front kick and walking/sprint/step/reaction assets are preserved.
116 focused TS tests across latest affected runs, typecheck/web build, native build and
nine targeted native tests pass. No full regression, family investigation, merge or PR.
Human launch: `pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 53636`.
WASD strafe/back/forward; mouse desired facing; Shift forward sprint; LMB Light; RMB Heavy;
Space + direction dodge; hold Ctrl crouch; F1 passive, F2 incoming, F3 reset with mode retained,
F4 Practice Recovery/Normal Physiology. Controller equivalents are in the report.
Three normal-speed 24-second front-oblique/side/rear videos are about 9 captured fps.
An uncaptured 60-fps run measured callback-to-evaluated-pose around 18.5 ms, not input-to-photon.
Stop for human playtest. Approval of the new/refined content and full acceptance are not claimed.
Unrelated caregiver experiment and prior local raw evidence remain uncommitted and preserved.

# Responsive combat repair — previous playtest checkpoint, 2026-09-12

Branch `codex/realtime-interaction-v0-1`, repair base `31051ec`.
Report: `docs/RESPONSIVE_COMBAT_REPAIR.md`; curated evidence and normal-speed video:
`docs/evidence/responsive-combat/`. Free light punches/heavy kicks, semantic directional
dodge/duck input, one bounded follow-up, explicit recovery transitions, owned full-body
animations and in-game scripted practice controls extend the existing architecture.
85 focused TypeScript tests pass across latest relevant runs; typecheck/build, native build
and eight targeted native tests pass. No full regression, family investigation, PR or merge.
The family experiment and earlier local raw evidence remain uncommitted and unmodified.

Human launch: `pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 8791`.
LMB punch; RMB kick; Space + direction dodge (neutral backstep); Ctrl duck; WASD/Shift
move/sprint; F1 passive, F2 repeated incoming, F3 reset/recover. Full controller mappings
and remaining animation/network acceptance limits are in the report. Stop for human playtest.
Human animation approval and full milestone completion are not claimed.

# Real-time combat contact and defense v0.1 — earlier checkpoint, acceptance incomplete

Branch: `codex/realtime-interaction-v0-1`, accepted movement base `6e3af83`.
Canonical checkout: `<existing-repository>`.
Delivery report: `docs/REALTIME_COMBAT_CONTACT_DEFENSE_V0_1.md`.

User requested checkpoint and stop, with no further investigation or tests (2026-09-11).
Production commit `7f2f418` and test commit `3bc3acc` were pushed normally to the feature branch.
The documentation checkpoint preserves the unsuccessful `src/headless/motive/trace.ts`
experiment locally and uncommitted. Raw measurement streams/logs also remain local; curated
summaries and three existing native videos/screenshots accompany the report.
Last full run: 851/852 tests passed, 84 files, 1622.62 seconds. The family motivated-life
trace alone failed: its care purpose adopted no serving goals and performed no multi-step arc.
Injury knowledge arrives, but no care plan reaches execution. The original caregiver repeatedly
reported assaults/fled while the victim healed. No production fix has been justified.
A pending harness-only change selects physically available participants and an awake caregiver
without an active emergency goal, retaining distance ordering and every assertion. Worker A
reviewed this scope with no findings, but the focused family rerun STILL FAILED the same two
checks (68.79 seconds, 1 failed / 3 skipped). Typecheck passes. This is an unresolved experiment,
not an accepted fix. No further full run is active. Resume diagnosis only after user direction.
Raw results: `.debug/combat-full-final.json`, `.debug/combat-family-focused.json`.

Budget-limited family follow-up (2026-09-11): one agent, one read-only reproduction of the
current fixture, no further source changes. Evidence: `docs/evidence/realtime/family-causal-followup.json`.
For Mara/Tomas, 494/502 observed purpose decisions have threat candidates and no care candidate;
three provision offers tie reporting at 1.0 and lose stable ordering; one care offer loses to
critical thirst. Four remaining decisions offer no care. No care plan is adopted. The purpose
resolves at 72.148/80 partner health, above the seen-well threshold. Initial caregiver availability
does not guarantee a multi-step care opportunity. The 17-hour delay before purpose formation is
still unexplained: this observer starts decision capture only once a purpose exists.
Exact family test rerun: 1 failed / 3 skipped, 69.36 seconds; same two care-action assertions.
No fix made. Next discriminating experiment, only if authorized: pair-specific welfare concern,
fear, percept and belief gates at upkeep from report receipt through first purpose formation.
That investigation stopped without full regression, source edits, Unreal work or additional
benchmarks. The subsequent checkpoint only publishes existing commits, documentation and
curated evidence; no acceptance completion is claimed.

- Persistent canonical attack phases and bounded tracking; acceptance leaves contact undecided.
  Relative swept six-volume geometry determines contact and injury region at 60 Hz, with
  segments bounded to 1/120 second. Active actions survive deterministic save/load.
- Canonical collision-constrained sidestep/backstep and geometry-changing duck; shared NPC/player
  requests and witnessed preparation cues. Internal phases do not flood social memory.
- Existing movement prediction/reconciliation extended to immediate attack/defense startup;
  authoritative binding does not replay animation. Live native choreography follows the action.
- Ten counterfactual arena cases, browser attack regression, twelve native tests, TypeScript build
  and shared generated-spec check pass. Final full regression acceptance is pending; no completion claim yet.
- Native input-to-predicted attack/duck p95 0.0165/0.0180 ms, combat receipt p95 18.686 ms,
  contact-to-presentation p95 11.789 ms. Cooperative regional projection reduces measured bulk
  combat receipt p95/p99 from 30.655/205.697 to 21.560/83.178 ms. World-work stalls remain.
- Human arena: `pwsh -File unreal/scripts/Start-CombatArena.ps1`. High strike LMB/X; low R;
  sidestep Z/V; backstep Space; duck Left Ctrl. Three native videos and reproduction scripts
  accompany evidence. No human approval or two-client rendered PvP is claimed.
- No PCG/vendor/binary game assets changed. Next: two-controller rendered combat and prediction
  hardening v0.2 before weapon content, mastery or progression.

# Accepted movement checkpoint (historical)

Branch: `codex/realtime-interaction-v0-1`, starting at `3c1c876` (stacked choreography/humanoid work).
Canonical checkout remains the Desktop projects checkout. Detailed delivery and remaining criteria:
`docs/REALTIME_INTERACTION_PREDICTION_V0_1.md`.

- Implemented: bounded command identities/epochs, received vs applied receipts, pure movement
  prediction/native reconciliation, shared collision/spec data, 60 Hz interaction scheduling with
  persisted 20 Hz slow cadence, immediate hand-attempt feedback and once-only canonical pickup.
- Not implemented: live contact phases, physical sidestep/backstep/duck, cue-driven defense,
  new combat arena, live choreography migration, two independently controlled bodies.
  Existing combat is still retrospective. This is not the full milestone outcome.
- Native local prediction is now sanctioned; obsolete blanket bans on root prediction do not
  apply. Mesh-only choreography still has no authority. PCG/vendor assets remain unchanged.
- Final canonical regression: 821/821 tests in 82 files (1,372 seconds), typecheck/build,
  generated spec check, six native automation tests and automated PIE/standalone movement
  checks passed. Loopback applied RTT p95 32.578 ms, PIE 54.825 ms, standalone startup
  119.634 ms all miss the 30 ms target. Native input-to-engine-state p95 <0.24 ms;
  display/physical latency and human approval remain unmeasured. Detailed evidence is in the report.

# Embodied Wildlife & Ecology v0.1

Original checkpoint: `codex/embodied-wildlife-ecology-v0-1`, based on `d9e758c`, subsequently merged to main as `5877a72` (PR #39). Report: `docs/EMBODIED_WILDLIFE_ECOLOGY.md`; reproducible evidence: `docs/ecology-acceptance.json`.

- Compositional species foundation and three reactive profiles: field hare, roe deer, woodland boar. Existing Creature identities and Body authority; per-manifestation reserves, finite feeding/drinking, physical travel, rest, paid gestation/birth, local nursing, growth and natural mortality. Sapience is not tied to humanity.
- Shared physiology kernel, existing spatial/nav/time/RNG/resource upkeep, additive schema-24 ecology state and deterministic partial-cadence continuation. Chronicle gets notable tracked-population changes, not routine meals. No extinction repair spawning.
- Focused ecology: 23 checks passed. Relevant existing physiology/resources: 65 checks passed. Typecheck and final build passed. Remaining normal regression: 743 checks in 77 files passed; combined selected coverage: 831 checks. Two long ecology cases exceeded their unchanged limits after an initial redundant visibility check; cheap eligibility gating removed that overhead and both passed on rerun. No unresolved test failures.
- Measured: seed 701, 8 → 18 hares in 100 days; seed 711, 8 → 15. Overcrowding: 48 hares, 5 → 0.061 kg accessible forage by day 3, starvation extinction by day 10, ordinary resource recovery to 5 kg by day 50. Water-free habitat: six dehydration deaths by day 10.
- Scale sample: 1,000 individuals / one day / 4,160 resource nodes in 20.424 s; 18.29 million spatial resource candidates, about 22× below full scans. Quarter-hour endpoint simulation; no realtime visual/century-scale claim.
- Deferred: predation/combat/hunting, domestication/ownership/economy, full hydrology, non-walking locomotion, pack/herd/Person controller attachment, worldwide wildlife generation, shared human/nonhuman presence/perception and visualization. Legacy decorative chickens, human water actions and abstract hunting grounds remain unchanged. No Unreal or combat/martial implementation changes; shared hand query only filters new direct-intake node kinds out of gathering offers.

## Previous merged milestone: Emergent combat choreography v0.1

Recorded previous branch: `astra/emergent-combat-choreography-v0-1`, from `8a5eda3`
(previous humanoid/PCG phase; 8 commits ahead of origin/main at start).
Canonical checkout: `<existing-repository>`.

- Ordered, bounded combat execution projection over existing causal events; preserved
  body counters, observation gating, save/reload and burst identity.
- Shared player/NPC native planner, stable technique fixtures, explicit pose sampling,
  target alignment, 22 cm mesh translation limit, 12-degree lean and close foot IK.
  Canonical actor movement remains TypeScript-owned; presentation drift telemetry is zero.
- Two owned grounded Manny strike derivatives, restrained ribbon/impact/pose hold,
  three presentation LODs and an isolated 14-scenario showcase. Real martial training,
  weapon animation families, magic and supernatural movement remain deferred.
- Architecture, reproduction, evidence and validation: `docs/EMERGENT_COMBAT_CHOREOGRAPHY_V0_1.md`.
- Final Unreal acceptance: 93/93 checks in 14 scenarios; native automation 3/3,
  humanoid regression 19/19, five PCG seeds/reload, owned asset editor restart verified.
  Target-centre alignment error: near 0.003 cm, left 0.293 cm, right 1.674 cm,
  far 13.664 cm. The far residual is retained within the 22 cm mesh-motion bound.
- Final canonical suite: 808/808 tests in 79/79 files, 1,390 seconds with one worker
  and Unreal closed. Targeted combat/bridge/persistence 44/44, typecheck and production
  build passed. A baseline-reproduced social trace subject precondition was corrected;
  all four social traces and the seven-test stress suite passed without weakened assertions.

# Previous playable humanoid and PCG dwelling v0.1

Phase branch: `astra/playable-humanoid-pcg-dwelling-v0-1`, from main `410a0a7`.
Canonical checkout: `<existing-repository>`; the Documents
checkout is stale. No PR or merge. Phase report: `docs/PLAYABLE_HUMANOID_PCG_DWELLING.md`.

- Shared Manny presentation for possessed and NPC bodyIds; typed parsing, correct 2D
  locomotion Blend Space axes, canonical combat counters and bounded one-shot replay.
  Local CharacterMovement authority remains disabled. Native acceptance: 19 checks passed,
  including measured prone bone heights. Owned clips bake the additive hit onto idle and
  extend the death lead-in with a keyframed settle; vendor animations remain untouched.
- Canonical knock-downs survive NPC wait replanning. Death still withdraws the body;
  persistent corpse semantics are deferred. Body-specific withdrawal leaves siblings intact.
- Five native PCG dwelling graphs and an isolated test map use Quaternius modules plus
  pantry barrels. 6 × 8 m input produces measured 6.4 × 8.2 m geometry, at most 20 cm
  excursion. Actual instance hashes match after cleanup/regeneration/package disk reload.
- Vendor assets, Ashford and the separate GameAnimationSample remain untouched.
- Final relevant canonical regression: 71 tests passed; typecheck/production build,
  UE editor target and native parser/queue automation passed. The initial full suite
  found two trace regressions (798 passed); a narrower wait-handler fix resolved them,
  with all four unchanged motivated-life traces passing. Details are in the phase report.

## Previous seeded-world foundation

Original milestone: `docs/PLAYABLE_SEEDED_WORLD.md`; journey evidence:
`docs/playable-world-acceptance.json`. The following records the previous startup/foundation work.

## Startup reliability

- Actual Desktop checkout loaded a stale September 7 DLL: native close 1009 at 1 MiB, caused by the 2.60 MB initial region frame preceding the snapshot. Launch now runs incremental UBT and validates bridge prerequisites/checkout diagnostics.
- Canonical hello/scene/snapshot precede lazy center-first presentation. Regional protocol 2 uses acknowledged <=128 KiB messages, <=4 MiB assembly, separate origin/residency updates and independently applicable regions. Native receive callbacks defer application; transport, snapshot freshness and streaming are distinct.
- Existing-save native PIE reached LIVE, rendered nine regions, and held native WASD bindings changed canonical position with local movement disabled. Same-editor PIE restart reacquired the same body; controller ownership was released on stop. World/save preserved.
- Validation: 12 focused + 44 additional relevant regression tests passed; live socket acceptance passed; typecheck/bundle and UE builds passed. Full world suite not repeated for this bridge-only change. See `docs/PLAYABLE_STARTUP_FIX.md` and `docs/evidence/startup/`.

## Implemented

- One 24.576 km square seeded world with seven settlements (127 generated residents plus an ordinary avatar for seed 918271), a shared clock/registry, locally seeded terrain, rivers, resources and suitability/cost-derived settlement sites and roads.
- 256 m regions with pure generated substrate, dense inhabited patches and canonical historical modifications. Body-driven resource relevance is independent of rendering. All NPC systems still step; no distant simulation LOD.
- Native `/scene` manifest plus regional geometry/semantic updates. Nine presentation regions stream around the avatar; canonical coordinates remain stable while Unreal rebases its presentation origin. Body-specific avatar visibility, explicit developer truth and evidence-gated mechanism offers.
- Generic `TornVeilWorld.umap`, modular Quaternius structure assembly, Poly Haven materials/grass, non-authoritative PCG grass/bush dressing, instanced canonical resources/crops/items/structures and basic semantic changes. Ashford is preserved with an explicit launch option.
- Shared canonical movement fixes: one-metre descent, door opening, footprint-safe path smoothing and release of completed external action scheduling. Browser emergency resurrection/teleport is removed.
- Save schema 24 preserves world specification, edits, resource lifecycles, knowledge/history and scheduler state. Older saves are explicitly rejected, not deleted. A running server continues without Unreal; stopped-server time is not silently advanced.

## Evidence

- Focused canonical checkpoint: 49 checks passed. Movement fixes: 2 checks passed. Final projection/menu/privacy: 11 checks passed.
- Detailed 0.1-second A→B→A journey: 10.510 km, 20,238 steps, 118 presentation unloads. Same depleted tree and introduced identity on return. B did not magically know the avatar. Energy/hydration fell and fatigue increased through existing physiology. Save/reload/reconnect preserved the same clock and alteration.
- Typecheck, production bundle (123 modules), and UE 5.8 editor target build passed. Full suite: 787 passed, two stress timeouts; both passed unchanged in isolation with Unreal stopped. No assertion/time limit changes.
- Actual PIE captures cover A, wilderness and B in the generic map: nine resident regions, 34–41 total actors, 212–4,249 canonical instances and 3,779–6,673 decorative instances. All sampled PCG regions generated and instance collision was disabled. Native region build max 26.04 ms; region-frame apply max 90.29 ms. Captures are explicit developer relocations, separate from the canonical movement evidence.

## Limits

This is a functioning continuous-world foundation, not an all-conditions showcase PASS. Starting settlements have primitive technical education and wind boundaries, with no guaranteed finished mechanism. The menu is verified using the existing disclosed workshop. Full human keyboard-driven regional PIE travel and every activity/repair/combat animation have not been visually accepted. Terrain/water, modular roofs/interiors, component geometry and item/crop presentation remain prototypes. No ecology/hydrology, bridges, shipping package, simulation LOD, multiplayer or offline catch-up.

Next: Regional Life and Interaction Acceptance — natural technical history/artifacts, procurement/construction access, complete live Unreal survival/mechanism journey, stronger region/material/facade rendering and recorded animation/performance evidence. Do not manufacture prosperity or disable distant systems for a demonstration.


## PR56 scoped production/pursuit/deadline repair (2026-10-01)

Request-aware per-workplace WorldLab probes and bounded shared combat approaches are locally verified (47 focused + 53 adjacent tests, typecheck). Profiled pure geography/navigation/visibility optimizations retain original test deadlines and baseline geographic output. The three-day baseline no longer reports production/conflict stalls but still reports construction supply and bandit hunger; no universal health claim is made. Evidence: `docs/evidence/worldlab-pr56-repair/`. Exact pushed-head PR56 CI is the final aggregate and must be read from the PR checks; no merge/deployment is authorized.

PR56 follow-up: b963cd7 exact-head CI finished red (1,821 pass, two default deadlines and a family trace selection defect). The trace now isolates its triggering canonical situation instead of unrelated later matters; four social traces and 32 focused floor/spatial/pressure/agency regressions pass with unchanged assertions/windows/deadlines, plus typecheck. Pure navigation/spatial overhead reductions preserve replay hashes. See repair followup.json and the current PR checks for final aggregate status.
