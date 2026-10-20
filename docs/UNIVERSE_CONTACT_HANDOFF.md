# Contact and flight presentation checkpoint — 20 October 2026

Jacob requested wrap-up before another polish cycle. All changes are local on
`codex/universe-traversal-oct19`. The review browser and isolated host are stopped.
No push, merge, publication or user-campaign edit was performed.

## Implemented

- Radial leg/ankle contact correction using actual skinned boot vertices,
  absolute anchors and a fresh floating-origin frame. Existing planar correction
  stays on its prior path; canonical movement/body state is unchanged.
- A read-only 5 m host floor window, capped at 768 triangles, including paving
  and slopes. Missing/out-of-range support releases contact. Actual street
  payloads measured 46.5–50.8 KB; the sampled forest slope measured 19.0 KB.
- Closer personal-flight framing, stronger directional flight poses and bounded
  altitude fill using the existing lights and materials.
- Preserved raw evidence, prototype corrections and issues U-061–U-065.

## Checks actually completed

- Final combined contact/camera/motion/lighting/import-boundary run: **56 tests
  in 9 files passed**. TypeScript and the plain Vite web build passed (83 s).
- Additional relevant runs: 76 tests in 9 canonical/presentation files; 47 tests
  in 8 shared-character files; 30 tests in 4 radial/planar files. These groups
  overlap; they are not additive unique-test counts. The real Ranger/Wren import
  test executed against the staged credited assets.
- Ordinary browser ground route reached flat paving, the step down/up, slope
  and return. **23 checks passed before a departure-position assertion failed**;
  no browser, HTTP or required-asset errors were recorded. It then returned
  ordinarily to fully rendered town with the same person, body and inventory.
- 5,002 retained ground frames over 112.4 seconds; 11,687 independent sole/host
  triangle comparisons agreed within numerical precision. Stable flat/step
  windows have sub-millimetre drift. **The left foot has no eligible slope-idle
  frame; the right remains eligible for 20.19 seconds**. Complete slope planting
  remains unverified.
- Graceful shutdown and exact checkpoint **10649** restore succeeded: inactive
  expedition, body present in town, all five inventory items unchanged, one
  discovery and 320 reserve. No new flight or browser-restart acceptance ran.

## Remaining issues

1. U-063: replace capsule-expanded Atlas support with exact point/top-face
   support for visual soles. Keep canonical walker collision unchanged.
2. U-065: investigate repeated slope-idle release/reach behavior; avoid claiming
   slope planting from flat-ground statistics.
3. U-064: verify stop/acknowledgement timing before using a precise departure
   waypoint. The final settled location missed the harness target by about 2.35 m.
4. U-059/U-053: moving-flight readability remains unverified; static boot contact
   shadows still look weak. Live camera hide-threshold coverage remains open.
5. Larger traversal work remains: ordinary spherical NPC/combat/door/Tower
   integration, survival consequences, surface ecology/resources, vessel
   acquisition/cargo/fuel, and lifecycle/endurance acceptance.

## Exact local review launch

This selects the **isolated acceptance fixture**, whose flight capacity was
explicitly endowed for testing. It is not a progression-earned character or a
replacement for Jacob's own campaign. Run in PowerShell:

```powershell
Set-Location 'C:/Users/green/Documents/Projects/torn-veil-universe'
$env:TV_REALMS_SAVE='C:/Users/green/Documents/Projects/torn-veil-universe/.debug/atlas-flight-qa-2026-10-20T19-33-44-972Z/world.json'
$env:TV_REALMS_PORT='7533'
npm run universe:campaign -- --no-open
```

Then open `http://127.0.0.1:7533/?universe&campaign`; the town view is
`http://127.0.0.1:7533/?realms`. Close play tabs and type `shutdown` in the host
terminal to checkpoint gracefully. Do not change executable source with a live
journal tail; never bypass its engine fingerprint.

Evidence: [ground run](evidence/presentation-quality/contact-pass/first-run/RESULTS.md),
[exact checkpoint](evidence/presentation-quality/contact-pass/first-run/checkpoint.json),
[imported rigs](evidence/presentation-quality/contact-pass/RIG_CHECK.md), and
[defect register](UNIVERSE_ISSUES.md). Earlier complete flight/restart evidence
belongs to `53c1f73`, not to visual verification of this pass's new flight changes.
