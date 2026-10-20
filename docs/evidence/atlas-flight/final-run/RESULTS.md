# Canonical personal flight acceptance

2026-10-20, normal-quality presentation, headed Chrome 1440×900, isolated canonical host on port 7533. The parent-created fixture was `.debug/atlas-flight-qa-2026-10-20T17-47-20-131Z/world.json`; the harness checked that exact save path before opening the page. It used the ordinary UI only. The character had fixture-authored interplanetary gravity capability and 320 mana; this is not a progression-earned ability claim.

**Passed: 23 checks, zero HTTP errors or rejections, zero browser/runtime/asset errors.** The earlier failed run is retained in [`../first-run`](../first-run/RESULTS.md).

**Restart failure recovered:** after this browser completed, the parent gracefully stopped the host and checkpoint restore initially rejected the saved world. After the U043 validation repair, the exact unchanged failed checkpoint restored through the normal host. The [bounded recovery follow-up](../recovery-corrected/RESULTS.md) then passed 11 checks: actual town rendering, original identity/items, ordinary reentry with zero position delta, and a second fully rendered town return. The original browser evidence and failed recovery measurement are retained.

The journey:

1. Rendered the actual mapped town and approved shared character before entry.
2. Entered on foot at the preview position with the same canonical person/body.
3. Opened help without a rejected ground command; G/F/C remained suppressed.
4. Walked, then pressed G to lift the same body from that place. The vessel remained parked and personal warp was disabled.
5. Flew continuously to Vesperspire 3 using assisted personal flight; powered flight spent canonical mana.
6. Landed, preserved identity and complete inventory, recorded the same explorer's discovery, and correctly showed that the vessel was parked on Cinderveil.
7. Reloaded on the foreign surface with identity, inventory, discovery and parked vessel intact.
8. Flew back, landed with access to the original vessel, preserved identity and inventory, obtained `canReturn:true`, and used the ordinary return action to navigate to `?realms`.

The last assertion proves accepted return and navigation. The harness closes at that URL; it does not separately validate the town renderer after navigation or a later host restart. No movement injection, client ability grant, debug teleport, or user-save edit was used.

## Visual and rendering evidence

The eight numbered screenshots and [`journey.json`](journey.json) contain the captures, sampled world state, identity/inventory, vessel position, loaded asset IDs, placement coordinates, terrain residency and animation samples.

| Capture | Frame p50 / p95 | Draw calls per sampled frame |
| --- | --- | --- |
| Town preview | 13.9 / 34.8 ms | 740 |
| Town on foot | 13.9 / 20.8 ms | 676 |
| Personal ascent | 6.9 / 7.1 ms | 19 |
| Between worlds | 6.9 / 7.2 ms | 12 |
| Other-world approach | 6.9 / 7.1 ms | 80 |
| Other-world ground | 6.9 / 7.0 ms | 88 |
| Reloaded other-world ground | 6.9 / 7.0 ms | 88 |
| Returned home | 13.9 / 20.8 ms | 577 |

Each sample contains 120 animation frames. This is one run on one machine, with no build/test contention, not a general benchmark. The town projected 12 actual settlement chunks and 56 focused placements. Those unloaded during interplanetary travel and returned on approach.

Across the samples, the Atlas renderer loaded and instantiated **18 distinct model IDs** and reported **19 distinct placement IDs**. Three model IDs entered the camera frustum: `atlas:local:file-3a113d30def4f0b5-200`, `atlas:local:item-TV-078`, and `atlas:local:item-TV-179`. Frustum inclusion does not establish unoccluded pixel visibility. The home models were resident near the settlement perimeter, outside this camera view; this route is not a close-up art review of all loaded assets.

Peak concurrent requests were **2**. The largest sampled cache held **3,414,480 decoded GLB bytes** and **54,746 triangles**, below configured normal-quality budgets of 64 MiB and 1.2 million cache triangles. These are registry costs, not measured GPU/JavaScript allocations. No Atlas load failures or budget rejections were reported. In open space, resident instances dropped to zero while the bounded reusable model cache remained.

## Repairs verified and limitations

- The missing forest-floor coverage attribute is repaired. The projected source terrain supplies the same `[1,1,1,.7]` vertex colors as the planar renderer and uses alpha as coverage, not transparency. The complete route produced no shader errors.
- Ground help/brake no longer submits an invalid inactive cruise cancellation. No 409 response occurred.
- Foreign-ground text names the planet where the vessel remains; it no longer asks the player to approach a nonexistent local vessel.
- U041: the clip **labelled** `unarmed/idle_neutral` advances and changes sampled joints. For example, the preview records clip frames `36.5, 47.3, 9.2, 26.9, 49.2, 63.3, 13.5, 27.1`, with changing upper-arm quaternions. This proves animation activity, not source provenance. A later asset audit found the motion-pack URLs returned HTML and the animation loader silently used a fallback under the requested alias. The earlier inference that this verified the named authored clip was incorrect. Correct source delivery/provenance and the stiff flight silhouette remain part of the next quality cycle.
- Ground detail and flight pose remain modest. This acceptance covers one generated system, two surfaces, one strong capability fixture and one route. It does not certify every catalog asset, all planetary seeds, progression balance, low-capacity characters, or every settlement/door configuration.

Reusable harness: [`scripts/world/personal-flight-journey.mjs`](../../../../scripts/world/personal-flight-journey.mjs). It requires explicit `TV_FLIGHT_ISOLATED=1`, `TV_FLIGHT_URL`, and `TV_FLIGHT_EXPECT_SAVE`; `TV_FLIGHT_OUTPUT` selects an evidence directory, otherwise a unique timestamped directory is used.
