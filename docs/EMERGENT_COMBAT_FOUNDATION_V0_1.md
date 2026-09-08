# Emergent combat foundation v0.1

`Simulation.resolveAttack(CombatAttackIntent)` is the canonical entry point. NPC actions and the browser/bridge melee adapters reach it through `Simulation.attack`. Intent identifies an actor, its selected body, a target body, `strike`, optional weapon ID, and existing conflict intent. It never specifies damage or success.

`physical/combat.ts::resolveCombatAttack` reads world state without mutation, validates eligibility, ownership, cooldown, three-dimensional body-origin distance and solid passage, then uses the supplied deterministic RNG. Invalid intents return reason-coded results without spending resources or RNG. A legal strike currently connects automatically: no evasion or accuracy lottery is introduced. Strength, dexterity and handling determine delivered impact with a single seeded 0.8–1.2 variation.

Weapon semantics use the existing item type and damage field (base impact), avoiding a second persisted weapon database or equipment system. Omitted weapon selects the highest-impact usable carried melee item; explicit null selects fists. Possession requires both inventory membership and matching holder. Broken tools are ineligible.

| Case | Reach (metres, body origin) | Base impact | Handling |
| --- | ---: | ---: | ---: |
| Fists | 2.1 | 7 | 1 |
| Dagger | 2.4 | existing damage (14) | 0.95 |
| Sword | 3.2 | existing damage (26) | 0.8 |
| Axe | 2.7 | existing damage (22) | 0.65 |
| Hammer | 2.4 | existing damage (20) | 0.6 |
| Stone axe | 2.5 | existing damage (14) | 0.55 |

These are deliberately coarse prototype distances including the bodies' separation, not blade lengths. Existing named-item damage overrides retain their meaning. No new save fields are required.

Physical capability comes from `getPhysicalCapability`, with the attacking manifestation supplied explicitly for wound effects. Existing fatigue, caloric energy, sleep debt and wound penalties affect strength/dexterity; existing heat and strength influence fatigue cost. Each legal attempt adds `0.025 * (2 - handling) * fatigueMultiplier`, bounded by remaining fatigue capacity, to canonical physiology fatigue and synchronizes derived needs. Existing rest/sleep recovery remains authoritative. Repeated attacks lower future impact; no disconnected stamina bar exists.

`Simulation.resolveAttack` commits exertion/pose and delegates health consequences to the existing `applyHit` adapter. It supplies explicit `injure` when intent is omitted, so player control never changes lethality in this path. Existing low-level `applyHit` callers retain compatibility. Existing social consequences are preserved without new law, reputation, surrender or morale features.

The existing perceivable `attack` event contains `data.combat`, the structured result, before downstream consequence handling. The bridge already forwards event data and now reports each actor's actual weapon reach. Rejected intents remain returned results rather than perceived events. `combatTrace(result)` formats a concise debug line without affecting state. Empty untargeted presentation swings retain the existing recovery-only behavior; they do not resolve a target attack.

Deferred: body-part injuries, bleeding, armor, blocking/parrying, evasion, grappling, advanced tactics, progression/mastery, magic, ranged combat and new Unreal presentation. Best next layer: a minimal canonical injury consequence adapter replacing flat health subtraction while retaining this intent/resolution boundary.

Validation note: the existing responsibility trace's multi-trip fixture now filters stock using actual personal carrying capacity. Combat changes the warm-up history and which workers remain fit; an average-capacity estimate no longer guaranteed multiple trips. The original seed and all acceptance assertions are retained, and no society runtime logic changes.

## Minimal localized injury continuation

A humanoid body's optional `injuries` map stores peak severity (0..1) for `head`, `torso`, `arm`, and `leg`. No left/right anatomy is introduced. `physical/injury.ts::injuryFromImpact` maps the resolver's existing seeded draw to a region and computes `min(1, impact / maxHealth)`. Reusing the draw preserves the one-draw combat contract; region and impact variation are correlated in this coarse model. Non-humanoid anatomy is deferred.

`resolveCombatAttack` returns `injury` (null for rejected/non-injuring outcomes). `Simulation.resolveAttack` applies it to the selected target body before existing health consequences emit `attack.data.combat`. The bridge already forwards that result. State keeps the maximum severity seen per region; individual impacts and provenance remain in attack events. Flat health subtraction is unchanged.

Effects remain in `core/attributes.ts`: head/torso severity extends general wound severity; arm severity shares the existing strength/dexterity wound multiplier, `1 - 0.65 * max(generalWound, armSeverity)`, rather than stacking another penalty. Leg severity produces `movementMultiplier = 1 - 0.65 * legSeverity`. NPC path following, browser movement, bridge movement and reported bridge speed all consume that multiplier. At leg severity 0.5, movement speed is 67.5% of its ordinary value. Effects follow the selected body, not identity's primary body when another manifestation acts.

Save version 16 persists regional injury state; earlier saves are not resumable. Existing health recovery does not clear these injuries. Healing/treatment, decay, repeated-injury accumulation, non-humanoid anatomy, tissue/bone/organ detail and independent location randomness are future work. No bleeding, armor, defensive actions, infection, scars, unconsciousness/death overhaul, progression, mastery, techniques, ranged combat, tactics, morale or Unreal animation is added.

Validation for the injury continuation: targeted combat/injury/persistence tests passed (25); typecheck and build passed. The full suite was run once with two workers: 551/552 passed. The existing generated-village family trace at seed 606060 now reports only one distinct goal kind (`provide`) across one adoption, failing its multi-step acceptance check. This remains an outstanding trace regression; society logic, scenario seed and assertions were not retuned in this constrained slice.
