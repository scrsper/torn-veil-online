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

## Next work and acceptance gates

Completed this iteration: canonical identity/body and carried-item continuity,
resident NPC/clock continuation, durable journal replay without a final checkpoint,
append-failure recovery, controller races, contact persistence and the occupied
return-anchor recovery. See [campaign results](evidence/universe/CAMPAIGN_RESULTS.md)
for the two browser runs and their distinct limits.

1. **Body simulation across domains.** The absent traveler currently does not
   receive ordinary physiology, wounds or recovery processing. Make body-system
   scheduling aware of astral residency before adding survival or combat. Verify
   identical health/item effects and causal events through travel, reload and
   return, with no duplicate planar participation.
2. **Seamless settlement geometry.** Existing town/pagoda structures are still
   absent from the spherical surface. Bind one canonical settlement and vessel
   approach to the shared sphere frame, with authoritative collision and doors.
   Acceptance must cover walking town → vessel → planet → town and Tower history,
   regardless of asset loading. The current gateway does not establish this.
3. **Lifecycle and endurance.** Repeat-mount handler coverage for U-008 remains
   pending. Add repeated view changes and a long flight/reload/warp session with
   delayed/lost transport and measured memory, moving-frame uploads and p95 frame
   time on the intended device. A short settled-frame sample is insufficient.
4. **World content.** Surface NPCs, resources, ecology and interactions need
   canonical simulation and persistent causal outcomes before presentation.
   Visiting a planet currently grants no inventory, progression or economic reward.
5. **Flight depth.** Fuel/cargo, vessel ownership and acquisition, combat,
   atmospheric hazards, orbital physics and cross-star continuous travel remain
   unimplemented. The current skiff is an explicit traversal fixture.
6. **Generation breadth.** Height fields cannot provide overhangs or caves.
   Static planet centers and metadata gravity are deliberate current limits.
   Add volumetric terrain only with shared collision, deterministic streaming,
   persistence and bounded memory acceptance.

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
