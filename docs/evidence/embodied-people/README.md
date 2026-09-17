# Slice 3 evidence — and the honest gap in it

## The gap, first

**No PIE evidence exists for this slice. No screenshot, no video, no editor run.**

This work was produced in a Linux cloud container with no Unreal Engine installation, no Windows
host, no GPU editor session and — importantly — none of the local Fab/marketplace human character
library the slice depends on. The repository's own Unreal content carries environment packs, the
Motifect motion packs and two Epic mannequins (`SKM_Manny_Simple`, `SKM_Quinn_Simple`); it carries
no human character meshes, no modular clothing and no hair, because those are licensed assets that
live only on the development machine and are correctly excluded from git
(`.gitignore`: `unreal/TornVeilOnline/Content/Characters/`).

So the visual question the work order asks — *is the difference between "white mannequins inhabit a
simulated village" and "recognisable individual people appear to live in Torn Veil" obvious?* —
**cannot be answered from this branch**. It has to be answered by running it on the machine that
has the library. Nothing below should be read as answering it.

Asset previews are not evidence, and none are offered.

## What is actually verified

Run in this container, on this branch:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | passes |
| `npx vitest run tests/embodied-people.test.ts` | 21/21 pass |
| `npx vitest run tests/bridge.test.ts tests/bridgeVisualState.test.ts tests/bridgeLife.test.ts tests/bridge-humanoid-presence.test.ts tests/bridge-streaming.test.ts tests/playable-world.test.ts` | 40/40 pass |

Those 21 tests cover the claims this branch is entitled to make: appearance survives a real
`serialize`/`deserialize` round trip with the same person id, body id and signature; a 127-resident
cast resolves to many distinct appearances rather than two; authored and modular paths both work
and neither loses canonical ids; no engine asset path appears anywhere in the projected snapshot;
activity families are derived from canonical pose/action/goal and an idle person stays idle;
canonical injury severity and movement multiplier are exposed rather than restated; occupancy
stations are physically valid, exclusive, refused when the simulation has not actually brought the
body to the workplace, and refused entirely when the geometry does not admit a body; and two full
snapshots leave every canonical body position, pose, yaw and the physical clock untouched.

## What is written but unverified

- `unreal/.../TVEmbodiment.h`, `TVEmbodiment.cpp`, `TVEmbodimentTests.cpp` — **not compiled.**
- The `ATVCharacter` changes (visible presentation component, embodiment parsing, bounded
  occupancy offset, extended diagnostics) — **not compiled.**
- `unreal/scripts/audit_human_assets.py`, `build_character_palette.py`,
  `build_character_retarget.py`, `capture_life_slice3.py` — syntax-checked only; **never executed
  against a real asset registry or a real PIE session.** `build_character_retarget.py` in
  particular reports `INCOMPLETE` by design, because Python cannot author the Retarget Pose From
  Mesh node and pretending otherwise would be a false claim.

Expect the first editor build to need fixes. UE API details (component registration order,
`SetLeaderPoseComponent` timing against `RegisterComponent`, the exact `IKRigController` /
`IKRetargeterController` method names in 5.8) are the likely failure points.

## What the next session on the development machine has to do

1. Sync this branch into the foundational Desktop worktree **without disturbing local asset
   state** — no `git clean`, no `reset --hard`, no touching `Content/Characters/` or the local
   palette content.
2. Build `TornVeilOnlineEditor`; fix whatever the native layer gets wrong.
3. Run `audit_human_assets.py`, choose a coherent Torn Veil human palette from what it finds, and
   generate `CharacterPalette.json`. Retarget anything not on the driver skeleton.
4. Confirm first, on the existing Fenwick save, the initial acceptance the work order specifies:
   the player at the same canonical `p_128`/`b_141` binding as a real visible human through idle,
   walk, run, sprint, strafe, backward, turning, dodge, a combat action, a dialogue transition and
   save/reload; then one existing canonical resident, same person id and body id, as a real human
   through idle, walking, dialogue and persistence.
5. Only then extend to several residents and record the life loops (blacksmith, tavern, food, rest,
   social) with `capture_life_slice3.py` plus a normal-frame-rate external recording.

`capture_life_slice3.py` writes a per-take summary naming which of the nine acceptance items that
take actually evidenced and which it did not, and marks a take that drew only the driver mannequin
`FAILED_NO_VISIBLE_CHARACTERS`. Use it; do not file a partial take as proof of the whole list.

## Slice 2 regression status

Untested here, and untestable here. Nothing in this branch touches terrain, woodland, roads,
buildings, interiors, props or lighting — the diff is the three new bridge modules, their wiring
into `session.ts`, the new native embodiment files, additive `ATVCharacter` members, four scripts
and documentation. The 40 existing bridge/playable-world tests that do run still pass. Visual
non-regression still needs a human look on the machine that can render it.
