# Codex first hardening pass

## Baseline

This pass started from Fable checkpoint `d92464244029e66ddb36a0d10e7cddd5a5f1172b` on a separate `codex/first-hardening-pass` branch. The checkpoint typechecked, built, and launched, but had no committed automated tests. `README.md` and `AGENTS.md` were not present at the checkpoint.

The prototype already had a promising separation between the authoritative simulation, physical bodies, and Three.js projection. NPC schedules, perception, memory, knowledge, relationships, gossip, combat, trading, persistence, and debug UI were present. The pass preserved that structure.

## Verified bugs and fixes

- **Epistemic leakage:** a hearer could receive a claim with `actorUnknown` while memories, reactions, goals, relationships, and reports still read the objective event actor. Downstream cognition now consumes the mind's claim. Heard-only crime knowledge, memory, gossip, and guard reports preserve an unknown attacker until legitimate identifying evidence arrives.
- **Knowledge upgrades:** `learn()` now refines incomplete claims, accepts stronger confidence/provenance and shorter paths, permits legitimate corrections, clears stale sharing state after a material refinement, and prevents weaker reports from replacing better evidence.
- **Historical identity:** Anna Wold, Lissa Bramble, Tam Reed, and Mira Reed are persistent dead `Person` entities with zero bodies. Historical events, graves, relationships, and item provenance reference their entity IDs rather than substituting living relatives or name strings.
- **Causal graph damage:** event compaction rewires causes around removed detail events and rebuilds surviving effects/indexes. Persistence retains the transitive causal closure of saved events.
- **Canonical randomness:** combat damage and semantic item drops use the world's seeded RNG. `Math.random()` remains only in presentation/audio effects.
- **Player action boundary:** player attacks, pickup, drop, gifts, buys, and sales use `Simulation` APIs shared with canonical systems. Transactions and item movement keep inventory, holder, owner, position, place, provenance, and semantic events aligned.
- **Navigation:** `Navigator.findPath()` now actually uses the nearest walkable replacement when the requested start cell is blocked.
- **Trading:** selling without an existing player coin entity creates a valid payment stack. Buying and selling now update both parties and item provenance through one transaction path.
- **Doors:** doors have authoritative open state, collision/LOS behavior, rendering, player interaction, NPC auto-opening during traversal, events, and persistence. The implementation intentionally has no locks or keys.
- **Persistence compatibility:** the corrected authored-entity topology uses save schema 2. Incompatible checkpoint-era schema-1 saves are no longer offered as resumable, and malformed saves cannot boot a world with no player body. New schema-2 saves and consequences round-trip.
- **Meal loop:** satiated NPCs no longer repeatedly complete a scheduled meal and flood the event log. Very low-significance events such as routine door operation are not selected as gossip.
- **Interaction/playability:** the initial view faces Ashford Vale, nearby dropped items are easier to reacquire, `X` is an accessible attack alternative, urgent NPC goals and speech are visually distinct, speech names its speaker, and the inspector links knowledge evidence.
- **Test aid:** selecting a present person in the F3 inspector and choosing **go to** moves the player to a nearby walkable, line-of-sight position. This is explicitly labeled as an inspector aid and makes dialogue and consequence testing repeatable without expanding the world.

## Tests added

Vitest is configured behind `npm test`. The deterministic suite covers:

- witnessed attack → perception → first-hand knowledge → episodic memory → directional feelings → report movement → telling → second-hand guard provenance → guard response;
- completely unseen crime isolation;
- heard-but-not-seen crime uncertainty, uncertainty-preserving gossip, and later legitimate identity refinement;
- better/worse/conflicting knowledge evidence;
- blocked-start pathfinding;
- event compaction and causal integrity;
- deterministic combat replay;
- historical entities and zero-body identities;
- player/NPC item state, trade payment, ownership, and provenance;
- door collision, traversal state, events, and save restoration;
- save/reload of witnessed consequences and dynamically created items;
- NPC cognition, schedules, movement, bounded memory, directional relationships, dialogue grounding, and meal-loop prevention.

At completion the suite contains 23 tests across 9 files.

## Browser verification

The running Vite client was exercised in the in-app browser. Verified paths included New World, schema-2 Continue, inspector state, event filtering, dialogue backed by actual knowledge, purchase, sale with no pre-existing coin stack, drop/pickup, combat, witnessed/heard reports, knowledge refinement, guard confrontation, manual save, reload, and persistence of the crime and its evidence.

One observed crime produced both kinds of testimony: Petra Crane reported that **someone** attacked Tomas, while Garrick Ironhand later identified the Traveler. Rowan Ashford first learned the uncertain report, then refined it using Garrick's telling event and chose to confront the Traveler. The focused event feed and knowledge inspector showed that chain, and it survived reload.

## Remaining known limitations

- There is no automated browser end-to-end suite. Browser integration was smoke-tested manually; simulation semantics are covered deterministically below the rendering layer.
- A knowledge item currently stores one overall provenance record. Field-level evidence histories would represent mixed-source refinements more fully, but that is a schema change rather than a safe first-pass patch.
- Save schema 1 is intentionally invalidated instead of migrated because generated IDs changed when the missing historical people were added. Stable authored semantic IDs and explicit migrations should precede broader persistence promises.
- Doors remain open after use and have no ownership, locks, keys, or close policy.
- Guard response supports investigation/confrontation but is not yet a complete law, arrest, sentence, or reputation system.
- Perception and several lookups scan all nearby world entities. This is appropriate for Ashford Vale's current population but will need spatial indexing before distant settlements or much larger populations.
- The production dependency audit is clean (`npm audit --omit=dev`). The pinned Vite 5 development toolchain still reports local-dev-server advisories through esbuild; resolving those requires a separately verified Vite major upgrade.
- The production JavaScript bundle remains roughly 688 kB before gzip. It is acceptable for this prototype but should be split when load-time work becomes a measured problem.

## Recommended next milestone

Introduce stable authored IDs plus a versioned migration harness, then deepen the village's consequence loop with deterministic justice/restitution scenarios and a small browser integration suite. That creates a durable base for longer history without widening Ashford Vale or replacing the current simulation architecture.

## Commands

```sh
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Open the local URL printed by Vite. Use **New world** for a new schema-2 save and **Continue** thereafter. F3 opens the canonical simulation inspector; F4 opens the event feed.
