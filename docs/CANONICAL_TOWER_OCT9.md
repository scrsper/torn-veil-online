# Canonical Tower integration — October 9

The connected realms now have a playable **shared Tower trial** attached to the
existing host-owned World/Simulation. Entry, combat, source learning, injuries,
finite rewards, ascent and return use the same Person and Body as city travel.
The old expedition remains available with its original scoped mechanics and
unverified rewards. This is the first shared encounter loop, not full legacy parity
or a completed 100-floor progression game.

## Authority and persistence

- `src/sim/world/interiors/tower.ts` allocates the existing seeded room grammar into
  the bounded folded-interior namespace. The registry is canonical; generated plans
  are disposable. Existing realm voxel indices, doors and saved edits remain intact.
- A run contains geography, identity bindings, revision and causal receipts. It does
  not copy health, inventory, rank, skills or player identity into a second sheet.
- Each warden is an ordinary Person/Body with a source-backed nonlethal trial
  agreement. Fresh sight contributes an attack goal through ordinary goal competition,
  planning, movement and combat. Fear, fatigue, fleeing and sleep still apply.
- A defeat requires actual attack/kill/surrender evidence. Each defeated participant
  retires once. The floor-clear receipt transfers ownership of an existing finite
  chest and its items; the browser cannot submit damage, clearance, loot or rank.
- `TowerController` attaches BridgeSession to the existing simulation. Commands retain
  body/controller/epoch binding and ordered receipts. The loopback realm host runs
  canonical Tower interaction at 60 Hz and slow simulation at its existing cadence.
  Outside the trial, city movement uses the same elapsed host clock. No LLM is used.
- Entry/ascent/return require physical thresholds and bodily eligibility. Occupied
  landings try a bounded nearby clear spot; fully obstructed landings fail. Durable
  transition commands have revisions and idempotency
  receipts; write failure restores the whole prior session and rebinds the controller.
- Save schema **30** reads schemas 24–29. Registry, finite stores, consent, defeated
  participants and reward provenance are validated and retained by event compaction.
  Reload restores the current floor, body, injuries, items, learning and action state.

## Presentation and shared fixes

`/?ascent` projects host geometry and the installed shared characters/motion contracts.
Stone/paving and elemental effects reuse existing local assets. Only observed cast
phases produce effects. Inputs are requests; clips and effects cannot cause damage.
No Opus candidate was installed, no new external art was fetched, and no other
worker's checkout or denied QA action was touched.

Shared physical issues were addressed while connecting the loop:

1. Controlled bodies now receive the existing timed knockdown recovery already used
   by autonomous bodies. Surrender/custody remain binding and injuries are preserved.
2. Ordinary melee approaches now close to the implemented contact path rather than
   stopping at the older wider admission radius and repeatedly missing.
3. Direct movement callers preserve sleep/incapacitated poses. The bridge also rejects
   those movement commands. Ordinary body-bound rest/wake is exposed in the trial UI.
4. Short action exertion is now a saved body reserve, separate from cumulative fatigue.
   One policy charges and recovers players and NPCs identically. The HUD shows Breath,
   and a ring identifies the currently selected visible opponent.

The replay driver initially restarted its sleep intention while walking back to the
entrance, preventing settling. That was a **driver error**, separate from the shared
movement safeguard; fixing it did not make the underlying fatigue curve fast.

## Evidence and validation

The complete default suite ran **2,097 tests in 211 files**, with **2,087 passes and
10 failures**, in 34m53s. After investigating those failures, the final affected run
passed **141/141 tests in 10 files**; all **four social-trace scenarios** passed in a
separate complete-file rerun. Every initially failing file was rechecked. TypeScript
and the Babylon production build passed. Test/scenario-fixture repairs changed no
runtime mechanics after the successful browser captures.

This is not one uninterrupted all-green full run. The complete suite was not repeated
after those narrow fixture repairs. [Initial aggregate](evidence/canonical-tower-oct9/AGGREGATE_INITIAL.json),
[final affected results](evidence/canonical-tower-oct9/REGRESSION_FINAL.json),
and [combined evidence](evidence/canonical-tower-oct9/RESULTS.json) retain the exact
scopes and raw-report hashes. Earlier interrupted full runs are not counted as passes.
Coverage includes source learning, physical chest access,
repeat reward credit, grid edits, save integrity, obstructed-landing rollback,
sleep/wake, exertion, stale input, realm travel and legacy separation.

The aggregate exposed an existing social-trace setup defect: its three staged gifts
went to a sleeping recipient, so it did not establish witnessed gratitude. The
fixture now selects existing awake, free participants. Cognition, seed, thresholds,
assertions and timeout are unchanged. The isolated original check and all four
scenarios in the complete trace-file rerun pass. The initial aggregate result and
this final rerun remain separately recorded.

The other failures had three causes: old integration assertions equated nominal
short effort with lasting fatigue; two immediate-attack fixtures stood outside the
new unarmed approach range; and an allegedly confined robbery passage had open ends.
The updated checks retain exhaustion/recovery, lasting work, duplicate-charge and
fresh-aggression guarantees. The robbery trace showed an ordinary injured defender
escaping, so the open passage now verifies escape without theft, while an additional
closed passage verifies actual nonlethal subdual before theft. No NPC outcome was
forced and no encounter difficulty changed to make these checks pass.

The headless acceptance command also now exits unsuccessfully for an uncleared or
incomplete journey. A deliberately zero-duration run returned exit 1; the complete
seed-918271 replay returned exit 0 with all five journey checks.

Actual browser evidence, never generated imagery:

- `.debug/canonical-tower-oct9/smoke-r2/actual-traversal.webm`: 29.04 seconds,
  1440×900, six checks. City entry, finite manual pickup/study, dagger equipment,
  save/reload and physical return. Predates the final reach/recovery safeguards.
- `.debug/canonical-tower-oct9/combat/actual-combat.webm`: 85.32 seconds,
  1440×900, five checks. Actual keyboard combat, host spell damage, autonomous warden
  attacks, knockdown/recovery and reload with the same injured body and learned source.
  The player did **not** clear that rendered fight.
- `combat-exertion/actual-combat.webm`: **283.72 seconds**, 1440x900,
  seven checks. Actual keyboard fight cleared three wardens in 273.5 elapsed physical
  seconds. Health fell from 80 to 59.963; lasting fatigue rose from 0.10015 to 0.10515.
  Reload retained the earned history without restoring health.
- `reward-portal-exertion/actual-portal-round-trip.webm`: **63.40 seconds**,
  1440x900, ten checks. Continues that **actual rendered fight save**, walks to the
  chest, takes the finite rewards, learns Ward, ascends, returns, cancels one portal
  choice, visits Cinderveil, resumes the same floor there, and travels back. Identity,
  inventory, rank and injuries persist. This final capture has no headless provenance.
- `smoke-exertion` repeats entry, pickup, learning, equipment, save/reload and return
  under the final shared physiology. All capture results are in the evidence manifest.

New capture paths above are relative to `.debug/canonical-tower-oct9/`. The earlier
failed `portal` run is retained: it exposed occupied-landing behavior and is not
counted as a pass.

The input-driven headless journey uses only an initial atrium placement fixture.
After entry it submits ordinary body-bound movement, combat, hand and transition
commands. There is no force-kill, health write or reward grant. Both final tested
seeds clear all three wardens, collect the existing chest, learn its Ward source,
verify reload, ascend at the physical stair and return to the city: **five journey
checks per seed**. Seed 918271 clears in **111.033 simulated seconds** (20 attack
events), seed 317 in **297.033 simulated seconds** (19 attack events). These runs
finish with 80 HP; that is an observed strategy outcome, not a healing operation.
Outputs are `.debug/canonical-tower-oct9/exertion-final-{seed}/`.

The retained before-policy result, `headless-journey-final`, took **8,230.033
simulated seconds** (2 h 17 min 10 s), 41 attack events and extensive resting.
The short-lived 81.15-second intermediate result predates the final rear-room
warden home placement; it is not the final baseline.

Headless execution time is not frame time or human completion time. Browser captures
ran alongside regression work and are not performance benchmarks. The earlier
Ryzen 5 9600X / RX 6650 XT short motion measurements remain in the motion report;
no new megacity, VRAM, population or multi-hour render-performance claim is made.
Selected actual captures and their delivery provenance remain private local evidence.

## Pacing result and remaining work

The shared first-floor loop is implemented; **Silver/Gold pacing remains unvalidated
and unimplemented**. The previous action costs treated a strike (~0.03) or Ember
cast (~0.042) as long-term fatigue, despite rest recovering only 0.12 per world hour
and sleep 0.5 before modifiers. Brief combat therefore required disproportionate
rest. The approved pacing repair changes that shared policy while preserving real costs.

`src/sim/physical/exertion.ts` now applies one authored policy:

- Nominal action effort adds five times its value to short exertion load, bounded
  at one. Admission refuses unaffordable actions. Heavy strikes and repeated blocks
  remain more expensive; guard can break under impact.
- Recovery starts after 0.8 seconds and the current action/cast commitment, at
  0.12 load/second standing, 0.06 moving and 0.03 while guarding. Low food/water and
  lasting fatigue slow this rate. NPC melee plans can disengage to catch breath.
- Nominal effort also converts to 100 heavy-work seconds per unit, charged at the
  existing quarry fatigue rate and incremental food/water rates. A nominal 0.03
  strike adds 0.15 short load and 0.000125 lasting fatigue, before ordinary elapsed
  activity costs. Recovery refunds none of that work, damage, injury or mana.
- Saved physical timestamps prevent reload refills and duplicate scheduler recovery.
  Chronic fatigue, hydration and energy still gate admission. The same rule applies
  across realms and controller types; no player-only or Tower-only stamina grant.

This deliberately changes game-wide combat endurance: sustained fighting is limited
by repeated short recovery and cumulative physical work, instead of hours of rest
per brief exchange. It is a tunable game-pacing policy, not a physiological claim.
Injuries still constrain subsequent floors. No global clock acceleration, rank
credit, fabricated days, free healing or extra items were introduced. Existing
Normal-to-Iron history/readiness remains unchanged. Human balance sessions and
higher-floor capability work are still needed before establishing any 4-6-hour
climb or 1-5% Gold outcome claim.

Other explicit gaps: full elemental riders/composition, bosses and ranged/magical
warden diversity, classes and higher-rank metaphysics, curated floor programmes,
human balance sessions, controller ergonomics, sword/shield presentation, character
quality and social/legal interpretation of agreed trials. The new view draws the
base floor plan; arbitrary persisted interior voxel edits do not yet have a visual
patch projection or player-facing edit tool. Old floors' residents remain ordinary
simulation entities; the 12-plan geometry cache is not a population simulation budget.

The eventual linked-world/continent vision remains intact. Streaming, instancing,
coarse remote simulation, moving origins, richer reusable art kits and representative
long traversal measurements remain separate expansion work. The documentarian is
still design-only. The reference-quality visual gate remains **unpassed**.

## Launch and reproduction

From this isolated `codex/connected-realms` checkout, use `Play Torn Veil.cmd` or
`npm run realms:play`, then open `http://127.0.0.1:7510/?realms`. Walk to the Tower,
open its real door, enter the atrium and choose **Enter shared Tower trial**.
The **Legacy Tower expedition** button preserves prototype access.

Controls: WASD, Shift run, J light strike, K heavy strike, L low strike, Space dodge,
G guard/face target, Q face target, Tab target, E hand action, 1–6 learned ability, Escape cancel,
drag orbit, wheel zoom. Blue threshold returns; cleared gold threshold ascends.
Rest/wake, source learning, equipment and chest transfers use the side panel.

For isolated QA set `TV_REALMS_SAVE` to a new path and optionally `TV_REALMS_PORT`.
`TV_REALMS_ASSETS` may point read-only at the original checkout's `web/public`.
The shipped launcher discovers that asset directory from the Git common directory.
Never overwrite a live save with a QA fixture. The headless driver is
`node --import tsx src/headless/towerLoop.ts` with `TV_TOWER_SECONDS=300` and a fresh
`TV_TOWER_OUT`. Browser scripts are `canonical-tower-smoke.mjs`,
`canonical-tower-combat.mjs` and `canonical-tower-portal.mjs` under `scripts/web`;
their headers state the required starting save and evidence limits. Set
`TV_TOWER_FINISH_FLOOR=1` for the portal driver to continue an actual floor-one
clearance through reward collection and ascent before the realm round trip.

All commits are local. No push, main merge, deployment or public sharing occurred.
