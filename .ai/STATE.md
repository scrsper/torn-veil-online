# Civilizational Capability Continuity

Current branch: `codex/civilizational-capability-continuity`, based on origin/main at 52da4f3 after Living Universe Integration was merged. Implementation checkpoint 7ff4df3 is pushed. No PR or merge requested. Report: docs/CIVILIZATIONAL_CAPABILITY_CONTINUITY.md.

## Implemented and demonstrated

- Owned physical method records carry fallible claims, notation and provenance. Reading transfers information only. Writing/copying pay labor and 0.5 kg of real wood; ordinary locality, possession, theft, gifts, inheritance, save/load and destructive exposure apply.
- Orla Thorne learns from a record, operates Perrin Nettle's machinery without owning it, then manufactures four separate physical components and procures her own stone to reproduce the system at another workplace. Crafting grows through manufacture, not instruction.
- Existing workplace/resident membership, living knowledge, physical records/examples and actual repeated practice produce derived knowledge reservoirs. No institution registry, global method unlock or preservation controller was added. Destruction/death can remove every usable local path.
- Real weather and geographical exposure drive explicit imported/escaped wind energy. The two-second air parcel cannot accumulate through disuse or survive calm. Known machinery persists through temporary input/power failure; broken/disconnected examples do not count as intact capability.
- Inherited place title follows the existing estate process. Personal material orders have explicit buyers, and absent local stock observations no longer cause duplicate procurement.
- A canonical child born after discovery reaches age 18 without method knowledge, learns notation from a living teacher, reads the record inherited after the inventor's death, and operates the machine through ordinary goals/actions. Nine-year loaded continuation matches uninterrupted execution exactly. The eighteen intervening years use the existing daily Epoch cadence, with fine-grained learning/operation and disclosed favorable adult conditions.
- Seed 17, three settlements, 1,800 physical seconds: Juniperstead 17.394586 mechanical flour / 2 method holders; Stonehaven 0 / 0; Ivesford 8.828571 / 1. Shared rules; no outcome keyed by settlement identity.

## Verification

- Focused capability/demographics: 12/12 passed at the first checkpoint.
- Final focused capability: **8/8** passed, including access, skill separation, mass costs, copying, destruction, reproduction, shared practice/loss, explicit operation provenance, replay and save/load.
- Final separate acceptance: **2/2** passed in 43.75 seconds, including eighteen-year continuity, exact nine-year loaded continuation and three-settlement divergence. Data: .debug/continuity/generation.json and divergence.json; log: .debug/continuity-final-accept.log.
- Long-run energy ledger error: **5.64e-8 J**. Household invariants and kernel restoration pass in acceptance.
- First full normal run: 728 passed / 6 timeout failures, no assertion failures. Failed files plus new capability checks then passed **97/97** with two workers. Normal Vitest concurrency is now bounded at two; timeouts and assertions were not relaxed.
- Final normal regression: **734/734 tests across 68 files passed** in 610.30 seconds. TypeScript checking and the production Vite build passed. Logs: .debug/continuity-final-regression.log and .debug/continuity-build.log. No verification jobs remain running; no runtime changes followed these checks.

## Remaining boundaries and historical failures

Limited linear mechanical graphs, declarative notation, seeded adult education/supplier priors, coarse Epoch stepping, simple workplace permissions, no autonomous reverse engineering/general machinery repair, and approximate weather collection geometry remain the main constraints. No claim of guaranteed transmission, survival, institutional durability, settlement viability or monotonic progress is made.

Older failures remain disclosed: Ashford's prior 30-day result had 25/32 at zero caloric reserve (not death); specialized adaptive acceptance was 8/9 with shortageEased failing at tests/adaptive-society-longrun.test.ts:132. Neither was rerun or declared fixed here. See docs/LIVING_ECONOMY_SURVIVAL.md and the prior Living Universe report.
