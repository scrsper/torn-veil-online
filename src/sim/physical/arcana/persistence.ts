import type { World } from '../../core/world';
import { ARCANE_DEFINITIONS, KERNEL_GEOMETRY } from './definitions';
import { TRANSFORMATIONS } from './growth';
import { ONTOLOGICAL_STAGES } from '../../core/stages';
const bounded = (n: unknown, low: number, high: number) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const record = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o);

/** Fail closed on malformed new mechanics. Legacy worlds simply have no components. */
export function validArcaneWorld(w: World, saveVersion: number): boolean {
  for (const i of w.items()) {
    if (i.arcaneFocus && (saveVersion < 31 || i.arcaneFocus.version !== 1 || !bounded(i.arcaneFocus.amplitude, 1, 20)
      || !bounded(i.arcaneFocus.aperture, 1, 12) || !bounded(i.arcaneFocus.reserve, 100, 320))) return false;
    if (i.arcaneSource) {
      const s = i.arcaneSource;
      if (saveVersion < 28 || s.version !== 1 || !ARCANE_DEFINITIONS.has(s.abilityId) || !['book', 'essence', 'scroll'].includes(s.kind)) return false;
    }
    if (i.physicalArmor) {
      const a = i.physicalArmor;
      if (saveVersion < 28 || a.version !== 1 || !bounded(a.absorption, 0, 50) || !Array.isArray(a.coverage)
        || !a.coverage.length || a.coverage.length > 4 || new Set(a.coverage).size !== a.coverage.length
        || a.coverage.some(r => !['head', 'torso', 'arm', 'leg'].includes(r))) return false;
    }
  }
  for (const p of w.persons()) if (p.arcana) {
    if (saveVersion < 28 || p.arcana.version !== 1 || !record(p.arcana.learned) || Object.keys(p.arcana.learned).length > ARCANE_DEFINITIONS.size) return false;
    for (const [id, l] of Object.entries(p.arcana.learned)) {
      const e = w.event(l.eventId);
      if (!ARCANE_DEFINITIONS.has(id) || !e || e.type !== 'arcane_learned' || e.actor !== p.id || e.item !== l.itemId
        || e.data.abilityId !== id || !w.item(l.itemId) || !Number.isSafeInteger(l.applications) || l.applications < 0) return false;
    }
    const g = p.arcana.growth;
    if (g) {
      if (saveVersion < 31 || g.version !== 1 || !record(g.victories) || !record(g.demonstrations)
        || Object.keys(g.victories).length > 2048 || Object.keys(g.demonstrations).length > ARCANE_DEFINITIONS.size) return false;
      for (const [id, v] of Object.entries(g.victories)) {
        const e = w.event(v.eventId);
        if (!bounded(v.quality, 0, 1) || !w.person(id) || e?.type !== 'attack' || e.actor !== p.id || e.target !== id || e.data.health > 0 || !(e.data.damage > 0)) return false;
        if (!Array.isArray(v.receivedEventIds) || new Set(v.receivedEventIds).size !== v.receivedEventIds.length) return false;
        const costs = v.receivedEventIds.map(id => w.event(id)), body = w.body(e.data.attackerBodyId);
        if (!body || costs.some(c => c?.type !== 'attack' || c.actor !== id || c.target !== p.id || c.data.conflictId !== e.data.conflictId
          || !(c.data.damage > 0) || c.tick > e.tick)
          || Math.abs(v.quality - Math.max(0, 1 - costs.reduce((n,c) => n + c!.data.damage, 0) / body.maxHealth)) > 1e-8) return false;
      }
      for (const [id, demonstrations] of Object.entries(g.demonstrations)) {
        if (!p.arcana.learned[id] || !record(demonstrations) || Object.keys(demonstrations).length > 64) return false;
        for (const [target, eventId] of Object.entries(demonstrations)) {
          const e = w.event(eventId), cast = e && w.event(e.data.arcaneEventId);
          if (e?.type !== 'attack' || e.actor !== p.id || e.data.targetBodyId !== target || !(e.data.damage > 0)
            || cast?.type !== 'arcane_cast' || cast.actor !== p.id || cast.data.abilityId !== id) return false;
        }
      }
      const t = g.transformation;
      if (t) {
        const e = w.event(t.eventId), rule = TRANSFORMATIONS.find(r => r.stage === e?.data.to);
        if (!rule || e?.type !== 'ontological_advancement' || e.actor !== p.id || e.data.adaptation !== 'source-integrated arcane capacity'
          || p.ontology.stage !== rule.stage || p.ontology.breakthroughEventId !== e.id
          || t.amplitude !== rule.amplitude || t.aperture !== rule.aperture || t.reserve !== rule.reserve
          || e.data.amplitude !== t.amplitude || e.data.aperture !== t.aperture || e.data.reserve !== t.reserve
          || e.data.from !== ONTOLOGICAL_STAGES[ONTOLOGICAL_STAGES.indexOf(rule.stage) - 1]
          || !Array.isArray(e.data.materialIds) || !e.data.materialIds.length || new Set(e.data.materialIds).size !== e.data.materialIds.length
          || !Array.isArray(e.data.materialAmounts) || e.data.materialAmounts.length !== e.data.materialIds.length
          || e.data.materialAmounts.some((n: number) => !Number.isInteger(n) || n <= 0)
          || e.data.materialAmounts.reduce((a: number, b: number) => a + b, 0) !== rule.materials
          || e.data.materialIds.some((id: string) => !w.item(id)?.provenance.some(v => v.eventId === e.id && v.how === 'essence integrated into embodied capacity'))) return false;
        const victories = Object.values(g.victories).filter(v => e.causes.includes(v.eventId));
        const forms = new Set(Object.entries(g.demonstrations).filter(([, proofs]) => Object.values(proofs).filter(id => e.causes.includes(id)).length >= 3)
          .map(([id]) => ARCANE_DEFINITIONS.get(id)?.kernel));
        const essences = Object.entries(p.arcana.learned).filter(([id,l]) => ARCANE_DEFINITIONS.get(id)?.source === 'essence' && e.causes.includes(l.eventId));
        if (victories.length < rule.victories || forms.size < rule.forms || essences.length < rule.essences
          || rule.stage === 'Gold' && victories.reduce((n,v) => n + v.quality,0) / victories.length < .97) return false;
      }
    }
  }
  for (const b of w.bodies()) if (b.arcana) {
    const a = b.arcana;
    if (saveVersion < 28 || a.version !== 1 || !bounded(a.mana, 0, saveVersion >= 31 ? 320 : 100) || !bounded(a.sampledAt, 0, w.physicalTime + 1e-6)
      || !record(a.cooldowns) || Object.keys(a.cooldowns).length > ARCANE_DEFINITIONS.size || !Array.isArray(a.effects) || a.effects.length > 6) return false;
    for (const [id, until] of Object.entries(a.cooldowns)) if (!ARCANE_DEFINITIONS.has(id) || !bounded(until, 0, w.physicalTime + 120)) return false;
    if (new Set(a.effects.map(e => e.kind)).size !== a.effects.length) return false;
    for (const e of a.effects) if (!['ward', 'chill', 'haste', 'frenzy', 'wet', 'imbue'].includes(e.kind)
      || !bounded(e.until, 0, w.physicalTime + 30) || !bounded(e.strength, 0, saveVersion >= 31 ? 1000 : 100) || !w.body(e.sourceBodyId)
      || w.event(e.sourceEventId)?.type !== 'arcane_cast') return false;
    if (a.cast) {
      const c = a.cast, d = ARCANE_DEFINITIONS.get(c.abilityId), e = w.event(c.eventId);
      if (!d || c.kernel !== d.kernel || !KERNEL_GEOMETRY[c.kernel] || c.bodyId !== b.id || c.id !== c.eventId
        || !e || e.type !== 'arcane_cast' || e.actor !== b.ownerId || e.data.bodyId !== b.id || e.data.abilityId !== c.abilityId
        || typeof c.resolved !== 'boolean' || typeof c.cancelled !== 'boolean' || !record(c.target)
        || ![c.target.x, c.target.y, c.target.z, c.facing].every(Number.isFinite)
        || !bounded(c.startedAt, 0, w.physicalTime + 1e-6) || !bounded(c.activeAt, c.startedAt, c.startedAt + 5)
        || !bounded(c.completeAt, c.startedAt, c.startedAt + 10) || !bounded(c.damage, 0, saveVersion >= 31 ? 1000 : 100) || !bounded(c.power, 0, saveVersion >= 31 ? 30 : 3)
        || !bounded(c.range, 0, saveVersion >= 31 ? 144 : 20) || !bounded(c.radius, 0, saveVersion >= 31 ? 30 : 12) || !Array.isArray(c.riders)
        || JSON.stringify(c.riders) !== JSON.stringify(d.riders)) return false;
    }
  }
  return true;
}
