# Character Foundry against the real installed library

Branch `claude/foundry-real-people-slice4`, from `fba1153`. Run on the Windows development machine
that holds the licensed content, which is the thing every previous session was missing.

## The headline, first

**This machine has no human character library.** Not "the cloud container could not see it" — it is
not installed here either. Every humanoid mesh in the project is an engine mannequin:

| Mesh | Skeleton | Usable as a body? |
|---|---|---|
| `SKM_Manny_Simple` | `SK_Mannequin` | yes — this is the animation target |
| `SKM_Quinn_Simple` | `SK_Mannequin` | yes |
| `SKM_UEFN_Mannequin` | `SK_UEFN_Mannequin` | no — no retarget bridge to the animation target |
| `HeroTPP` | `HeroTPP_Skeleton` | no — same |
| `SKM_Manny`, pack-local `SKM_Manny_Simple`/`SKM_Quinn_Simple` | `FreeSampleAnimationSet` copies | no — different skeleton assets |

There are **zero** heads, hair, grooms, facial hair, upper or lower garments, robes, armour,
footwear, accessories, MetaHumans or modular parts. The other skeletal meshes in the project are a
pickaxe, a flashlight, two lockers, five butterflies and a deer.

So the work order's requirement that a visible person "must not be Manny" **cannot be met on this
machine**, and no amount of resolver work changes that. What this branch does instead is make the
whole pipeline real and honest end to end, so that installing a character pack is the only
remaining step rather than the first of many.

## Toolchain (work order §1)

The blocker was never "Windows SDK 10.0.19041.0 is missing". Nothing in the project pins that
version; it is UnrealBuildTool's stated *minimum*, printed because **no Windows SDK was installed at
all**. Visual Studio Community 2026 (18.9.12120.119) had only the Core Editor workload, and its
MSVC 14.51 was an ASAN-only stub — 2 include files, no CRT, no STL.

UE 5.8's own `Engine/Config/Windows/Windows_SDK.json` names `10.0.22621.0` as `MainVersion`, so
installing the obsolete 19041 would have been the wrong fix. Installed instead, via the VS
installer, exactly the components UE 5.8 lists for VS2026:

- `Microsoft.VisualStudio.Component.VC.14.50.18.0.x86.x64`
- `Microsoft.VisualStudio.Component.VC.14.50.18.0.ATL`
- `Microsoft.VisualStudio.Component.Windows11SDK.22621`

**No project configuration was changed.** UBT now reports `Win64 VALID` and selects MSVC
`14.50.35737` with the `10.0.22621.0` SDK — the engine's preferred pair.

Two further environment facts worth recording:

- UnrealBuildTool needs the .NET 10 runtime, which only the engine's bundled copy provides. Invoke
  it through `Engine/Build/BatchFiles/Build.bat`, never `UnrealBuildTool.exe` directly.
- Unreal Build Accelerator exhausts the paging file on this box
  (`UbaSharedMemoryAllocator.cpp:692`). Pass `-NoUBA`. This is a machine limit, not a code fault.

## The merged C++ had never been compiled

`TVEmbodiment.cpp` did not build. UE 5.8 changed `FJsonObject`'s key type from `FString` to
`UE::FSharedString`, so iterating `->Values` and using `Pair.Key` no longer converts. Fixed with
`FString(Pair.Key.ToView())`, which is the conversion `TVCharacter.cpp` was already using for the
same pattern a few files away.

The native automation tests then ran for the first time and found a second real defect:
`FJsonValue::TryGetString` **succeeds on a number**, stringifying `7` into `"7"`, so
`OptionalTokens` admitted numeric junk as accessory tokens despite a comment promising a
"string-only token list". Now type-checked.

## Real asset audit (§2)

`unreal/scripts/audit_character_assets.py`, run in the editor against the real registry. The first
run produced a catalogue that was confidently wrong, and each fault is worth naming because a
synthetic fixture could never have shown it:

| First run said | Actually | Cause |
|---|---|---|
| 6 bodies | correct | — |
| 115 accessories | 0 | `Motifect_Combat_Motion_**Pack**` matches the accessory token `pack` |
| 2 upper garments | 0 | `s`**`top_`**`from_run` matches the `top_` token |
| 252 skeletons | 126 | skeleton paths recorded in both package and object form, double-counted |
| 0 rig groups | 11 | grouping could not load skeletons from the object-path form |
| retargeter source/target `null` | resolved | `SourceSkeleton`/`TargetSkeleton` are not AssetRegistry tags |

The most dangerous of these was none of the above. The audit's body pattern ends in `sk_|skm_`,
which matches **every** skeletal mesh in a project — so a pickaxe, a flashlight, two lockers and a
deer were all catalogued as candidate human bodies. Bodies and heads are now gated on a real
humanoid bone hierarchy read from the mesh, in either the Epic or the Mixamo bone vocabulary, and an
unreadable hierarchy fails *closed*.

Final catalogue: **6 bodies, 371 animations, 126 skeletons, 11 rig groups, 1 retargeter**, animation
target `/Game/Characters/Mannequins/Meshes/SK_Mannequin`. Every other slot is empty, which is the
truth about this machine.

## Skeleton compatibility graph (§3)

| rig group | convention | bones | skeletons | meshes | anims | identity |
|---|---|---|---|---|---|---|
| `rig_35746ff211f8` | ue | 89 | 2 | 3 | **148** | **animation target** (`SK_Mannequin`) |
| `rig_981b5dce4d59` | **mixamo** | 77 | **115** | **0** | 115 | the three Motifect packs |
| `rig_f1b915692173` | ue | 68 | 1 | 0 | 64 | `HeroTPP_Skeleton` |
| `rig_b77b93caa85d` | ue | 161 | 1 | 2 | 14 | full `SKM_Manny` |
| `rig_38f0aa36a8d5` | ue | 93 | 1 | 1 | 8 | UEFN mannequin |
| `rig_9086901fdb1b` | non-humanoid | 62 | 1 | 1 | 13 | deer |
| 5 more | non-humanoid | 1–2 | 1 each | — | 0–5 | lockers, pickaxe, flashlight, butterfly |

The load-bearing findings:

- **Manny and the Motifect packs share no bones at all.** Manny is UE convention (`pelvis`,
  `spine_01`, `upperarm_l`); Motifect is Mixamo (`Hips`, `Chest`, `LeftForeArm`). Leader Pose
  between them is impossible; **IK retargeting is mandatory**, which is what
  `RTG_TV_CombatRepair` already does.
- **All 115 Motifect skeletons are one rig.** Each clip shipped its own Skeleton asset, but their
  bone sets are identical — the only differences are the clip's own name and a GUID. So the honest
  statement is "one rig imported 115 times", and **one retargeter per rig group reaches all of
  them**, not 115 retargeters. That is the single most valuable thing in this table and it is the
  recommended next slice.
- Manny and Quinn share `SK_Mannequin` with the animation target, so a visible Quinn is driven by
  **Leader Pose from the hidden driver** with no retargeting at all.

## Resolver faults found by real content (§6)

Three genuine bugs, all invisible to a fixture:

1. **`animatableSkeletons` only accepted retargeters authored clips→driver.** A foreign body posed
   *from* the driver — the hidden-driver architecture this project actually uses — was always
   rejected. A retargeter is a bone-chain mapping and is usable in whichever direction the runtime
   needs; both are accepted now, and one that does not involve the animation target is still ignored
   rather than silently widening the pool.
2. **`chooseCandidate` weighted every preference equally**, so "average build" tied with "feminine"
   and a canonically female person was assembled on a male body whenever the tie fell that way.
   Preferences are now weighted by their position in the rule, which is already ordered
   strongest-first.
3. **A monolithic character mesh carries its own head**, so completeness no longer demands a
   separate head asset that no pack could supply for that body. Without this, `bComplete` stays
   false for everyone forever and `UTVCharacterPresentation` never draws a visible character at all
   — which is precisely why the pipeline had never produced one.

## Two bridge faults that made visible people impossible (§4)

Even with the resolver fixed, every character stayed a driver mannequin. The cause was not in the
Foundry at all:

- `appearanceSent` dedupes profiles **per body, not per client**. A renderer joining an
  already-running bridge was told nothing, because the profiles had "already been sent" — to nobody.
- Worse, `/health` builds a snapshot just to count visible NPCs and throws it away, and that
  consumed the delta too. **`Launch.ps1` health-checks the bridge before starting the editor**, so
  this fired on every ordinary launch, and any body that came into view later was also permanently
  unembodied.

Now the delta resets when a renderer connects, and a snapshot only consumes it when it is actually
being delivered. Measured before and after, same world, same seed:

| | visible characters |
|---|---|
| before | 0 / 8 |
| after connect-reset only | 5 / 9 |
| after `/health` fix as well | **8 / 8** |

## One canonical person, end to end (§4)

    Person p_128 → appearance.description → projectAppearanceDescription
      → Foundry slotRules → realizeCharacter (against the audited catalogue)
      → /Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple on SK_Mannequin
      → UTVCharacterPresentation, Leader Pose from the hidden driver → visible in PIE

`foundryComplete: true`, `visibleCharacter: true`, `retargeted: false` (Leader Pose, as intended).

## A material fault that discarded every canonical colour (§12)

The first PIE capture showed real, correctly-scaled people who were all **identical white**.
`TintComponent` pushed canonical skin and garment colour into a `Tint` parameter on whatever
material the mesh shipped with — and the mannequin wears `MI_Manny_01_New`, which has no such
parameter. `SetVectorParameterValue` on an undeclared parameter is a silent no-op, so canonical
colour was computed, projected, sent across the bridge and then dropped on the floor.

The project already had `M_TV_CharacterSkin`/`Cloth`/`Hair`/`Prop`, each declaring `Tint` and
already flagged `bUsedWithSkeletalMesh`; nothing was applying them. The presentation now does.
This matters more than it looks: with no garment, hair or head content, **colour is the only
remaining channel for individuality**, so without it a settlement is one mannequin repeated.

## Population measurement (§7, §8)

`npm run foundry:report` over the generated world, against the real catalogue:

| | before this branch | after |
|---|---|---|
| people | 33 | 33 |
| complete | **0** | **33** |
| distinct bodies | 1 | 2 |
| distinct outfits | 1 | 1 |

Distinguishing the causes honestly, as the work order asks:

- **Content gap** — every empty slot. `hair`, `facialHair`, `upperGarment`, `lowerGarment`, `robe`,
  `armor`, `footwear` and 22 accessory kinds are unmet because nothing on this machine can fill
  them. `.debug/character-foundry/foundry-report.json` carries the full shopping list.
- **Resolver** — no outstanding known bugs; the three above are fixed.
- **Animation incompatibility** — the Motifect rig gap above.
- **Canonical data** — none found. Canonical appearance was complete and correct throughout.

Visible individuality now comes from body choice (2), canonical skin/hair/garment tint, and
canonical scale. Scale is genuinely doing work: measured in PIE, height multipliers ran 0.67–1.04
and build 0.70–1.11, and the short ones are canonically **children aged 9, 9 and 11** and
adolescents of 15 and 16. Canonical age really does drive visible stature.

## Activity and occupancy (§9)

Observed live in PIE, downstream of simulation truth: `work/harvest` standing at a station with a
106 cm presentation-only occupancy offset, `socialize/sit_and_talk` seated with a 25 cm offset, and
`idle/stand`. Canonical positions were untouched.

`build_character_palette.py` resolves **13 of 36** activity keys from clips on the animation target.
The other 23 (`eat`, `rest/pray`, `socialize/converse`, `flee`, `idle`, most `work/*`) exist in the
Motifect packs but sit behind the retarget boundary described above.

## Evidence

| What | Path |
|---|---|
| One canonical person, Foundry-resolved and visible | `foundry-one-person.png` |
| Nearest cluster, canonical skin tints applied | `foundry-cluster.png` |
| The same cluster before the material fix — every person identical white | `foundry-cluster-untinted-before.png` |
| Settlement scale | `foundry-settlement.png` |
| Machine-local catalogue | `.debug/character-foundry/catalogue.json` (gitignored) |
| Population report | `.debug/character-foundry/foundry-report.json` (gitignored) |
| Live PIE probe | `.debug/foundry-real-people/probe.json` (gitignored) |

Licensed asset content and machine-local paths are deliberately not committed.

## What is NOT evidenced

Stated plainly, because a gap recorded is worth more than a gap implied:

- **No 10-person diversity shot.** Only 8 bodies were in view, and with 2 usable meshes a
  "diversity" claim would be dishonest regardless.
- **No combat capture**, no dodge/jab/cross/kick/hit-reaction verification on a *visible* character.
- **No PIE video.**
- **No fail-soft capture in PIE.** The fail-soft path is covered by tests, not by a screenshot.
- **Nothing on reference-family realization (§5) or named-character likeness (§11).** Both need
  character content that does not exist here; guessing would be inventing coverage.

## Tests

| Suite | Result |
|---|---|
| `tsc --noEmit` | passes |
| `character-foundry`, `character-appearance`, `embodied-people`, `player-embodiment`, `embodied-economy` | 132/132 |
| `TornVeil.Embodiment.*`, `TornVeil.Humanoid.VisualState.*` | 6/6 after the `TryGetString` fix (5/6 before) |
| `TornVeilOnlineEditor` Win64 Development | builds |

No timeout thresholds were changed.

## Recommended next slice

1. **Install a modular character pack.** Everything else is now waiting on exactly this.
2. **Consolidate the Motifect rig.** All 115 skeletons are provably one rig; re-point the clips onto
   one shared skeleton and batch-retarget onto `SK_Mannequin` with the existing
   `IKRetargetBatchOperation` path. That unlocks ~115 clips and most of the 23 unresolved
   activities.
3. **Retarget bridges for the UEFN mannequin and HeroTPP**, which would take usable bodies from 2 to
   4 without licensing anything.
