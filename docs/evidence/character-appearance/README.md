# Character appearance pipeline — evidence

Regenerate with:

```bash
npm run appearance:sheet -- 1337 docs/evidence/character-appearance/ashford-contact-sheet.svg 40
```

Deterministic: the same seed always produces byte-identical output.

## `ashford-contact-sheet.svg` / `.png`

The authored Ashford village at seed 1337, drawn straight from canonical appearance — one figure
per resident, proportioned by their own canonical height and build, captioned with the structured
tokens that produced it. This is what the bridge sends, so anything visible here that PIE does not
show is a projection bug rather than a generation one.

The PNG is a Chromium render of the SVG; the SVG is the source.

## Measured spread (seed 1337, 33 living residents)

| Metric | Value |
| --- | --- |
| Reference families present | 8 of 8 (`shogun` 7, `kaito` 5, `hana` 5, `yuki` 5, `ren` 4, `ayami` 3, `ascetic` 3, `shiro` 1) |
| Distinct costume palettes | 8 |
| Distinct garment silhouettes | 8 |
| Distinct realized garment colours | 29 of 33 |
| Distinct trait signatures | 33 of 33 |

Before this slice, every resident of a procedurally generated settlement had one uniformly random
shirt colour and identical height and build, and the five reference sheets influenced nothing.

## What is NOT evidenced here

- **No Unreal build, no native automation run, no PIE screenshots.** No engine was available in the
  environment this slice was implemented in. The C++ (`TVHumanoidVisualState`, `TVCharacter`) and
  the schema-2 profile JSON are unverified by compiler or editor and need a build before merge.
- **No human visual acceptance.** The Unreal-side change is colour/scale differentiation on the
  existing Manny presentation; the primitive hair/garment/prop stand-ins remain hidden behind
  `proxyVisibility` in `AshfordAppearanceProfiles.json` so the accepted Slice 2 look does not
  regress without review.

See `docs/CHARACTER_APPEARANCE_PIPELINE.md` for the full contract.
