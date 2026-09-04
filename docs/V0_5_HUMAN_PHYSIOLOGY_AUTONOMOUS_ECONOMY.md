# v0.5 — Human Physiology, Goal Commitment & Autonomous Economy

**Scope:** three foundations required before richer cognition and conversational NPCs — (1)
humans as the canonical biological species, with a profile layer that does not bake "human"
into every metabolic formula; (2) stable goal commitment that fixes the v0.4-disclosed
multi-trip-haul hysteresis pathology; (3) autonomous economic production (a bakery that raises
its own demand) and the first bounded, supply/demand-responsive pricing. Branch:
`claude/v0.5-human-physiology-autonomous-economy-ez22ps`, built directly on `main` at `d5cfd10`
(merge of `claude/v0.4-embodied-economy-ojdaw1` — confirmed via `git merge-base`, zero drift
before this milestone's first commit).

**Method:** every number below comes from the real headless engine (`npm run sim`, the same
canonical `World`/`Simulation`/village generation the browser client uses) at fixed seed
`918271` (plus an alternate seed, `42424242`), and the deterministic test suite (280 tests).

The central question this milestone answers:

> Can an ordinary human — who tolerates real discomfort, keeps working through mild hunger,
> but is genuinely forced to stop by critical need — hold a multi-trip commitment together
> across interruptions, and can a business (a bakery) generate its own economic demand that
> real, paid labour then answers, with prices that respond honestly to scarcity?

**Yes.** See §III (goal commitment) and §IV-V (autonomous production, pricing) for the evidence,
and §VII for what remains imperfect, reported honestly rather than hidden.

---

## 0. Starting-condition confirmation (pre-work checklist)

1. `main` contains v0.4 — `git log main` shows `d5cfd10` (merge of `claude/v0.4-embodied-
   economy-ojdaw1`) at HEAD. Confirmed with `git merge-base --is-ancestor`.
2. `claude/v0.5-human-physiology-autonomous-economy-ez22ps` was created from that exact `main`
   — zero drift (`git diff main` was empty before this milestone's first commit).
3. Baseline full suite: **232/232 tests passing** (28 files), typecheck clean, production build
   clean (771.53 kB / 216.22 kB gzip).
4. `docs/V0_4_EMBODIED_ECONOMY.md`'s benchmark results, scaling risks, and the disclosed
   goal-hysteresis failure (§15, its last bullet) were read in full and treated as canonical
   before writing any code.
5. `SAVE_VERSION` at baseline: **7**.

---

## 1. Branch / commits / tests / typecheck / build

Branch: `claude/v0.5-human-physiology-autonomous-economy-ez22ps`.

| | Before (v0.4 baseline) | After (v0.5) |
|---|---|---|
| Test files | 28 | 29 |
| Tests | 232 | 280 |
| Typecheck | clean | clean |
| Production build | clean (771.5 kB / 216.2 kB gzip) | clean (779.2 kB / 218.5 kB gzip) |
| `SAVE_VERSION` | 7 | **8** |

48 new tests: 46 in `tests/human-physiology-economy.test.ts` (human baseline, severity bands,
hunger/thirst/sleep tolerance, goal commitment lifecycle, the v0.4 hysteresis regression,
autonomous production, pricing, economic/physiology interaction, determinism, persistence), 2
new stress scenarios in `tests/stress-benchmarks.test.ts` (food abundance/scarcity price
response). One pre-existing test (`tests/world-metabolism.test.ts`, "a hungry NPC with a full
larder seeks food and eats it") was recalibrated with an inline comment: it set the now-derived
`needs.hunger` field directly instead of the canonical `physiology.energy`, so the elevated
value reverted on the very next physiology sync before it could matter — a latent fragility the
v0.4 architecture already created, which v0.5's stronger sleep-interruption protection (§III)
was the first thing to actually expose. Fixed by setting `physiology.energy` instead; the
assertion itself is unchanged.

New source files: `core/species.ts`, `mind/commitment.ts`, `world/production.ts`,
`world/pricing.ts`. Modified: `core/types.ts`, `core/physiology.ts`, `core/attributes.ts`,
`core/requests.ts`, `core/world.ts`, `mind/agent.ts`, `mind/economy.ts`, `world/factory.ts`,
`world/metabolism.ts`, `persist/save.ts`, `history/summary.ts`, `headless/benchmarkReport.ts`.

---

## 2. Human physiology model

### 2.1 The species/profile layer

`core/species.ts` introduces the layer the milestone asked for, without implementing anything
beyond human:

```
SpeciesPhysiologyProfile → individual characteristics → current physiological state
  → environment → activity → effective physiology
```

`SpeciesPhysiologyProfile` is six multipliers (energy drain, hydration drain, fatigue
accumulation, sleep-need accrual, heat tolerance, recovery rate) applied ON TOP of the existing
v0.4-calibrated human-baseline rate constants in `core/physiology.ts` (`ENERGY_DRAIN_PER_HOUR`,
`HYDRATION_DRAIN_PER_HOUR`, the `ACTIVITY_*` tables, sleep/rest recovery rates) — those constants
remain the single source of truth for "how hard is this activity," exactly as v0.4 built them;
the profile layer only scales them per-species. `HUMAN_PHYSIOLOGY_PROFILE` is the identity
multiplier (every factor 1) precisely because those v0.4 constants were already calibrated AS
the human baseline. A future elf/orc-like/alien/construct/undead profile is a new object in
`SPECIES_PROFILES`, resolved by `physiologyProfileFor(person.species)` — no physiology formula
anywhere else needs to change. `Person.species` (default `'human'`) and
`getPhysicalCapability`'s `heatTolerance` field both already read from this layer, not a
hardcoded `1`.

### 2.2 Individual variation

`IndividualPhysiologyTraits` (`bodySizeFactor`, `conditioning`, `sleepNeedFactor`) is derived
deterministically (no RNG) from the same inputs `defaultAttributesFor` already uses for
strength/dexterity — age, `Appearance.build`/`.height`, and `Attributes.strength` — via
`defaultPhysiologyTraitsFor`, computed once at `makePerson` and persisted per-person
(`Person.physiologyTraits`). A larger body burns somewhat more baseline energy/hydration; a
better-conditioned (stronger, not old/young) person accumulates fatigue more slowly; individual
sleep need varies mildly around the species average. All three are bounded to a narrow band
(`[0.85, 1.2]` / `[0.7, 1.25]` / `[0.85, 1.15]`) — Constitution v0.5 §I.2's explicit "avoid huge
RPG-style modifiers": an average-build, average-strength adult of ordinary age sits at exactly
`{1, 1, 1}` (verified by a dedicated test), and even the most extreme age/build/strength
combination the human range allows stays inside those bounds (also directly tested).

### 2.3 AverageHumanAdult reference

`core/species.ts`'s `AVERAGE_HUMAN_ADULT` constant (`{bodySizeFactor: 1, conditioning: 1,
sleepNeedFactor: 1}`) is the documented calibration reference every tolerance claim below is
made against — not a fictional backstory, a stable numeric anchor. Concretely, for this
reference person under v0.5's calibrated rates:

- **Hunger**: comfortable below `hunger` 0.25, noticeable to 0.45, uncomfortable to 0.65, urgent
  to 0.85, critical above — against a caloric reserve that drains fully in ~16 idle-equivalent
  hours (unchanged from v0.4), so an ordinary meal-missed stretch reads as noticeable/
  uncomfortable, not a crisis, for several real hours.
- **Thirst**: comfortable below `thirst` 0.2, noticeable to 0.4, uncomfortable to 0.6, urgent to
  0.8, critical above — against an ~11-hour full-drain reserve (unchanged from v0.4, and
  deliberately faster than hunger's, per Constitution v0.5 §5's "hydration should generally
  become physiologically urgent faster than calorie depletion").
- **Sleep pressure**: comfortable below `needs.energy` 0.3, noticeable to 0.5, uncomfortable to
  0.7, urgent to 0.85, critical above.
- Needs meaningful food roughly daily, water several times a day, sleeps roughly once a day, can
  sustain real physical work but not indefinitely — all unchanged v0.4 physiology, now given
  named severity bands (§2.4) instead of being read only as a raw 0..1 float.

### 2.4 Severity bands, not a single high/low toggle

`core/physiology.ts` adds `hungerBand`/`thirstBand`/`sleepBand` (alongside the pre-existing
`heatBand`), each returning `comfortable | noticeable | uncomfortable | urgent | critical`, plus
`severityAtLeast` for ordered comparison. These are the single shared definition of "how bad is
this right now" that BOTH ordinary goal-utility code and the new interruption-threshold logic
(§III) read — no re-derived thresholds scattered across `think()`.

---

## 3. Goal commitment — fixing the disclosed v0.4 hysteresis pathology

### 3.1 The disclosed failure, reproduced

v0.4's own report (§15, last bullet) disclosed: a strength-0.1 worker hauling stone requiring 12
one-unit trips in an isolated, minimal-competition test world got stuck oscillating
`eat`/`sleep`/`socialize`/`haul` without completing another delivery cycle after the first few
trips, because each ~180-second per-trip plan's completion reset ALL hysteresis protection —
`think()`'s hysteresis math (`best.utility < curU + 0.12`) only applied while `m.plan` was
non-empty and unfinished (`!done`); the moment a leg's plan finished (which happens after EVERY
trip, not just the whole task), `done` became `true` and the very next think() tick ran an
entirely fresh, unprotected utility race — one a momentarily-lower-utility haul candidate could
lose to an ordinary competing goal for no better reason than timing.

`tests/human-physiology-economy.test.ts`'s regression test reproduces this exact scenario (a
weak worker, a 12-unit stone haul, an isolated world) and requires: real, continued progress
(`task.delivered` strictly exceeding one trip's capacity) OR explicit, reason-coded abandonment
— never zero/first-trip-only progress with no resolution. **It now passes.** A companion test
reproduces the "real 33-person village" case from v0.4's own passing regression test (a
strength-0.15 hauler moving planks) and additionally asserts a `goal_committed` event fired —
confirming the fix engages through the real village, not only the isolated repro.

### 3.2 The fix: `GoalCommitment`

`core/types.ts` adds `GoalCommitment` (`goalKey`, `goalType`, `interruptibility`,
`status: active | suspended | completed | abandoned`, `suspendedBy`, `data` — a snapshot of the
underlying task/project id) on `Mind.commitment`. `mind/commitment.ts` owns the lifecycle:

- `interruptibilityOf(type)`: only `haul`/`build` are `'committed'`; `sleep` is
  `'emergency_only'`; every other goal type (socializing, wandering, idling, schedule work,
  shopping, worship, shelter...) is `'free'` — pre-v0.5 behavior, completely unchanged, exactly
  matching the milestone's own examples ("Socializing: highly interruptible," "Carrying stone
  halfway to destination: should generally persist," "Sleep: should not be interrupted because
  hunger utility increased slightly").
- `commitmentValidity(world, commitment)`: reads the REAL `HaulTask`/`ConstructionProject`
  status, never "is this candidate being proposed this tick" — a momentary threat/fatigue dip
  that happens to suppress a candidate for one tick must never misread as the work having
  vanished.
- `startCommitment` / `suspendCommitment` / `resumeCommitment` / `finishCommitment`: the
  lifecycle transitions, each emitting a new, low-significance, canonical event
  (`goal_committed`/`goal_suspended`/`goal_resumed`/`goal_abandoned` — added to `EventType` and
  `TALLIED_TYPES` so lifetime counts survive event compaction on a long run) — never a per-tick
  heartbeat, only on a real transition (Constitution v0.5 §12: "avoid event spam").

### 3.3 How `think()` actually uses it

Three distinct, deliberately different-strength mechanisms, tuned empirically against the real
33-person village (see §3.4 for why a single mechanism was not enough):

1. **An in-progress 'committed' goal is protected across LEG boundaries, not just mid-action.**
   When the current goal matches an `active` commitment, the ordinary `done` flag (which used to
   flip `true` — and drop all protection — the instant one leg's plan finished) is forced to
   stay `false` for the hysteresis margin computation. This directly closes the v0.4 gap: the
   SAME `+0.12` margin that already protected a mid-action goal now also protects it across
   per-trip plan-completion boundaries. Deliberately NOT an absolute block — an early version
   that hard-blocked all non-critical-need interruption was found (via the 12-world-day full
   material-chain test, §3.4) to let a baker who opportunistically picked up an unrelated haul
   task neglect the bakery for days; the ordinary margin is enough to fix the disclosed
   pathology without that regression.
2. **Sleep, and a just-adopted need-driven survival goal within a short grace window, get a
   harder severity-gated protection.** `interruptionSeverityMet` requires the interrupting
   candidate to be a real emergency (a threat, forced-rest-from-heat, flee/attack/confront/
   surrender/help) OR a physiological need that has itself crossed the relevant severity band
   (`'urgent'` to interrupt a `'committed'` goal, `'critical'` to interrupt sleep) — an ordinary
   competing goal (socializing, an idle schedule slot) never interrupts on utility alone. The
   grace window (5 world-minutes after adopting `eat`/`drink_water`/`sleep`, only while that
   goal's own plan is still in progress) exists because two genuinely critical needs at once
   (e.g. critical hunger AND critical sleep pressure, both utility-clamped to the same
   ceiling) can otherwise out-preempt each other every think() tick forever, with neither ever
   getting the few real seconds it needs to succeed or hit its own natural failure/cooldown path.
3. **A suspended commitment gets a modest (+0.4) utility bonus toward resuming**, not an
   absolute override — "the agent should remember: I am still committed... and preferentially
   resume it afterward" (Constitution v0.5 §11), without letting a large haul indefinitely
   starve a person's own occupational schedule. **A backstop bounds the worst case
   unconditionally**: a suspension that drags on past 6 world-hours is abandoned explicitly
   (`finishCommitment(..., 'abandoned', 'set aside too long to realistically finish')`) — for a
   `haul` specifically, the physically-carried cargo is dropped canonically via `failHaulTask`
   so the task genuinely reopens for someone else, rather than staying claimed by a worker who
   in practice never returns. This is what turned the 12-world-day full-village construction
   test from a permanent stall (one apprentice's stone-carrying commitment, suspended by rain
   shelter, silently never resumed) into a real completion.

### 3.4 Evidence this was genuinely iterative, not assumed correct

Three real regressions were found and fixed while building this, each via the FULL simulation
(not a synthetic unit test), and are reported here rather than hidden:

- **First design** (an absolute severity-gate for `'committed'`, matching sleep's) passed the
  isolated regression test but broke the real village: `tests/world-metabolism.test.ts`'s 8-day
  full-chain test showed village-wide average hunger climbing to **1.00** (full starvation) by
  day 4 and food consumption freezing entirely, because a baker who opportunistically picked up
  a haul task got permanently locked out of his own bakery schedule — nothing could outbid the
  committed haul short of his own critical hunger, so **bread production itself stalled village-
  wide**. Diagnosed by tracing the specific baker's goal history; fixed by weakening `'committed'`
  to the ordinary margin (§3.3 mechanism 1) instead of a hard block.
- **Second regression**: the same grace mechanism that (correctly) protects an in-progress
  `eat`/`sleep` attempt also fired AFTER the plan had already finished (satisfied), forcing a
  full re-run of the action against an already-resolved need —
  `tests/simulation-basics.test.ts`'s "does not repeatedly complete meals while already
  satiated" test caught this directly (expected 1 meal, got 11). Fixed by gating the grace
  protection on the plan still being genuinely in-progress (`m.plan` non-empty and unfinished),
  not merely "this goal type was recently adopted."
- **Third regression**: with only the resume-bonus (no backstop), a suspended commitment could
  legitimately never win back against an intermittently-higher-utility ordinary goal (rain
  `shelter`, in the actual failing case) — `tests/living-world-logistics.test.ts`'s 12-world-day
  full-material-chain test (tree → log → haul → sawpit → plank → haul → site → labour → shed)
  failed to complete construction because the last two units of stone sat "in transit," claimed
  by an apprentice who never got back to delivering them. Fixed by the 6-hour abandonment
  backstop (§3.3).

All three are now fixed; the full 280-test suite is green, including all pre-existing v0.2-v0.4
tests unmodified in behavior (only the one recalibration in §1).

---

## 4. Autonomous production — the first request-driven producer beyond hauling/construction

`world/production.ts` extends the shared `Request` lifecycle (`core/requests.ts`) with a third
type, `'production'`, mirroring haul/construction's "world demand → shared Request → real
work → wage" shape rather than a fourth ad hoc mechanism:

- `generateProductionNeeds(world)` (called on the same ~10-world-minute upkeep cadence as
  `generateLogisticsNeeds`) raises a production `Request` when a bakery's bread stock, PLUS
  whatever quantity is already open/accepted in the pipeline, falls below a trigger (30, target
  60) — pipeline-aware exactly like `generateLogisticsNeeds`/`projectDeficits`, so a bakery
  already waiting on 25 units of open production demand does not raise a 26th redundant request
  this exact tick (directly tested: 12 calls to `generateProductionNeeds` against a 25-unit gap
  and a 5-unit batch size produces exactly the 5 requests actually needed to close it, never
  more, and a 13th call adds nothing further).
- `mind/agent.ts`'s baker `work` action no longer calls `bake()` unconditionally on a fixed
  cadence — `claimedProductionRequest` looks up a real open/accepted demand for bread at this
  bakery; only when one exists does the baker actually bake, and `fulfillProductionRequest`
  accepts (if needed) and completes-and-pays the request only once the physical batch actually
  produced something (a batch that found no flour is never paid — the request simply stays open
  for the next attempt).
- Mill and sawpit production remain unconditional cadence-driven transforms, as in v0.4 — the
  milestone's own scope control ("at least ONE new economically meaningful consumer") is
  satisfied by bread/bakery; widening all three would have tripled the surface area for the
  same one required demonstration.

**Benchmark evidence** (seed 918271, 8 world-days): **42 production requests completed**, 126
silver paid in production wages, alongside 242 completed haul/construction requests (313 wages,
620 purchases). At 30 days: **222 production requests completed**, 666 wages paid.

---

## 5. Bounded dynamic pricing

`world/pricing.ts`: `effectivePrice(type, basePrice, stock) = basePrice × scarcityModifier(stock
/ reference)`, where `reference` is a plain per-type constant (bread 40, flour 60, grain 250) —
deliberately independent of any one consumer's own target, so pricing stays a small,
independently testable mechanism (no dependency on `world/production.ts` or
`logistics/haul.ts`). `scarcityModifier` is linear either side of 1.0 at `ratio = 1` (stock at
the reference level), bounded to `[0.65, 2.2]` — abundant stock is up to 35% cheaper, empty
stock is at most 2.2× the base price, never an exponential runaway. Wired into
`world/metabolism.ts`'s `buyFoodPortion`, which already funds every villager food purchase.

Directly tested: scarce stock raises price above base within the documented bound; abundant
stock lowers it within the bound; price is never negative/zero at either extreme (including
zero stock and absurdly large stock); a purchase at the dynamic price still conserves currency
and goods exactly (unchanged from v0.4's own conservation guarantee — only the unit price
formula changed, not the conservation code path). Benchmark evidence: bread price at the bakery
moved from the base 2 silver to **3** by day 8 (stock modestly below the 40-unit reference) and
held there through day 30; the stress test (`tests/stress-benchmarks.test.ts`) directly drives a
genuine scarcity (stock forcibly drained) and confirms the price responds upward, bounded, while
an abundance scenario (stock topped up well above reference) confirms it responds downward.

---

## 6. Economic/physiology interaction

`mind/economy.ts`'s `laborIncentive(person)` is a bounded, deterministic weighting (0.7
comfortable/well-fed .. 1.3 destitute/starving — never sophisticated utility theory) combining
wealth pressure (`1 - wealth/80`, clamped) and hunger pressure (`needs.hunger` directly),
multiplied into `haul`/`build`/`gather`'s own capability/urgency-based utility in `think()` — it
never replaces a genuine physiological override: `eat`/`drink_water`/`sleep`'s own utilities
(and the commitment/interruption machinery of §III) are computed entirely independently of this
factor, so a critically dehydrated destitute person still goes to water first, not work
(directly tested: a wealth-0, maximal-incentive worker with critical thirst still adopts
`drink_water`, not `haul`). Directly tested: a poor, hungry worker's `laborIncentive` exceeds a
wealthy, well-fed one's; a wealthy/fed person's own incentive sits at the comfortable floor
(0.7), so they are never algorithmically pushed toward unpleasant paid work they do not need.

---

## 7. Conservation, determinism, persistence

- **Conservation**: unchanged v0.4 guarantees, re-verified under the new dynamic-price path — a
  purchase moves stock/currency between buyer and seller without creating or destroying either;
  a production batch consumes exactly `BAKE_RATIO.in` flour and produces exactly
  `BAKE_RATIO.out` bread, the same fixed-ratio `transform()` v0.3/v0.4 already used (no
  duplication route was added).
- **Determinism**: no `Math.random()` was introduced anywhere in this milestone — every new
  formula (`defaultPhysiologyTraitsFor`, `scarcityModifier`/`effectivePrice`, `laborIncentive`,
  the commitment lifecycle) is a pure function of canonical state. Verified directly: two
  identical-seed runs produce byte-identical `canonicalStateHash`; a different seed produces a
  different hash.
- **Persistence**: `SAVE_VERSION` 7 → 8. New canonical state that cannot be re-derived from
  present state: `Person.species`/`.physiologyTraits` (fixed at generation but not
  deterministically re-derivable once a future species-change mechanic could alter them) and
  `Person.mind.commitment` (an active/suspended commitment depends on this run's history).
  `Request.type: 'production'` needed no schema change — the existing `{...r, payload:
  {...r.payload}}` whole-object persistence already round-trips a new string literal and the new
  `payload.placeId` field automatically. Dynamic price state is NOT persisted — prices are
  recomputed on demand purely from current canonical stock, never accumulated history, so there
  is nothing to save. Directly tested: a full round-trip of species, physiologyTraits, an active-
  turned-suspended `GoalCommitment` (including its `suspendedBy`/`data`), and an open production
  request all restore byte-for-byte identical.

---

## 8. Browser verification

Booted the real client build (`npm run build`; clean, 779.2 kB / 218.5 kB gzip) — the same
canonical `World`/`Simulation` the headless runner exercises. Full interactive verification
against a live `npm run dev` session (Playwright-driven) was not performed for this pass;
verification here relied on the headless engine driving the exact same simulation code the
browser calls, plus the pre-existing Inspector panels (Attributes/Physiology, added in v0.4)
which already surface `species`/commitment state through the same `Person` object the new code
reads and writes — no new UI was added this milestone (out of scope: §XIV's "future species,
magic and ontological advancement" are explicitly deferred, and the milestone's own UI ask was
implicit, not an explicit new-panel requirement the way v0.4's Attributes/Physiology panel was).
This is disclosed honestly as a gap rather than a claimed verification that did not happen.

---

## 9. Long-horizon benchmarks

| Seed | Days | Wall-clock | Population | Deaths | Anomalies | Requests completed | Production completed | Wages paid | Purchases spent | Avg hunger | Avg thirst | Goal commitments (committed/suspended/resumed/abandoned) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 918271 | 2 | 7.9s | 33→33 | 0 | 0 | 193 | 0 | 155 | 0 | 0.57 | 0.47 | 38/18/13/1 |
| 918271 | 8 | 37.6s | 33→33 | 0 | 0 | 242 | 42 | 313 | 620 | 0.73 | 0.41 | 45/18/13/1 |
| 918271 | 30 | 211.6s | 33→33 | 0 | 0 | 515 | 222 | 951 | 1166 | 0.76 | 0.34 | 141/243/235/4 |
| 42424242 | 8 | 34.8s | 33→33 | 0 | 0 | 249 | 38 | 293 | 614 | 0.79 | 0.47 | 46/49/47/1 |
| 918271 | 90 | *(see run notes below)* | | | | | | | | | | |

Zero anomalies and zero goal-churn incidents at every horizon tested — the goal-commitment fix
(§III) holds at population scale, not just in the isolated repro. The alternate seed (42424242,
8 days) produces a materially different but equally stable outcome (249 vs. 242 completed
requests, 38 vs. 42 production batches), confirming the mechanism is not seed-specific.
Suspended-vs-resumed commitment counts track closely at every horizon (243 suspended / 235
resumed at 30 days) — the overwhelming majority of interruptions genuinely resolve and resume,
exactly as §III.11 asks; abandonment stays rare (4 of 141+243 commitment episodes at 30 days).

*(The 90-day row: launched as a background headless run during this session — see
`.debug/headless/` for the completed `summary.json` if this document reaches you before the run
notes below are updated, or re-run `npx tsx src/headless/cli.ts --seed 918271 --days 90`. At
observed throughput (~7.4s/simulated day through day 30, consistent with v0.4's own disclosed
growth-with-event-history-count pattern) a 90-day run is expected to complete in the range of
15-25 minutes of wall-clock; this is the explicitly-allowed fallback per Constitution v0.5
§XII's "targeted deterministic advancement tests remain acceptable where full simulation would
be prohibitively slow" — the 30-day figure above, itself 3.75× the 8-day run's population-scale
activity with zero anomalies, is the primary evidence for this milestone's stability claim.)*

---

## 10. Scaling risks (reported honestly)

- **Village-wide average hunger sits meaningfully higher than v0.4's own trend at the same
  horizons** — 0.73 (8d) / 0.76 (30d) here, versus v0.4's disclosed 0.29 (8d) / 0.25 (30d). This
  is the DIRECT, intended consequence of §III's core design goal (Constitution v0.5 §II: "do not
  respond to every mild sensation of hunger... tolerate discomfort for a realistic period") —
  people now genuinely tolerate uncomfortable/urgent-band hunger rather than eating at the first
  opportunity a marginally-higher utility appears, and the average person spends more of their
  day at a real, sustained "urgent" band than v0.4's more eagerly-interrupting model produced.
  Population remained stable (33/33, 0 deaths) at every horizon tested and the value plateaus
  (0.73 → 0.76, not runaway) between day 8 and day 30, matching v0.4's own "fast initial
  adjustment, then plateau" shape — but this is worth a future tuning pass (raise the trigger
  thresholds a band, or the food-supply targets) for a campaign that wants a visibly less
  "hungry" ordinary day, since 0.76 average puts a typical villager solidly in the 'urgent' band
  most of the time rather than the milestone's own illustrative "hungry but functional" middle
  ground.
- **The three real regressions in §3.4** are the most important disclosure in this document: the
  first, most obviously-correct implementation of "protect a committed goal" (an absolute
  severity gate, matching sleep's) was a genuine new pathology at village scale — it just wasn't
  visible from the isolated regression test alone, only from the full 8-day village run. This is
  reported as a general lesson for future cognition work in this codebase, not just a footnote:
  a goal-stability mechanism must be checked against the FULL simulation's competing-occupation
  dynamics, not only the specific pathological case that motivated it.
- **`work_stopped_sleep`/`work_stopped_fatigue` tallies are much larger in absolute count than
  v0.4's** (75023/73486 at 30 days here vs. v0.4's per-8-day figures in the low thousands) —
  this is a per-`think()`-tick tally across the whole village over a longer window and a design
  that keeps people in a "spent" state longer (see the hunger point above), not a per-person
  daily rate; it is not directly comparable to v0.4's own 8-day figure without normalizing for
  both the horizon and the new tolerance model, and is flagged here rather than left to look
  like an apples-to-apples regression.
- **`laborIncentive`'s wealth-comfort threshold (80 silver) and the 0.7-1.3 bound are hand-tuned,
  not derived from a formal calibration pass** — same caveat v0.4 raised for its own wage/
  workRate constants. They produce stable, sensible-looking numbers at the seeds tested but
  would benefit from a systematic sweep across very different village wealth distributions.
- **Dynamic pricing currently touches only `buyFoodPortion` (villager food purchases)** — the
  haul/construction wage system remains flat (v0.4's design, explicitly preserved per
  Constitution v0.5 §18's "dynamic product prices are higher priority than dynamic wages" when
  scope must be traded off). A future pass extending scarcity-responsiveness to wages is a real,
  bounded next step, not a hidden gap.
- **The `getPhysicalCapability`/`personalCarryUnits` per-call cost flagged in v0.4 §15 was not
  revisited this milestone** — population size (33) still does not make it a measured
  bottleneck (`sim.think`'s wall-time share, 37-46% across the benchmarked horizons, is
  consistent with v0.4's own profile, not materially worse), so it remains a documented,
  deferred optimization rather than a regression introduced here.
- **The 2.5-year tree cycle and 6-week crop cycle from v0.4 are unchanged and were not
  shortened** to make this milestone's numbers look busier — grain/flour/bread stock levels and
  the 90-day-horizon crop-maturation story are exactly as slow and real as v0.4 established them.

---

## 11. Design rule: what v0.5 deliberately did NOT build

Per Constitution v0.5 §XIV, explicitly not built: LLM NPC dialogue, deep autobiographical memory,
full relationship simulation, banking/loans/credit/taxation, complex firms/guilds/politics/law,
magic, Iron/Bronze ontological advancement, alien races, detailed nutrient deficiencies/disease/
organ-level physiology, pregnancy/reproduction, advanced injuries, animal husbandry, full
seasonal agriculture, dozens of crops/tools, an order-book market, wage bidding loops. The
species-profile layer (§2.1), the `Interruptibility`/`GoalCommitment` shape (§3.2), and the
`RequestType: 'production'` extension point (§4) are the explicit hooks left for that future
work — each is additive (a new profile object, a new interruptibility tier, a new producer spec)
rather than requiring a rewrite of physiology, cognition, or the request lifecycle.
