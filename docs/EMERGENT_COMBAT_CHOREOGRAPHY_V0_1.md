# Emergent combat choreography v0.1

This slice extends the shared `ATVCharacter` with ordered combat replay, a pure
choreography planner, explicitly sampled/blended poses, bounded mesh warping,
close-range foot IK, and reusable impact operators. It does not add combat rules.

## Authority and real inputs

`src/sim/` remains the sole world authority. A legal strike still uses
`Simulation.attack -> resolveAttack -> applyHit`, for players and NPCs alike.
The resolver currently has one strike/one hit, carried weapon selection, physical
reach, impact, exertion, injury, incapacitation and death. It has no combat skill
proficiency, parry, evasion, multi-hit technique or persistent combat technique
identity. Trade instruction/technology ancestry is not a substitute for any of
those missing combat semantics.

Unreal never resolves a hit, reach, cost, injury, motion or death. It receives the
already resolved action and depicts it retrospectively. No animation notify sends
gameplay events. CharacterMovement remains disabled. The body/capsule follows the
existing TypeScript projection even during a presentation freeze.

## Ordered projection

`CombatActionFacts` is an optional immutable execution record on the existing
canonical `attack` event. An empty swing now emits a perceivable `attack_missed`
event with the same record. Its independent `combat` sequence uses the existing
World counter mechanism and consumes no RNG. Body attack/hit counters retain
their existing meanings. Old events and saves are not assigned invented history.

The facts record the explicit actor and target body IDs, physical timestamp,
positions, target velocity, actor yaw, actual selected weapon type/ID, `strike`,
`hit` or `miss`, body counters, and effective strength/dexterity/exertion at
execution. No intent, private cognition, trade proficiency, class or speculative
technique crosses this allowlist. Facts persist through normal event serialization;
no extra persistent event bus or second authoritative result table is introduced.

`src/bridge/combatPresentation.ts` maintains a disposable cache of the latest 128
causal event references per world. Each snapshot replays the retained eight-second
window as a detached allowlist. It reports `firstAvailableSeq` and `latestSeq`.
Ordinary spectators must have actually seen the event; hearing alone is insufficient.
Both manifestations must currently be render-visible. Participants have direct
experience. Whole-world observation is confined to the named developer projection.

The native cursor establishes a baseline on connection, sorts new entries, deduplicates,
and reports malformed rows, late observations and source retention gaps. Gaps between
visible sequences normally mean filtered actions, not loss. The cursor does not create
replacement strikes. A new connection clears pending presentation. Initial connection
does not replay an old fight. Each body queue is capped at 32 entries/eight seconds;
overflow is counted. Incapacitation and manifestation withdrawal take precedence.

## Style, signature and planning

`FTVCombatStyleProfile` maps effective strength into force, dexterity into control,
and exertion into economy/recovery. Complexity thresholds select simple commitment,
controlled entry, a small angle step/pivot, and faster guarded recovery. They are
presentation categories, not ranks or canonical martial training. The explicitly
labeled technique fixture also exercises a future mastery input. Production never
claims a person knows a move because of their occupation or private thoughts.

`FTVTechniqueVisualSignature` uses a specified UTF-8 FNV-1a hash. Its stable anchor
is lineage when supplied, otherwise technique identity, otherwise body plus weapon.
The anchor determines a motif, primary gesture, rotation tendency, rhythm and permissible
effect colour. A persistent technique retains its primary gesture across repeated events
within the same feasible directional vocabulary. Selection excludes clips whose effector
bearing cannot fit the target within the alignment bound when a compatible clip exists;
sequence supplies a bounded ±2.4% anticipation variation. No global random draw is
used. Future lineage can preserve the anchor while child identity evolves details.

`FTVChoreographyRequest` combines the resolved event, render LOD, physical appearance
scale and attack/reaction role. The pure planner emits `FTVChoreographyPlan`: selected
motion, anticipation/strike/recovery timing, contact sample, mesh offset/yaw/lean,
footwork complexity and `FTVPresentationFXCue`. Paired bodies receive one shared
scheduled contact time. Later actions wait for each involved body's presentation
availability; unrelated pairs can proceed independently. A reaction cannot create a
second canonical hit.

## Motion vocabulary and animation authority

The owned JSON catalog is `Content/TornVeil/Combat/Data/MotionPrimitives.json`, loaded
once; assets are cached per component. Rows carry family, asset, effector, contact
sample, measured hand geometry and control eligibility. Adding a family does not
require a parallel player/NPC path. Weapon classification covers unarmed, one-hand
blade, axe, blunt and generic improvised inputs; only the grounded unarmed family is
art-supported in this version. Unsupported families fall back to body expression,
without displaying a fabricated equipped weapon.

The selected library contains two single-strike upper-body performances derived
from project Manny `MM_Attack_01` and `MM_Attack_02`, with a planted guard lower
body, plus the previous owned full-pose front reaction. Native samples contained
roughly 90–150 cm root travel, unsuitable for ordinary non-authoritative attacks.
`create_combat_choreography.py` bakes the owned grounded derivatives and measures
their contact geometry. Motifect's separate skeleton and combo clips were inspected
but not imported/retargeted into this small slice. FreeSample's installed inventory
was primarily traversal/work, not a convincing equipped melee library. Vendor
packages and the sibling GameAnimationSample are unchanged.

The canonical actor root remains separate from the skeletal mesh. Temporary visual
translation is capped at 22 cm, alignment at 55 degrees, and target lean at 12 degrees;
all reconcile to zero. Close LOD applies two-bone foot IK without limb stretching to
counter mesh movement, and capable fighters use a small step-and-recovery target.
The mesh's base transform is restored on completion/cancellation. Root extraction
is disabled on owned clips and ignored by the native animation instance.

`UTVCombatAnimInstance` blends idle with a sequence evaluator at an explicit time.
Sequence teleport sampling produces neither root motion nor animation notifies.
Anticipation, contact and recovery are independently timed. Only this visual clock
pauses for impact; global time dilation and canonical clocks remain untouched.
No Motion Matching, Mover, ChaosMover, NetworkPrediction or sample trajectory
architecture is added. MotionWarping/Chooser are unnecessary for the current two
primitives; custom mesh warp and AnimationCore foot IK provide the required boundary.

## Impact and magic extension

The same reusable FX cue controls a short hand ribbon, small contact flash, local
camera impulse and 25–65 ms pose hold. Ordinary expression stays restrained; higher
control increases trail/step complexity and impact contrast. Geometry is pooled per
body and collision-free. The owned additive emissive material compensates for eye
adaptation so thin effects remain visible in daylight. Its graph is saved outside PIE
and verified after package reload/editor restart. Audio cue authoring, Niagara,
afterimages, casting projectiles and large supernatural displacement are deferred.

The disposable server can overlay `fixture:reed-cut` / `fixture:reed` and an explicit
`fixture:wind` descriptor after canonical combat resolution. These synthetic labels
are never inserted into world events, knowledge or saves. They demonstrate body
motion plus a stable signature and hand-centred effect geometry. They do not claim
a real magical attack, energy cost, projectile, spell ancestry or learned move.

Future rank/capability support must authorize additional motion operators from real
displacement and capability semantics, rather than particle multipliers or tier-name
switches. Air control, dashes and battlefield-scale geometry remain unavailable until
the canonical action actually supports them. The planner can gain operators without
changing the shared actor, event consumer or identity boundary.

## Presentation LOD

LOD is render distance only: close (<12 m), medium (12–25 m), far (>25 m). Close uses
foot IK, target alignment, bounded offsets and FX. Medium keeps simpler sampled
animation/alignment with effects suppressed. Far keeps basic animation with no visual
translation, lean, foot IK, trails or impact processing. LOD is selected per queued
action for coherence. It never changes simulation frequency, resolution or cognition.

## Showcase and reproduction

Level: `/Game/TornVeil/Combat/Tests/L_TV_CombatChoreography_Showcase`.

1. Run `npx tsx src/headless/bridge/combatChoreographyFixtureServer.ts` in the canonical
   checkout. This is a disposable fixture, never the playable-world server/save.
2. Build with `unreal/scripts/Build.ps1`; it selects the repository portable AutoSDK.
   Start exactly one UE 5.8 editor on the showcase map with Remote Control enabled.
3. Begin PIE and execute `unreal/scripts/verify_combat_choreography.py` through Unreal
   Python. The callback advances stages without blocking the editor thread.
4. Evidence is written under `docs/evidence/combat-choreography/`. To inspect one
   stage manually, POST `/fixture/stage/arrange_near` then `/fixture/stage/strike`.

Stages cover 0.8/1.4 m and ±30-degree targets, low/capable and force/precision
attribute arrangements, repeated signature use, a three-action burst between
publications, an NPC striking another NPC, the labeled wind effect fixture, and LOD2.
Scenario arrangement is synthetic; actual strikes/hits/exertion remain the shared
canonical mechanics. Each arrangement restores the fixture's initial physiology so
long editor sessions do not silently turn a capability comparison into starvation.
Capture scheduling uses Unreal presentation time, keeping screenshots from overlapping
the next action. The previous humanoid and PCG fixtures remain separate regression
environments. Native telemetry measures offset, hand-to-recorded-target horizontal
error, played sequence identities, pending/dropped actions, complexity and pose hold.

## Validation and limits

The final live Unreal run passed **93/93 checks across 14 scenarios**, including
three distinct attacks and three distinct reactions from one bridge burst. Every
scenario retained disabled CharacterMovement, zero presentation-induced actor drift,
ordered replay and restoration to zero mesh offset. Maximum observed mesh offset was
22 cm (floating-point telemetry: 22.000000000000004 cm). World time dilation remained
unchanged during the local pose holds. LOD2 disabled the extra presentation operators.

Contact telemetry samples the evaluated striking hand against the **recorded execution
target centre in the horizontal plane**. It is not a weapon-surface or current moving
target contact solver; canonical recoil can already have moved the target during replay.

| Arrangement | Measured error | Acceptance bound |
| --- | ---: | ---: |
| 0.8 m | 0.003 cm | 2 cm |
| 1.4 m | 13.664 cm | 18 cm |
| 1.1 m, 30° left | 0.293 cm | 2 cm |
| 1.1 m, 30° right | 1.674 cm | 2 cm |

Native Parser, Plan and Replay automation passed **3/3** after the final geometry
selection change. The final incremental editor build succeeded in 4.79 seconds.
The prior shared humanoid acceptance passed **19/19**, including native input,
NPC movement, burst replay, prone/incapacitation, sibling manifestation isolation
and death withdrawal. Five PCG dwelling seeds regenerated with their expected
52/51/52/51/52 instance counts and matching hashes after package reload. The owned
combat level, animations and material loaded after editor restart; both clips had
root motion disabled and there were no dirty packages. Changed Content paths are
confined to `/Game/TornVeil/Combat/`; vendor and GameAnimationSample assets are untouched.

Canonical focused verification passed **44/44 tests in six files**, typecheck and
the 124-module production build. An earlier full run exposed a pre-existing social
trace fixture problem, reproduced at starting HEAD: its chosen victim was already
above the wound threshold, so the planned assault applied no hits. The trace now
selects an eligible subject and checks that an assault happened. No canonical rule,
assertion or timeout was weakened. All four social traces and the isolated seven-test
stress suite passed afterward. The final stabilized full run,
`npm test -- --maxWorkers=1`, passed **808/808 tests in 79/79 files in 1,390.00 seconds**
with Unreal closed. Details are recorded in
`evidence/combat-choreography/canonical-validation.json`.

The two bounded test workers performed canonical/regression and Unreal/acceptance
verification. The Unreal worker also performed one independent final implementation
review, with no high- or medium-priority findings. Root retained production architecture,
implementation and visual integration ownership.

Evidence:

- [Native checks and sampled telemetry](evidence/combat-choreography/native-acceptance.json)
- [Build and automation summary](evidence/combat-choreography/native-validation.json)
- [Canonical validation](evidence/combat-choreography/canonical-validation.json)
- [Humanoid regression](evidence/combat-choreography/humanoid-regression.json)
- [PCG regeneration and reload](evidence/combat-choreography/pcg-regression.json)
- [Owned asset restart/reload](evidence/combat-choreography/reload-and-ownership.json)
- [Low-capability anticipation](evidence/combat-choreography/04-low-anticipation.png)
  and [capable anticipation](evidence/combat-choreography/05-capable-anticipation.png)
- [NPC-to-NPC strike](evidence/combat-choreography/11-npc_duel.png)
  and [wind presentation fixture](evidence/combat-choreography/12-magic.png)

The NPC demonstration exercises the same canonical attack and native presentation
substrate with an NPC actor and target. The isolated harness initiates the action;
this is not evidence that autonomous NPC planning selected a technique.

This is a bounded grounded combat foundation, not an anime animation content pack.
It lacks convincing equipped sword/polearm assets, true combat proficiency and
technique discovery, canonical magic, multi-hit choreography, weapon collision
contact solving, directional defense, multi-body formations and advanced aerial
operators. Canonical reach is currently much more generous than human hand reach;
the visual planner must disclose residual error rather than teleport the actor to
hide that gap. Dead bodies still withdraw according to the existing lifecycle.

The next useful slice is a small retargeted one-handed weapon library with measured
weapon-tip contact, a fitted grip and two directional reactions, using this event
and motion substrate. Canonical combat training should be a separate mechanics task.

## Change inventory and commits

Canonical production changes are limited to execution facts, the causal miss event,
bridge projection/session wiring and the social acceptance subject precondition.
Unreal changes add the pure choreography model, sampled animation instance, shared
presentation component and existing bridge/character wiring. Tests live in
`tests/combat-presentation.test.ts` and `TVCombatChoreographyAutomation.cpp`; the
isolated TypeScript fixture and two Unreal Python bake/verification scripts provide
reproduction. Existing humanoid scripts only gain the new expected presentation
path and a separate evidence output option.

The four new binary assets are `A_TV_Direct`, `A_TV_Hook`, `M_TV_CombatLight` and
`L_TV_CombatChoreography_Showcase`; the accompanying primitive catalog is JSON.
`.ai/STATE.md`, `.ai/DECISIONS.md` and `.ai/REPO_MAP.md` point to this phase.

Starting HEAD was `8a5eda35e0e0d59fa0bc05fbf64ca0695d3a11ba`, exactly the requested
previous phase endpoint, with a clean tree and eight commits ahead of fetched
`origin/main` (`410a0a7`). Work is on `astra/emergent-combat-choreography-v0-1`.

| Commit | Coherent change |
| --- | --- |
| `db6872a` | Ordered canonical combat execution projection and tests |
| `4527159` | Shared Unreal planner, motion, IK, effects and owned assets |
| `bc61453` | Eligible assault subject in the existing social regression trace |
| `8226a57` | Deterministic isolated choreography showcase and acceptance |

The following documentation/evidence commit records final validation without changing
tested implementation. No merge or pull request is part of this phase.
