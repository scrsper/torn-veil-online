# The deprivation question: what was measured (work order 2, Track C, step 1 of 3)

This records **evidence only**. The decision about whether Ashford is allowed to starve is the
project owner's; steps 2 (propose a consequence model) and 3 (blast radius) are not done.

## The disagreement, resolved

Two measurements appeared to conflict:

- The previous pass reported "every person sits at energy 0.000, hydration 0.000, health 1.000 for
  the entire run", measured at **coarse cadences** (5, 20, 60 and 1440 physical seconds per step)
  out to day 30.
- An independent probe at **play cadence** (0.15 s substeps) out to day 20 measured median energy
  holding at 0.37–0.44 with a growing minority at zero (0 → 9 of 32).

Re-measured at play cadence, across the seed matrix, out to 30 world-days — the run the previous
pass never completed:

| seed | day 12 energy med / at-zero | day 28 energy med / at-zero | day 28 hydration med / at-zero | meals | water |
|---|---|---|---|---|---|
| 918271 | 0.351 / 6 | **0.079 / 16** | 0.574 / 0 | 1149 | 2002 |
| 918272 | 0.298 / 7 | 0.188 / 10 | 0.676 / 1 | 1150 | 1964 |
| 1337 | 0.425 / 6 | **0.076 / 15** | 0.752 / 1 | 1082 | 1991 |
| 42424242 | 0.178 / 14 | **0.000 / 17** | 0.597 / 0 | 998 | 1951 |
| 12345 | 0.407 / 5 | 0.314 / 12 | 0.545 / 0 | 1150 | 1920 |
| 1 | 0.243 / 9 | 0.282 / 14 | 0.808 / 0 | 1079 | 1984 |

(n = 32 living, non-controlled, at every sample. Health median 1.000 in every cell.)

**Both measurements were right about different points on one curve, and neither had run it far
enough.** It is not a uniform collapse and it is not a small stable minority: at-zero rises
monotonically to **10–17 of 32 (31–53 % of the village) by day 28 and is still rising**, on every
seed. The independent probe stopped at day 20 with the trend climbing; the previous pass measured a
cadence at which the curve is already at its asymptote.

## Which failure it is

**Not supply.** ~1,000–1,150 meals are eaten per run. Food exists and is consumed.

**Not behavioural.** Water uses the same seek-and-consume machinery, the same goal loop and the same
cadence, and it works everywhere: hydration median 0.55–0.86 at day 28, at-zero 0–1 of 32. The
difference between water and food is not how people decide; it is that water is free and unlimited
and food must be bought.

**Distribution, through money.** The depleted are almost without exception broke. Seed 918271 at day
28, every person at zero energy with their wealth:

```
Garrick Ironhand (smith, 1.0)      Wendel Crane (merchant, 0.0)   Petra Crane (merchant, 0.0)
Father Aldous (priest, 0.0)        Rowan Ashford (captain, 0.0)   Hale Dorn (guard, 2.0)
Dunstan Mole (guard, 0.0)          Brigid Tallow (guard, 1.0)     Greta Hollis (farmer, 0.0)
Pip Hollis (child, 0.0)            Nell Fletcher (farmer, 0.0)    Maud Penny (farmer, 0.0)
Kestrel (hunter, 0.0)              Bors Ashwood (woodcutter, 0.0) Elder Godwin (elder, 0.0)
Skarn (bandit, 290.0)
```

Fifteen of the sixteen hold between 0 and 2 silver. The sixteenth is an outlaw with 290 who does not
shop. This is the same phenomenon WorldLab's `cannotAffordAnyMeal` and the v0.8 audit already
report from the other side, and it is progressive: as spendable wealth drains, people fall out of
the market one at a time and do not come back.

Measured **after** the wider trade economy landed, as the work order asks. Widening the process
table did not change the shape.

## What follows, and what does not

The order's conditional ordering resolves toward the second branch: a real and growing subset
starves while the median holds and while water works, so a deprivation consequence would be
measuring something true about the economy rather than modelling a broken food supply. But the
subset is 31–53 % of the village by day 28 and still climbing, not the ~28 % the independent probe
saw at day 20 — so "a graded, recoverable health penalty with death at the end of a long curve"
would, on this evidence, put a third to a half of Ashford onto that curve within a month of
simulated time, on every seed in the matrix.

**Not proposed here.** The consequence model and its blast radius are steps 2 and 3 and were not
reached.

## The incidental finding, checked

Minimum health among the living sits at **0.01, constant**, on four of six seeds — and it is not the
combat-cadence work. `Simulation.applyHit` sets `health = 1` (one point, not one percent) on a
non-lethal downing, and `bodyPhysics` restores to `maxHealth * 0.3` only when the body actually
stands back up. A body held down — surrendered, in custody, or subdued — never takes that path and
is explicitly excluded from strategic health regeneration too ("a subdued or in-custody body does
not regenerate health from strategic upkeep while held"). So a detainee sits at 1 point of health
for the length of their detention by design. Seeds 1337 (min 0.47) and 918272 show the ordinary
picture where nobody is held.

It is nonetheless a real input to everything Track C measures: `physiologicalFitness` reads
`health / maxHealth`, so a person parked at 1 % is at ~0 reproductive and survival fitness for the
whole time they are held. Worth a decision alongside the deprivation model rather than separately.
