> Historical motion/arcana checkpoint. The later shared Tower and recovery work
> supersedes its missing-integration status: see [Canonical Tower](CANONICAL_TOWER_OCT9.md).

# Connected realms: October 9 checkpoint

The two linked procedural realms are a playable foundation for the intended Veil.
The current branch also adds shared ability, motion and physical-contact foundations.
It is not a finished megacity, reference-quality art, or a completed canonical Tower.

Work remains isolated at `codex/connected-realms` in
`<candidate-checkout>`.
The active Tower and character workers' separate checkouts were not edited. No Opus
character candidate was installed, and no push, deployment or public upload occurred.

## What is implemented

- **Playable connected world:** seeded Aether Reach and Cinderveil, distinct sci-fi
  and fantasy/steampunk building grammars, roads, districts, landmarks, physical
  doors, navigation and collision. Portals retain the same canonical Person, Body,
  inventory and rank. The actual Tower building has a playable ascent/return adapter.
- **Shared mechanics foundation (`c98207a`):** source-backed learning/casting,
  persisted mana, cooldowns and accepted casts, ordinary injury/damage, finite wards
  and physical armor. NPCs and players use the same functions and body-bound bridge.
  These mechanics are not yet a complete city-facing ability UI or Tower replacement.
- **Motion/contact checkpoint (`0ee4660`):** installed model/clip contracts,
  canonical-phase animation timing, correct facing, strikes, dodges, locomotion
  recovery and hit reactions. Collision-swept recoil persists across reload.
  Ordinary NPC attack plans use fresh sight to manage melee spacing. City movement
  respects shared bodily limitations. Schema 29 reads prior schemas 24-28.
- **Final hardening:** two reproduced recoil bugs are fixed: later spells cannot
  inherit a retained kick's impulse, and crouching preserves collision clearance
  without applying walking slowdown to external displacement.
- **Reusable interiors:** the existing Tower consumes its unchanged room generator
  from canonical code. A separate bounded grid adds stable instance IDs, connected
  physical layouts and retained edits. It is groundwork, not an enabled new ascent
  route. The geometry contract is [documented separately](FOLDED_INTERIOR_GEOMETRY.md).

## Verification

| Check | Result and scope |
|---|---|
| Full default regression at `0ee4660` | 2,073/2,073 tests, 207 files; zero failed/pending; 31m25s |
| Final affected suite after hardening/extraction | 181/181 tests, 17 files; zero failed/pending |
| Final TypeScript / Babylon production build | Passed; 3,404 modules; build 1m42s |
| Recorded motion evidence inspection | 11 checks passed; original raw capture unchanged |
| Legacy floor compatibility | All 101 floor descriptors for seeds 317 and 918271 retain their pre-extraction hashes |

The full default run predates the final narrow patch; the affected suite covers that
patch. Opt-in long society acceptance/soak suites were not rerun. Per-file results and
raw-report hashes are in [the aggregate record](evidence/motion-oct9/aggregate-0ee4660.json)
and [final affected record](evidence/motion-oct9/final-affected.json).

Actual before/after gameplay, original screenshots, hardware observations and limits
are in [the motion report](evidence/motion-oct9/RESULTS.md). The latest video is
`.debug/motion-oct9/after-contact-r2/after-contact-r2-gameplay.webm`: 26.96 seconds,
1440x900. Its original four browser checks passed with no browser errors; subsequent
recorded-state inspection verified four accepted strikes, contact displacement,
dodge/recovery and all five review opponents attempting attacks. Those partners are
explicit test drivers, not proof of autonomous encounter design.

The separate real-input city/Tower/portal journey remains at
`.debug/realms/combined-journey/traversal.webm` (121.84 seconds). It reached floor two,
reloaded, returned to the atrium, crossed realms and resumed the same scoped run.
Its [report](evidence/connected-realms/COMBINED_RESULTS.md) distinguishes this earlier
journey from the newer canonical motion laboratory.

## Performance and visual assessment

Local inventory confirmed Ryzen 5 9600X / 6 cores / 12 threads and 33,436,114,944 bytes
of OS-visible RAM. Chrome reported RX 6650 XT / ANGLE D3D11. The short six-person
captures had p95 frame interval 7.1 ms before and after; latest host-step p95 was
1.191 ms. These are refresh-limited observations, not uncapped benchmarks or proof of
improved GPU cost. Dedicated VRAM usage and a long memory soak were not measured.

**The visual quality gate remains unpassed.** Grounding, turns, hand/weapon contact,
shadows, faces/clothing, facade variety, terrain and street composition need more
work. The motion capture is unarmed; a full sword/shield comparison remains pending.
The code retains the replaceable asset contract for a later approved character handoff.

## Full direction retained; next work

Two linked realms remain the initial organization. The eventual goal is detailed
sci-fi and fantasy/steampunk worlds or continents with useful nested interiors,
portals and one shared character history, not only the current representative district.
The 81-chunk render window, 128-descriptor cache and 12-interior-plan cache bound
derived geometry. Four city residents do not establish populated-megacity affordability.
Worker generation/upload budgets, material/LOD refinement, moving origins, and bounded
coarse continuation of households and institutions still require implementation and
long traversal/GPU/memory validation.

The larger canonical Tower route must bring floor instances, encounters, items,
rewards, death/injury, activity scheduling and exactly-once recovery into one host
transaction. The current rich Tower still owns scoped browser combat and pauses the
realm; its checkpoint cannot award global rank or equipment. This deliberate boundary
preserves saves while the shared route is built.

Complete spell riders/composition, emergent magical classes and meaningful Silver/Gold
capability remain unfinished. Four-to-six-hour climbs and one-to-five-percent Gold are
provisional design targets, not observed balance. The current Normal-to-Iron history
gate is preserved; floor counters cannot manufacture elapsed history or metaphysical
capability. The fictional documentarian remains design-only, with private reviewable
drafts and source-grounded curated knowledge as the proposed boundary.

## Launch

Double-click `Play Torn Veil.cmd` in this checkout for the connected world, or run
`npm run realms:play` and open `http://127.0.0.1:7510/?realms`.
The prior living-world launcher/save and Unreal archive remain available.
Motion-laboratory launch and reproduction instructions are in the motion report.
Its temporary review server was stopped after capture. There is no remaining access
blocker; the unfinished items above are engineering and visual-quality work.
