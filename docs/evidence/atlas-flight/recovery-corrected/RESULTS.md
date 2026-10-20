# Exact-checkpoint recovery and reentry

2026-10-20, normal-quality headed Chrome 1440×900, isolated host port 7533, original failed final checkpoint `.debug/atlas-flight-qa-2026-10-20T17-47-20-131Z/world.json`.

**Passed 11 bounded UI checks with zero browser/shader errors and zero HTTP failures.** The parent restored the unchanged failed checkpoint normally after the validation repair; this follow-up did not rewrite the save.

The town renderer became ready with loaded focused assets and an enabled controlled character. Person `p_5`, body `b_5`, and every original carried item ID/name/quantity were preserved. The normal town travel button opened the inactive mapped preview; the rendered avatar feet matched that preview's body position. Exploring kept the exact position (**0 m delta**), identity and inventory, and `canReturn` was true. The ordinary return action reached a second fully rendered town with the same identity/items. The final binding is inactive.

Screenshots `00`–`03` and [`recovery.json`](recovery.json) preserve town readiness, the preview, reentry and final rendered town. These are also before-images for the next camera/lighting/rig quality cycle.

After this UI follow-up, the parent again shut down cleanly and reloaded the new checkpoint. Sequence **9398** retained `p_5`/`b_5`, carried items, discoveries and the parked vessel; the binding was inactive, the body was present, and return event `e_353` remained. The parent refreshed `checkpoint.json` with that verification.

## Save defects repaired by the host work

- **U043:** the completed return stood at Y=1.0625 on focused paving. Inactive-history support validation searched only 0.015 m, began on lower mortar, and missed neighboring paving 6.25 cm higher. Its support search now uses the same 0.55 m range as walking; the final support-height acceptance tolerance remains 0.015 m. The parent retained the exact failed sequence 7267 checkpoint under the fixture's `restart-failure` directory.
- **U044:** an inactive mapped binding could survive return and then allow focused-town adoption, invalidating its historical body/parked-vessel geometry. A narrow pre-mutation guard now rejects that adoption. Existing-focused no-ops and the supported legacy gateway migration remain available. The parent reported 25 settlement/migration/journal regressions plus TypeScript checks passing.

## Preserved harness measurement correction

The initial recovery reader selected `snapshot ?? preview` while inactive. The actual renderer correctly selects the current preview first. That reader compared an older historical landing with a subsequent occupancy-adjusted town return and reported a 1.005664 m discrepancy. The original failure and its follow-up normal return remain in [`../recovery`](../recovery/recovery.json); no production position defect was established.

The corrected reader uses `campaign.active ? snapshot : preview ?? snapshot`. It verified both the rendered feet and reentry against the actual current preview and measured zero position difference. This did not require a production change.

The next visual cycle remains necessary: U041 source-provenance audit found missing motion packs hidden behind requested animation aliases. Changing clip frames/joints showed active animation, but did not certify the named authored clip. Camera, lighting and movement polish are separate from this durable-state recovery.
