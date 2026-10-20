# Corrected physical short-tap check — response latency remains

Clean `db70c4a`; production source is unchanged from `f900adf`. The corrected
checker never waits for a movement request before releasing keys. Four requested
20 ms holds measured 42–43 ms including keyboard dispatch. Displacements were
0.700, 1.050, 0.700 and 0.700 m. The backward tap **failed** the retained 0.75 m
precision target; this is not a passed microtap acceptance.

Backward input seq 5 took 118 ms to return. Neutral seq 6 was dispatched at the
same recorded millisecond as that response, then acknowledged 67 ms later.
There was zero observed extra queue-timer delay. The host's 50 ms steps account
for three 0.35 m steps before neutral input took effect. All taps subsequently
had acknowledged newer neutral sequences and stable positions. The short
diagonal chords were coalesced before transmission, which the checker now records
without extending their physical duration.

The U-073 artificial timer delay is fixed; serialized transport still imposes a
response-time limit on precise control. Keep this limitation visible, assess the
full unchanged waypoint route, and review safer delivery options before deciding
release readiness. Do not enlarge spatial gates or call this run passed.

Zero browser/HTTP errors. Ordinary town return retained the same body and items.
Graceful checkpoint 1213 restored read-only with 110 XP, Normal stage, John Smith,
home discovery and original vessel; manifest unchanged. Raw evidence is retained
locally in `.debug/release-microtap-oct20-v2`.
