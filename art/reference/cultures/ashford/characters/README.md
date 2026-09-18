# Ashford character references

These five sheets are the authored visual statement about what Ashford's people look like. They are
**not** five bespoke characters: they are the stylistic families the whole population is generated
from.

| File | Yields archetype(s) |
| --- | --- |
| `hana.png` | `hana` — festival silk |
| `yuki.png` | `yuki` — blossom court |
| `kaito.png` | `kaito` — young retainer |
| `shogun.png` | `shogun` — dragon silk |
| `-ren-ayami-shiro.png` | Four labelled NPC panels: `ascetic` (NPC 5, the monk — the filename gives only three names for four panels, so this one is keyed by role), `ren` (NPC 6, the ronin), `ayami` (NPC 7, the dancer), `shiro` (NPC 8, the kitsune) |

The written interpretation lives in `src/sim/world/characterArchetypes.ts`, one `referenceNote` per
archetype recording what was actually read off the sheet and, where something was deliberately not
taken, why. `tests/character-appearance.test.ts` asserts every archetype still names a file that
exists here, so renaming or removing a sheet fails the suite rather than silently orphaning a family.

Full pipeline: `docs/CHARACTER_APPEARANCE_PIPELINE.md`.
