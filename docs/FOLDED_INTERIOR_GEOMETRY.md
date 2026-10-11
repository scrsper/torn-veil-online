# Folded interior geometry checkpoint

The room/corridor grammar used by the existing Tower now lives under
`src/sim/world/interiors`, and the existing Tower imports/re-exports that same function.
It produces deterministic connected rooms, corridor loops,
guarded side spaces and reserved entrance/exit areas. It uses no renderer objects,
browser state, external assets or language-model calls.

`planInterior` turns that grammar into stable room/source IDs and explicit physical
solids. The renderer can decorate those solids, but openings and collision must remain
derived from the same plan. Floor numbers 1-100 select existing size bands; generating
their geometry does not generate or validate 100 canonical encounters or progression.

## Address and persistence contract

`veil:folded-interiors:v1` explicitly reserves the previously solid interval between
the two realm domains: X 6144-8191, Z 0-6143. It has 768 cells of 128 metres. Each
registered instance occupies one cell; the largest current floor fits with a margin.
This is a bounded interior namespace, not a third continent or an infinite-world claim.

`FoldedRealmGrid` retains the existing W/H/D and flattened cell indices. Old realm
doors and voxel diffs therefore retain their addresses. Unknown instances remain
solid. A registry rejects duplicate IDs/slots and malformed generator descriptors;
registration also rejects a slot containing pre-existing edits rather than silently
reinterpreting them as a new floor. Equivalent descriptor property order is irrelevant.

The owning host must allocate and persist the stable `(building ID, floor ID, slot)`
binding before admitting a body. Allocation must not depend on renderer load order.
The current registry API deliberately does not invent that host transaction. Changes
to version-1 geography require a new generator version with an explicit migration.

Only 12 derived plans are cached. Eviction discards layouts, while ordinary voxel
diffs retain edits. A fresh grid restored from the same registry and diffs reproduces
them. Navigation must be invalidated when the host registers new physical space.
This proves bounded geometry caching, not bounded cognition for a populated Tower.

## Verification and remaining integration

Focused tests verify address separation, descriptor determinism, preserved legacy
Tower descriptors, actual Navigator paths, swept body collision, bounded caches,
edit restoration and rejected ambiguous allocation. Legacy compatibility hashes
cover all 101 existing floor descriptors, including the proving hall, for seeds 317
and 918271; they were captured before extracting the original grammar.

This checkpoint does **not** attach the registry to `World` saves, open a new ascent
route, move a player's body into it, create canonical rewards, or replace the existing
Tower checkpoint adapter. The next coherent integration must do those together:

1. Persist versioned instance and run bindings in World, retaining old saves and the
   scoped prototype. Use one BridgeSession/physical clock and controller lease.
2. Register finite source-backed items and encounters through ordinary entities,
   actions, perception and goal execution. Resolve rewards and return from durable
   causal events, with exactly-once writes and interruption recovery.
3. Schedule distant activity explicitly. Do not mark living entities absent just to
   reduce CPU or run every floor's NPC cognition on every street tick.
4. Project canonical geometry, bodies and equipment in Babylon; verify an actual
   enter/fight/loot/reload/return journey before promoting this route to the default.

The existing playable city/Tower adapter remains the launch path. Shared arcana and
motion/contact work is described in `SHARED_SIMULATION_EXPANSION.md`.
