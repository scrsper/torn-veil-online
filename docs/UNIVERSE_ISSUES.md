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
| U-041 | **Animation:** the selected hero's arms appear symmetrically raised on ground and in flight. | Ground source/retargeting fixed: verified CC0 Quaternius idle/walk/jog/sprint, actual-rig bakes and truthful fallback provenance. Ground arms now relax. Flight uses a bounded pose overlay; its recentered silhouette and fine deformation still need improvement. | Actual-rig and staging regressions pass. Verified ground/front/side captures show attached limbs and relaxed idle. Actual 852 m/s side capture shows trailing legs; small dark airborne captures do not establish fingers, face or fine deformation quality. |
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

## Camera, character and lighting pass — verified journey, remaining limits

| ID | Observed problem | Current action / acceptance |
| --- | --- | --- |
| U-045 | Pointer look submits authoritative yaw/pitch at 10 Hz, changes the traveler heading and cancels assisted flight. Pointer-up also discards an unsent short drag. There is no preferred wheel zoom. | Fixed: local render-rate orbit, recenter and persistent zoom preference. Pure tests and ordinary browser checks verify full drag, zoom and unchanged canonical heading/navigation during active assisted flight. Ground movement remains body-relative. |
| U-046 | Takeoff switches camera offsets instantly; vertical facing falls back to geographic north, and changing nearest planets can abruptly change the horizon. | Fixed for the measured route: stable transported tangent, eased framing and 90°/s automatic horizon transport. Actual ascent, nearest-world crossing and landing pass. Coarse sampled transition fell from 59.54° to 8.77°; measured clock quantization and acceptance tolerance are disclosed in the verified report. |
| U-047 | Universe character/settlement shadow callbacks are no-ops; the PBR character has no environment irradiance and the surface sky is a flat clear color with visible daytime stars. | Implemented and browser checked: existing HDR, atmospheric gradient/star fade and owned bounded shadows. Verified maximum sample 112 casters / 51,713 triangles; no shader/browser errors. Ground p50/p95 20.8/27.9 ms, 849 draws on this run. This adds workload; space readability and endurance remain open. |
| U-048 | Spherical character previously disabled planar contact correction without a radial replacement. Authored gait had no radial terrain foot locking. | Radial implementation added: absolute anchors, measured skinned sole hulls, bounded real host floor patches and independent leg correction. The live ground route reached paving, step and slope, with independently checked sole samples; flat/step contacts have stable windows. **The left foot had no eligible slope-idle frame; the right remained eligible for 20.19 seconds**, so complete slope planting remains open (U-065). See `evidence/presentation-quality/contact-pass/`. |
| U-049 | **Flight pose:** the first quality run reports braking at 847 m/s during steady assisted passage. Horizontal speed falls as the local radial frame rotates, falsely satisfying the deceleration detector. | Fixed detector uses total speed; equal-speed rotating-frame and actual deceleration regressions pass. Verified 852 m/s capture has ascent rather than persistent false brake. No browser interval met the strict ≥400 ms / four-update / ≤0.05 m/s stability criteria; that specific live steady-speed assertion remains unexercised. |
| U-050 | **HUD/framing:** the current-world label covers the character's chest on the ground; minimum zoom and wrapped action controls obscure a boot. “Landing available” is also shown 11.9 km above a world. | Fixed and captured: no current-world marker over the ground hero, both boots clear the HUD at close zoom, target text above the silhouette and accurate “descent available” wording. |
| U-051 | **Camera evidence:** the first quality harness aborts at a greater-than-45° change over an approximately 95 ms sampling interval, then loses its trace because it stores it after asserting. | Fixed harness retains traces before assertions and measures elapsed render frames. Recovery established a fast smooth turn, not an instantaneous snap. Verified route retains 489 trace samples; angular cap checks pass with disclosed numeric/clock tolerance. |
| U-052 | **Motion diagnostic:** an upright spherical character reports about 67.6° spine tilt because the diagnostic compares against global Y. | Fixed relative to transformed actor up. Actual upright idle reads approximately 2.0–4.2°, while flight still reports anatomical lean. This was an inspection error, not evidence of mesh deformation. |
| U-053 | **Visual contact:** the ground capture has weak boot-contact cues, pale face lighting and a strong hair highlight. A parked vessel overlaps the overhead close view. | Partially improved: tuned existing material roles, light/shadow bias and new berth minimum 8 m; retained vessel coordinates stay unchanged. No overhead vessel in fresh close captures. Weak ground contact remains open (U-048); bind/ankle measurements do not support a large global height correction. |
| U-054 | **Shadow accounting/ownership:** the budget counts source triangles without multiplying thin instances. Bending an InstancedMesh disposes it and creates a Mesh replacement without transferring its caster registration or per-instance metadata. | Fixed: rendered-instance triangle accounting, per-placement metadata and caster transfer, original-owner cleanup. Real Babylon hierarchy/disposal regressions pass; verified journey stays within budgets. |
| U-055 | **Animation cleanup:** temporary instantiated rigs used for baking release groups/roots but leave their cloned Babylon skeleton registered until scene disposal. | Fixed: temporary cloned skeletons disposed across bake paths. Real ownership regression verifies scene skeleton counts and retained shared sources. This was bounded per load, not observed per-frame growth. |
| U-056 | **Camera collision:** thin-instance town batches do not enable per-instance picking, so camera rays can miss a placed wall/post while testing its prototype instead. | Fixed: per-instance picking enabled after bending. Real Babylon regression hits the placed instance away from its prototype and preserves source ownership; ordinary near-wall browser probe shows lens contraction. |
| U-057 | **Near-wall character clipping:** the real browser probe retracts the camera to zero distance at a pillar, leaving the underside of the hero's face across the top of the view. | Implemented: avatar hides at ≤1.25 m lens clearance, restores at ≥1.6 m; five focused tests verify continued animation/placement/material ownership. Corrected journey reached 1.716 m; final bounded ground probe reached 1.29788 m across three positions/24 angles. **The hide threshold still needs ordinary-UI acceptance.** The earlier zero-clearance defect capture is retained. |
| U-058 | **Blocked departure feedback and test route:** the wall probe overshot its return to the street. Subsequent departure collided with town geometry, cancelled navigation and consumed hover mana while the test waited for a world crossing. Captures named “moving” actually show 0 m/s at 3 m. | Failed attempt preserved, relabeled and safely returned. HUD now exposes recent authoritative flight collisions; this specific text remains unexercised in the corrected journey. Harness guards stalled departure, asserts real speed/cruise and probes walls after travel. Corrected journey passes 51 checks with actual flight, foreign reload, home and rendered-town return, zero errors. |
| U-059 | **Space readability:** moving hero occupies only about 100–150 pixels and is very dark against space. Recentered flight can look upright with raised forearms despite a coherent side silhouette. | Added closer default flight framing, vertical-ascent arm reach, stronger forward lean and bounded altitude fill. Focused camera/pose/light tests pass. The new browser run stopped on the ground before flight, and Jacob requested wrap-up; **new moving-flight visual acceptance remains unverified**. Fine fingers, eyes and elbow deformation remain unverified. |
| U-060 | **Zero-clearance view direction:** minimum 3 m zoom removes look-ahead. At zero wall clearance, camera eye and target coincide; Babylon can construct a degenerate view. | Fixed with a nonzero aim direction while retaining the actual blocked lens position and body. Fourteen camera tests pass, including zero/tiny clearance and a real Babylon FreeCamera's finite, invertible view in two radial frames. Final ordinary min-zoom/near-wall/reentry/return follow-up passes 27 checks, zero errors; it stays finite but does not reach zero clearance. Exact checkpoint 18377 reloads successfully. |
| U-061 | **Imported units in radial correction:** using the model import scale as a metre-distance multiplier gives Ranger and Wren different leg-correction limits despite identical canonical stature. | Corrected during the radial implementation: limits derive from canonical body stature and presentation-parent scale. Actual imported-rig checks cover the two distinct conversion factors; this is a presentation correction, not a change to physical body dimensions. |
| U-062 | **Incomplete sole footprint:** a small cross of floor samples can lie entirely on a step while the measured toe or heel extends over its edge. | Added checks across the actual bounded skinned sole hull, with a ledge regression. Unsupported or discontinuous sole support releases the anchor. Live step/edge behavior remains part of U-048 acceptance. |
| U-063 | **Atlas capsule margin reused for sole support:** the canonical walker helper expands low platform footprints by 0.535 m. Using that helper for individual boots can report support just beyond the actual box edge. | Fixed with a presentation-only point/top-plane intersection, native placement basis and actual face bounds. Canonical walker behavior is unchanged. Eight contact-support regressions pass, including edge, raised/radial face and overhang cases; live Atlas-edge coverage is not claimed. |
| U-064 | **Ground QA departure overshoot:** the route reached its waypoint, then settled near chart `(11312.212, 3092.664)`, about 2.35 m from the requested `(11312.5, 3095)`. Its strict departure assertion failed. | Added ordinary key release/Brake, accepted-input acknowledgement and stable sampled position before checking the original tolerance. Bounded corrections use ordinary movement. Three harness regressions pass; integrated browser rerun pending. Original trace and inactive checkpoint 10649 remain preserved. |
| U-065 | **Slope-idle contact eligibility:** the left foot has no fully weighted, non-releasing contact frame at the measured slope stop. The right remains eligible throughout its 20.19-second slope-idle interval. | Open. Aggregate flat/step gap statistics must not be presented as complete slope planting acceptance. Inspect left-foot slope reach/release behavior and exclusions before changing root height or adding pelvis correction. Full 5,002-frame trace retained; wrap-up stopped further iteration. |
| U-066 | **Save-version collision:** traversal and public progression independently wrote schema 32. | Integrated writer uses 33; both 32 shapes retain strict present-component validation. Three explicit schema regressions preserve absence, inventory, progression, quest and John Smith histories without granting missing state. Original checkpoint 10649 also loads read-only unchanged. |
| U-067 | **Duplicate Tower rewards:** legacy silver quests and the current John Smith cache authority could reward the same clear. | Future legacy issuance/payment stops after journaled current-authority initialization. Existing paid/unpaid entries, balances and receipts remain unchanged. Four regressions pass, including a real-worker journal replay, repeat claim/objectives, checkpoint/JSON reload and retried universe entry/return. Exactly one historical silver payout and one current cache grant/open remain. |
| U-068 | **Clean-checkout motion staging:** ignored staged animation was needed by actual-rig tests. | Staging now finds the already tracked, hash-verified CC0 UAL source. Three fresh-output regressions pass. CI explicitly stages it before the test suite; external Atlas geometry remains a separately documented authorized-install dependency. |
| U-069 | **QA turning counted as stalled walking:** after adding stop acknowledgements, the first waypoint spends 5 seconds rotating from the opposite heading; the distance-only 4.5-second watchdog stops before any forward input. | Integrated attempt 1 preserved with 23 passing checks and no browser/HTTP/asset errors. Ordinary return and exact checkpoint 4713 restore retain the same body/items/110 XP. Added bounded angular progress, prompt ordinary Brake and measured turn-tail compensation; four harness regressions and syntax checks pass. Fresh-fixture live rerun pending; waypoint/contact tolerances and 4.5/18-second stall/route bounds are unchanged. |
| U-070 | **QA stop observer assumes brake flag survives input coalescing:** the existing timer can replace queued `brake:true` with all-zero `brake:false`; both stop ground movement but the observer times out. | Attempt 2 retained with 23 checks and zero browser/HTTP/asset errors, safe town return and checkpoint 4699. Require a newer accepted all-zero input with either boolean flag and stable position. Reject stale/nonzero replies; retain all spatial and timing gates. |
| U-071 | **QA walking pulse ignores stopping delay:** attempt 3's initial turn and neutral acknowledgements pass, but a pulse 3.86 m from the waypoint moves 4.87 m and reversals exhaust the 18-second bound. | Preserve the 23-check attempt and safe town recovery. Use ordinary immediate Escape brake and measured translation-tail compensation, retaining all tolerances and bounds. No gameplay or complete flight acceptance is inferred from these checker changes. |

The first presentation trip's recovery passed landing, reload, home return and
actual town rendering, then checkpoint 9898 loaded with unchanged identity,
inventory, discoveries and vessel. Its one transient GET 503 was followed by
recovery. The API's save-busy fence is the code-supported explanation; the old
capture did not retain the response reason, so it is not direct response proof.
The next harness retains the exact reason and requires a subsequent successful
read before classifying a temporary save-busy response as expected.

The preceding October 19 checkpoint completed canonical identity/body and carried-item continuity,
resident NPC/clock continuation, durable journal replay without a final checkpoint,
append-failure recovery, controller races, contact persistence and the occupied
return-anchor recovery. See [campaign results](evidence/universe/CAMPAIGN_RESULTS.md)
for those two browser runs and their distinct limits.

## Next work and acceptance gates

For the next character-quality iteration, prioritize radial foot contact
(U-048), then readable moving flight at multiple camera angles (U-059), and
finish any outstanding ordinary-UI near-wall acceptance (U-057/U-060).
The broader integration gates remain:

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
   The volcanic arrival view is sparse and distant terrain repeats visibly.
   Improve composition and approved locomotion presentation while retaining
   route clearance, actual source-model proof and bounded streaming. Frustum
   membership alone is not proof that a model is visually legible.
8. **Character and camera acceptance.** Implement radial per-foot support and
   planting (U-048), improve space readability/flight silhouette (U-059), and
   exercise the near-wall avatar hide/restore threshold in ordinary play
   (U-057). Keep source textures and actual rig provenance; measure skinned
   soles and slopes before changing the character's global height. The current
   meshes still exceed the older 25k-triangle character target; no LOD claim.

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
