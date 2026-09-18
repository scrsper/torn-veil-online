# Slice 3 — Embodied people and visible daily life

Slice 1 made canonical people visible. Slice 2 gave them a more convincing world. Slice 3 is
about the two things still missing: those people do not look like people, and what they are
canonically doing is not legible from watching them.

This slice adds no simulation. It exposes simulation truth that already exists.

---

## 1. The architecture

```
canonical person / body        (src/sim/ — unchanged by this slice)
  → appearance.description      (canonical, persisted, renderer-neutral)
  → appearance profile          (src/bridge/appearanceProfile.ts)
  → Character Foundry resolver  (src/foundry/resolve.ts + local audited catalogue)
  → activity presentation       (src/bridge/activityPresentation.ts — families, postures)
  → physical occupancy          (src/bridge/occupancy.ts — stations, spacing, facing)
      → ATVCharacter            (unchanged authority: controller, capsule, movement, combat)
          → hidden animation driver   GetMesh(), the existing Manny/GASP rig
          → visible presentation      UTVCharacterPresentation
          → activity/retarget map     Content/TornVeil/Presentation/CharacterPalette.json
```

Three rules hold the split together, and every one of them is enforced by a test:

- **No engine asset path reaches canonical simulation.** The bridge may carry machine-local paths
  only inside a disposable `CharacterRealization` produced by the Foundry. Tests assert that the
  canonical `Person` graph remains path-free before and after resolution.
- **Presentation derives; it never decides.** Every activity family carries the canonical fields
  it was read from, and there is deliberately no ambient-animation pool: a person the simulation
  says is doing nothing in particular resolves to `idle`.
- **Presentation never moves anybody.** The occupancy offset is bounded at `MAX_SETTLE_METRES`
  (1.25 m — one cell plus a margin, because canonical planning routes a worker to the anchor cell
  itself), applies only to a body the simulation has already brought to rest, and is applied to
  the visible mesh, never to the actor, the capsule or the camera. The player's own body is never
  offset at all.

## 2. Appearance — one semantic source, one resolver

`appearanceProfile(person, bodyId, catalogue, worldSeed)` consumes the canonical persisted
`Person.appearance.description`. It does not derive hair, head, clothing or status again from
wealth, occupation or identity. `projectAppearanceDescription` adds the current age presentation
and occupation role cues, then the shared Character Foundry maps that description onto the one
machine-local audited catalogue.

The resulting `CharacterRealization` contains concrete body/head/hair/garment/footwear/accessory
packages, compatible skeleton, morphs, material inputs, completeness and explicit problems. The
resolver's per-slot identity streams choose deterministically between equally valid installed
parts; they do not create appearance semantics. An empty or malformed catalogue returns a
diagnosed incomplete realization and leaves canonical state untouched.

The bridge sends the full profile only on the snapshot where its `signature` changes; every other
snapshot carries the short signature alone, and the renderer keeps the character it already built.

## 3. Activity families

`activityPresentation` maps canonical pose + active plan action + goal + velocity + injury into
one of: `travel`, `work`, `eat`, `drink`, `rest`, `socialize`, `trade`, `carry`, `flee`,
`injured`, `combat`, `idle` — plus a narrower `detail` (`forge`, `bake`, `chop`, `sit_and_eat`,
`drink_from_source`, `converse`, …), a `posture`, a locomotion tier, and the `station` kind the
activity needs. `injured` is both a family (for a downed or dead body) and a modifier carried on
every other family: severity and the canonical `movementMultiplier` from
`getPhysicalCapability`, exposed rather than recomputed.

Work detail is read from the canonical action first and the canonical workplace second, so a
smith at a smithy forges and a baker at a bakery bakes without either being scripted.

## 4. Physical occupancy

`Place.anchors` already carries canonical `work`/`seat`/`bed`/`counter`/`stall`/`altar` positions.
`occupancySlots` turns them into physically valid stations by checking the voxel grid: a seat is
occupied *at* its cell facing whatever table or counter it is set against; a work anchor offers
one station *per side a body can actually stand on*, so two smiths take opposite faces of one
anvil and a forge backed into a wall honestly offers the single position it has. An anchor the
world has made unusable yields no slot rather than a slot inside geometry.

`SlotReservations` keeps two characters off one station. It expires on physical time, is never
persisted, and is never read by cognition — a rendering courtesy, not a canonical claim on a
workplace. `conversationStations` builds an F-formation from the canonical positions of the people
the simulation actually has talking. `approachSlot` and `separationOffset` cover doorways, wells,
stalls and crowding.

## 5. What the renderer does with it

`UTVCharacterPresentation` (`TVEmbodiment.h/.cpp`) is a skeletal mesh component alongside the
existing `GetMesh()`. The driver keeps everything Slice 1 and 2 built — the directional blend
space, sprint, start/stop/pivot transitions, crouch, attack/hit/downed replay,
`AlwaysTickPoseAndRefreshBones` — and simply stops being drawn. The visible character either

- **shares the driver pose** via `SetLeaderPoseComponent` when the realization uses the driver skeleton
  under `driverSkeletons` (no second evaluation, no duplicated animation library), or
- **retargets** through an animation blueprint whose Retarget Pose From Mesh node reads the same
  driver via a UE 5.8 IK Retargeter.

Modular parts are leader-posed to the visible body, so a full outfit costs one evaluation.

A skeleton with no usable pose source, an unresolved body, or a package that fails to load falls
back to the driver silhouette and is reported as `visibleCharacter: false`. The palette is not an
appearance resolver; it maps optional activity clips and generated retarget AnimBlueprints only.

## 6. Running it on a machine with a human library

```
# 1. one read-only inventory for Foundry parts, skeletons, retargeters and activity clips
unreal/scripts/audit_character_assets.py        (in the editor)
# 2. optional, for a visible character on a non-driver skeleton
unreal/scripts/build_character_retarget.py      (in the editor; reports its one manual step)
# 3. write the activity/retarget map from that same catalogue
python3 unreal/scripts/build_character_palette.py
# 4. ordinary PIE, then record a take
unreal/scripts/capture_life_slice3.py           (in the editor)
```

The checked-in `CharacterPalette.json` resolves no optional activity clips. Character packages
come only from `.debug/character-foundry/catalogue.json`, which is machine-local and gitignored.

## 7. What is not claimed

See `docs/evidence/embodied-people/README.md`. In short: the TypeScript embodiment layer is
implemented and tested; the native layer and the tooling are written but have not been compiled
or run, and **no PIE evidence exists for this slice**.
