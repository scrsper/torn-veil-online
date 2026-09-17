# Character appearance pipeline — slice 1, 2026-09-17

Branch `claude/determined-meitner-w9c23l`, based on merged `main` plus the already-merged
Slice 2 history at `1f36ba5`. Nothing merged; no Unreal build or PIE run was possible (no engine
in this environment).

The five committed reference sheets in `art/reference/cultures/ashford/characters/` now drive the
population. `-ren-ayami-shiro.png` is four labelled NPC panels, not one, so five files yield eight
stylistic families (`hana`, `yuki`, `kaito`, `shogun`, `ren`, `ayami`, `shiro`, `ascetic`).
`Person.appearance.traits` is a new canonical, persisted, structured description (archetype,
phenotype, costume family, silhouette, accessories, station, wear); the realized colour/scale
channels every renderer already read are derived from it, and authored cast pins still win with
their tokens snapped to match. Generation runs on each person's own `individualRng` stream, so it
consumes no world RNG. Age presentation and role cues are derived at projection time, never stored.
`SAVE_VERSION` deliberately NOT bumped — the field is additive and optional, so existing saves
(including the Fenwick one) stay playable and their people keep the look they had.

Unreal: `FTVAppearanceTraits` parses the trait block fail-soft;
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
`C:/Users/green/Desktop/projects/torn-veil-online-foundational`. Keep protected `4fd5114`.
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
Canonical checkout: `C:/Users/green/Desktop/projects/torn-veil-online`.
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
Canonical checkout: `C:/Users/green/Desktop/projects/torn-veil-online`.

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
Canonical checkout: `C:/Users/green/Desktop/projects/torn-veil-online`; the Documents
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
