# Character metres and camera review — October 12, 2026

The current imported Wren remains the character. This correction calibrates its import and third-person framing; it does not replace the model or alter its proportions. The earlier 2.10 m asset-planning value was provisional. A 9.5-head proportion does not establish a metre height, and this change does not claim to realize that anatomical target.

## Measured dimensions

| Measurement | Metres / observed pixels |
|---|---:|
| Wren source bind mesh, boots to hair crown | 1.5324 m |
| Saved stature multiplier | 0.96, unchanged |
| Standing reference after import calibration | 1.75 × 0.96 = 1.68 m |
| Old posed mesh / default screen height | 1.486 m / 189 px |
| Corrected posed mesh / default screen height | 1.697 m / 348 px |
| Canonical standing capsule | 1.75 m tall, 0.30 m radius, unchanged |
| Bridgeport door clearance / finished ceiling | 2.405 m / 2.85 m |
| House source outer bounds, including porch | 19.257 × 16.433 m |
| Source roof ridge above its ground reference | 5.63 m |
| Bed frame | 2.40 × 1.30 × 0.54 m |
| Basin / sink height | 0.86 m |
| Cellar stair rise / repeated tread | about 0.179 / 0.183 m |
| Audited pine group heights | 6.575–8.954 m |
| Audited oak group heights | 7.445–8.237 m |

The house retains its approved horizontal enlargement of 1.44 and literal room topology. It is intentionally generous relative to this shorter player. The stair measurements describe delivered geometry; they do not certify a new basement traversal feature. Mature tree sizes are authored metre dimensions, not an import-unit error, and were retained.

## Implementation

The canonical human adapter measures the existing kit after its authored node transforms, then applies the standing reference and saved stature once. Source vertices, joints, clips and hierarchy remain intact. The standing player now fits within the existing controller clearance; collision and navigation continue to use the same canonical triangle geometry and capsule. Catalog held items cancel the actor-parent scale so their metre dimensions remain literal; armour fitting still follows the rig.

The default world view is 4 m / 22 degrees / 52-degree vertical FOV, with free orbit and the existing 3–18 m zoom range. The Tower default is 4.8 m / 24 degrees. Named legacy framing adapts to the closer defaults, while arbitrary saved zoom choices remain. The pivot follows the measured standing reference and canonical crouch posture. Tight architecture uses cached imported bounds and the existing camera clearance/cutaway mechanism. Close raised views adapt their lens; intentional wide zoom remains wide. Tree obstruction continues through the original source-geometry cast.

Architectural cutaways require mesh clones sharing existing geometry, local-space intersection rays and automatic alpha mode. Babylon's explicit glTF OPAQUE mode otherwise ignores per-mesh opacity. Other parts retain instancing, and the source asset files remain unchanged. Snapshot refresh also preserves unchanged Tower action buttons so a real equipment click can complete.

## Verification and adoption

The latest applicable checks passed **69 / 69 tests across 16 files**, with production typecheck/build. The original foundation's 2,303-test aggregate remains supporting evidence for unchanged canonical simulation; it is not presented as a new run for this correction.

The minimal retained-floor contact diagnostic passed: ordinary geometry-routed input produced a real `dagger_high` hit on b_8 at 0.187 m planar separation, zero vertical separation and the unchanged 2.1 m reach. Opposing hit sequence increased and reload preserved it. Earlier full-journey failures recorded a column-blocked approach and absence of opponents in the initial bounded entrance snapshot; neither was repaired by damage injection or wider hit rules.

Final **after-v5** rendered review and **V24** uninterrupted journey passed at **5d2fd5f550ac55f155e9853d2e303724ba47dfbb**, with zero browser errors. Camera clearance passed at every captured stop; the actual room images show the player and furniture through the cutaway. Matched doorway, bedroom and forest stops differ by 0.016, 0.170 and 0.120 m respectively, with matched requested yaw and the deliberately closer pitch. Observed character heights are 348 px outdoors, 299 px in the living room, 272 px in the bedroom and 442 px at the forest stop.

V24 includes portal cancellation/round trips, Tower entry/return/reentry, actual finite gear, an opposing-body hit and reload. Its recorded post-combat player health is **1.1606970268591814**, preserved exactly across reload, alongside identity, Normal rank, four carried items, run and floor. This is the isolated combat test, **not the canonical main save**. The short motion capture also passed ordinary walking, running, free orbit and zoom with unchanged identity, rank, 80 health and original inventory. It preserves actual Chrome capture timestamps; no benchmark or synthetic timing claim is made.

Main remains unchanged pending the final local adoption step. The canonical sequence-139 save, complete committed journal prefix, original import and compiled main build are preserved privately. A new-engine checkpoint is staged from that verified export and asserts exact world and continuation preservation, excluding only the wall-clock `savedAt` file timestamp. It preserves p_5 / b_5, Normal rank, 80 health and inventory i_1 / i_2. The canonical engine fingerprint covers presentation source too, so the checkpoint is a verified compatibility upgrade, not a replay-fingerprint edit or a transfer of the test player's injuries/loot.

Review rulers and metre labels exist only in captured evidence. They are not permanent HUD. All captures use ordinary controls and read-only observations; no positions, damage, progression or scene state are injected. Broader art quality, clothing/equipment polish, anatomical proportion work and megacity performance remain separate roadmap work.
