# PR gate disposition — PR #51 run 35918658515 (2026-09-23)

The hosted `PR gate` job failed `npm test` with six timeouts (5 files), so its later steps
(`build:bundle`, `world:smoke`) never ran. Nothing was retried with a larger timeout.

## Reproduction on the same revisions, same host, same command

Pushed PR head `0346386` and `main` `5171eba` were extracted into clean trees (`git archive`,
shared `node_modules`) and the five files were run alternately main → PR → main → PR, one at a time,
with the repository's own Vitest configuration (Windows 11, Ryzen 5 9600X, Node 22.23.2).

| Test (file) | CI budget | CI observed (PR) | main run 1 / 2 | PR run 1 / 2 |
|---|---|---|---|---|
| agency WorldLab replays deterministically (agency-worldlab) | 5 s | >5.0 s | 2.55 / 2.65 s | 2.56 / 2.59 s |
| same demand admits … (918271) (causal-pressure) | 5 s | 6.21 s | 2.79 / 2.83 s | 2.83 / 2.91 s |
| same demand admits … (44017) (causal-pressure) | 5 s | 5.94 s | 3.06 / 2.94 s | 2.93 / 2.88 s |
| determinism: identical canonical hash (embodied-economy) | 5 s | 5.07 s | 2.48 / 2.49 s | 2.57 / 2.56 s |
| three settlements diverge (living-universe) | 30 s | 34.23 s | 18.22 / 17.72 s | 17.26 / 18.29 s |
| far horizon vista (playable-vista) | 5 s | 7.10 s | 3.19 / 3.28 s | 3.16 / 3.18 s |

All 72 tests in the five files pass in all four runs. Durations are indistinguishable between
`main` and the PR head (differences are within run-to-run noise in both directions).

## History of the hosted gate

The same tests time out on the hosted runner for every PR since at least 2026-09-17, including
branches that were subsequently merged into `main` (runs 35296350190 slice 3, 35313434573 Foundry
slice 4, 35460244009 Foundry real assets). The hosted runner is roughly 2× slower than this host
for these CPU-bound single-thread simulations.

## Disposition

Environment-specific wall-clock baseline failure of the hosted runner, **not a regression** in PR
#51. Assertions and timeouts are unchanged. The skipped gate steps are run locally for each slice
and recorded in `docs/LIVING_ALPHA_RELEASE.md`. Making the hosted gate green requires either a
faster runner or an explicit, reviewed decision about CPU-scaled budgets; neither is taken here.
