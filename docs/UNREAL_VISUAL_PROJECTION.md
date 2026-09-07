# Canonical visual projection (v0.3)

The Unreal client projects a loaded simulation region; it is not an alternate world generator.

```text
canonical World / BridgeSession.scene()
        -> place + terrain + openings + fences + resource facts
        -> Unreal culture visual profile
        -> deterministic family/variant/material/prop selection
        -> Unreal actors and camera-query collision
```

The contract deliberately separates these questions:

- Simulation: a place, road surface, terrain column, door, fence, resource, and manifestation
  exist at these coordinates in this state.
- Renderer: this canonical fact uses these roof forms, materials, accessories, lights, proxy
  meshes, and deterministic variation.

`scene()` now includes compact canonical terrain columns plus door and fence records in addition
to place footprints and resource nodes. The current loaded-region script can render the full
Ashford sample from that data. Future streamed regions can emit the same contract independently;
there is no singleton `AshfordMap` in the projector.

`unreal/scripts/visual_profiles.py` is deliberately small: `CultureVisualProfile`, material
palette, building families, occupation cues, and stable seed/id variation. Ashford is one
profile (`ashford_japanese_medieval_fantasy`). A different biome/culture/world adds a profile
and family definitions while retaining the same canonical traversal.

Visual structural actors are camera-query blockers while pawn movement remains canonical:
TypeScript checks the grid and Unreal reconciles to the result. This prevents visual collision
from becoming authority while making walls, roofs, doors/openings, fences, terrain and resources
visible and keeping the third-person camera outside their surfaces.

Native NPC appearance consumes canonical age/body appearance/occupation data. The renderer owns
the chosen material treatment, hair/garment proxy and occupation cue. Its profile data lives in
`Content/TornVeil/Presentation/AshfordAppearanceProfiles.json`; named overrides are optional and
remain empty until an approved reference actually matches a canonical individual.
