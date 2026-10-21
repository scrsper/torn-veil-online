# Corrected traversal and same-save restart

Implementation `956e837` passes54 ordinary journey checks and20 same-save host
restart checks on port7534. Both runs have zero HTTP/browser errors and zero
rejected movement receipts. The same launcher owns the canonical town and
universe views; no independent world or client prediction is introduced.

The unchanged paving, step, slope and departure route passes, followed by actual
moving ascent above50m/s, camera orbit, personal flight to Vesperspire3, landing,
foreign reload, home vessel recovery and full rendered-town return. All original
spatial, camera, contact and workload thresholds remain. Night/space readability
uses brighter existing ambient sources; daylight ground treatment and the shadow
budget are unchanged. Root inspected current moving and foreign-ground captures.
The improvement is modest; dark cloth, sparse terrain, missing eligible left-foot
slope samples and clipped slope-front framing remain presentation limitations.

The controller gracefully checkpointed/stopped its owned host, started a new
process on that exact save, verified the final town position and complete
character/items/discoveries/parked vessel, reentered on foot and returned normally.
Both host exits are0. Final read-only checkpoint18240 retains Person `p_5`, Body
`b_5`, all five items,110XP, Normal rank, current John Smith and two discoveries.
The checkpoint manifest remains unchanged by inspection; writer version33.

On the same corrected input implementation (`b331a65`, before the lighting-only
change),12 repeated physical41–53ms taps move0–0.70m under the retained0.75m limit.
Every complete diagonal chord reaches the wire. Distinct authoritative snapshots
verify durable neutral and stable position. Earlier passes and failures remain
in [input history](../input-stream/RESULTS.md) and the
[polling failure](../input-stream-first-journey/RESULTS.md).

67 affected input/API/QA tests,11 lighting/boundary tests (overlapping groups),
TypeScript and the final Babylon build pass. Camera-only QA counts both HTTP
commands and WebSocket input. Actual worker replay and delayed-storage tests
preserve durability barriers and owner fences.

[Compact evidence](acceptance.json) contains selected token-free measurements.
Raw local evidence is `.debug/input-journey-fourth`, `input-restart-fourth`,
`input-journey-controller-fourth` and `input-microtap-third` in the isolated input
checkout. The ordinary unendowed town/Tower/combat follow-up is separate.

This establishes restart behavior for the corrected implementation's owned7534
fixture. It does **not** establish the original7533 host/save restart. That writer
remains untouched and must checkpoint gracefully before upgrade; its terminal's
approved shutdown input was tool-denied. PR72 stays draft until that gate and
final-head CI pass. See [release status](../../../UNIVERSE_RELEASE.md).
