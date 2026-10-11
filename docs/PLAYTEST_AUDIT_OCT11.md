# Human-build playtest audit - October 11, 2026

This is a diagnosis and repair plan. No gameplay, assets, running preview state,
or another worker's files were changed. The private character preview on 7531
and the protected Tower-polish worktree were not used as integration targets.

## Exact build and delivered progress

The audited human presentation is commit
`dc9e07c57005e9854ba062f31f712440944a101f` on
`codex/ontology-human-motion`. The inspected historical preview served that build
on loopback port 7517 from the existing source checkout.

The served build is `.debug/quality-pass/client`, launched at
`http://127.0.0.1:7517/?gym=1&scenario=town&autoplay=1&view=third-person&renderer=webgl2`.
Read-only GETs confirm Town, a disposable no-save host, and
`./assets/index-Be97ENCn.js`. Served and local bundle SHA-256 both equal
`bcc5b01805fff6f1e17580a4438d03bba6e7829dad447f3b6590f372e824327f`.

The task delivered these presentation milestones:

| Commit | Delivered changes |
|---|---|
| `77dc178` | Imported human models, shared canonical action-clock animation, body/ontology checks, fallback IK, head/eye and garment coverage |
| `a097d62` | Closer exploration camera, secondary motion, restored missing tree canopies |
| `679ce9a` | Contact-aligned cycles and fades, guard transitions, foot support, Wren/Brann clothing fit and material work |
| `dc9e07c` | Terrain-aware foot support, bounded head/neck gaze, contact/surface audio, daylight balance |

Its final report records 65 focused tests, TypeScript, production build, terrain,
gaze, audio and keyboard combat/movement checks. This is substantial progress,
with no demonstrated Witcher 3 parity. Faces, wardrobe deformation, encounters,
interiors and sustained performance remain open. The keyboard acceptance strikes
with H in the Gym; its Town phase verifies loading rather than mouse combat.

`54dd429`/`2c3fbbe` on `codex/connected-realms` are a separate shared-gait
implementation and evidence checkpoint. Neither branch contains the other;
their merge base is `832c56fe3f583dd8c7af8b3c381ca41e296d83fe`. That gait adapter
is absent from the tested 7517 build. The private 7531 character candidate is
also separate, unpublished and unintegrated.

## Hunched posture

An offline right-handed Babylon NullEngine probe loads the actual frozen 7517
hero/Wren/Brann/Mystic and Mixamo GLBs and executes that branch's Retargeter.
It samples bind, idle, walking and running poses with no gaze, foot IK or physics.
Angles describe bone-chain geometry, not an artistic quality score.

The reference hero bind has pelvis-to-neck inclination 0.76 degrees and
chest-to-head inclination 8.98 degrees. Current idle at phase zero gives
11.36 and 26.96 degrees. Across four idle samples the upper chain is
25.56-27.96 degrees. Brann has a similar result; Wren/Mystic respond differently
to the same baked rotations because their joint geometry differs.

The source bind itself has chest-to-head inclination 27.25 degrees. Retargeting
applies a static target-to-source rest-direction correction even for neutral
source deltas. In a discarded diagnostic process, replacing only the six torso
corrections with identity reduces the hero's idle inclination to 1.69 degrees
and its upper-chain inclination to 12.43 degrees. This isolates a material
retargeting contribution, before gaze or foot support. It is **not a production
fix or visual acceptance**; arm, grip and action rest conversion still matters.

Smallest repair: preserve the target's neutral torso/neck geometry while
transferring source motion deltas, keeping necessary arm/limb conversion.
Review front and side views for every imported look, then walking/running,
guard, actions, gaze and foot support. Do not compensate by layering arbitrary
spine offsets or rebuild all character assets before this correction is tested.

## Combat appears absent

The tested `src/web/game/input.ts` only emits mouse combat in third-person
when pointer lock is active. Unlocked LMB/RMB become camera dragging. With
capture disabled, or lock refused, mouse strike/guard never reaches canonical
combat; H still emits a strike. A synthetic-event probe against the actual
InputManager reproduces this in six input-mode cases, without reading Jacob's
settings or connecting to the live preview. Jacob's exact pointer-lock state
is unknown, so this is a verified defect capable of causing the symptom,
not proof that all possible Town combat failures have been explained.

Smallest repair: define separate camera-drag and combat gestures for unlocked
third-person, make input-mode hints accurate, and verify real LMB/RMB against
a reachable Town opponent. Keep keyboard, pointer-lock entry/refusal, menus,
blur, cancelled pointers, guard release and controller behavior working.

## Fast Iron and inconsistent Tower scaling

The tested Town button explicitly goes to `?arena=1&tower=1`. This is the
older client action Tower, not the connected-realms canonical ascent host.
Its `tierOf` score combines level, square-root style points, affinities,
attributes and bosses. Pure-function checks return Iron for an otherwise
empty sheet at level 10, or level 1 with flame affinity 4.5. Hits add style
points, kills add three, and casts add rider affinity without an opposed
encounter gate. These are mathematical/code-path findings, not measured
time-to-Iron from Jacob's run.

Difficulty uses separate floor curves: early foe HP multiplier .775 at floor 1
to 1 at floor 10, then +.1 per floor; damage .595 to 1, then +.04 per floor.
Bosses have additional multipliers. Player proc damage grows with floor*.06
and skill power with floor*.03 regardless of earned rank. The displayed player
tier is therefore neither the floor's theme band nor a canonical transformation.

The separate connected-realms branch has both an intermediate bounded ARPG
ledger and the newer canonical body/source ascent. These must not be confused.
Current canonical arcane Iron requires 12 distinct opposed victories, a learned
form demonstrated against three opponents, a learned essence and consumption
of spare essence stock, with recovery/action/contact gates. The older embodied
Iron route requires meaningful practice, proficiency, foundations, provenance
and evidence across three world days. Floor clearance alone grants no rank.
The canonical ascent HUD reads the host person's rank; summit recognition
requires earned Silver. Gold policy work remains paused. Neither canonical
thresholds nor difficulty have been proven to match desired human pacing.

Smallest repair: coordinate integration of the canonical host, session identity,
inventory and Tower adapter into the human build, then route its Town entry to
that supported host. A URL change alone is insufficient because that build
lacks the ascent client/host path. Check round trips and persistence before
calibrating actual first-person play time, damage/resource cost, breakthrough
pace and per-floor difficulty. Do not replace one rank formula with another
or claim balance from accelerated fixtures.

## Evidence and limits

Snapshot results are saved as [input-probe.json](evidence/playtest-audit-oct11/input-probe.json)
and [rig-probe.json](evidence/playtest-audit-oct11/rig-probe.json).
New raw probes and outputs are local under
`.debug/playtest-audit-20261011`: `input-probe.mts/json`, `rig-probe.mts/json/log`.
They are reproducible with `node --import tsx` from this worktree and read the
explicit tested Desktop checkout/static GLBs. Probe outputs are synthetic input
and structural observations, distinct from actual rendered evidence in the
tested task's `docs/evidence/human-world-quality` and `fluid-human-models`.
No new live interaction, capture, timing benchmark or full-suite rerun occurred
during this read-only audit. The prior shared-gait checks remain a separate
branch's acceptance. No push, merge, deployment or reference upload occurred.
