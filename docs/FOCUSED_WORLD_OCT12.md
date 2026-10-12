# Focused authored world checkpoint — October 12, 2026

The later [retained-save migration and forest review](FOCUSED_MIGRATION_FOREST_OCT12.md)
supersedes the blanket retained-Tower warning and first visual assessment below.
The actual live export has no Tower run; an explicit preserving migration is tested.
The approved local adoption is complete, with the existing canonical launcher and
current-save path retained. Corrected rendered review artifacts remain prototype quality.

This isolated candidate extends the existing Babylon.js connected realms and canonical simulation. The initial organization is two linked realms: Aether Reach (science fiction) and Cinderveil (fantasy/brass). It retains Unreal, existing character assets, ordinary player identity and earned Tower progression. It does not establish finished megacity fidelity, population scale or several-hour climb pacing.

## Source and authority

The verified focused pack contains 21 assembled GLBs and 25 modular components. Original GLBs and metadata are byte-preserved under `web/public/focused`; `pack.lock.json` records source hashes. The archive SHA-256 is `f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce`. The unrelated 730-asset collection is excluded. GLBs are already right-handed Y-up metres; source Z-up room metadata is converted once for room-target queries.

Cinderveil combines literal single-floor Bridgeport houses, paving, tavern/store, joined forest and ruin scenes, and a real Tower landmark. The house uses a disclosed 1.44 horizontal adaptation and retains its room plan. Authored door leaves are open poses; closed/open animation is not implemented for those imported doors. Aether retains the existing seeded science-fiction district grammar. The focused town is a curated fixed layout with stable seeded IDs, not a claim that every seed creates a different town.

`cook-focused-assets.mjs` derives canonical collision from the actual source meshes: 998,530 triangles, 53,979,786 bytes, SHA-256 `c3ad74f50784f8709a648dec03fd256c7aeb873c101ca1d02feebfab4271252f`. This derivative stays out of the JavaScript bundle. The server loads it; prediction receives a bounded nearby triangle window. Support, capsule collision, sight and navigation use the same geometry. A* edges are certified at 4 cm increments; impassable routes fail instead of tunnelling.

The terrain heightfield derives from authored support and aligns to whole 96 m chunks. A narrow join apron supports a capsule crossing into the original realm ground. Renderer vertices match canonical terrain. Runtime metre UVs and existing documented CC0 material maps improve the imported untextured sources without modifying source vertices or files.

The existing World, Person, Body and Item remain authoritative. Portal confirmation validates destination support before moving that same body. Cancellation leaves the current realm intact. Ordered journal operations persist changes and replay the same geometry/generator. Generator `chrysanthus-focused-3` and geometry hashes are pinned; incompatible saves fail closed. Adoption rejects any existing Tower or legacy realm expedition until coordinated migration is supplied. QA never rewrites the main save.

## Tower and reusable interiors

New bounded Tower descriptors use the same source/connector/collision principles. Folded interior slots are 128 m apart; scene/geometry caches are bounded at 12. Source connector frames, namespace limits, support and routes are certified before use. The 100-floor certification produced 30 physical recipes and 1,769 reachable opposed encounter stations under the existing floor budgets. This certifies layout/support/stations, not an NPC combat playthrough of every floor.

The Tower entry uses the real world landmark. Entry, return, reentry and reload retain the same canonical run/body. A loading acknowledgement pauses encounter stepping until the rendered source floor is ready. The finite first-floor dagger is catalogued as the existing TV-011 knife; reach, damage and attack gates remain canonical. No ranks, damage or completed floors are granted by the browser.

## Streaming and expansion

The underlying realm registry uses deterministic realm/district/chunk/parcel seeds and IDs. Its 64 × 64 chunk domains are addressable extent, not verified inhabited city area. Roads use global alignment. The existing 9 × 9 window caps realm chunk residency at 81, with detailed central chunks and reduced outer LODs; descriptors have a 128-entry cache. The client uploads at most one heavy chunk per frame and uses shared instanced kits and frustum culling.

Focused sources stream within 150 m (230 m for the landmark), reuse verified asset containers, retain at most 16 inactive containers, and cancel unwanted instances. These authored scenes are not a finished HLOD system. The server holds the compact curated geometry; large future cities need paged geometry and worker cooking rather than loading every source triangle.

Full simulation remains bounded to actual active entities. Far buildings do not imply millions of brains; there is no LLM call in the render loop. Persistence follows actual player/entities/edits rather than potentially generated addresses. The exact-request Navigator memo is bounded at 4,096 entries; failed queries are memoized too. That avoids repeated expensive NPC route searches without changing World truth.

Extend this foundation with versioned continent registries, district recipes and reusable licensed art kits; stable IDs preserve edits across cache eviction. Then add terrain/bridges/markets, doorway and multilevel adapters, instanced distant representations, worker budgets, floating origin, occupied households and coarse economic continuation. Each extension needs representative traversal and memory evidence before multiplying it across continents.

## Actual visual assessment and remaining gates

Current captures are actual rendered gameplay. Existing texture maps improve readable stone, timber, plaster and roof surfaces. The forest remains visibly low-poly/conical, town density is sparse, the night presentation is too dark, sci-fi facades remain repetitive, and the Tower camera exposes open/cutaway walls against a plain background. The visual gate remains open; these frames do not match the Ryan Sael reference.

Existing people/Mixamo/unarmed assets remain the baseline. Wren is deliberately retained. Full procedural gait override is disabled for rigs without its expected anatomy; authored in-place clips distinguish ordinary jog from Shift sprint. Earlier controlled observations measured roughly 3.38 m/s ordinary movement and 5.24 m/s sprint. These are observed input traversals, not a character quality acceptance. Crouch animation binding, equipment fit and a wider animation/art review remain unfinished. No Trellis or rejected v004 cast was substituted.

Canonical loose items, health, inventory, consent and progression persist. Block diffs are retained, but arbitrary structural edits inside immutable GLBs are not yet projected into their geometry/rendering. Imported closed doors, upper floors, stair-aware routes and persistent source-mesh remodelling remain roadmap work. Gold gates and existing earned-growth rules remain; climb duration and rank frequency require a human playthrough. Protected `codex/tower-visual-polish` files were not edited and its denied QA action was not rerun.

## Reproduce safely

Use this branch's existing launcher on a separate unused port and fresh save path. Never point automated QA at the main save.

```powershell
$env:TV_FOCUSED_WORLD = '1'
$env:TV_REALMS_SAVE = Join-Path (Get-Location) '.debug/realms/focused-review.json'
# Optionally copy an approved portable baseline to that NEW path before starting.
.\Play Torn Veil.cmd -Port 7572 -NoBrowser -View Play
```

First cook assets and build the committed candidate if needed:

```powershell
node scripts/web/cook-focused-assets.mjs
node scripts/web/build-current.mjs
```

WASD moves relative to the rendered camera; hold X to walk, Shift to sprint, MMB to orbit. E interacts; I opens the journal; J/K/L strike, Q faces the selected target, G guards, Space dodges. The Tower entrance has real narrow walls and columns: advance through the doorway before using the wide left aisle. Testing uses ordinary buttons/keys and read-only observations, never injected positions or damage.

Focused regression tests, full-suite results, actual before/after captures and traversal video are recorded separately in the final evidence report. Headless automated control is disclosed; human visual/pacing acceptance remains outstanding. No push, merge, deployment or public upload occurred.

