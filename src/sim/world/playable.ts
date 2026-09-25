import type { World } from '../core/world';
import { WorldGeography, PLAYABLE_WORLD, type PlayableWorldSpec } from './geography';
import { generateProceduralWorld } from './settlement';
import { B } from '../physical/blocks';
import { initializeWildlife } from '../ecology/generation';
import { makeContainer } from '../core/container';
import { makeItem } from './factory';
import { createAnimal } from '../ecology/animals';
import { learn } from '../mind/knowledge';
import { techniqueKey } from '../core/skills';

export function generatePlayableWorld(world: World, spec: PlayableWorldSpec = PLAYABLE_WORLD, withWildlife = true) {
  const geography = new WorldGeography(world.seed, spec);
  world.geography = geography;
  world.clock.timeScale = spec.timeScale;
  const settlements = generateProceduralWorld(world, geography.sites, geography);
  // Connect regional approaches to local streets through actual canonical navigation.
  world.grid.recording = false;
  for (const s of settlements) {
    const x = s.spec.site.x - 4, z = s.spec.site.z + 120;
    const path = world.nav.findPath(s.places.square.inside, { x: x + .5, y: world.nav.floorY(x, z), z: z + .5 });
    if (!path) continue;
    let previous = s.places.square.inside;
    for (const p of path) {
      const length = Math.ceil(Math.hypot(p.x - previous.x, p.z - previous.z) * 2);
      for (let j = 0; j <= length; j++) {
        const t = length ? j / length : 1, px = Math.floor(previous.x + (p.x - previous.x) * t), pz = Math.floor(previous.z + (p.z - previous.z) * t), y = world.nav.floorY(px, pz) - 1;
        if ([B.Grass, B.Dirt, B.Sand].includes(world.grid.get(px, y, pz))) world.grid.set(px, y, pz, B.Path);
      }
      previous = p;
    }
  }
  world.initNav(); world.grid.recording = true;
  // A small general-purpose acceptance fixture in the first generated public square. It uses
  // ordinary canonical item/container state; Unreal only projects these identities.
  const first = settlements.slice().sort((a,b)=>a.spec.site.id.localeCompare(b.spec.site.id))[0];
  if (first) {
    const center = first.places.square.inside;
    const containerPos = { x:center.x + 1.5, y:world.nav.floorY(center.x+1,center.z), z:center.z + .5 };
    const loosePos = { x:center.x - 1.5, y:world.nav.floorY(center.x-2,center.z), z:center.z + .5 };
    const chest = makeContainer(world,{name:'Traveler chest',capacity:24,pos:containerPos,placeId:first.places.square.id,tags:['physical','storage']});
    makeItem(world,'bread','Travel bread',{container:chest.id,quantity:2,description:'A plain loaf kept for the road.'});
    makeItem(world,'lantern','Weathered lantern',{pos:loosePos,placeId:first.places.square.id,description:'A serviceable lantern left in the square.'});
  }
  if (withWildlife) {
    initializeWildlife(world);
    // The broad geography has only three bounded founder-registration corridors. Give this
    // specific playable scenario a small canonical founder cohort in the settlement forest so
    // the ordinary settlement-to-wilderness route demonstrates wildlife without relocation.
    // These are normal persistent Creature/Body entities; no presentation-only animal exists.
    if (first) {
      const center=first.places.square.inside,forest=first.places.forest.inside;
      const approach=world.nav.findPath(center,forest)?.filter(p=>Math.hypot(p.x-center.x,p.z-center.z)<=72);
      const founders=approach?.slice(-2) ?? [forest];
      for(const [index,pos] of founders.entries()) {
        createAnimal(world,'roe_deer',pos,{sex:index===0?'female':'male'});
      }
      // Living Alpha authored starting circumstance: the forest people work in holds a boar sow
      // with a young litter and a lone boar. What they do from here (forage, breed, defend their
      // young against woodcutters, get hunted or driven off) is ordinary simulation.
      const woods=walkableNear(world,forest,6,10);
      if(woods.length>=5) {
        const sow=createAnimal(world,'woodland_boar',woods[0],{sex:'female'});
        for(const [i,pos] of woods.slice(1,4).entries()) createAnimal(world,'woodland_boar',pos,{sex:i%2?'male':'female',ageDays:30,parentIds:[sow.id]});
        createAnimal(world,'woodland_boar',woods[4],{sex:'male'});
      }
    }
  }
  seedVeilLore(world, settlements);
  return settlements;
}

/** Walkable, distinct cells around a point (deterministic ring scan). */
function walkableNear(world: World, at: { x: number; z: number }, min: number, count: number) {
  const out: { x: number; y: number; z: number }[] = [];
  for (let r = min; r < min + 24 && out.length < count; r += 3) for (let k = 0; k < 8 && out.length < count; k++) {
    const a = k * Math.PI / 4 + r, x = Math.floor(at.x + Math.cos(a) * r), z = Math.floor(at.z + Math.sin(a) * r), y = world.nav.floorY(x, z);
    if (y >= 0 && world.nav.walkCost(x, z) < 3 && !out.some(p => Math.hypot(p.x - x - .5, p.z - z - .5) < 2)) out.push({ x: x + .5, y, z: z + .5 });
  }
  return out;
}

/** Living Alpha authored initial condition: in each settlement, the adult with the strongest will
 * holds the hedge veil-lore (the `veilcraft` technique, physical/veil.ts) as prior knowledge with
 * modest practice. Everyone else can only learn it from such a person. */
function seedVeilLore(world: World, settlements: ReturnType<typeof generateProceduralWorld>): void {
  for (const s of settlements) {
    const adults = Object.values(s.people).filter(p => p.alive && p.age >= 30).sort((a, b) => (b.attributes.will - a.attributes.will) || a.id.localeCompare(b.id));
    const keeper = adults[0]; if (!keeper) continue;
    learn(world, keeper, { key: techniqueKey('veilcraft'), kind: 'technique', claim: { type: 'technique', skill: 'veilcraft', tradition: 'hedge veil-lore' }, confidence: 0.85, source: { type: 'prior' } }, true);
    keeper.skills.veilcraft = Math.max(keeper.skills.veilcraft ?? 0, 0.3);
  }
}

/** Canonical relevance follows bodies, not renderer requests. Untouched substrate has no
 * active lifecycle; once indexed, its resource history remains in the shared simulation. */
export function indexWilderness(world: World): void {
  const g = world.geography; if (!g) return;
  for (const body of world.activeBodies()) {
    const rx = Math.floor(body.pos.x / g.spec.regionSize), rz = Math.floor(body.pos.z / g.spec.regionSize);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = rx + dx, z = rz + dz, id = `${x},${z}`;
      if (world.wildernessRegions.has(id)) continue;
      world.wildernessRegions.add(id); world.resourceNodes.push(...structuredClone(g.resources(x, z)));
    }
  }
}
