# Tower expedition checkpoints

The Tower is a playable expedition inside Torn Veil. The combined-world integration owns its exterior building,
portals and world-player transfer; this branch supplies the interior and expedition rules.

Normal climbs save a versioned checkpoint at the start of each floor. Reload offers **Continue climb** or an explicit **New climb**. Continue reconstructs that floor and restores the same expedition/climber identities, capabilities, rolled gear, learned skill identities and slots, consumables, health, mana, progression and subsequent loot RNG. Mid-floor work rolls back to that boundary; the menu states this. Combat bodies and scene objects are rebuilt rather than serialized.

The next floor's checkpoint includes gifts, loot and progression from completed floors. Resuming it does not rerun their reward handlers. Codex and lifetime achievement receipts also prevent a floor retry from recording the same run discovery twice. Death and victory end only the matching expedition checkpoint, preserving existing retry behavior and lifetime discoveries. This adds no permanent character death rule.

The Proving Hall and explicit `floor` previews cannot overwrite an expedition. Leaving practice starts or continues a real climb; demonstration XP and modifiers are discarded. Existing Codex and achievement records remain, and legacy world saves are untouched.

Corrupt or incompatible expedition data stays in storage until the player explicitly chooses New climb. The recovery menu can download it. Unavailable storage produces a warning instead of a false saved-state claim. This first slice saves in the current browser origin; it is not cross-device/server persistence.

Checks: `npx vitest run tests/tower-checkpoint.test.ts tests/web-magic.test.ts`, root typecheck, and the actual-browser checkpoint harness. Automation verifies continuation with rolled gear and a Time-gift fixture, spell identity links, practice isolation, death and corrupt recovery. These are functional checks, not human balance approval.

## Simulation rules and integration contract (October 8)

`src/sim/progression/tower.ts` is the deterministic, browser-safe owner of expedition practice credit, completed-floor
receipts, loot capability rewards, level, tier and emergent-class assessment. It imports no renderer, DOM, storage,
clock, random source or world stepper. `src/web/arena/tower/capability.ts` re-exports those rules and keeps only display
colours and the browser Codex adapter. `TowerRun` submits observed encounter actions and projects the resulting level
into `ArenaWorld`; the Tower no longer uses the gym's parallel kill-XP curve.

The host-facing API is:

- `newSheet()` and `startJourney(sheet, seed, preview?)`: create expedition capability history.
- `beginFloor(sheet, floor, targets)`: register the actual encounter roster, in order. Preview floors cannot earn rank.
- `practice(sheet, action)`: bounded hit, kill and spell practice; actual damage taken; active time. Repeated kills,
  healed-target damage and idle casting cannot provide unlimited credit.
- `reward(sheet, floor, receiptId, reward)`: consume an actual loot/choice receipt once; at most 40 per floor. Salvage
  and repeated elemental procs do not independently train capabilities.
- `finishFloor(sheet, floor)` / `finishTrial(sheet)`: complete one proven encounter and pay its receipt once.
- `restoreFloor(...)`: rebind ephemeral actor IDs only from an untouched floor-start snapshot.
- `levelOf`, `advancement`, `emergentClass`: derive authoritative expedition projections.
- `towerSummary(sheet): TowerSummary`: detached, versioned host projection containing seed, preview/legacy flags,
  completed floors, full-clear status, level/XP, tier/progress/reason, class identity and active seconds.

The caller owns `runId` and `climberId` (currently browser-generated UUIDs); they are stored alongside the sheet in
`TowerCheckpoint`. They are **not** currently canonical `Person` IDs. Browser observations and localStorage are not
server-trusted evidence. This branch does not grant a world Person a Bronze/Silver/Gold breakthrough or weaken the
ordinary world's existing metaphysical gates. The combined-game host must bind identity and validate canonical
events before applying any world-character outcome. No world return/transfer endpoint is implemented here.

Current entry routes: `?arena=1&tower=1&seed=<seed>` for a persistent expedition, `&hall=1` for practice, and an explicit
`&floor=<n>` for a disposable preview. Do not add `floor=1` when entering a real climb. The storage key is
`tv.tower.expedition.v1`; its schema remains version 1 with an optional journey field for additive migration. Legacy
gear and attained level are preserved, an exact recovery copy is saved before future writes, and prior mastery is
not invented. The absence of past mastery prevents legacy runs earning Gold. A checkpoint larger than the reader's
500,000-character limit is rejected before replacing the previous save.

## Pacing and evidence limits

First classes require sustained capability over at least six completed floors; elemental classes require at least
18. Iron, Bronze and Silver expedition milestones occur at 10, 30 and 65 proven floors. Every legitimate full clear
therefore finishes at least Silver. Gold additionally requires a full non-legacy ascent, mean mastery >=94%, boss
mastery >=90%, and style rank >=8. Mastery is derived from actual damage taken relative to maximum health. Gold is
earned by outcomes, never rolled randomly. An unlocked class/tier is a summary of these capabilities and receipts;
combat still evaluates attacks, resources and equipment.

Encounter budgets in `towerEncounters.ts` increase opposition count/composition, awareness and reinforcement range,
flanking and attack pressure, alongside HP and damage. Ranged enemies require sight lines. Flask attrition matters:
ordinary floors replenish one, and rest floors replenish fully. Boss and trial floors remain deliberate difficulty
peaks; the immediately following ordinary floor is not claimed to be harder than that boss.

`scripts/web/tower-pacing-model.ts` estimates 300 successful cases across 60 seeds and five styles. Its initial
assumptions yield a 259-minute median and 14/300 Gold results (4.67%). **This is an assumption-driven design model,
not a full combat simulation or observed player distribution.** Its DPS, travel, competence and damage assumptions
are included in `.debug/tower-pacing-oct8.json`. Actual multi-hour completion time, survival rate and Gold rarity
still need sustained playtesting; the numbers must not be reported as measured player outcomes.

October 8 recovery evidence: the initially accepted `checkpoint-nav-rewards-oct8` run failed (7/10 checks, no kills).
Navigation only considered walls and led the real-input driver into furniture. After routing around all solid props
and repairing the driver, `restored-navigation-oct8` reached floor 3 in 51 seconds with zero console/page errors, and
`checkpoint-fixed-oct8` passed all 23 recovery checks with zero page errors. The pre-reversion 103-test run is not
used as evidence for the restored implementation.
