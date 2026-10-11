/** Shared encounter budgets. Design parameters, not empirical player clear-time estimates. */
export function towerEncounter(floor: number) {
  const f = Math.min(100, Math.max(1, Math.floor(floor))), depth = (f - 1) / 99;
  return {
    enemies: Math.min(32, 3 + Math.floor(f * .3)),
    rangedShare: f < 3 ? 0 : .12 + depth * .22,
    heavyShare: f < 5 ? 0 : .12 + depth * .2,
    attackTokens: f < 15 ? 2 : f < 70 ? 3 : 4,
    alertRadius: 13 + depth * 7, reinforcementRadius: 5 + depth * 3,
    flank: .15 + depth * .3, cooldown: 1.15 - depth * .35, tell: 1.1 - depth * .2,
    hp: (.78 + Math.min(f, 10) * .022) * (1 + Math.max(0, f - 10) * .065),
    damage: (.55 + Math.min(f, 10) * .045) * (1 + Math.max(0, f - 10) * .032),
    refill: f === 1 || f % 10 === 1 ? 'rest' as const : 'one' as const,
  };
}
