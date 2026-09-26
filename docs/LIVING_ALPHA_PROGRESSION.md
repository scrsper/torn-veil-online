# Living Alpha progression calibration (Normal → Iron)

This records a deliberate calibration decision, the measurements behind it, and what it does and
does not change. It answers the Living Alpha requirement that ordinary life improves people,
training matters, different activities develop different foundations, and Iron is reachable on a
game-relevant timescale — without awarding Iron from experience points or fabricating history.

## What was measured before the change

* **Rate.** `DEVELOPMENT_HOURS = 500`: from foundation 8 to 15 at potential 10 took ~30,300
  effective hours (60.7 "base units" × 500 h). The best possible adult vitality practice needed
  ~33,900 world days. `.debug/progression-calculation.json`.
* **Ordinary life produced almost nothing.** Diffing `development.exposure` across the retained
  five-day continuation day-saves (seeds 918271/918272, 764 person-days,
  `scripts/alpha/development-exposure.ts`) measured 0.001–0.006 weighted *hours* per day for
  farmers, woodcutters, millers and hunters — a few seconds. Each completed batch credited a fixed
  "one minute" regardless of how long the work took.
* **One shared daily budget** of 8 h of stimulus covered all seven foundations together.
* **Iron required all seven foundations ≥ 15**, so there were no distinct paths; intellect and will
  had almost no sources. The NPC advancement goal was hard-wired to `crafting`.
* The martial practice system (`mind/martialPractice.ts`) existed but was never called by the
  running simulation; nobody could spar.

## The decision

1. **Exertion conditioning.** The per-minute physiology pass already classifies what each body is
   doing (walk, haul, chop, quarry, construct, craft). The same classification now develops the
   body (`developThroughExertion`): time under real load, not a batch count. It is a slow
   stimulus (a first point in a few days of hauling, 8→11 over weeks); a faster rate measurably
   destabilised the Ashford WorldLab smoke within two days by reshaping who was strongest.
2. **Challenge ceilings.** Every stimulus names the foundation level it actually demands.
   Adaptation falls off steeply once a foundation meets it (`challengeFactor`: 0.88 one point
   below, 0.12 at, 0.0025 one point beyond). Routine labour demands ~10–11.5; trades 10.5–12;
   hunting 13; solitary veil meditation 13; sparring with a partner 15.5; bringing down a boar 17;
   a hush attempt 15–16. Ordinary work therefore makes an ordinary person clearly stronger and
   then stops mattering; exceptional foundations require exceptional challenge.
3. **Per-foundation daily budgets** (8 h of stimulus each per world day). Recovery bounds each
   system separately; a day of hauling does not use up the attention tracking game develops.
4. **Rate.** `DEVELOPMENT_HOURS = 0.6`. With ceilings doing the gatekeeping, the rate sets how a
   deliberate trainee experiences progress: the first point of a trained foundation arrives within
   a single session; points beyond 12 take many sessions; potential still shapes the whole curve.
5. **Path-anchored Iron.** `IRON_FOUNDATION` stays 15. Iron is anchored on one practiced capability:
   the foundations its practice profile weights at ≥ 0.5 (at least two) must reach 15; every other
   foundation must reach `IRON_SUPPORT` = 11. The capability, technique-provenance, recovery and
   three-day-evidence requirements are unchanged. `advanceToIron` names the path on the event.
6. **Evidence sources.** Capability adapters now also accept a self-made kill of wild game
   (hunting) and completed martial practice/sparring sessions (both partners credited through the
   event's participants). Martial sessions are wired into the live simulation; a player can ask an
   ordinary villager to spar through dialogue, and the partner holds for the rounds.
7. **The veil as a discipline.** A taught person can meditate on the veil (sit ~30 world minutes):
   it develops will/perception/intellect up to challenge 13 and eases strain, but is not capability
   evidence, and credits the skill only a minute. Strain recovers on lived (world) time and eases
   with skill; the art is learned at 0.3× the ordinary per-minute rate (~60 real attempts to become
   reliable). Beyond 13, only real hush attempts develop the discipline further.

## Paths

| Path | Qualifying capability | Core at 15 | Support at 11 from | Main sources |
|---|---|---|---|---|
| Veil discipline | `veilcraft` (hush attempts) | will, perception | meditation (int), labour/walking (str/end/vit), sparring (dex) | hush attempts, meditation |
| Martial | `unarmed` (sparring) | dexterity, endurance | meditation or study (int/will/per), labour (str/vit) | sparring, labour |
| Hunter | `hunting` (kills, butchering) | perception, endurance, dexterity | as above | kills, butchering, sparring |
| Craft | `crafting` (mechanism fitting) | dexterity, perception | as above | fitting, making |

They do not have identical speed. Each path needs provenance-bearing technique knowledge of its
skill. A trade lesson records the `skill`; martial knowledge records the technique's `family`
and reaches a person through a martial lesson, by observing a technique performed, or by
discovering a variation in practice. The assessment reads either. (It once read only `skill`, so
the martial path could never pass. Its test had hand-built a trade-shaped claim and hid that.)

## Evidence

* `tests/progression-paths.test.ts`: plateau of routine labour, single-session progress,
  per-foundation budgets, path anchoring, sparring credit and a causal Iron transition, meditation
  limits. `tests/sparring.test.ts`: sparring through dialogue in the regional world.
* `scripts/alpha/iron-journey.ts`: an accelerated journey in the regional world through ordinary
  intents only (walking, dialogue, hush, meditation, advance), with ordinary autonomy between
  play sessions. Results are recorded in `docs/LIVING_ALPHA_RELEASE.md`.

## Measured pace (2026-09-25): Iron is not yet reachable in play time

The real `develop` calls, driven by a deliberate daily regimen (three meditations, 30 hush attempts,
4 spars, 6 solo drills, walking and optional hauling; `.debug/iron-estimate.ts`), reach veil-path
Iron for an ordinary adult in about 277 world days (potentials 11), 195 (12) or 138 (13). Support
foundations reach 11 in about 20–40 days. The long pole is the two core foundations at 15: past 13
they develop only through hush attempts, which strain limits to a few dozen short efforts a day. A
10-day accelerated journey in the regional world follows the estimate (day 3: strength 8,
dexterity 9, endurance 9, vitality 8, will 11).

At the live time scale (6), a world day is four real hours, so the first rank currently costs
hundreds of hours of play. This is a pacing decision for the canonical curve, which also governs
every NPC, so it is recorded here rather than retuned to produce a demonstration. Candidate
levers: a higher rate only for challenge above routine (NPC routine labour, which stops at about
11–12, would be unchanged), lower Iron thresholds, or more credited stimulus per real high-
challenge session (a spar round is credited as one minute).

## Deliberate-stimulus calibration under validation (2026-09-25)

The 50/100 handoff explicitly authorizes retuning first-rank pace. The candidate
keeps core/support thresholds at 15/11, potential resistance, challenge plateaus,
physiological gates and per-foundation eight-hour daily exposure limits.
It multiplies adaptation only above challenge 12:
`1 + 3 * clamp(challenge - 12, 0, 11/3)` (at most 12).
Ordinary labor and unspecified legacy hooks retain their previous response.
Recorded activity and capability hours are not multiplied or granted.

This addresses the measured 140–280-day deliberate-training tail without promoting
ordinary labor into elite development. NPCs and players use the same operator.
Synthetic estimates are calibration tools, not acceptance: the generated-person
journey must still reach Iron through ordinary intents.

The harness now buys food, drinks at wells, leaves mornings/nights for work and
recovery, and compares the full person/body/clock at each daily save/reload.
It no longer clears the mind's plan on connection. Play is 13:00–19:00; lack of
money, fatigue or unavailable necessities returns control to ordinary life.
No attributes, practice credits, wealth or advancement are injected.

Preliminary evidence: .debug/finish50/iron-calibrated, seed 918271.
Starting foundations 7/7/8/7/7/7/9; potentials 9/9/10/12/10/11/12
(str/dex/end/vit/int/per/will). Day 2: 9/10/11/9/11/12/13; wealth 12,
energy .92, hydration .77, zero veil strain. Daily reload equality passed.
127 NPCs remained Normal; highest NPC foundation was 11. Ordinary strength
and intellect means were nearly unchanged. This is **not yet an Iron pass**.


## First-rank evidence calibration (2026-09-25)

The real three-day trainee had only 0.60 effective hours of veil practice despite 17 attempts,
12 meditation sessions and real recovery. Novelty reduction means even an ideal, all-success
series of repeated person hushes needs 438 casts to accumulate eight effective hours. Retuning
foundations alone therefore leaves a separate, long repetition gate.

Normal→Iron now requires two effective practice hours instead of eight. This is a readiness
threshold, not a multiplier or award: every recorded second still comes from the same canonical
act, with unchanged quality, repetition penalties, provenance and daily caps. Skilled proficiency
(.55), evidence spanning three days, actual technique knowledge, core foundations 15, support 11
and recovery remain required. Meditation alone still cannot supply capability evidence or push
core foundations beyond its ceiling. An ideal repeated hush series needs at least 52 successes;
real failures and needs lengthen it. The generated journey remains the acceptance proof.

The journal now exposes meaningful-practice hours, proficiency, dated evidence, all current
blockers, and both trade-shaped and martial-family technique provenance. The journey policy
allows free training while fed even without a cash reserve, and asks other nearby willing
partners before falling back to solo drills. Necessities, fatigue and ordinary work remain real.

## Martial practice correction (2026-09-26)

Tracing the first trainee exposed a second family-proficiency award in the capability adapter,
after martial practice had already applied its mastery and solo-family ceilings. A completed
solo session raised a test subject's .65 family skill to .6672256 despite the .35 solo ceiling.
The martial learning operator now owns proficiency and mastery alone. The completed-session
adapter owns the associated foundation conditioning and provenance ledger, without duplicating
either proficiency or conditioning. Solo practice cannot raise existing skill above its ceiling;
skilled bodies still receive conditioning from real completed sessions.

Deliberate solo form practice now demands foundation level 13 (previously 11.5 in the adapter),
above incidental labor but below Iron's core level 15. Sparring retains demand 15.5. Effective
practice time, repetition penalties, daily limits, physiological gates and potential resistance
are unchanged. This permits healthy balanced conditioning of supporting foundations without
making solo drills a complete martial Iron path. NPCs use the same rules; routine work is unchanged.

The earlier generated trainee is preserved through day 6.642 as diagnostic history. Its skill
was affected by the duplicate award, so final acceptance begins with a newly generated person
on the corrected rules rather than editing that person's skill or retroactively claiming a pass.
The focused martial/development/capability integration passed 38 tests, including the reproduced
solo-ceiling defect, and typecheck passed. The genuine completed journey remains required.
