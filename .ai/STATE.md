# Living Economy & Survival

Started from current main `31a9782`. Implementation is frozen. **Primary survival target not met:** final Ashford has 25/32 residents at zero energy versus 13/32 on untouched main. Zero energy is the caloric reserve floor, not death. No starvation death or permanent deprivation injury was added. Full mechanisms, results, limits, and verification: `docs/LIVING_ECONOMY_SURVIVAL.md`.

## Implemented

Canonical local household pantry/purse actions, including personally owned surplus; observed poverty/shortage responses through existing goals and bounded knowledge; wholesale payment before title transfer; delivered-leg wages; workplace operator continuity; ownership, reservation, and spoilage fixes; grain/fuel brewing; finite local procedural game. Corrected sleep fatigue recovery, action-based exertion, hungry producer/input goals, crop concerns, and the arbitrary grain harvest cap. Haul progress and terrain constraints use shared player/NPC mechanics. Save schema 20 rejects older incompatible initialization. No currency creation or periodic redistribution.

Access corrections include height-aware counter navigation, bounded distance-scaled searches, failed-travel handling, terrain-valid crowd separation and rest anchors, and local navigation refresh after crop projection. These remove false economic failures caused by stranded workers. Focused reproductions failed before each fix. The site 0 farmer's stale blocked navigation cell was confirmed by a live/reloaded-world comparison and a fresh four-day recovery run.

Observer/fixture corrections preserve canonical semantics: motive traces distinguish completed material favors from intentions and respect the existing protected pursuit dwell window; the direct regression checks protection at 44 world minutes and promotion at 46. The crop-loss scarcity fixture removes standing crops as well as stored food, because labor could recover the former stores-only shock. No canonical priority rule was changed to satisfy an observer.

## Final measured outcomes

Seed 918271, 0.15-second physical steps, 30 world days, all implementation runs on current runtime:

| World | Zero energy | Below 2 silver among zero-energy residents | Median energy | Bread | Total currency start → end | Hash |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ashford baseline | 13/32 | — | 0.382 | — | 1550 → 586 | — |
| Ashford implementation | 25/32 | 23 | 0 | 45 | 1550 → 1550 | `77a4399b` |
| Procedural site 0 | 11/22 | 11 | 0.017 | 41 | 715 → 715 | `40f5940f` |
| Procedural site 3 | 3/15 | 1 | 0.353 | 26 | 704 → 704 | `ac07a3e7` |

Currency includes all wallets, household purses, and coin items. Site 3 has negligible floating-point noise. Global bread totals do not establish individual access. Final reports: `.debug/economy/{Ashford-final-918271-30d,site_0-918271-30d,site_3-918271-30d}.json`; baseline `baseline-918271-30d.json`. Ashford full save: `Ashford-final-30d.save.json`. Generated artifacts are ignored; the milestone report preserves summary data. Earlier checkpoint hashes/results are superseded.

Ashford circulation: retail 2685, wholesale 1799, wages 1108.93, 590 home meal deposits; 1779 unaffordable purchase attempts. Bandit cash 90 → 448. Conserving currency fixes an artificial sink but does not establish adequate household purchasing power. Site 3 had no zero-energy residents at sampled times through day 24, then 1 at day 28 and 3 at day 30. Do not describe these results as normal viability or proven systemic collapse.

All six Ashford farmers, its hunter, and its woodcutter finish at zero energy. Farmer wallets total 3.77 silver; bakers 522.25, merchants 232.14, miller 141. Grain 2309/flour 49 remain. Productive-labor income and food use remain central gaps; missing civic wages alone do not explain the failure.

## Verification

- Final build/typecheck PASS: `.debug/living-economy-final2-build.log`.
- Final full regression **691/691 across 64 files PASS**, 338.65 seconds: `.debug/living-economy-final2-suite.log`.
- Final causal acceptance **7/7 PASS**, 274.55 seconds: `.debug/living-economy-final2-causal.log`.
- Final adaptive acceptance **8/9 PASS, 1 FAIL**, 565.91 seconds: `.debug/living-economy-final2-adaptive.log`. Existing `6. the shortage eased without being cured` fails at tests/adaptive-society-longrun.test.ts:132 because acceptance.shortageEased is empty. Replacement production and earned skill checks pass, but the daily bakery flour-stock recovery is not observed. Root cause not isolated. Assertion, seed, and duration are unchanged; do not label the suite passed.
- All three final 30-day economy runs complete.
- Targeted navigation/player-embodiment/living-economy/pathfinding-livelock 54/54 and crop lifecycle 4/4 passed before final suite. No runtime changes after final build/regression. Documentation edits do not invalidate those checks.

All final jobs have ended; session 80970 exited 1 at the adaptive acceptance failure. No agents or intentional jobs remain. The user asked how much testing remained; final testing is finished for this incomplete checkpoint. Do not rerun unchanged broad suites or probes. No subagents were used; latest developer instructions prohibit unsolicited delegation.

## Limits and next coherent work

Sustained fiscal/service income, continuing consumption demand for some crafts, and household food preparation from raw grain remain incomplete. Nutrition, storage, credit, and inheritance are coarse or absent. Food and labor can fail for real reasons, but incomplete income/distribution mechanics still contribute. Do not add permanent deprivation consequences or claim the primary milestone achieved. Next economic work needs sustained earned income and usable household food, not a target survival rate or unconditional transfers.

The specialized adaptive recovery regression also remains open. A future focused diagnosis needs retained downstream/haul/payment observations from that scenario; the final test log contains the assertion result, not the complete in-memory trace. Do not assert a specific cause or weaken the recovery requirement without evidence.

Preserve pre-existing user edits in AGENTS.md, .ai/TESTING.md, .github/workflows/pr.yml, and changed-test package scripts. No commit or push requested or made.
