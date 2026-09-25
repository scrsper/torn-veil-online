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
