// Measured development exposure from ordinary autonomous life (read-only over retained saves).
//   node --import tsx scripts/alpha/development-exposure.ts <dir-with-day-N.save.json> [...more dirs] --out <json>
// For each consecutive pair of day saves, reports every living adult's development-exposure
// delta per foundation (weighted stimulus seconds before physiology/instruction), attribute
// changes and occupation. No simulation is run and no save is modified.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
const dirs = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
const IDS = ['strength', 'dexterity', 'endurance', 'vitality', 'intellect', 'perception', 'will'] as const;

type P = { id: string; alive: boolean; age: number; occupation: string; attributes: Record<string, number>; attributePotential: Record<string, number>;
  development?: { exposure: Record<string, number> }; capability?: { bySkill: Record<string, { effectiveSeconds: number }> }; skills?: Record<string, number> };
function persons(file: string): Map<string, P> {
  const save = JSON.parse(readFileSync(file, 'utf8'));
  const list: P[] = save.persons ?? save.world?.persons ?? [];
  return new Map(list.map(p => [p.id, p]));
}
const rows: Record<string, unknown>[] = [];
const byOccupation = new Map<string, { n: number; hours: Record<string, number> }>();
for (const dir of dirs) {
  const days = readdirSync(dir).map(n => /^day-(\d+)\.save\.json$/.exec(n)).filter(Boolean).map(m => Number(m![1])).sort((a, b) => a - b);
  for (let i = 1; i < days.length; i++) {
    const a = join(dir, `day-${days[i - 1]}.save.json`), b = join(dir, `day-${days[i]}.save.json`);
    if (!existsSync(a) || !existsSync(b)) continue;
    const before = persons(a), after = persons(b);
    for (const [id, q] of after) {
      const p = before.get(id); if (!p || !q.alive || q.age < 16 || !p.development || !q.development) continue;
      const hours = Object.fromEntries(IDS.map(k => [k, ((q.development!.exposure[k] ?? 0) - (p.development!.exposure[k] ?? 0)) / 3600]));
      const gained = Object.fromEntries(IDS.map(k => [k, q.attributes[k] - p.attributes[k]]));
      rows.push({ dir, day: days[i], id, occupation: q.occupation, age: Math.round(q.age), hours, gained });
      const o = byOccupation.get(q.occupation) ?? { n: 0, hours: Object.fromEntries(IDS.map(k => [k, 0])) };
      o.n++; for (const k of IDS) o.hours[k] += hours[k]; byOccupation.set(q.occupation, o);
    }
  }
}
const occupations = [...byOccupation].map(([occupation, o]) => ({ occupation, personDays: o.n,
  meanWeightedHoursPerDay: Object.fromEntries(IDS.map(k => [k, Math.round(o.hours[k] / o.n * 1000) / 1000])) }))
  .sort((x, y) => y.personDays - x.personDays);
const result = { kind: 'measured weighted development exposure per world day (seconds × intensity × weight)', dirs, personDays: rows.length, occupations };
if (out) writeFileSync(out, JSON.stringify({ ...result, rows }, null, 2));
console.log(JSON.stringify(result, null, 2));
