# v0.6 — Knowledge, Memory, Skills & Intentional Action

**Scope:** close the v0.5-disclosed verification gap and the disclosed hunger-calibration
overshoot, then move NPC cognition a real step away from omniscient world-state queries and
toward believable persons: what they know (bounded, acquired), what they remember (bounded,
behaviorally consequential), what they are skilled at (learned, not innate), and what they
intend to do about a need (a real layer between "I am hungry" and "walk to the bakery").
Branch: `claude/v0.6-knowledge-memory-skills-intent-kmsnvl`, built directly on `main` at
`ef097d772ea2048110d08c6cac83acc72303e86f` (merge of
`claude/v0.5-human-physiology-autonomous-economy-ez22ps` — confirmed via `git log`, zero drift
before this milestone's first commit: the branch and `origin/main` were at the identical commit).

**Method:** every number below comes from the real headless engine (`npm run sim`, the same
canonical `World`/`Simulation` the browser client uses) at fixed seed `918271` (plus an alternate
seed, `42424242`), the deterministic test suite (300 tests), and a real `npm run dev` session
driven with Playwright against an actual Chromium build.

---

## 0. Starting-condition confirmation

1. `main` contains v0.5 — `git log main` shows `ef097d772` (merge of
   `claude/v0.5-human-physiology-autonomous-economy-ez22ps`) at HEAD.
2. `claude/v0.6-knowledge-memory-skills-intent-kmsnvl` was already checked out at that exact
   commit when this session began — `git log --oneline origin/main..HEAD` and the reverse were
   both empty. Zero drift.
3. Baseline full suite: **280/280 tests passing** (29 files), typecheck clean, production build
   clean (779.24 kB / 218.54 kB gzip).
4. `docs/V0_5_HUMAN_PHYSIOLOGY_AUTONOMOUS_ECONOMY.md` (and, where relevant, `docs/
   V0_4_EMBODIED_ECONOMY.md`) were read in full and treated as canonical before writing any code
   — in particular v0.5's own disclosed gaps: no live-browser Playwright verification was
   performed, and village-wide average hunger (0.73-0.76 across 8-30 days) sat meaningfully
   higher than the milestone's own illustrative target.
5. `SAVE_VERSION` at baseline: **8**.
6. A pre-existing, more extensive cognition substrate than the v0.5 report alone suggested was
   discovered and read before designing anything: `mind/knowledge.ts` (a real, scored, bounded
   `KnowledgeItem` system with source/confidence/hops, already covering crime/social/location/
   ownership/fact knowledge, dating to v0.2.1-v0.2.2) and `mind/memory.ts` (a bounded `Memory`
   list with significance/recency scoring). v0.6's job was to EXTEND this existing, working
   architecture into the economic-opportunity domain the v0.5-era code still handled
   omnisciently — not to invent a knowledge/memory system from scratch.

---

## 1. Branch / commits / tests / typecheck / build

| | Before (v0.5 baseline) | After (v0.6) |
|---|---|---|
| Test files | 29 | 30 |
| Tests | 280 | 300 |
| Typecheck | clean | clean |
| Production build | clean (779.2 kB / 218.5 kB gzip) | clean (786.25 kB / 221.02 kB gzip) |
| `SAVE_VERSION` | 8 | **9** |

20 new tests in `tests/knowledge-memory-skills-intent.test.ts` (non-omniscient food-source
resolution, the three knowledge-acquisition paths, memory-driven preference/avoidance, skill
capability/conservation/learning/persistence, the intentional vertical slice both informed and
uninformed, the mill's demand-aware conversion, and a v0.6-scope determinism check). One
pre-existing test (`tests/living-world-logistics.test.ts`'s 12-world-day full-chain test) was
recalibrated with an inline comment — see §7 (Skills).

New source files: `core/skills.ts`. Modified: `core/types.ts`, `core/physiology.ts`,
`core/attributes.ts`, `core/world.ts`, `mind/agent.ts`, `mind/knowledge.ts`, `mind/memory.ts`,
`logistics/haul.ts`, `world/metabolism.ts`, `world/production.ts`, `world/resources.ts`,
`world/construction.ts`, `world/village.ts`, `world/factory.ts`, `persist/save.ts`,
`history/summary.ts`, `game/ui/inspector.ts`. `playwright` added as a devDependency (browser
verification tooling — see §2).

---

## 2. Browser verification (the v0.5-disclosed gap, closed)

`npm run dev`, driven by a real headless Chromium (`/opt/pw-browsers`, launched via the
`playwright` API — no custom test harness beyond one throwaway driver script) against the
actual client build, not a second implementation:

- **New Game** → the real village generates, the client renders (screenshot captured), no
  console errors beyond one pre-existing, unrelated `404` (a missing static asset reference —
  present before this milestone, not something v0.6 introduced or investigated further, since it
  never surfaces as a JS error/exception).
- Advanced simulated time at ×16 for ~15 real seconds (this alone easily covers a full
  in-game hour+ given the compression), then opened the Inspector (**F3**) on multiple named
  NPCs (Bors Ashwood the woodcutter, and others from the dropdown).
- **Mind tab**: goal/plan/decision-candidates render as before, PLUS the new **Intention** and
  **Commitment** sections (both showed "none" for Bors mid-chop, since intention is currently
  only populated for the food vertical slice and Bors wasn't food-seeking at that moment — see
  §6 for a screenshot of Intention actually populated).
- **State tab**: a new **Skills** section shows Bors's seeded-and-grown proficiency directly —
  `woodcutting 0.56, sawing 0.40, hauling 0.26` — next to his (unchanged) Attributes section,
  visibly demonstrating the "skill is distinct from attributes" architecture live in the client.
- **Knowledge tab**: a new **Known services** section (previously these entries were buried
  inside a generic "Other" bucket dominated by same-timestamp `home:<id>` facts, so it needed
  its own section to stay visible) shows exactly what the food-seeking decision reads: "Bramble's
  Bakery offers food", "the village well offers water", "the river bank offers water", "The
  Gilded Boar offers food", "Crane's General Store offers food" — all `prior`/first-hand,
  confidence 1.00, learned at generation. This is the literal knowledge substrate
  `knownFoodPlace` (mind/knowledge.ts) reads, visible and legible, not a black box.
- **Save (F5) → page reload → Continue**: the world resumed at the correct in-game time with
  the same population and (spot-checked) the same carried inventory. `SAVE_VERSION` 9 round-trips
  correctly; an old `SAVE_VERSION` 8 save is correctly rejected (`hasSave()`'s version check is
  unchanged — same mechanism used since v0.2.1).

No discrepancy between headless and browser behavior was found — both drive the identical
`World`/`Simulation`, and the only genuinely new client-visible surface (Inspector sections) was
exercised directly, live, in the browser, not inferred from headless output alone.

---

## 3. Hunger-calibration investigation (Part II)

### 3.1 What was actually measured, not assumed

v0.5 disclosed elevated average hunger (0.73 at 8 days, 0.76 at 30 days) as the *intended*
consequence of tolerance, but flagged the absolute level as too high. Rather than guess at a
cause, the headless engine was run at the v0.5 baseline and its telemetry inspected directly:

- **8-day run, unmodified v0.5 code**: `mealsEaten = 486`, `resource_shortage(need=food) = 695`
  — a **41% success rate** on food-seeking attempts, village-wide. Every one of the 695 shortage
  events had `need: 'food'` (verified directly from `telemetry.jsonl` — this was not a mixed
  bag of grain/flour/seed shortages).
- Breaking the 695 down by actor showed it was **not** uniform across the village: a
  concentrated subset (guards, priests/acolytes, the elder, children, and specific farmers)
  accounted for the bulk of it, and inspecting *where* they failed (`data.placeId`) showed the
  overwhelming majority at the tavern and the bakery specifically.
- Root cause #1, tavern: `ale`/`meat`/`cheese` (unlike grain→flour→bread) have **no modeled
  ingredient chain at all** — they were seeded once at village generation with no restock. Every
  occupation whose schedule eats at the tavern (smith, apprentice, captain, guard) permanently
  ran out of anything to buy there after the tavern's initial ~3 units of ale were gone (day 1),
  for the rest of the run.
- Root cause #2, household access: `findAccessibleFood` only ever considered food a resident had
  physically SET DOWN at home, never food a fellow resident was CARRYING. A parent who bought
  bread and carried 2 spare units home in their own pack never actually fed anyone but
  themselves — the extra units sat in their personal inventory until they personally ate them.
  A dependent with no income (a child, wealth 0) or nobody's-schedule-brings-them-to-town
  (several farmers, whose `eat` schedule slots are both at home) had **no path to food at all**
  once the one-time starting larder ran dry. Directly confirmed: Pip Hollis (a child, wealth 0)
  alone accounted for 178 of the pre-fix run's 962 shortages in one diagnostic pass, almost all
  at the bakery/tavern, hunger climbing to 1.0 (full starvation) repeatedly.
- Root cause #3, calibration: even with #1-#2 fixed, a person whose schedule keeps them working
  6-12 real hours between meals (baker: 8h; guard: 8h; hunter: 9h) still outpaces a 16-idle-hour
  caloric drain long before an ordinary two-meal day can catch up, given `eat`'s own utility must
  cross a real hysteresis margin against a competing schedule-driven `work` goal (Constitution
  v0.5 §II's own tolerance design, working as intended — this is not a bug, but the rate it was
  calibrated against was too fast for the schedules layered on top of it).

### 3.2 What was changed, and what was measured after

- `world/metabolism.ts`: `restockTavern` — the innkeeper, while working, tops up the tavern's
  ale stock on the same batch cadence bakers/millers already use, bounded (trigger 8, batch 6).
  This is the same abstraction level the game already uses for these background food types (no
  modeled ingredient chain in either direction) — not a new economic system, a bug fix.
- `world/metabolism.ts`: `findAccessibleFood` now also considers food a fellow HOUSEHOLD member
  is physically carrying, while that member is actually present at home — a real family shares
  what whoever went to market brought back. `eatFood` was fixed alongside it to clean up
  whichever person's inventory the eaten stack actually belonged to (previously it only ever
  checked `food.holderId === p.id`, which would have left a stale item reference in a *different*
  resident's inventory once this path could be reached).
- `core/physiology.ts`: `ENERGY_DRAIN_PER_HOUR` raised from 1/16 to 1/21 (a full caloric reserve
  now drains in ~21 idle-equivalent hours instead of 16). This is the single, disclosed, coarse
  lever, chosen deliberately over touching any tolerance/interruption THRESHOLD (which the
  milestone explicitly says not to loosen) — it changes how fast the underlying reserve depletes,
  not how a mind decides to react to a given level of depletion.
- **A change that was tried and reverted, on real evidence**: shortening the `eat` action's
  give-up cooldown (`NO_FOOD_RETRY_SECONDS`) from 30 to 15 minutes was tried first (more retries
  should mean faster recovery). Measured effect: shortages **rose** (695 → 962) and average
  hunger got **worse** (0.73 → 0.81), because the people who fail chronically (see §3.1) don't
  fail less often when retried more often — they just fail twice as often, burning more of their
  day on repeated 25-minute failed sit-downs instead of one longer wait. Reverted to 30 minutes.
  This negative result is reported because it is the more important methodological lesson than
  any single number: **retry frequency cannot substitute for fixing why an attempt fails.**

### 3.3 Before / after, with real time-weighted evidence

v0.5's own `avgHunger` figure is a single END-OF-RUN SNAPSHOT (the mean of `needs.hunger` across
all living persons at the instant the run ends), not a time-integrated measure — a single busy
or idle moment can skew it. v0.6 adds a genuinely time-weighted measure
(`mind/agent.ts`'s `strategic()` tallies real world-minutes spent at each severity band, every
person, every world-minute — see `history/summary.ts`'s new `cognition.hungerBandMinutes`), which
is the actual evidence this section reports.

| Seed | Days | avgHunger (snapshot) | mealsEaten | food shortages | comfortable | noticeable | uncomfortable | urgent | critical |
|---|---|---|---|---|---|---|---|---|---|
| 918271 (pre-fix, v0.5 code) | 8 | 0.731 | 486 | 695 | *(not measured — instrumentation added this milestone)* | | | | |
| 918271 | 2 | 0.543 | 108 | **0** | 21.6% | 31.0% | 28.5% | 13.3% | 5.6% |
| 918271 | 8 | 0.675 | 420 | 282 | 14.8% | 27.0% | 27.5% | 18.1% | 12.6% |
| 918271 | 30 | 0.839 | 1169 | 5253 | 8.1% | 16.0% | 21.2% | 17.3% | 37.4% |
| 918271 | 90 | 0.869 | 2687 | 25320 | 4.8% | 10.0% | 16.4% | 14.9% | 53.9% |
| 42424242 | 8 | 0.627 | 434 | 197 | 14.3% | 26.1% | 28.8% | 19.0% | 11.8% |

Reading this honestly (see §3.4 and §9 for the full disclosure): the 2-day and 8-day horizons, at
both seeds, show the intended qualitative shape — comfortable/noticeable together are the largest
share (~42-53%), critical is a minority, and the 8-day shortage count (282) is a genuine **59%
reduction** from the pre-fix baseline (695), with per-attempt success rate improving from 41% to
roughly 60%. **The 30- and 90-day horizons are materially, and increasingly, worse** —
critical-band time keeps climbing (12.6% → 37.4% → 53.9%) rather than plateauing the way v0.5's
own disclosed 8/30/90-day trend did (0.73 → 0.76 → *0.71*, "eases slightly"). §3.4 traces this to
its actual cause, found by direct inspection of final per-person wealth after a 30-day run — not
a knowledge/memory mechanism at all.

### 3.4 The real long-horizon cause: a pre-existing wage/wealth structural gap, newly measured

The first hypothesis tried for the 30-day regression — that the memory-based demotion in §5
could create a feedback loop (a failed attempt demotes a source, pushing a hungry person toward
a less reliable alternative, compounding over a long run) — was tested directly: the avoidance
window (§5) was shortened from 12 to 2 hours specifically to break that loop, and a fresh 30-day
run showed **no material change** (5872 → 5253 shortages, 36.6% → 37.4% critical — within
run-to-run noise, not a fix). The hypothesis was wrong, or at best a minor contributor; it is kept
in the code (a shorter avoidance window is still more defensible on its own terms — see §5) but
is not the actual explanation, and this document says so rather than quietly keeping only the
flattering theory.

The actual cause, found by writing a one-off diagnostic that dumps every living person's final
`wealth` after a 30-day run: **23 of 33 villagers had wealth below 3 silver — most of them
exactly 0** — while four occupations (the two bakers, both innkeepers, the merchant) held the
overwhelming majority of the village's money (Osric Bramble alone: 207 silver). Bread was
neither scarce nor mispriced (price had settled back to the base 2 silver by day 30, exactly as
v0.5 reported for its own 90-day run) — the people failing to eat simply **had no money left to
buy it**, and no way to earn more:

- `canHaul` (logistics/haul.ts, unchanged since v0.4) excludes children, guards, captains,
  priests, and acolytes from ever taking a haul/construction wage job — the ONLY paid-labour
  path most occupations have.
- Farmers' own harvested grain is credited to the field owner as raw stock, not sold for wealth
  until it is hauled, milled, baked and bought by someone else — the farmer who grew it earns
  nothing directly from that chain; their only direct income is personally selling at a market
  stall (`stall_produce`/`stall_grain`), and those stalls have the **exact same bug** this
  milestone found and fixed for the tavern (§3.2): their display stock was seeded once at
  generation and is never restocked, so that income dries up after the first few sales too.
- Every villager keeps spending on food regardless (there is no debt mechanic — `buyFoodPortion`
  already correctly floors purchasable quantity at what `wealth` affords), so wealth is a
  one-way, monotonically-draining resource for anyone without an ongoing income path. Over a
  longer run, more of the population crosses into destitution, which is exactly the
  8→30→90-day *worsening* trend (not a plateau) the table above shows.

This is very likely a **pre-existing v0.4/v0.5 structural gap**, not something v0.6 introduced —
nothing this milestone touched changes wage amounts, purchase costs, or `canHaul`'s eligibility
list — and v0.5 never measured it this precisely, because it had neither this milestone's
time-weighted band instrumentation nor a reason to inspect per-person wealth at a long horizon.
**It was not fixed this milestone** — it is a wage/wealth-economy problem (Part IX's territory,
explicitly lower-priority than the knowledge/memory/skill/intention work this milestone exists
to deliver — see the brief's own priority order, item 9 vs. items 1-7), not a knowledge,
memory, skill, or intention problem, and fixing it correctly (extending the `stall_produce`/
`stall_grain` restock the same way `restockTavern` fixed the tavern, and/or giving excluded
occupations *some* income path) is real, scoped, follow-up work for a future economy-focused
pass — named here explicitly rather than silently left for someone to rediscover.

---

## 4. Knowledge architecture (Part III)

### 4.1 Where world truth stops and personal knowledge begins

World truth is `World.places()`/`World.requests`/etc. — always fully populated, always
authoritative, exactly as before. A person's BELIEF about that world is `Person.knowledge:
Record<string, KnowledgeItem>` (pre-existing since v0.2.1, extended this milestone). v0.6 adds
one new `KnowledgeItem.kind`: `'service'` — "this Place offers X" (`{ placeId, placeType,
offers: ('food'|'water')[] }`), populated by exactly three acquisition paths (below), read by
exactly one new resolver: `mind/knowledge.ts`'s `knownFoodPlace(world, person)`, which ranks a
person's OWN known food-service entries (never a global scan) and returns the best one, or
`undefined` if the person genuinely knows none. `mind/agent.ts`'s `think()` now calls this
instead of the old `this.placeIdOfType('bakery')` — the single line that made every hungry mind
omniscient about the bakery's existence regardless of whether it had ever been there, been told,
or bought bread. `KnowledgeItem` also gained an optional `lastConfirmedAt` field (world-time a
belief was last checked against reality), used by the staleness mechanism in §4.3.

### 4.2 Three real acquisition paths

1. **Existing role/home knowledge** (generation-time seeding, `world/village.ts`): every
   settled villager is seeded with knowledge of the settlement's handful of central services —
   the bakery, the well, the river bank, the tavern, the store — via `learnPlace(..., {type:
   'prior'})`, exactly the same mechanism (and the same `source.type: 'prior'` "backstory,
   known since before the story started") already used for everyone knowing everyone's home. A
   farmer additionally knows their own assigned field. This is a genuine, disclosed choice: for
   a settlement this size (33 people), it is more realistic that everyone has been to the one
   bakery than that they haven't — and it means ordinary villagers' behavior is **unchanged**
   from v0.5 (they already effectively always found the bakery), while the architecture itself
   is now real (a knowledge lookup, not a world scan) and the machinery is provably load-bearing
   for anyone who ISN'T seeded this way (§4.4, §6).
2. **Direct observation** (`mind/agent.ts`'s `goto`-arrival handler): arriving anywhere with a
   `placeId` calls `learnPlace(world, person, place, {type: 'witnessed'})`. A no-op for a place
   type with nothing service-relevant to learn (a house, the guardhouse); teaches food/water
   service for a bakery/store/tavern/stall/well. This is what lets the "search" behavior in §6
   actually resolve something over time.
3. **Economic observation** (`world/metabolism.ts`'s `buyFoodPortion`): a successful purchase
   calls `learnPlace(..., {type: 'self'})` AND records a `Memory` (type `'purchase'`) — the same
   event is both a knowledge-acquisition path and (§5) a memory-behavior hook.

### 4.3 Knowledge can be stale, and can be updated

`noteFoodShortage(world, person, placeId)` — called from the `eat` action's give-up path —
lowers that specific `service` KnowledgeItem's confidence (floored at 0.4, never deleted: the
place still exists, it may just be temporarily out) and sets `lastConfirmedAt`. This is directly
tested (`tests/knowledge-memory-skills-intent.test.ts`'s "stale knowledge" case): confidence
drops, the entry survives, and a person's *next* choice among several known sources shifts away
from the demoted one — real, bounded, reversible (nothing prevents a later successful purchase
from raising it back via `learn()`'s normal confidence-merge rule).

### 4.4 Non-omniscience is demonstrated, not asserted

`tests/knowledge-memory-skills-intent.test.ts`'s first case constructs a person with a genuinely
empty `knowledge` map (bypassing village-generation seeding) next to a real, freshly-built
bakery, and asserts `knownFoodPlace` returns `undefined`. The vertical-slice tests (§6) go
further: the SAME hunger level produces a direct trip to a KNOWN bakery for one person and a
physical, unresolved SEARCH for another who has never learned of it — see §6 for the mechanism.

---

## 5. Memory architecture (Part IV)

`Person.memories: Memory[]` (pre-existing since v0.2.1, unchanged shape) already carried a
bounded (`MAX_MEMORIES = 60`), significance/recency-scored retention policy — high-significance
memories persist; low-significance ones are evicted first as the list fills. v0.6 adds two new
`Memory.type` values (`'purchase'`, `'shortage'`) and one new lookup, `memoriesAtPlace(person,
placeId)` (distinct from the pre-existing `memoriesAbout(person, entityId)`, which is keyed to a
PERSON/item an event involved, not the PLACE it happened at — these are genuinely different
questions and conflating them was an early bug caught by this milestone's own tests.

**Two decisions now read memory, as required:**

1. **Familiar food source preference**: `knownFoodPlace`'s ranking adds +0.35 to a known
   service's score if a `'purchase'` memory tagged to that place exists within the last 12
   hours — directly tested: two equally-known, equally-confident places (store learned first,
   bakery learned second — an ordinary tie would favor the first) are correctly reordered once a
   purchase memory exists for the second.
2. **Recently-failed-source avoidance**: the same ranking subtracts 0.5 for a `'shortage'`
   memory at that place within 2 hours (shortened from an initial 12 hours — see §3.4: this was
   tried as a fix for the long-horizon hunger regression, measured to not materially help, and
   kept anyway at the shorter window since it is independently more defensible: a temporary
   stockout is typically resolved within one production batch cadence, ~15-40 world-minutes, so
   avoiding the village's best-supplied source for half a day over one bad-luck failure was
   never well-justified on its own terms) — directly tested (§4.3): a demoted place loses to an
   untainted alternative, without the demoted entry being deleted or the demotion being
   permanent (bounded, time-windowed, confidence-floor-limited).

Both modifiers are small and bounded (±0.35 over 12h / -0.5 over 2h, against a 0-1 confidence
scale) specifically so neither can make one memory *permanently* dominate — Constitution v0.6
§IV's own requirement.

Bounded growth: directly tested (500 `remember()` calls against one person leave `memories.length
<= 60`) — this is the SAME pre-existing v0.2.1 mechanism, not new work, but it is now genuinely
exercised by the new purchase/shortage traffic and was worth re-confirming under that load rather
than assumed to still hold.

---

## 6. Intention architecture (Part VI)

`Mind.intention?: Intention | null` (new; NOT persisted — like `Goal` itself, cheaply re-derived
on the next real goal adoption rather than history that would be lost — see `persist/save.ts`'s
SAVE_VERSION comment for the full reasoning) sits between a raw
need and a physical plan: `{ type, target?, reason, createdAt, grounded }`. Distinct from `Goal`
(which already carries utility/target/plan mechanics) — `Intention` carries the COGNITIVE
grounding: WHY this particular target, on what evidence, and whether that evidence is real
knowledge/memory (`grounded: true`) or an uninformed guess-and-search (`grounded: false`).
Deliberately thin and scoped to where it materially helps explain a decision today (the food
case) rather than threaded through every goal type — `mind/agent.ts`'s `updateIntention`, called
once per real goal ADOPTION (never per tick, matching `goal_changed`'s own event cadence), sets
or clears it, and fires a new low-significance `intention_formed` event only on an actual change.

**The required vertical slice, both directions, both tested and browser-verified:**

- **Informed**: hunger crosses into real pressure → `knownFoodPlace` resolves the bakery (known
  from generation seeding or memory of a prior purchase) → `Intention{type: 'obtain_food', target:
  bakery, reason: 'know a place that sells food', grounded: true}` → the `eat` goal's plan
  walks there, buys/eats a REAL food item → a purchase memory updates for next time.
  `tests/knowledge-memory-skills-intent.test.ts`'s first intention test constructs exactly this
  and asserts the goal, its target, and the intention's `grounded` flag all agree.
- **Information-limited**: the same hunger level, no known food source, no accessible free food,
  no scheduled meal to fall back on → the mind CANNOT target the bakery it doesn't know exists
  (directly asserted: `goal.targetPlace !== bakery.id`) → instead adopts a bounded `wander` goal
  tagged `foodSearch: true`, whose plan (`mind/agent.ts`'s `plan()`) targets a nearby place NOT
  yet known as a food source — walking there and arriving is itself the direct-observation
  acquisition path (§4.2), so a genuinely uninformed person gradually, physically discovers
  options rather than teleporting to knowledge or to a destination.

---

## 7. Skill architecture (Part V)

`core/skills.ts` (new): `SkillId = 'woodcutting' | 'quarrying' | 'hauling' | 'sawing' |
'construction' | 'baking'` — one per materially different kind of work the simulation already
has (mapped 1:1 onto v0.3/v0.4's own `chop`/`gather`/`haul`/saw-in-`work`/`build`/bake-in-`work`
actions). `Person.skills: Partial<Record<SkillId, number>>` (0..1, absent = 0 = complete novice).

**How it interacts with attributes/tools/physiology/environment** — the unified model the
milestone asks for: `core/attributes.ts`'s `getPhysicalCapability` already folded body
(strength/dexterity, penalized by current fatigue/hunger/heat/sleep-debt — physiology) and tools
(via `ToolAction`) into one `workRate`/`energyCostMultiplier`/`fatigueMultiplier`. v0.6 adds ONE
more term, resolved automatically from the same `ToolAction` already being passed in
(`SKILL_FOR_TOOL_ACTION: chop→woodcutting, quarry→quarrying, saw→sawing, construct→construction`)
so chop/gather/saw/build's existing call sites needed **zero changes**: `skillWorkMult = 1 +
skill*0.3` (up to +30% work rate at theoretical mastery), `skillEfficiency = 1 - skill*0.15`
(up to -15% energy/fatigue cost) — bounded well short of "level 10 = +500%", and exactly 1 (a
no-op) for skill 0, so every person who has never practiced a skill is numerically IDENTICAL to
pre-v0.6 behavior. Hauling (no `ToolAction` — raw carrying has no tool) is resolved explicitly at
its own call site (`logistics/haul.ts`'s `personalCarryUnits`), with a small (+9% at mastery)
bonus to safe-carry mass representing packing technique — strength remains the dominant carrying
term. Baking (no tool at all) gets a direct, symmetric batch-cadence speed-up in `mind/agent.ts`'s
`work` action, mirroring the pattern v0.4 already established for sawing's tool-driven cadence.

**Never magical output**: extraction yield (`extractFromNode`) already scaled with `workRate` in
v0.4 (a stronger/better-tooled worker gets more per swing from the SAME finite node — real
efficiency, not duplication, since `node.remaining` is unaffected); skill flows into that same,
unchanged formula. Baking/milling's fixed `BAKE_RATIO`/`MILL_RATIO` are untouched by skill —
only how OFTEN a batch completes changes. Directly tested: a fixed 3-unit node is extracted for
EXACTLY 3 units total regardless of skill.

**Learning by doing**: `practiceSkill(person, id, amount)` — `gain = BASE_GAIN * amount * (1 -
current)`, diminishing as proficiency rises (reaching ~0.8 from scratch takes roughly a hundred
real work-units). Called only at the point a real, successful unit of work already happened — a
successful extraction, a completed batch, a credited labour-slice (scaled by minutes, not a flat
per-call amount), a completed haul delivery leg — never for standing at a workplace or a failed/
depleted-node attempt (directly tested both ways: a real extraction raises `skillOf`, a
zero-yield attempt on a depleted node does not, byte-for-byte).

**Starting proficiency**: `seedStartingSkills` (called from `world/village.ts`'s population loop)
gives plausible starting values by profession — a woodcutter starts at woodcutting 0.55/sawing
0.4/hauling 0.25, a baker at baking 0.6 — world-generation background exactly like starting
knowledge/tools, never a magical permission; every occupation absent from the table starts every
skill at 0, identical to pre-v0.6.

**Persistence**: `Person.skills` is new canonical state (`persist/save.ts`'s SAVE_VERSION 8 -> 9) — directly tested round-tripping
through `serialize`/`deserialize`.

---

## 8. Autonomous production — the second producer (Part VIII)

The mill was converted from unconditional cadence production (`mill(w,p)` called every ~8
world-minutes of work regardless of demand) to the SAME demand-aware `Request` pattern v0.5 gave
the bakery: `world/production.ts`'s `PRODUCTION_TARGETS` gained a second entry (`{placeType:
'mill', resource: 'flour', target: 45, trigger: 24, batchOut: MILL_RATIO.out}`), and `mind/
agent.ts`'s miller `work` handler now calls `claimedProductionRequest`/`fulfillProductionRequest`
exactly like the baker, rather than an unconditional `mill(w,p)`. Directly tested: a miller with
no open production request and no grain never mills or gets paid; a real demand (low flour stock)
raises a request, and only THEN does milling (and payment) happen, and only for a batch that
actually produced flour. Benchmark evidence: 5 production batches completed by day 2, 53 by day
8 (bakery + mill combined), 211 by day 30 — flour/bread stock stayed healthy throughout (46/24/22
flour village/bakery/mill at day 8), confirming the conversion didn't starve the pipeline it now
gates.

---

## 9. Scaling risks and failures (reported honestly)

- **The 30/90-day hunger/shortage trend is the most important disclosure in this document.**
  §3.3's table shows critical-band time climbing, not plateauing, from 8 to 30 to 90 days
  (12.6% → 37.4% → 53.9%) — worse than v0.5's own disclosed 8/30/90-day snapshot trend, which
  eased slightly by day 90 (0.73 → 0.76 → 0.71). §3.4 traces this to its real cause: a
  pre-existing wage/wealth structural gap (most occupations have no paid-labour path at all —
  `canHaul` excludes children/guards/captains/priests/acolytes, and farmers' own harvests are
  never sold on their behalf), which was NOT introduced by this milestone and was NOT fixed by
  it either (out of the knowledge/memory/skill/intention mandate, and explicitly lower priority
  than that mandate per the brief's own priority order). It is disclosed in full, with the
  specific mechanism and the specific fix a future economy-focused pass should make (§3.4), not
  hidden behind a flattering short-horizon number.
- **Knowledge-lookup scale**: `knownFoodPlace` and `memoriesAtPlace` are linear scans over one
  person's OWN `knowledge`/`memories` (bounded at 400/60 respectively — never the village's, and
  never per-tick over all persons), so they do not reintroduce the `World.entities`-style
  full-population scan risk earlier audits flagged. At 33 people this is not yet a hard
  bottleneck, but it is a real, measured cost: `sim.think`'s wall-time share moved from 37-46%
  (v0.5) to 47% (8 days) / 57% (30 days) / 63% (90 days) here, and absolute wall-clock grew
  faster than day-count alone would predict (12.7s → 45.7s → 293.6s → 1454.8s at 2/8/30/90 days —
  roughly linear from 8→30 days, but the 30→90 jump, 3× the days, cost ~5× the wall-clock).
  Flagged as a real, worsening cost rather than a hypothetical one — at population scales larger
  than 33 this would need the same kind of indexing v0.2.2 already gave `Person.knowledge`
  eviction, applied to the lookup path itself, not just the storage bound.
- **`avgKnowledgePerPerson` reaches 375.5 at 30 days and 426.4 at 90 days** — the second figure is
  ABOVE the nominal `MAX_KNOWLEDGE = 400` cap, which is expected and correct: pruning is batched
  (only triggers past `MAX_KNOWLEDGE + PRUNE_MARGIN = 440`, per-person, not synchronized across
  the village — see `mind/knowledge.ts`'s own v0.2.2 doc comment), so a village-wide *average*
  sitting between the two thresholds is consistent with some individuals already having been
  pruned back toward 400 and others still climbing toward their own next prune pass. The new
  `'service'` entries are virtually all `source.type: 'prior'` (foundational, effectively pinned
  — see `knowledgeScore`), so they are not at meaningful eviction risk regardless.
  `knowledgeForgotten` (the OBSERVABLE-eviction event tally) was 0 at every horizon measured — by
  design, that event only fires for an evicted entry an active goal/plan still referenced, so it
  undercounts total eviction and should not be read as "no pruning happened."
- **Wage responsiveness (Part IX.14) was consciously NOT implemented this milestone** — see §3.4
  for why this is now understood to be a materially bigger gap than "no scarcity-responsiveness
  yet" (haul wages already respond to distance/mass since v0.4): the real problem several
  occupations have is no wage-earning eligibility at all, not that their wage doesn't scale with
  demand. Both are Part IX territory, explicitly lower priority than this milestone's mandate
  (items 1-7), and are named together here as the natural next economy-focused pass.
- **The three v0.5-disclosed goal-commitment regressions were re-verified, not re-broken**: every
  horizon in §10 shows healthy commitment counts and a suspended/resumed ratio close to 1:1, and
  zero `goal_churn` anomalies at every horizon tested (2/8/30/90 days) — the goal-stability work
  v0.5 shipped is intact under the new cognition load.
- **The `getPhysicalCapability` per-call cost** (flagged in v0.4 §15, not revisited in v0.5) was
  not revisited here either — it is now called with one additional resolved skill lookup per
  invocation, a bounded, O(1) addition, not a new scaling dimension on its own.

---

## 10. Long-horizon benchmarks

| Seed | Days | Wall-clock | Population | Deaths | Anomalies | Production completed | Wages paid | Purchases spent | avgHunger (snapshot) | Goal commitments (committed/suspended/resumed/abandoned) |
|---|---|---|---|---|---|---|---|---|---|---|
| 918271 | 2 | 12.7s | 33→33 | 0 | 0 | 5 | 15 | — | 0.543 | 15/2/2/0 |
| 918271 | 8 | 45.7s | 33→33 | 0 | 0 | 53 | — | — | 0.675 | — |
| 918271 | 30 | 293.6s | 33→33 | 0 | 0 | 221 | 787 | 885 | 0.839 | 96/31/29/1 |
| 918271 | 90 | 1454.8s | 33→33 | 0 | 0 | 560 | 1586 | 1015 | 0.869 | 223/80/73/3 |
| 42424242 | 8 | 49.8s | 33→33 | 0 | 0 | 44 | — | — | 0.627 | 41/10/8/1 |

Zero `goal_churn` anomalies at every horizon tested (one run at day 30, before the §3.4 avoidance-
window change, briefly showed 4 `stuck_agent` anomalies — all plain `path_failure` events for a
single NPC in one 3-hour window, unrelated to goal selection; the re-run above shows 0). Bread
price at the bakery: settled to the base 2 silver by day 30 and held there through day 90 (supply
genuinely caught up with demand, exactly as v0.5 reported for its own run — see §3.4 for why that
did NOT translate into fewer people going hungry). The alternate seed (42424242, 8 days) produces
a materially different but qualitatively consistent hunger-band distribution (14.3%/26.1%/28.8%/
19.0%/11.8% vs. 14.8%/27.0%/27.5%/18.1%/12.6% at the primary seed) — the short-horizon calibration
is not an artifact of one seed's specific random draw.

---

## 11. Design rule: what v0.6 deliberately did NOT build

Per Constitution v0.6 §XVIII, explicitly not built: LLM dialogue, natural-language memory
storage, deep personality psychology, full relationship simulation, rumor propagation, teaching/
schools/apprenticeships, books/libraries, a complex intelligence stat, politics/law/religion
systems, firms/banking/credit, magic, Iron/Bronze ontological advancement, alien/new species,
combat overhaul, disease, detailed nutrition, full injury simulation, advanced farming. Also
consciously deferred within scope: wage responsiveness beyond v0.4's existing distance/mass
factors (§9); extending the demand-aware production conversion to the sawpit (mill alone
satisfies the "at least one more domain" requirement); a communications/rumor network for haul-
task/request awareness (Constitution's own "keep it simple" — the existing proximity cutoff in
`pickHaulTask`, "not my problem — too far to have heard of it," is left as the existing partial
mitigation for that specific omniscience surface rather than rebuilt this milestone). The
`Intention` shape, the `'service'` KnowledgeItem kind, and `SkillId`/`core/skills.ts` are the
explicit hooks left for future work — each additive, none requiring a rewrite of cognition,
knowledge, or the physical-capability layer.
