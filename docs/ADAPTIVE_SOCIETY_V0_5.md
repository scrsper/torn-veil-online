# Adaptive Society (v0.5 of the social line)

> Naming note: this milestone was commissioned as "Adaptive Society v0.5". It follows Causal
> Society v0.4, which follows v0.9 (Social Causality) and v0.10 (Motivated Lives) in the
> repository's main version line. The file is named for the milestone, not for a version of the
> whole project. The unrelated `docs/V0_5_HUMAN_PHYSIOLOGY_AUTONOMOUS_ECONOMY.md` is the *engine*
> v0.5 and predates this.

What a future maintainer needs to know about what this milestone added, why each piece is the
smallest addition that could work, and the invariants that keep it honest. Everything else is in
the source comments.

## The problem it addresses

Causal Society closed the gap between the physical economy and the social one. Kill the miller and
the chain now runs the whole way: the mill stops, no flour reaches the bakery, the baker finds his
bin empty and holds a first-hand belief about it, people he tells hold a weaker second-hand one,
somebody infers that the killing is *why*, and a worry about flour bends what they do next.

And then, in every run, it stopped there for good. **A vacant productive role stayed vacant
forever.** The village could grieve its miller, gossip about him, work out who was to blame, and
starve. It could not grind grain.

The reason was one line, in `mind/agent.ts`'s `work` action:

```ts
if (p.occupation === 'miller' && t === 'mill') { /* run a batch */ }
```

The mill's work did not merely lack a worker. It had ceased to exist, because the only thing that
could make a batch happen was a person carrying the string `'miller'`, and the world had just
destroyed the only one. This is Constitution invariant **IX — capability over labels** — inverted:
the label was not summarising the mechanics, it *was* the mechanics.

## What was built

Three modules and one deletion. The deletion is the important part.

| Where | What |
|---|---|
| `sim/world/labor.ts` | Which places have a real input→output process, who is fit to work them, whether a post's work is going undone — all **derived**, nothing stored |
| `sim/mind/succession.ts` | How plausible it is that a given person would take up work nobody is doing. Returns a number and its reasons. Decides nothing |
| `sim/mind/apprenticeship.ts` | One person showing another how a trade is done. Writes a belief. Grants no proficiency |
| `sim/core/skills.ts` | `milling` as a real learned capability, the novice yield/time penalties, and instruction's effect on practice |
| `sim/mind/agent.ts` | The occupation gate **removed**; a stand-in candidate added as one ordinary goal among twenty-five |

### 1. Vacant work is derived, not flagged

Nothing anywhere writes "the mill is vacant". `tradePostAt` computes it, every time it is asked,
from three canonical facts that are already true or false whether or not anybody asks:

* **staffing** — nobody on the place's own `workers`/`ownerId`/`workId` staff is currently fit
  (`unfitReason`: `dead`, `gone`, `incapacitated`, `badly hurt`, `held`, `away`, `spent` — which
  between them cover all four of the milestone's routes to a vacancy);
* **demand** — the place is still under its own reserve AND carries a standing production request
  (`world/production.ts` raises one only from real stock below that reserve, but nothing closes a
  request except somebody completing it, so both halves are needed);
* **output** — and it has been failing to answer that demand for `STOPPAGE_HOURS`, measured from
  the later of its last completed batch and the moment the oldest standing demand was raised.

Two of those refinements came out of running the *undisturbed* village rather than out of design,
and both were false positives worth recording:

* the mill legitimately stands quiet for days when its flour bin is full, and a stale request
  raised a week earlier was enough to make that quiet read as a stoppage. Hence "failing to answer
  the demand it has", not "has not produced lately";
* at seven in the morning the miller's exertion capacity is briefly under the floor — he has not
  eaten yet — which made a man standing at his own stones read as a lost trade. Hence
  `TRANSIENT_STOPPAGE_HOURS`: a merely *spent* workforce has to leave the work undone for two full
  days before it counts, where a dead, hurt, held or departed one counts after fourteen hours.

With both in place, an eight-day undisturbed run reports no work going undone at all, which is the
correct answer for a village where nothing has happened.

Delete `labor.ts` and no world state changes. That is the test of whether a derived view is really
derived. `p.occupation` does not appear in the file.

**Cost.** Everything in the demand/output half reads the whole item list and the whole request
list, so `tradePostAt` returns early the moment it finds one fit staff member — a healthy village
pays for none of it. That is not a micro-optimisation: without the gate, four full scans per
productive place per coarse pass added roughly a tenth to the whole test suite's CPU, which was
enough to starve a neighbouring test with a five-second budget until it timed out. The same
reasoning put a cheap `workId`-based prefilter in front of the `work` action's `placeAt` scan and
a precomputed awareness set (`peopleAwareOfShortage`) in front of `standInCandidacy`.

### 2. Who may work is capability and circumstance, never a label

`workAuthorization` has two answers and no third: **you work here** (the place is yours, or you
are on its staff), or **the work is going undone and you are in a state to do it**. An unattended
mill with grain in it, in a village asking for flour, is available in a way a working mill with
its miller at the stones is not.

A `WorkStint` is opened only *after* a batch has already produced something, which is precisely
what keeps it provenance rather than permission — it cannot have been the thing that allowed the
batch it records. Nothing in the authorization path reads one.

### 3. Who responds emerges; it is not selected

`standInCandidacy` scores one person against one post. `mind/agent.ts` turns the score into one
more `work` candidate and lets it compete with sleep, hunger, their own shift, their own errands
and everything else. There is no successor list and no assignment step. Four properties make it
adaptation rather than scripted replacement, and each is asserted by a test:

1. **Nothing consults who is missing.** No branch reads the lost worker at all. A post is a post.
2. **Awareness is required and is ordinary knowledge.** Somebody who has not *learned* that
   anything is short scores zero by short-circuit. This is why the nearest idle villager is
   usually not the responder — they have no idea. (Constitution invariant III.)
3. **The score is a sum of independent pressures**: awareness 0.22, capability 0.26, proximity
   0.14, household/obligation 0.16, economic need 0.10, opportunity 0.12, all multiplied by real
   physical capacity. None reaches the threshold alone, so changing any one circumstance can
   change who answers.
4. **Nobody may be plausible**, and then the shortage stands. See the failure case below.

### 4. Learning through work

`milling` joined `SkillId` — it was the one production process in the village with no learned
capability behind it, which is exactly why a lost miller could not be replaced by a *worse* one:
there was no worse to be.

* One real successful batch is one unit of practice (`practiceSkill`), on the same
  diminishing-returns curve everything else uses. A batch that fails trains nothing.
* A novice gets **less out of the same input**: `tradeYield` gives a complete novice half a
  batch's output, rising to the full ratio at `TRADE_BASELINE`. The grain is consumed either way —
  badly ground meal is still ground.
* A novice **takes longer**: `tradeBatchSeconds`, up to 1.75× at zero proficiency. That is where
  their higher time-and-energy cost comes from; no second rule was invented for it.

`TRADE_BASELINE = 0.6` is sized at exactly the proficiency Ashford's seeded tradespeople start
with, so **the working village behaves precisely as it did before this milestone** and every
penalty is paid only by people who genuinely have not learned the work.

### 5. Apprenticeship is provenance, not a level

`teach` writes one `technique` belief into the student's knowledge map with the teacher on its
`source`. That is the whole apprenticeship: who taught whom, in the student's own head, with the
same provenance machinery every other belief carries — so it survives a save, decays if unused,
and could be told on to a third person.

It raises **no** skill. All it does is make subsequent real practice count for more
(`instructionFactor`, read only by `practiceSkill`). A student who is taught and never works is
mechanically identical to one who was never taught.

One finding worth recording, because the first version got it wrong: teaching originally fired for
anyone standing near the work, which produced **28 lessons in a 22-day unattended run** — to a
priest, a smith, a child and the village elder, not one of whom ever went near an oven again.
Instruction with no work behind it is not instruction; it is an event log of proximity. The
student must now be at the work too (their goal is this place's work, or they hold an open stint
here). The acceptance run consequently reports zero lessons, which is honest: on that seed the
only skilled miller died before anyone came to learn from him.

### 6. Occupation follows capability, not the other way round

`recogniseClass` (unchanged in structure) now counts `milling` among the makings. A person who
takes up the mill because nobody else will, and grinds at it for a season, may eventually read as
an Artisan — *because of the work*, and after it. Renaming somebody `'miller'` changes nothing
they can do, nothing they are authorized to do, and nothing about their yield. There is a test
that does exactly that and asserts nothing moves.

## Verified recovery chain (the unattended run)

`npm run adapt:accept` — seed 918271, 30 world days, no player embodied, one seeded happening
(a bandit's killing blow through `Simulation.applyHit`). Recorded output, not narrative:

```
day 100  Hobb Grist, the village's only miller, is killed on the east road
day 100  his last batch of flour; the mill produces nothing for the next 11.9 days
day 104  the mill reads as under-served: "Hobb Grist is dead", 16 flour wanted
day 112  Mara Bramble finds the bakery's bin empty — first-hand, confidence 1
day 112  Osric Bramble finds the same, and infers "no flour because Hobb Grist was set upon"
         (inferred, confidence 0.46, 2 hops — weaker than what it was drawn from)
   ...   SEVEN people become plausible responders over the run: Mara 0.535,
         Fenn Muddle 0.301, Osric 0.302, Greta Hollis 0.305, Father Aldous 0.301,
         Hale Dorn 0.307, Alwin Hollis 0.303
day 112  Mara — eighteen, a baker, milling proficiency 0 — takes up the mill
         "because the old mill is standing idle and flour is wanted"
   ...   22 batches over the rest of the run, 2 flour each against Hobb's 4
   ...   24 batches of flour in all since the loss, averaging 2.46 units against his 4
   ...   28 batches of bread once the mill was turning again
day 129  flour is reaching the bakery again: 0 at the worst on day 127, 3 on day 129
end      Mara's milling: 0 → 0.283. Two people still carry a supply worry.
```

Fenn Muddle got one batch out of the mill, stopped, and came back ten days later — beginning that
second stint at exactly the 0.015 his own first batch had earned him, which is the clearest
statement the run makes that proficiency belongs to the person and not to the record.

**The recovery is partial, and it is meant to be.** The bakery's bread stock never climbs back out
of nothing: the loaves are eaten as fast as the trickle of flour allows them to be baked. A
village that loses a lifetime's proficiency and replaces it with an eighteen-year-old's first
month does not get its bread back at the old rate, and the acceptance deliberately does not
require that it should — it requires that flour reached the consumer again after the worst of it,
that bread was baked again, and that people are *still* worried at the end.

The trace, walked back:

```
Mara Bramble chose to work at the old mill  [utility 0.75]
  because Mara Bramble is short of flour at Bramble's Bakery  [intensity 0.98]
    because there is no flour at Bramble's Bakery  [I found it so myself, confidence 1]
      because no flour because Hobb Grist was set upon  [inferred, confidence 0.46, 2 hops]
      because Skarn attacked Hobb Grist  [told by Pip Hollis, confidence 0.61, 2 hops]
```

## The failure case

`tests/adaptive-society.test.ts`'s "a society may simply fail to adapt": a stopped mill, open
demand, grain physically in the hopper, and two able-bodied people standing in the village who
have simply never learned that anything is wrong. `plausibleRespondersTo` returns an empty list.
Ninety seconds of simulated time later there are no stints, no `work_taken_up` event, and no
flour. The grain is still grain.

This is not a gap. Societies fail, and a mechanism that could not fail would not be a mechanism —
it would be the scripted replacement this milestone exists to avoid.

## Invariants

Breaking any of these should require deleting a test.

1. **No vacancy flag.** Under-servedness is recomputed from staffing, demand and output every time
   it is asked. Nothing stores it.
2. **`p.occupation` never grants capability, authorization or yield.** It is not read in
   `world/labor.ts` at all.
3. **A `WorkStint` is a record, never a permission.** It is opened after the first successful
   batch, and no authorization path reads one.
4. **No candidacy without knowledge.** `standInCandidacy` returns null for anybody holding no
   belief that connects them to the shortage.
5. **A lesson is not a level.** `teach` never writes to `skills`.
6. **Skill rises only from batches that actually produced something.**
7. **A settled tradesman pays no novice penalty**, so introducing this changed nothing about the
   working village.
8. **A stand-in goal is capped** (`MAX_STAND_IN_UTILITY`) below a physiological emergency, and
   reaches utility through the one existing bridge (`motivationBoost`) like every other motive.
9. **Nothing here proposes a goal that walks somebody toward another person.** The v0.9
   justice-concern discipline, unmodified.

## One deliberate widening, and why

`concernGoalBoost`'s supply→`work` rule used to require `tradeMakes(p.occupation, resource)` — a
person's *label* had to be one that makes the missing material. That is the same §IX inversion in
a second place: somebody capable of milling, standing at a mill nobody was working, got no help
from their own worry because their occupation said otherwise.

A `work` goal now qualifies if it **declares** the material it would produce, which only a
stand-in candidate does, and which is grounded in a real place with a real canonical process
behind it. The old label path is kept as the fallback for goals that declare nothing (an ordinary
scheduled shift), because a miller turning up to the mill because flour is short is a true and
useful boost. It is now the weaker of the two readings rather than the only one.

## Scope held

Not built, and named in the milestone's own limit: inheritance, governments, guilds, schools,
businesses, migration, classes, XP, combat, magic, Unreal, dialogue, or any new economy
architecture. Two processes are in the trade table (mill, bakery) and the rule for adding a third
is written above it. The gathering trades (herbalist, hunter, innkeeper, the cook's hearth) were
deliberately left occupation-gated: they are somebody's own stall and their own stock, with no
input to be short of and nothing for a stand-in to take over.

## Running it

```bash
npm run typecheck
npm test                    # 563 tests, includes tests/adaptive-society.test.ts (22)
npm run adapt:trace         # the readable report, 30 world days (~4 min)
npm run adapt:trace -- --scenario undisturbed --days 8   # the no-false-vacancies check
npm run adapt:accept        # the same run as a pass/fail acceptance suite
npm run causal:accept       # Causal Society's own acceptance, unaffected by this milestone
```
