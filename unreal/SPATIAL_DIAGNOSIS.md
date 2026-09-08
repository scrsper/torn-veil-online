# Ashford renderer spatial diagnosis

Measured from canonical `/scene` seed `918271` before the practical-quality scale correction.
All measurements are metres. Nearest-clearance figures compare canonical structural footprints;
terrain regions such as the square and wilderness are excluded.

| Building | Canonical footprint | v0.4 roof envelope | Nearest canonical structure / clearance | Renderer issue |
| --- | ---: | ---: | --- | --- |
| Ironhand house (`pl_14`) | 8 × 7 | 10.7 × 9.7 | Elder Godwin house / 4.0 | Roof leaves about 1.3 m between envelopes. |
| Elder Godwin house (`pl_15`) | 7 × 7 | 9.7 × 9.7, plus side wing | Ironhand house / 4.0 | Side wing extends beyond the main roof and can consume the remaining gap. |
| Captain Ashford house (`pl_16`) | 7 × 7 | 9.7 × 9.7 | Elder Godwin house / 5.0 | Usable, but visually crowded by the 1.35 m eave on both buildings. |
| Ironhand smithy (`pl_8`) | 10 × 8 | 12.7 × 10.7 | hunter stall / 7.0 | Main envelope is acceptable, but props/chimney make the front visually dense. |
| Old mill (`pl_30`) | 10 × 8 | 12.7 × 10.7 | Hollis farmhouse / 18.0 | Canonical spacing is generous; renderer scale is the only concern. |
| Sawpit (`pl_37`) | 6 × 6 | 8.7 × 8.7 | Fletcher house / 2.8 | Both causes: canonical footprints are close and v0.4 roofs visually overlap. |
| Storage shed (`pl_38`) | 7 × 7 | 9.7 × 9.7 | sawpit / 4.0 | Roofs reduce the clear gap to about 1.3 m. |
| Market stalls (`pl_3`–`pl_6`) | 4 × 4 each | 8.15 × 8.15 canopy | stalls are 7–8 m apart | Canopies nearly touch despite adequate canonical placement. |

The dense residential street (`pl_14`–`pl_16`) has 4–5 m canonical gaps. In v0.4, two
1.35 m opposing eaves reduce those gaps to 1.3–2.3 m, and the 1.3 m engawa can consume one
side of that clearance. The market has 7–8 m canonical stall clearance, but each canopy was
inflated by 4.15 m over its footprint.

## Finding

The problem is **both renderer scale and canonical placement**, with renderer inflation the
primary problem in the village core. Canonical 6–10 m building footprints are large for a small
village, and the sawpit/Fletcher pair is intrinsically tight at 2.8 m. Those facts should be
reviewed by the simulation workstream. The renderer can recover most gameplay readability with
0.7 m eaves, a 0.75 m engawa, thinner structure pieces, in-footprint side wings, and smaller
market canopies; it must not move any canonical footprint.
