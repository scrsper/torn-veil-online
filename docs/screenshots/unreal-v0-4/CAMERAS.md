# Unreal v0.4 comparison cameras

The v0.4 comparison set uses four fixed presentation views.  They are renderer-only inspection
cameras and do not participate in canonical state.  The projector creates matching camera actors
from the canonical village-square bounds so the views remain reproducible when the level is
regenerated from the same scene seed.

| File | Camera | Purpose |
| --- | --- | --- |
| `village-overview.png` | `TV_Camera_Overview` | whole-settlement silhouette and material read |
| `street-ground.png` | `TV_Camera_Street` | eye-level eaves, facades, doors, and props |
| `market.png` | `TV_Camera_Market` | stalls and civic centre |
| `village-edge.png` | `TV_Camera_Edge` | terrain, fields, vegetation, and water edge |

The `before` images preserve the corresponding v0.3 captures that existed before the v0.4
projector/material pass.  Later captures must retain these filenames and camera identities.
