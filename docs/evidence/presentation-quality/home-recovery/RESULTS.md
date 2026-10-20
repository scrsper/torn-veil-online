# Safe home recovery after blocked departure

The exact failed refined-run save was reopened with ordinary controls. Clicking Brake and Descend immediately returned the same body to the home surface; the harness then used Return to town and waited for the actual town renderer. No save edits, force movement, ability grants or new travel route were used.

**Passed: safe landing, full identity/inventory preservation, actual town readiness, no HTTP or browser errors.** The browser closed normally. [journey.json](journey.json), [home ground](18-recovered-home-ground.png) and [returned town](19-recovered-town-ready.png) preserve the result.

The parent gracefully checkpointed and restored the exact save at **sequence 12804**: inactive expedition, present `p_5` / `b_5`, unchanged five inventory entries, original vessel, returned event, and only the home discovery as expected. See [checkpoint.json](checkpoint.json). The failed departure did not reach or discover another world.

The prior blocked flight and near-camera character clipping remain documented in [the preserved refined run](../final-run/RESULTS.md). The next moving-flight verification must begin from the open street and put any near-wall probe after the round trip.
