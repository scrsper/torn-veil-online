import { beforeAll, describe, expect, it } from 'vitest';
import { loadFocusedGeometry } from '../src/server/focusedGeometryLoader';
import { RealmRuntime } from '../src/server/realmRuntime';
import { RealmSession } from '../src/sim/world/realms/session';
import { handInteractions, performHandInteraction } from '../src/sim/physical/hand';
import { combatWeapon } from '../src/sim/physical/combat';
import { travelPath } from '../src/sim/physical/travel';
import { requestGuard } from '../src/sim/physical/guard';
import { creatureBlow } from '../src/sim/ecology/defense';

beforeAll(() => loadFocusedGeometry());

const toolsIn = (s: RealmSession) => s.world.items().filter(i => i.tags.includes('focused-town-loose-tool'));
function founded() {
  const runtime = new RealmRuntime(new RealmSession(918271));
  runtime.apply({ type: 'adopt_focused' });
  runtime.apply({ type: 'adopt_wildlife' });
  return runtime;
}

describe('finite town encounter equipment', () => {
  it('places one ordinary unowned knife on the pinned supported forest approach without granting player inventory', () => {
    const runtime = new RealmRuntime(new RealmSession(918271)), s = runtime.session;
    const inventory = [...s.person.inventory];
    runtime.apply({ type: 'adopt_focused' });
    expect(toolsIn(s)).toHaveLength(0);
    runtime.apply({ type: 'adopt_wildlife' });
    const tools = toolsIn(s);
    expect(tools).toHaveLength(1);
    const knife = tools[0], paving = s.grid.focusedTown!.placements.find(p => p.id.endsWith(':path:wood:24'))!;
    expect(knife).toMatchObject({ type: 'dagger', quantity: 1, ownerId: null, holderId: null, condition: .65 });
    expect(knife.pos).toMatchObject({ x: paving.position[0], z: paving.position[2] });
    const g = s.grid.movementGeometryAt(knife.pos!.x, knife.pos!.z)!;
    expect(g.supportAt(knife.pos!.x, knife.pos!.z, knife.pos!.y)).toBeCloseTo(knife.pos!.y, 7);
    expect(g.fits(knife.pos!.x, knife.pos!.y, knife.pos!.z, .3, 1.75)).toBe(true);
    expect(knife.provenance).toContainEqual(expect.objectContaining({ from: null, to: null, how: 'focused town loose-tool initial condition' }));
    expect(s.person.inventory).toEqual(inventory);
    expect(s.world.persons().filter(p => p.tags.includes('forest-outlaw'))).toHaveLength(1);
    expect(s.world.creatures().filter(c => c.wildlife)).toHaveLength(6);
  });

  it('requires physical reach, follows canonical navigation, then takes and equips through existing hand actions', () => {
    const runtime = founded(), s = runtime.session, knife = toolsIn(s)[0];
    expect(performHandInteraction(s.sim, s.person, `take:${knife.id}`)).toBe('interaction_unavailable');
    expect(performHandInteraction(s.sim, s.person, `equip:${knife.id}`)).toBe('not_carried');
    // Unit route execution exercises the actual geometry. Browser acceptance must still walk it with ordinary input.
    const path = s.world.nav.findPath(s.body.pos, knife.pos!);
    expect(path).not.toBeNull();
    s.body.path = path; s.body.pathIndex = 0; s.body.pathGoal = { ...knife.pos! };
    for (let i = 0; i < 2400 && s.body.path; i++) travelPath(s.world, s.body, 1 / 60, 3.3796, .3, 1.8);
    expect(s.world.distance2d(s.body.pos, knife.pos!)).toBeLessThan(.7);
    expect(handInteractions(s.sim, s.person).map(a => a.id)).toContain(`take:${knife.id}`);
    expect(performHandInteraction(s.sim, s.person, `take:${knife.id}`)).toBe('accepted');
    expect(performHandInteraction(s.sim, s.person, `take:${knife.id}`)).toBe('interaction_unavailable');
    expect(performHandInteraction(s.sim, s.person, `equip:${knife.id}`)).toBe('accepted');
    expect(combatWeapon(s.world, s.person)?.id).toBe(knife.id);
    expect(knife.holderId).toBe(s.person.id);
    expect(knife.equipped).toEqual({ bodyId: s.body.id, slot: 'right-hand' });
    expect(s.person.inventory.filter(id => id === knife.id)).toHaveLength(1);
  }, 60_000);

  it('retains pickup and equipment across save restore and cannot replenish on adoption or reload', () => {
    const runtime = founded(), s = runtime.session, knife = toolsIn(s)[0];
    // Explicit proximity fixture for the save invariant; this is not ordinary-player route proof.
    s.body.pos = { ...knife.pos! };
    expect(performHandInteraction(s.sim, s.person, `take:${knife.id}`)).toBe('accepted');
    expect(performHandInteraction(s.sim, s.person, `equip:${knife.id}`)).toBe('accepted');
    const identity = { person: s.person.id, body: s.body.id, inventory: [...s.person.inventory] };
    const retainedKnife = structuredClone(knife), receipts = structuredClone(s.world.questLedgers);
    runtime.apply({ type: 'adopt_wildlife' });
    expect(toolsIn(s)).toHaveLength(1);
    const restored = new RealmRuntime(new RealmSession(0, s.save()));
    restored.apply({ type: 'adopt_wildlife' });
    expect(toolsIn(restored.session)).toEqual([retainedKnife]);
    expect({ person: restored.session.person.id, body: restored.session.body.id, inventory: restored.session.person.inventory }).toEqual(identity);
    expect(restored.session.world.questLedgers).toEqual(receipts);
    expect(combatWeapon(restored.session.world, restored.session.person)?.id).toBe(knife.id);
  });

  it('does not add equipment to an existing ecology or a non-focused world', () => {
    const plain = new RealmRuntime(new RealmSession(918271));
    plain.apply({ type: 'adopt_wildlife' });
    expect(toolsIn(plain.session)).toHaveLength(0);
    const runtime = founded(), knife = toolsIn(runtime.session)[0];
    knife.quantity = 0;
    runtime.apply({ type: 'adopt_wildlife' });
    expect(toolsIn(runtime.session)).toEqual([knife]);
    expect(knife.quantity).toBe(0);
  });

  it('exposes town wildlife only through detached, observed body state for rendering and targeting', () => {
    const s = founded().session, boar = s.world.creatures().find(c => c.species === 'woodland_boar')!;
    const body = s.world.body(boar.bodies[0])!;
    expect(s.snapshot().observedWildlife.bodies.some(b => b.bodyId === body.id)).toBe(false);
    // Proximity/facing is a unit fixture. Actual browser route acceptance remains ordinary input.
    const nearby = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => ({ ...body.pos, x: body.pos.x + dx, z: body.pos.z + dz }))
      .find(p => s.grid.movementGeometryAt(p.x, p.z)?.fits(p.x, p.y, p.z, .3, 1.75)
        && s.world.grid.lineOfSight({ ...p, y: p.y + 1.5 }, { ...body.pos, y: body.pos.y + .6 }, 5));
    expect(nearby).toBeDefined(); s.body.pos = nearby!;
    s.body.yaw = Math.atan2(s.body.pos.x - body.pos.x, s.body.pos.z - body.pos.z);
    const visible = s.snapshot().observedWildlife.bodies.find(b => b.bodyId === body.id)!;
    expect(visible).toMatchObject({ creatureId: boar.id, speciesId: 'woodland_boar', alive: true, present: true });
    const position = { ...body.pos }, height = s.world.ecology!.species.woodland_boar.bodyPlan.heightM;
    visible.pos.x = -999; visible.bodyPlan.heightM = 999;
    expect(body.pos).toEqual(position);
    expect(s.world.ecology!.species.woodland_boar.bodyPlan.heightM).toBe(height);
    s.body.yaw += Math.PI;
    expect(s.snapshot().observedWildlife.bodies.some(b => b.bodyId === body.id)).toBe(false);
  });

  it('projects canonical boar impact and its causal guard receipt without inventing damage', () => {
    const s = founded().session, boar = s.world.creatures().find(c => c.species === 'woodland_boar')!;
    const body = s.world.body(boar.bodies[0])!;
    // Synthetic contact fixture for projection only; never ordinary-input combat acceptance.
    body.pos = { ...s.body.pos, x: s.body.pos.x + 1.2 }; s.body.yaw = -Math.PI / 2;
    expect(requestGuard(s.world, s.body.id, true)).toBe('accepted');
    const hp = s.body.health;
    creatureBlow(s.world, boar, body, s.body, 20, 'torso');
    const hit = s.combatEvents().find(e => e.actor === boar.id && e.target === s.person.id)!;
    expect(hit.damage).toBeCloseTo(hp - s.body.health, 7);
    expect(hit).toMatchObject({ damage: 13, incomingDamage: 20, guarded: true, guardOutcome: 'blocked' });
    expect(s.world.event(hit.guardEventId!)?.data).toMatchObject({ kind: 'guard', phase: 'contact', impact: 13, incomingImpact: 20 });
    requestGuard(s.world, s.body.id, false);
    creatureBlow(s.world, boar, body, s.body, 20, 'torso');
    expect(s.combatEvents().at(-1)).toMatchObject({ damage: 20, guarded: false, guardEventId: null });
  });
});
