# Exact-save restart acceptance

**17 checks passed; zero HTTP, browser, runtime or asset errors.** This run used the exact `.debug/atlas-flight-qa-2026-10-20T18-45-46-729Z/world.json` save from the [verified round trip](../verified-run/RESULTS.md), after the parent gracefully stopped the host, verified checkpoint **11693**, and restarted the unchanged source and save.

The ordinary browser flow:

1. Rendered the actual restored town, with enabled `b_5`, person `p_5`, and the same complete inventory.
2. Opened the spherical preview and verified the same identity/items and actual verified UAL idle source.
3. Confirmed both discoveries and the original parked vessel survived restart.
4. Used Explore; entry matched the current preview position within the 5 cm test tolerance.
5. Used the ordinary home return and waited for the actual town renderer again.

The final town was ready with 81 chunks, 55 focused instances, zero pending instances, and controlled `b_5` at `(11314.57580171227, 1.0625, 3093.1542221288964)`. The browser closed normally.

The parent then gracefully stopped the host and verified final checkpoint **12963** from the same save. Identity, inventory, discoveries, original vessel, inactive expedition and present returned body remained valid. The initial restart used checkpoint 11693; this final proof covers the follow-up's second return as well.

[Observations](journey.json), [initial restored town](00-town-rendered.png), [preview](01-town-preview.png), [ordinary reentry](02-restored-reentry.png) and [second returned town](03-restored-town-ready.png) preserve the evidence. This bounded follow-up does not repeat the flight route or extend its visual coverage claims.
