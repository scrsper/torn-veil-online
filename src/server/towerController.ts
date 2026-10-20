import { BridgeSession, LOCAL_CHANNEL } from '../bridge/session';
import type { RealmSession } from '../sim/world/realms/session';
import { currentTowerFloor, observeCanonicalTower } from '../sim/world/interiors/tower';
import { FoldedRealmGrid } from '../sim/world/interiors/grid';
import { ARCANE_DEFINITIONS } from '../sim/physical/arcana/definitions';
import { arcaneProgress, arcaneCapacity } from '../sim/physical/arcana/growth';
import { experienceSummary, recentAnnouncements } from '../sim/progression/experience';
import { observedThreat } from '../sim/progression/threat';
import { towerResidency } from '../sim/world/interiors/residency';

/** One controller on the existing simulation. No arena fixture, free regeneration,
 * scripted enemies, second character or browser-owned progression is installed. */
export class TowerController {
  readonly bridge: BridgeSession;
  constructor(readonly session: RealmSession) {
    this.bridge = new BridgeSession(session.world.seed, { state: { world: session.world, sim: session.sim }, defaultPlayer: false, continuousMovement:true });
    if (!this.bridge.openChannel(LOCAL_CHANNEL, session.person.id)) throw Error('Unable to attach the canonical body');
  }
  bind(id: string, epoch?: string) { return this.bridge.bindInteraction(id, LOCAL_CHANNEL, epoch); }
  step(now = performance.now()) {
    const receipts = this.bridge.stepInteraction(now, dt => this.session.advanceMovement(dt,this.bridge.hasInteractionControl()));
    observeCanonicalTower(this.session.world); return receipts;
  }
  frame() {
    const { world: w, person: p, body: b } = this.session, f = currentTowerFloor(w), run = w.canonicalTower;
    if (!run?.active || !f || !(w.grid instanceof FoldedRealmGrid)) return null;
    const plan = w.grid.interior(f.interiorId), sight = (pos: { x: number; y: number; z: number }) =>
      Math.hypot(pos.x - b.pos.x, pos.z - b.pos.z) < 32 && w.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1.6 }, { ...pos, y: pos.y + .3 }, 34);
    const snapshot = this.bridge.snapshot();
    const growth = arcaneProgress(w, p, b);
    return { type: 'tower_frame', snapshot, local: this.bridge.localState(),
      casts: snapshot.bodies.flatMap(visible => {
        const body = w.body(visible.bodyId), cast = body?.arcana?.cast;
        return body && cast && cast.completeAt + .3 >= w.physicalTime ? [{ ...cast, origin: { ...body.pos } }] : [];
      }),
      residency: towerResidency(w),
      // Only what the climber can see: species and visibly worn or wielded equipment.
      observedThreat: Object.fromEntries(snapshot.bodies.filter(v => v.bodyId !== b.id).flatMap(v => {
        const body = w.body(v.bodyId), t = body && observedThreat(w, body); return t ? [[v.bodyId, { level: t.level, grade: t.grade }]] : []; })),
      tower: { id: run.id, revision: run.revision, floor: f.floor, status: run.status, clear: !!f.clearEventId,
        defeated: f.defeats.length, opponents: f.enemyBodyIds.length, retiredBodyIds: f.defeats.map(d => d.bodyId), start: plan.start, exit: plan.exit },
      own: { id: p.id, bodyId: b.id, name: p.name, health: b.health, maxHealth: b.maxHealth, rank: p.ontology.stage,
        growth, experience: experienceSummary(w, p), announcements: recentAnnouncements(w, p),
        capacity: arcaneCapacity(p, w, b),
        mana: b.arcana?.mana ?? 100, fatigue: p.physiology.fatigue, food: p.physiology.energy, water: p.physiology.hydration,
        breath: 1 - (b.exertion?.load ?? 0), cast: b.arcana?.cast ?? null,
        learned: Object.keys(p.arcana?.learned ?? {}).map(id => ({ id, name: ARCANE_DEFINITIONS.get(id)?.name ?? id })),
        sources: p.inventory.flatMap(id => { const i = w.item(id); return i?.arcaneSource ? [{ id, name: i.name, abilityId: i.arcaneSource.abilityId }] : []; }) },
      items: w.items().filter(i => i.pos && !i.holderId && !i.containerId && i.quantity > 0 && sight(i.pos)).map(i => ({ id: i.id, name: i.name, type: i.type, pos: i.pos })),
      containers: w.containers().filter(c => c.pos && sight(c.pos)).map(c => ({ id: c.id, name: c.name, pos: c.pos, open: c.open, accessible: c.ownerId === p.id || !c.ownerId })),
      waterSources: w.resourceNodes.filter(n => n.kind === 'surface_water' && n.placeId && w.place(n.placeId)?.type === 'well' && sight(n.pos))
        .map(n => ({ id: n.id, pos: n.pos, remaining: n.remaining })),
    };
  }
  geometry() {
    const w = this.session.world, f = currentTowerFloor(w);
    return f && w.grid instanceof FoldedRealmGrid ? w.grid.interior(f.interiorId) : null;
  }
}
