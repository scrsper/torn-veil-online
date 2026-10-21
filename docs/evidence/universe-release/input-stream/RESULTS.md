# Ordered movement input — October 20, 2026

Implementation `ffd79c7` separates receipt of owner input from durable saving.
Movement uses the existing owner WebSocket, canonical travel operation and
journal; structural commands and view transitions wait for durable input.
Owner changes, invalid sequences, save failure and bounded backlogs fail closed.
No prediction, dropped simulation time, speed change or relaxed waypoint bounds.

65 focused tests in six files, TypeScript and the Babylon web build pass.
Coverage includes a real-worker replay of input, intervening host ticks and
release, plus simulated 120 ms persistence latency at four scheduler phases.

The ordinary browser microtap run used a new endowed acceptance fixture on7534.
It returned the same Person/Body and five inventory items to rendered town,
then its controller gracefully checkpointed and closed its owned host (exit0).
No browser, HTTP or rejected input-receipt errors occurred.

| Physical keys | Physical hold | Displacement |
| --- | ---: | ---: |
| W | 43 ms | 0.35 m |
| S | 54 ms | 0.70 m |
| W+A | 47 ms | 0.70 m |
| S+D | 48 ms | 0.35 m |

All four pass the retained0.75m bound. Complete diagonal samples coalesced before
wire admission in the two chord taps; these demonstrate bounded short input,
not complete diagonal movement or animation coverage. Zero drift after durable
neutral is verified using distinct authoritative snapshots and unchanged
300ms/three-tick settling checks.

Raw local evidence: `.debug/input-microtap-first/microtap.json` and
`.debug/input-microtap-controller/controller.json` in the isolated input checkout.
Screenshots accompany this record. Earlier failed benchmarks remain preserved.
Full corrected-source journey, same-save restart and final-head CI are separate
release gates; see `docs/UNIVERSE_RELEASE.md` for their current status.
