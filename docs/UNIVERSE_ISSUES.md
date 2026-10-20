# Universe defects and next work

This is the working defect register for the Astral Sea. “Fixed” means a code
change exists; the evidence column states what was actually verified. Open
items are not acceptance claims. Updated during the October 19–20, 2026 iteration.

## Current iteration

| ID | Impact and reproduction | Status / change | Verification |
| --- | --- | --- | --- |
| U-001 | **Integration:** the standalone expedition invents an explorer unrelated to the saved town character. Launching both routes does not transfer identity, inventory or Tower history. | Fixed for the new campaign route: a versioned binding inside the existing realm journal, with one controller and an explicit home return. The standalone save remains separate. | Canonical identity, inventory, retained Tower history, NPC continuation, duplicate commands and journal tests pass. Browser round trip exposed U-014; recovery of that saved run now passes. |
| U-002 | **Persistence:** a landing command is saved before the descent finishes; an interrupted process before the next movement checkpoint can lose touchdown and its discovery. | Fixed: checkpoint contact immediately. The canonical endpoint fences publication until the contact tick is durable. | Runtime restart and HTTP pending-outcome/failure regressions pass. |
| U-003 | **Persistence:** replacing a live standalone writer lock does not prevent its original process from continuing to overwrite the save. | Fixed: verify the writer token before operations and each durable write. | Replaced-lock regression passes; stale host cannot overwrite or remove the new lock. |
| U-004 | **Save integrity:** array-valued enum/digest fields can pass coerced checks; landing state outside the landing envelope can be accepted. | Fixed: strict pure persistence validator shared with canonical restore; strict transition digest and inactive-home constraints. | Malformed-save regressions pass. |
| U-005 | **Networking:** a slow GET overlaps later polls; an older failed GET can mark a newer successful session offline. | Fixed: one outstanding poll and stale-error fencing. | Three 1.2-second delayed reads remain serialized. One deliberately aborted old read cannot erase a newer accepted target or mark it offline. |
| U-006 | **Input:** opening Controls blocks walking keys but still allows F/C and pointer steering behind the modal. | Fixed: modal hotkey and pointer guards. | Browser F/C command-count and state checks pass. |
| U-007 | **HUD:** a remote selected world says “landing available” when the ship can land on a different nearby world. | Fixed: match the landing planet to the selected world. | Ordinary browser check passes. |
| U-008 | **Lifecycle:** disposed universe views retain canvas pointer listeners. Re-entering on the same canvas doubles handlers. | Fixed: remove all installed pointer listeners on teardown. | Inspected teardown; repeat-mount coverage pending. |
| U-009 | **Launcher:** a managed standalone host fails to bind its port but remains alive because stdin is resumed. | Fixed: pause managed stdin on every stop path. | Spawned child with occupied port now exits 1 without a forced kill. |
| U-010 | **Terrain:** after 32 tile uploads, the player's ground is still only LOD 2 because distant regions fill the queue first. | Fixed: prioritize complete sibling groups along the nearest branch. | Same upload budget reaches at least LOD 6; coverage and residency tests pass. |
| U-011 | **Terrain:** ground texture brightness jumps by about 32/255 across rotated cube-face boundaries. | Fixed: periodic, rotation/reflection-symmetric texture and integer repeats. | Bilinear pixel sampling matches across all 12 cube edges. |
| U-012 | **Integration:** the town objective timer expects a completion list while active astral residency correctly refuses planar objectives; after about a second it pauses the host. | Fixed: skip that player objective pass during astral residency. Ordinary NPC simulation still advances. | Browser interplanetary travel runs with healthy realm host; headless NPC movement/event checks pass. |
| U-013 | **API:** controller replacement during an awaited save can expose the new owner's token and a later undurable snapshot to the old request. | Fixed: capture the reply before awaiting persistence; recheck ownership and readiness afterward. | Real HTTP ownership races and persistence-failure tests pass. |
| U-014 | **Return softlock:** another resident occupies the original town anchor. A complete planet round trip cannot return after 30 seconds waiting. | Fixed: deterministic reachable, clear arrival within three metres of the original anchor. Retain the requested anchor and record actual arrival; refuse fully blocked paths. | First browser run reproduced after 18 passing checks. Recovery returned the same saved body/items one metre from its anchor, clear of residents. Occupied, fully blocked, through-wall and focused geometry regressions pass. |
| U-015 | **Boarding view:** the unpositioned skiff intersects the initial camera and fills the top of the screen with cyan geometry before the first snapshot. | Fixed: hide the skiff until a snapshot positions it; hide flight controls behind boarding. | Recaptured boarding view is clear; browser verifies hidden flight/chart chrome. |
| U-016 | **HUD:** the campaign name alternates with generic host status because two render cadences overwrite the same label. | Fixed: choose the status string once per frame. | Campaign label remains identical for 120 rendered frames. |

## Atlas and personal-flight iteration — October 20

These rows describe the current working tree. A passing isolated test does not
establish that the complete journey is playable or that every model was viewed.

| ID | Defect or limitation | Change / next action | Evidence |
| --- | --- | --- | --- |
| U-017 | Timestamp and byte-count caching accepted a replaced model with unchanged size. | Fixed: verify content hashes on later host requests and again in the client. | Transport replacement regression passes. |
| U-018 | The existing road helper omitted wet/bridge links from Atlas exclusions. | Fixed: Atlas reservations include every road segment and the entire model footprint. | Placement regressions and bounded coverage script. |
| U-019 | Native scene floors about 0.38 m high blocked a terrain-locked walker. | Fixed: support query and lift/sweep/lower steps up to 0.55 m; retain walls and headroom. | Low-floor, high-step, wall and ceiling tests pass. |
| U-020 | A whole scene or coarse combined mesh can contain an apparent opening closed by its conservative box proxy. | Keep affected architecture out of populated routes until triangle/convex collision and opening validation are cooked. No shrinking whole scenes into props. | Catalog and placement policy report actual exclusions. |
| U-021 | 51 rebuilt models depend on external texture resources. | Excluded from the current self-contained transport. Next: package and hash the complete dependency closure, then recook. | Registry inspection; these have geometry and are not concept-only entries. |
| U-022 | The older observer has roughly 7,500 draw calls including shadows; initial loading causes substantial stalls. | Open. Baseline comparison attributes only the measured small settled-frame difference to Atlas. Reduce the older world's mesh/shadow work and measure a moving journey. | `docs/evidence/atlas/RESULTS.md`; short samples are not an endurance benchmark. |
| U-023 | An existing distant library landmark has a floating roof block. | Open. Inspect the original library placement and source transform separately from Atlas population. | Observer screenshot/reproduction in the Atlas evidence report. |
| U-024 | Treating all flight as a vessel would grant ship speed and move the parked vessel with a magical traveler. | Fixed in the new personal-flight path: actual learned forms/capacity, continuous acceleration, explicit parked vessel. | Capability and personal-flight regressions plus the normal-quality 23-check browser crossing/return pass. Exact checkpoint recovery is tracked under U-043. |
| U-025 | A 30 m/s radial descent estimate prematurely aborted a capable interplanetary flight; a reserve-dependent ceiling shrank during the flight. | Fixed: descent uses available flight speed and braking; physical altitude envelope is stable while reserve forecasts use current resources. | Complete finite-reserve route regression passes. |
| U-026 | Absent canonical travelers skipped physiology and could never recover mana/breath on a remote world. | New canonical scheduling advances metabolism and flight costs once; grounded or vessel rest uses the existing recovery laws. Airborne personal flight does not regenerate mana. | Exact cost, saved continuation, compaction and remote landing tests pass. |
| U-027 | Disconnecting could cancel falling momentum. | Fixed: retain personal-flight velocity when the host pauses. | Canonical journal replay includes disconnect; personal movement and resource continuation remain identical after reload. |
| U-028 | Magical collision and loss of protection currently lack injury, vacuum damage and water-survival consequences. | Open. Unpowered movement has gravity/drag and real collision, but impact speed is evidence only. Add shared damage/rescue/death-residency handling before calling this a survival system. | Explicit implementation boundary; no hazard acceptance claim. |
| U-029 | Some carried stacks have no canonical mass metadata. | Open. Use weighed resources and an authored body-mass estimate; show the incomplete-mass diagnostic. Add source mass to items before full cargo claims. | Capability tests distinguish known load and unweighed stacks. |
| U-030 | The town gateway changes position instead of continuing from the character's town coordinates. | Implemented: versioned reversible settlement charts, live source geometry/doors, mapped entry and one spherical view. Legacy saves retain their previous geography. | Seven canonical handoff tests pass, including the actual focused spawn and returned facing. Browser acceptance recorded separately. |
| U-031 | Core terrain clamps could place a walker or landing body at generated terrain instead of a source floor, including floors below terrain and upper stories. | Fixed: source support enters the integrator; collision uses the preceding safe support height. Final touchdown is accepted once by the canonical host. | Actual host walk, ship and personal-flight cases at source Y 0.6 and 8 pass. |
| U-032 | Provisional personal touchdown could discard its flight record before a source roof/headroom check, or duplicate landing history. | Fixed: retain the flight record until authoritative source validation, then emit one accepted contact. | Host roof-underside and exactly-one-landing regressions pass. |
| U-033 | The spherical hero used the wrong forward convention, facing backwards despite a correct travel heading. | Fixed: adapt the existing hero's local -Z facing and retain a radial upright frame during vertical flight. | Presentation orientation tests pass with float32-appropriate tolerance. Visual acceptance recorded separately. |
| U-034 | Static settlement projection and live door updates used different address representations. | Fixed: normalize coordinate and indexed door projections into the existing renderer key. | Typecheck and live door collision tests pass; exhaustive visible doorway review remains open. |
| U-035 | Spherical exploration has no ordinary town interaction controller or live resident presentation. | Open: bridge existing canonical NPC interaction, combat, door and Tower commands into mapped coordinates. Until then, return to town at actual supported ground to use those systems. | This is an explicit playable-scope limit, not a claim of seamless social simulation. |
| U-036 | Registry metadata is about 5.8 MB before bundling; source model byte budgets do not measure total JS/GPU residency. | Open: measure startup, metadata parsing and actual memory over a long journey; split metadata only while preserving deterministic registry identity. | Current frame/asset counters are bounded samples, not a memory endurance result. |
| U-037 | **Save failure:** close an Aether door after exploring/returning through it and moving away; the inactive expedition's historical point is tested against the newly closed door and the ordinary town save is rejected. The old return anchor has the same risk while away. | Fixed: validate historical coordinates, supporting floor and causal history without treating them as current physical occupants. Keep active traveler and parked-vessel collision checks. | Reproduced on seed 20261017 at door (3001,1,2988). Five regressions pass, including active obstruction/vessel refusals, historical height rejection, reload and reentry at the current body. |
| U-038 | **Rendering:** town ground reused the forest material without its vertex coverage stream, causing `color` shader compilation errors and repeated fallbacks. | Fixed: adds the same coverage buffer and alpha policy as the ordinary town renderer. | First run's failure retained. Fresh normal-quality 23-check journey has no shader, runtime or asset errors. |
| U-039 | **HUD:** after personal flight to another world, ground text says to approach the vessel within 60 m even though that world has no vessel. | Fixed: distinguishes personal departure and remote parked-vessel location. | Fresh foreign-ground capture and reload show the vessel parked on the home planet and the available personal-flight action. |
| U-040 | **Resource leak:** forest GLB load succeeds, then route metadata fetch/hash fails; instantiated scene entries have no returned owner/disposer. | Fixed: releases entries/root and shadow registration on setup rejection or late cancellation; successful disposal remains idempotent. | Three real Babylon hierarchy tests pass for metadata failure, disposal while awaiting metadata and successful shared-source ownership. |
| U-041 | **Animation:** the selected hero's arms appear symmetrically raised on ground and in flight. | Open. Cycling frames prove an active animation, but not the source implied by its alias. Followup audit found missing private clip URLs returning HTML and a KayKit fallback labeled `idle_neutral`; Wren also reuses Ranger's baked rotations despite differing rest joints. Correct fallback provenance and bake against the actual rig before judging a replacement pose. | Browser records changing frames/joints. Read-only asset audit measured differing pelvis/spine/leg rest rotations; this corrects the earlier inference that the named authored idle was verified. |
| U-042 | **Controls:** opening help or braking on the ground sends `cruise:false`, which the host rejects with a misleading “launch before cruise” toast. | Fixed: cancel cruise only when cruise is active; always release held movement separately. | First journey's single HTTP 409 traced to this path. Fresh browser acceptance checks opening help and rejects any HTTP errors. |
| U-043 | **Restart failure:** the normal-quality journey returns onto focused paving at Y 1.0625, but inactive-history validation searches for support within only 0.015 m. The ground query starts from lower mortar and misses the adjacent 6.25 cm paving support, rejecting the completed save. | Fixed: uses the same 0.55 m support search as walking while still requiring the resolved height to match saved feet within 0.015 m. | Exact failed checkpoint sequence 7267 is preserved. Actual paving regression passes; the unmodified checkpoint loads and roundtrips with the same body, full inventory, discoveries and parked vessel. Ordinary host restart succeeds; rendered-town/reentry followup is recorded separately. |
| U-044 | **Geometry migration:** after mapped travel in ordinary town geometry, adopting focused town geometry succeeds but invalidates retained body history and the actual parked vessel. | Fixed: refuse this unsupported migration before any mutation. Already-focused no-ops and legacy gateway adoption remain supported. A future migration must map both history and vessel to validated replacement geometry. | No-mutation regression and both compatibility controls pass. Final delta verification: 25 settlement/migration/journal tests and TypeScript pass. |

The exact failed checkpoint was restored through the ordinary host after U-043.
The corrected recovery reader then verified rendered town readiness, unchanged
identity and full inventory, current preview-to-entry continuity, and another
rendered town return without browser or HTTP errors. Clean shutdown produced
checkpoint 9398, which also loads successfully. The first recovery helper read
the retained old landing snapshot instead of the current inactive preview;
that measurement failure and its correction remain in the evidence directory.

The population coverage sample used 819 distinct models in 16,614 placements
across 660 surface queries and 100 Tower floors. The separate browser sample
loaded 42 distinct models and saw 13 distinct IDs in the camera frustum. Neither
number is an assertion that all 1,249 static-compatible models were rendered or
that generated decoration creates living NPCs, loot or economy.

The preceding October 19 checkpoint completed canonical identity/body and carried-item continuity,
resident NPC/clock continuation, durable journal replay without a final checkpoint,
append-failure recovery, controller races, contact persistence and the occupied
return-anchor recovery. See [campaign results](evidence/universe/CAMPAIGN_RESULTS.md)
for those two browser runs and their distinct limits.

## Next work and acceptance gates

1. **Finish the ordinary interaction bridge.** The mapped towns now share source
   geometry, but NPC interaction, combat, doors and Tower entry still use the town
   controller. Reuse those authoritative operations through reversible chart
   coordinates. Verify the same people, items, events, door state and Tower
   history through walking, flight, reload and return. Do not create a second
   simulation for the spherical view.
2. **Survival across domains.** Metabolism, breath, mana and existing downed
   recovery now advance on the canonical clock. Wounds, collision injury, vacuum,
   water and loss of protection still need shared damage and rescue/death rules.
   Verify causal health effects and saved continuation with no duplicate planar
   participation, safe impact thresholds or resource-free protection.
3. **Lifecycle and endurance.** Repeat-mount handler coverage for U-008 remains
   pending. Add repeated view changes and a long flight/reload/warp session with
   delayed/lost transport and measured memory, moving-frame uploads and p95 frame
   time on the intended device. A short settled-frame sample is insufficient.
4. **World content.** Surface NPCs, resources, ecology and interactions need
   canonical simulation and persistent causal outcomes before presentation.
   Visiting a planet currently grants no inventory, progression or economic reward.
5. **Flight depth.** Complete missing item masses, route/rescue policy, fuel/cargo,
   vessel ownership and acquisition, combat, atmospheric hazards, orbital physics
   and cross-star continuous travel. The current skiff is an explicit traversal
   fixture; personal flight does not grant vessel warp or move its parked location.
6. **Generation breadth.** Height fields cannot provide overhangs or caves.
   Static planet centers and metadata gravity are deliberate current limits.
   Add volumetric terrain only with shared collision, deterministic streaming,
   persistence and bounded memory acceptance.
7. **Visible world variety.** Validate more than the safe arrival clearings:
   different biomes, authored landmark approaches and native-size architecture.
   The volcanic arrival view is sparse and the hero reuses an upright idle.
   Improve composition and approved locomotion presentation while retaining
   route clearance, actual source-model proof and bounded streaming. Frustum
   membership alone is not proof that a model is visually legible.

## Prior fixed defects

The first checkpoint (`4327ead`) fixed stale Babylon Vector3 coordinate copies
that prevented LOD refinement on return, an instant landing snap, insufficient
near-ground visual detail, acceptance of underground saves and continued
simulation after failed persistence. Evidence is in
[the initial results](evidence/universe/RESULTS.md).

## Save upgrade boundary

The realm journal hashes the complete executable source tree and runtime. A
source update with an outstanding old-code journal tail must fail closed.
Checkpoint or export with the exact previous source/runtime before upgrading.
Never edit fingerprints to force replay. Test development changes against an
isolated save and retain the user's original import and journal files.
