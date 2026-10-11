# October 11 main consolidation verification

This ledger distinguishes the consolidated source, actual rendered gameplay,
controlled pose fixtures and provisional progression rules. Publication and independent
CI are tracked in [PR #66](https://github.com/scrsper/torn-veil-online/pull/66).
That PR supplies the final-head checks and main landing receipt; the local
`.debug/main-integration/delivery.json` records the exact compiled main replay.
Earlier recordings remain scoped to their named commits. No simulated timing or
copied checkpoint is a fresh human-climb benchmark.

## Source and authority

The candidate starts at main `10a648b`, merges current human presentation `dc9e07c`
and connected realms/input repair `6732dbb`, and retains compatible orbit/camera/input
fixes from `e853410` and generic fallback contact timing from `98b16b2`. The realms
history already includes the committed Tower chain and `e7cd628`; no protected
worker checkout was changed or its denied QA repeated. Source branches remain.

`5ce1853` integrates the simulation/presentation; `98190ad` adds required local
motion staging/hash validation. `6423888` corrects the QA driver and inherited
asset provenance and is the last fully played predecessor. Review then found the
schema-30 compact-save compatibility defect described below; its local repair is
passes the final local regression. Rendering never creates rank, inventory, player identity
or combat consequences. New Gold source promotions are paused; the conceptual
ladder and saved capacities remain.

## Historical save compatibility repair

The readable-version gate already admitted schema 30, but the compact-event branch
used a duplicate list that omitted it. Compact events now load for every supported
version from 25 onward. Unsupported versions and damaged event tables remain rejected.

The paired golden fixtures come from the actual schema-30 serializer at `97f8146`,
with only `savedAt` normalized. Complete restored canonical serialization equals
the historical plain reference, including receipts, events, IDs, belongings, rank,
health, injuries, door state and Tower consent/run. A second current-format round
trip preserves it. The regression failed before the repair and passes afterward.

All **32 affected tests in four files** pass, as does TypeScript. Journal tests
verify import, upgrade of a checksummed compressed base before accepting a new tail,
and refusal of an incompatible old-engine tail without changing committed files.
The compressed-base case wraps historical JSON in a synthetic format-1 journal;
schema-30 JSON predates the actual journal. This does not certify arbitrary old
uncheckpointed tails or a fresh several-hour Tower climb. Final full regression passes
**2,248 tests in 230 files**, zero failures/skips, in 1,551.58 seconds. Raw result:
`.debug/main-integration/schema30-aggregate.json`. Final production bundle passes
(2.45 seconds Vite); final World smoke exits 0, five PASS and two DEGRADED solely
for `WL-TIMBER-HORIZON`. Report:
`.debug/worldlab/2026-10-11T05-55-39-621Z-smoke/report.json`.
The existing schema-26 default JSON also initializes a realm session with identical
person/body/rank/belongings and unchanged original bytes (read-only validation).
The repaired candidate's compiled identity and ordinary-input journey are recorded
in the local delivery receipt and `playable-schema30-repaired/result.json`:
exact clean `1a4ecdc`, 24 checks and zero browser errors. Later current-state
documentation edits leave the tested runtime unchanged; independent CI verifies
the final public head. The landed-main compiled journey is recorded separately.

Tracked reports generalize personal paths and omit private delivery/task IDs.
Raw originals and private media provenance remain local. Artifact digests for
derived reports identify their generalized bytes; original raw digests are retained
separately where applicable. This cleanup does not alter rendered measurements or
canonical gameplay receipts. The full integration history is preserved privately on
`codex/consolidate-main-oct11`. Local release branch
`codex/consolidate-main-oct11-sanitized` is a tree-identical snapshot parented only
by the previous main, so its outgoing history omits private intermediate reports.
No source branch was deleted or force-updated. The sanitized release is published
through PR #66; private intermediate reports and raw licensed motions stay local.

## Predecessor compiled-build journey

**Passed: 24 checks, zero browser errors**, served commit
`98190addcc7b2b28f6b42e0cc3482252d40cf97d`.

Run `scripts/web/current-main-smoke.mjs` with `TV_REALMS_URL` pointing to the current
loopback host and a **fresh disposable** `TV_REALMS_SAVE`, never a live player save.
`TV_REALMS_EVIDENCE` chooses the local evidence directory. The driver uses mouse,
keys and UI buttons, reads the visible projection and actor contact receipts, and
never edits bodies, hidden residents, simulation clocks or saves.

Verified together: default canonical world; imported city/Tower bodies; ordinary
movement; cancelled crossing; Aether→Cinderveil→reload→Aether; exact real person,
body, rank and starting belongings; enterable Tower; finite manual acquisition and
learning behind the rank gate; free-cursor LMB strike; RMB held lease/release;
physical room search and actual mouse hit; injury authority; save/reload with released
input and retained learning/belongings; world return; repeated same-run entry/return;
world reload. The successful jab has canonical event `e_251`, contacting warden `b_6`.

Raw local evidence:

- `.debug/main-integration/playable-scan/result.json`
- `.debug/main-integration/playable-scan/current-main-traversal.webm` (actual recording, 14.7 MB)
- `01-current-aether.png`, `02-current-cinderveil.png`, `03-current-canonical-tower.png`,
  `04-current-mouse-combat.png`, `05-current-returned-world.png` in that directory.

Earlier failed driver runs remain in adjacent evidence directories. The first used
missing-motion stand-ins and cannot establish final visual fidelity. Later failures
were distant/stale target navigation, lost canonical visibility and a selected-only
contact assertion; `playable-follow` already contains real hit event `e_132` on `b_8`.
The final driver physically turns/searches and checks the authoritative actor contact.
It does not weaken the physical combat rules or reveal hidden server people.

## Observed cost and limits

Actual device: Ryzen 5 9600X, 33,436,114,944 bytes physical RAM; Chrome WebGL reports
ANGLE/D3D11 on RX 6650 XT. Resolution 1440×900, headless Chrome with video recording.
This short functional run overlapped the serial regression. It is **not an
uncontended benchmark**, GPU timing/VRAM measurement or long-session guarantee.

| Observation | Samples / result |
| --- | --- |
| Aether chunk residency | 81 |
| Aether warm frame interval | 167 samples; p50 8.3 ms, p95 17.6 ms, max 27.5 ms |
| Initial streaming frame interval | 81 samples; p95 23.6 ms, max 333.1 ms |
| Aether JS heap snapshot | 442 MB used; browser JS heap only |
| Tower frame interval during play | 3,950 samples; p50 6.9 ms, p95 7.5 ms, max 139.6 ms |
| Tower JS heap snapshot | 668 MB; four visible people, 280 scene meshes |
| Tower server update | 278 samples; p95 0.713 ms, max 2.089 ms |

Cold upload stalls remain. Addressable geography, bounded chunk residency and four
nearby people do not prove megacity population cost. The representative art gate
remains open; no equality with Gigacity/Witcher visual quality is claimed.

## Controlled posture evidence

`.debug/input-posture-repair/side-views-final/` contains 32 actual rendered paired
GLB fixtures and `matched-posture-fixtures.webm`: four looks, neutral/walk/run/UE jab,
before/after, fixed full-body side camera. No live World, gaze or foot planting.
Hero neutral torso inclination improves 11.36°→1.69°, upper chain 26.96°→12.43°;
walk/run upper inclination also improves. UE combat samples match exactly. Garment,
hands and cast-specific posture defects remain; these fixtures are not gameplay
or whole-cast terrain acceptance.

## Repository gates

Focused integration checks and final runtime TypeScript passed during reconciliation.
The root production bundle passed (2.41 s Vite build, 2.85 s command elapsed).
The stamped primary build passed with audited local motion hashes (about 86 s).
Full normal regression passed: **2,237 tests in 229 files, zero failures or skips**,
28.10 minutes; raw JSON is `.debug/main-integration/aggregate.json`.
The shipped-assets gate passes: 39 CC0 assets and nine shared cast assets/credits.
Its first run found inherited stale Brann/Wren hashes; their current GLBs match
committed human `dc9e07c` and fit history `679ce9a`. Only provenance hashes and
modification history were corrected; models, licenses and credits stayed intact.
World smoke exited 0 in 202.98 s: five scenarios PASS and two DEGRADED with
`WL-TIMBER-HORIZON` warnings. Baseline Village and Food Chain harvested all 84 logs
across 14 tracked trees; regrowth takes about 913 world days. There are no invariant
or liveness failures. The warning is retained; biology and the gate were not weakened.
Raw report: `.debug/worldlab/2026-10-11T04-57-38-847Z-smoke/report.json`.
Ontology typecheck and all 16 tests pass (16.40 s command elapsed); ontology production
build passes (90.42 s command elapsed, 87 s Vite). The final candidate/main stamped
journeys belong in the delivery receipt. Independent final-head CI is linked in PR #66.

The exact local Mixamo/unarmed motion hashes and licensing prerequisite are in
`current-build.json` and `scripts/web/stage-current-assets.mjs`. Raw licensed motions
remain ignored and are not pushed. A fresh machine must supply its licensed local
copies; the primary build fails instead of silently substituting stand-ins.
