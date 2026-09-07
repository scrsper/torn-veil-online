import type { Person, SkillId } from '../core/types';
import type { World } from '../core/world';
import { skillOf } from '../core/skills';

/**
 * Capability before class (Constitution §12).
 *
 * A class here is a RECOGNITION, not a label anyone is issued and not a container of stats. The
 * lowest-level truth stays where it already is — attributes, skills that only rose through real
 * successful practice, and the canonical record of what this person has actually done. This
 * module reads that truth and asks one question: does it form a pattern a culture would have a
 * name for? Nothing here writes to the world, nothing here multiplies a stat, and nothing here
 * grants a permission. A recognised Armsman hits exactly as hard as the same person did before
 * anybody recognised them.
 *
 * Three names only, and deliberately so — the point of v0.1 of this layer is the derivation, not
 * a roster. Occupation is not an input and must not become one: `p.occupation` is never read in
 * this file. Ashford's guards mostly qualify as Armsmen, but they qualify because they have
 * stood in real fights, and a guard who never has does not qualify. The same derivation runs for
 * the player, from the same fields.
 *
 * A recognition can be wrong. `confidence` is how strongly the pattern holds, never a promise.
 */
export type ClassId = 'armsman' | 'artisan' | 'scout';

export interface RecognisedClass {
  id: ClassId;
  /** What this culture calls the pattern. Another civilization may name it differently. */
  name: string;
  /** 0..1 — how cleanly the pattern holds. Never 1: recognition is a reading, not a fact. */
  confidence: number;
  /** The canonical evidence the reading rests on, in plain words. */
  evidence: string[];
}

/** Enough of a qualifying pattern to be worth a name at all. Below this, someone is just a person. */
const RECOGNITION_THRESHOLD = 0.5;
/** Roughly the proficiency at which a person is unmistakably good at something. Scores are read
 * against this rather than against theoretical mastery, which nobody in Ashford is near. */
const ACCOMPLISHED = 0.7;

/** The makings. Breadth across them separates a maker from a labourer good at one motion. */
const CRAFT_SKILLS: SkillId[] = ['crafting', 'baking', 'cooking', 'construction', 'sawing'];
/** Skills whose practice happens away from a workbench, out in the country. */
const FIELD_SKILLS: SkillId[] = ['herbalism', 'woodcutting', 'quarrying', 'hauling'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How many blows this person has actually stood in the middle of, across every conflict the
 * world still remembers them being party to. A `Conflict` is canonical, durable history with real
 * provenance — unlike a memory, it does not fade out of a 60-entry window. */
function blowsStoodIn(world: World, p: Person): { blows: number; conflicts: number } {
  let blows = 0, conflicts = 0;
  for (const c of world.conflicts) {
    if (!c.participants.includes(p.id)) continue;
    conflicts++; blows += c.attackCount;
  }
  return { blows, conflicts };
}

/** Does this person keep something that can hurt someone? Carrying a weapon is a circumstance,
 * not a capability — it counts for a little, and only alongside a history of using one. */
function armed(world: World, p: Person): boolean {
  return p.inventory.some(id => { const it = world.item(id); return !!it && it.damage > 0; });
}

/** Places this person has learned about with their own eyes. First-hand only: being told where
 * the mill is does not mean you have been there (Constitution: knowledge remains local). */
function placesKnownFirsthand(p: Person): number {
  const seen = new Set<string>();
  for (const k of Object.values(p.knowledge)) {
    if (k.hops !== 0) continue;
    if (k.kind !== 'location' && k.kind !== 'service') continue;
    const where = k.claim.placeId ?? k.claim.place ?? k.claim.subject ?? k.key;
    if (typeof where === 'string') seen.add(where);
  }
  return seen.size;
}

interface Candidate { id: ClassId; name: string; score: number; evidence: string[] }

/**
 * The single ontology, run identically for an NPC and for the player. Returns the strongest
 * qualifying pattern, or null when nobody's life has yet made one — which is the ordinary case.
 */
export function recogniseClass(world: World, p: Person): RecognisedClass | null {
  const candidates: Candidate[] = [];

  // ---------------------------------------------------------------- Armsman
  // Someone who has been in real fighting and kept doing it. Strength is the capability; the
  // conflicts are the history; a kept weapon is the circumstance. One brawl is not a vocation,
  // which is why a second conflict counts for as much as several more blows in the first.
  {
    const { blows, conflicts } = blowsStoodIn(world, p);
    const history = clamp01(blows / 10) * 0.65 + clamp01((conflicts - 1) / 2) * 0.35;
    const capability = clamp01((p.attributes.strength - 0.35) / 0.5);
    const score = history <= 0 ? 0 : clamp01(history * 0.75 + capability * 0.2 + (armed(world, p) ? 0.05 : 0));
    if (score > 0) candidates.push({
      id: 'armsman', name: 'Armsman', score,
      evidence: [
        `${blows} exchanged blow${blows === 1 ? '' : 's'} across ${conflicts} conflict${conflicts === 1 ? '' : 's'}`,
        `strength ${p.attributes.strength.toFixed(2)}`,
        armed(world, p) ? 'carries a weapon' : 'carries no weapon',
      ],
    });
  }

  // ---------------------------------------------------------------- Artisan
  // Someone who makes things. Skills only rise through real successful work, so the proficiency
  // IS the history — and breadth across several makings is what distinguishes a maker from
  // someone who has repeated one motion many times.
  {
    const levels = CRAFT_SKILLS.map(s => skillOf(p, s)).sort((a, b) => b - a);
    const depth = levels[0];
    const breadth = levels.filter(v => v >= 0.15).length;
    const capability = clamp01((p.attributes.dexterity - 0.35) / 0.5);
    const score = depth < 0.2 ? 0 : clamp01(clamp01(depth / ACCOMPLISHED) * 0.7 + clamp01((breadth - 1) / 2) * 0.2 + capability * 0.1);
    if (score > 0) candidates.push({
      id: 'artisan', name: 'Artisan', score,
      evidence: [
        CRAFT_SKILLS.map(s => ({ s, v: skillOf(p, s) })).filter(x => x.v >= 0.05).sort((a, b) => b.v - a.v)
          .map(x => `${x.s} ${x.v.toFixed(2)}`).join(', ') || 'no making skill',
        `${breadth} making${breadth === 1 ? '' : 's'} practised past a novice's hands`,
        `dexterity ${p.attributes.dexterity.toFixed(2)}`,
      ],
    });
  }

  // ---------------------------------------------------------------- Scout
  // Someone whose own perception has ranged widely, and who works away from a bench. Second-hand
  // directions do not count: this is ground actually covered.
  {
    const levels = FIELD_SKILLS.map(s => skillOf(p, s)).sort((a, b) => b - a);
    const depth = levels[0];
    const breadth = levels.filter(v => v >= 0.15).length;
    const places = placesKnownFirsthand(p);
    // Ashford seeds everyone with a working knowledge of their own village, so ground covered
    // only starts telling you something once it runs past what a settled life accounts for.
    const ground = clamp01((places - 18) / 20);
    const capability = clamp01((p.attributes.dexterity - 0.35) / 0.5);
    const score = depth < 0.2 ? 0 : clamp01(clamp01(depth / ACCOMPLISHED) * 0.7 + clamp01((breadth - 1) / 2) * 0.15 + ground * 0.1 + capability * 0.05);
    if (score > 0) candidates.push({
      id: 'scout', name: 'Scout', score,
      evidence: [
        FIELD_SKILLS.map(s => ({ s, v: skillOf(p, s) })).filter(x => x.v >= 0.05).sort((a, b) => b.v - a.v)
          .map(x => `${x.s} ${x.v.toFixed(2)}`).join(', ') || 'no field skill',
        `${places} places known first-hand`,
        `dexterity ${p.attributes.dexterity.toFixed(2)}`,
      ],
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < RECOGNITION_THRESHOLD) return null;
  // A pattern that is nearly matched by a second reading is a less confident reading.
  const rival = candidates[1]?.score ?? 0;
  const confidence = clamp01(best.score - Math.max(0, rival - RECOGNITION_THRESHOLD) * 0.5) * 0.95;
  return { id: best.id, name: best.name, confidence, evidence: best.evidence };
}
