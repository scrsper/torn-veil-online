/** Design model, NOT a human playtest or a combat-engine victory simulation.
 * Uses actual floor rosters, health budgets and canonical progression actions. Combat efficiency,
 * exploration, menu time and damage outcomes are declared assumptions. Gold is assessed from
 * those outcomes, never randomly awarded. This cohort is not an estimated population distribution.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { advancement, beginFloor, emergentClass, finishFloor, finishTrial, levelOf, newSheet, practice, startJourney, type Style } from '../../src/sim/progression/tower';
import { towerEncounter } from '../../src/sim/progression/towerEncounters';
import { planFloor } from '../../src/web/arena/tower/floorgen';
import { FOES } from '../../src/web/arena/combat';
import { mulberry } from '../../src/web/render/noise';
const styles: Style[] = ['fists', 'blade', 'heavy', 'axe', 'bow'];
const efficiency: Record<Style, number> = { fists: .88, blade: 1, heavy: 1.12, axe: 1.05, bow: .96 };
const cases: { seed: number; style: Style; competence: number; minutes: number; tier: string; progress: number; level: number; classFloor: number | null; milestones: Record<string, number> }[] = [];
const byFloor: { floor: number; enemies: number; hp: number; seconds: number }[][] = [];
for (let seed = 1; seed <= 60; seed++) for (const style of styles) {
  const rng = mulberry(seed * 31337 + styles.indexOf(style) * 977), competence = .3 + .7 * Math.pow(rng(), 1.5);
  const sheet = newSheet(); startJourney(sheet, seed); let seconds = 0, classFloor: number | null = null;
  const milestones: Record<string, number> = {}, floors: typeof byFloor[number] = [];
  for (let floor = 1; floor <= 100; floor++) {
    const p = planFloor(seed, floor), budget = towerEncounter(floor);
    const targets = p.foes.map((f, i) => ({ id: `${floor}:${i}`, kind: f.kind, hp: Math.round(FOES[f.kind].hp * budget.hp), boss: false }));
    if (p.boss) targets.push({ id: `${floor}:boss`, kind: p.boss.kind, hp: Math.round(FOES[p.boss.kind].hp * budget.hp * p.boss.hpMul), boss: true });
    const hp = targets.reduce((n, t) => n + t.hp, 0);
    const dps = (28 + floor * 2.6) * efficiency[style] * (.75 + .4 * competence);
    const fighting = floor === 10 ? 180 : hp / dps + targets.length * 1.7;
    const exploration = p.half * 3.8 / 4.7 + (p.maze?.rooms.length ?? 3) * 1.1;
    const decisions = 8 + p.chests.length * 2 + (p.boss ? 12 : 0);
    const time = fighting + exploration + decisions;
    if (!beginFloor(sheet, floor, targets)) throw Error(`rejected floor ${floor}`);
    for (let remaining = time; remaining > 0; remaining -= .25) practice(sheet, { kind: 'time', seconds: Math.min(.25, remaining) });
    const damage = (1 - competence) * 1.15 + rng() * .04;
    practice(sheet, { kind: 'hurt', fraction: damage });
    if (floor === 10) finishTrial(sheet);
    else {
      for (const t of targets) { practice(sheet, { kind: 'hit', target: t.id, damage: t.hp, style }); practice(sheet, { kind: 'kill', target: t.id, style }); }
      if (!finishFloor(sheet, floor)) throw Error(`rejected proof ${floor}`);
    }
    seconds += time; const rank = advancement(sheet).tier;
    milestones[rank] ??= floor; if (classFloor === null && emergentClass(sheet)) classFloor = floor;
    floors.push({ floor, enemies: targets.length, hp, seconds: time });
  }
  const a = advancement(sheet);
  cases.push({ seed, style, competence, minutes: seconds / 60, tier: a.tier, progress: a.progress, level: levelOf(sheet).level, classFloor, milestones });
  if (seed === 7) byFloor.push(floors);
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const summary = { cases: cases.length, gold: cases.filter(c => c.tier === 'Gold').length, belowSilver: cases.filter(c => !['Gold', 'Silver'].includes(c.tier)).length,
  goldPercent: cases.filter(c => c.tier === 'Gold').length / cases.length * 100,
  minutes: { p10: percentile(cases.map(c => c.minutes), .1), median: percentile(cases.map(c => c.minutes), .5), p90: percentile(cases.map(c => c.minutes), .9) },
  perStyle: styles.map(style => { const rows = cases.filter(c => c.style === style); return { style, medianMinutes: percentile(rows.map(c => c.minutes), .5), gold: rows.filter(c => c.tier === 'Gold').length }; }) };
const assumptions = { evidence: 'MODEL ONLY: successful-run outcomes supplied; no human or combat-engine full clears', effectiveDps: '(28 + floor*2.6) * styleEfficiency * (.75 + .4*competence)',
  competence: '.3 + .7 * seededUniform^1.5 (illustrative cohort, not measured players)', normalizedDamage: '(1-competence)*1.15 + seededUniform*.04 per floor',
  travel: 'half-size*3.8/4.7 + roomCount*1.1 seconds; includes assumed detours', enemyReposition: '1.7 seconds per foe', menus: '8 seconds + 2 per chest + 12 on boss floors',
  limitations: ['No healing/death probability model; cohort is conditional on successful clears', 'No full fight, pathfinding, gear-drop or player learning simulation', 'Actual human duration, fun, survival and Gold incidence require playtesting', 'Changing assumptions changes estimated duration and Gold incidence'] };
mkdirSync('.debug', { recursive: true }); writeFileSync('.debug/tower-pacing-oct8.json', JSON.stringify({ summary, assumptions, cases, representativeFloors: byFloor }, null, 2));
console.log(JSON.stringify({ summary, assumptions }, null, 2));
