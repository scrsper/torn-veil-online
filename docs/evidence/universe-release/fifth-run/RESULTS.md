# Integrated release attempt 5 — exposed control latency

Local `0f210f7`, game source unchanged from public `2447752`, fresh fixture.
Ordinary body-relative WASD passed flat-forward (5.08 s, 0.379 m remaining),
step-down (1.42 s, 0.190 m), slope-forward, slope-side and slope-return. On step-up,
the last short diagonal pulses repeatedly moved exactly 1.40 m, alternating
between points 0.751 m and 0.712 m from the target. No collision event explains
this. The unchanged 4.5-second progress gate correctly stopped the route.

This exposed an actual control-delivery limitation: the client leaves queued stop
input waiting for another 100 ms network tick after an earlier command finishes;
key transitions also rely on the timer. Address prompt key-transition delivery and
serialized queue draining while preserving authority, ordering and stale-response
fences. Verify short taps before another complete flight test. Do not enlarge the
0.65 m target tolerance to conceal the latency.

23 checks passed, zero browser/HTTP/asset errors, ordinary rendered-town return
preserved character/inventory. Graceful shutdown wrote checkpoint 8087; read-only
restore preserves 110 XP, Normal stage, John Smith, home discovery and parked
vessel, with unchanged manifest. `acceptance.json` retains token-free request and
route records; raw contact evidence remains in `.debug/release-journey-oct20-v5`.
The sampled left slope foot still lacks eligible stable contact, a recorded
coverage limit. No flight acceptance is claimed.
