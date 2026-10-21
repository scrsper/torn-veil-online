# Preserved first streamed-input journey failure

Source `ffd79c7` passed the complete unchanged physical ground route and
takeoff, but failed the required moving-ascent speed check. A held-input
heartbeat set the shared request-busy flag before each polling attempt.
Unlike the earlier HTTP commands, stream receipts do not carry snapshots.
The server moved the character, while the rendered snapshot stayed at tick2833,
seq173 and0m/s despite durable lift seq180. The later snapshot reached tick2880
and417.29m altitude. This is a client freshness defect, not permission to weaken
the moving-speed gate.

The correction permits authoritative polling during streamed input delivery,
while retaining structural command barriers. The checker also counts sent
WebSocket movement in camera-only checks, alongside existing HTTP commands.
Full corrected acceptance must run again.

The ordinary recovery landed and returned the same Person `p_5`, Body `b_5`
and inventory `i_1`–`i_5` to rendered town. Owned-host graceful shutdown exit0;
read-only restore of checkpoint10506 retained110XP, Normal rank, John Smith,
one discovery and the original vessel; manifest unchanged. A marked save-busy
503 occurred during recovery; this failed run is not error-free acceptance.

Raw evidence remains `.debug/input-journey-first/journey.json`, `restore.json`
and `.debug/input-journey-controller/controller.json` in the isolated input
checkout. No original7533 source/save or user campaign was changed.
