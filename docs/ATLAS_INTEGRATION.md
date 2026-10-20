# Atlas population of the existing world

This integration uses the installed `TornVeilAtlas` models as deterministic
world content. Existing Cinderveil terrain, towns, roads, Tower floor layouts and
canonical identity/inventory rules remain the foundation.

## Source and transport

The default source is `%USERPROFILE%\TornVeilAtlas`; `TV_ATLAS_ROOT` can select
another installation with the same `public/` layout. Source models stay there.
No model binaries, licensed animation files or copied Atlas sources are placed
in this Git repository.

The game serves compatible registered models at
`/atlas/models/<decoded-sha256>.glb`. Both the host and browser verify model
content. Compressed Atlas files remain compressed on disk and in transport.
The route accepts local read-only requests, resolves paths from the registry
instead of URL filenames, and refuses changed payloads or root escapes.
`/atlas/status` reports local source availability and verified/served counts.

Catalog membership, static compatibility, placement eligibility, selection in
sampled worlds and actual browser rendering are distinct coverage measures.
The results report must state each rather than equating a catalog with a game.

## Integration rules

- Generated placements have deterministic identities and native model scale.
  Visual loading cannot choose their location, create canonical people, grant
  items or alter the world's history.
- Complete authored scenes are distinguished from modules and props. A scene
  is not reduced to a tabletop prop. Draft creatures do not become living NPCs.
- Terrain and existing paths/entrances are constraints on placement, including
  space for the full model footprint, not just its origin.
- Collision/navigation uses cooked simulation data independent of the loaded
  meshes. The proxy limitations must be explicit; successful rendering alone
  cannot certify a usable interior or doorway.
- Tower dressing fits existing solid support footprints. It cannot change the
  floor plan, enemy/award rules, start/exit positions or recorded Tower progress.
- Runtime budgets limit concurrent loads and resident resources. They do not
  restrict the source library to a fixed shortlist of twelve designs.
- Old travel states retain their generation revision. New collision is never
  silently inserted into an already saved travel state.

## Coordination and save boundary

Implementation began from local `af39ab1` on
`codex/universe-traversal-oct19`. On October 20, remote `main` was independently
observed at `8a9fa5860a9a404f67bc64028f1a805632fb4514`, matching the coordinator's
merged PR #71/#70 report. This asset iteration does not incorporate that main
revision or modify the merge task's checkout, creator staging or source Atlas.

Checkpoint a pending journal with its matching old source/runtime before
upgrading. Existing engine-fingerprint checks remain in force. Use an isolated
save for acceptance; no live user campaign migration is part of this work.

## Acceptance record

The reproducible cook contains 3,007 source records, 1,850 unique GLB payloads
and 1,249 static-compatible entries. The bounded population survey selected
819 distinct models in 16,614 placements across 660 surface queries and 100
Tower floors. The independent observer browser sample loaded 42 distinct models
and placed 13 distinct IDs in the camera frustum. See
[the Atlas report](evidence/atlas/RESULTS.md) for screenshots, budgets, exclusions
and the older observer's substantial existing draw-call cost.

The canonical personal-flight journey has separate evidence under
`docs/evidence/atlas-flight`. The first complete trip passed 16 functional
checks but failed visual acceptance on a missing ground-material coverage
stream. Its report remains preserved alongside the repaired run. Counts from
the population survey must never be substituted for actual browser sightings.
Neither decoration nor visual mobs imply living NPCs, loot or economy.

Reproduce capability QA by explicitly setting `TV_FLIGHT_ISOLATED=1` and running
`node --import tsx scripts/world/create-flight-fixture.ts`. This creates a new
timestamped save with learned sources and an equipped strong focus solely for
acceptance. Launch that exact printed path with `TV_REALMS_SAVE` and a free
`TV_REALMS_PORT`. The bounded `scripts/world/personal-flight-journey.mjs` additionally
requires `TV_FLIGHT_URL` and `TV_FLIGHT_EXPECT_SAVE`, and refuses a host whose
reported save differs. These tools do not modify an existing player campaign.
