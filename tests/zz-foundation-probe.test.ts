// TEMPORARY exploration (to be deleted): drive a NEW in-memory focused world with ordinary commands only.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadFocusedGeometry } from '../src/server/focusedGeometryLoader';
import { RealmSession } from '../src/sim/world/realms/session';
import { RealmRuntime } from '../src/server/realmRuntime';
import { INTERACTION_SPEC } from '../src/sim/physical/prediction';
const lines: string[] = []; const log = (...a: unknown[]) => lines.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
it('probe boar', () => {
  try {
    loadFocusedGeometry();
    const r = new RealmRuntime(new RealmSession(918271)); r.apply({ type: 'adopt_focused' }); r.apply({ type: 'adopt_wildlife' });
    r.apply({ type: 'bind', id: 'c', epoch: 'e' });
    let seq = 0, now = 0;
    const cmd = (c: any) => r.apply({ type: 'command', now, input: { version: 2, type: 'command', epoch: 'e', controllerId: 'c', bodyId: r.session.body.id, specRevision: INTERACTION_SPEC.revision, sequence: seq, commandId: `c-${seq++}`, clientTimeMs: now, command: c } });
    const rejected: Record<string, number> = {};
    const tick = () => { now += 1000 / 60; for (const x of r.apply({ type: 'step', now })) if (x.status === 'rejected') rejected[x.result] = (rejected[x.result] ?? 0) + 1; };
    const w = r.session.world, me = r.session.body, boar = w.primaryBody('wild_1')!, state = () => (w.get('wild_1') as any).wildlife.embodiments[boar.id];
    const t0 = w.physicalTime, T = () => +(w.physicalTime - t0).toFixed(2);
    let phase = 'approach', phaseAt = 0, lastMode = '';
    const face = () => Math.atan2(me.pos.x - boar.pos.x, me.pos.z - boar.pos.z);
    const status = () => log(T(), phase, 'me', [+me.pos.x.toFixed(1), +me.pos.z.toFixed(1)], 'hp', +me.health.toFixed(1), 'boar', [+boar.pos.x.toFixed(1), +boar.pos.z.toFixed(1)], 'hp', +boar.health.toFixed(1), '/', boar.maxHealth, 'd', +w.distance2d(me.pos, boar.pos).toFixed(2), 'mode', state()?.defense?.mode ?? '-', 'proj', r.session.snapshot().interactions.length);
    let route: any[] = [], wp = 0, routedAt = -1e9;
    for (let i = 0; i < 60 * 150; i++) {
      const dx = boar.pos.x - me.pos.x, dz = boar.pos.z - me.pos.z, d = Math.hypot(dx, dz);
      const mode = state()?.defense?.mode ?? '-'; if (mode !== lastMode) { lastMode = mode; log(T(), 'boar mode ->', mode, 'd', +d.toFixed(2), 'hp', +me.health.toFixed(1), +boar.health.toFixed(1)); }
      const sample = i % 3 === 0;
      if (phase === 'approach') {
        if (i - routedAt > 300) { route = r.session.grid.focusedGeometry!.findPath(me.pos, boar.pos, 400000) ?? []; wp = 0; routedAt = i; }
        while (wp < route.length - 1 && Math.hypot(route[wp].x - me.pos.x, route[wp].z - me.pos.z) < .6) wp++;
        const goal = d < 5 || !route.length ? boar.pos : route[wp], gx = goal.x - me.pos.x, gz = goal.z - me.pos.z, gd = Math.hypot(gx, gz) || 1;
        if (sample) cmd({ type: 'move', x: gx / gd, z: gz / gd, sprint: false });
        if (d <= 1.4) { phase = 'fight'; phaseAt = i; status(); }
      } else if (phase === 'fight') {
        const guardNow = mode === 'charge' || mode === 'strike';
        if (sample) cmd(d > 1.2 && !guardNow ? { type: 'move', x: dx / d, z: dz / d, sprint: false, facing: face() } : { type: 'move', x: 0, z: 0, sprint: false, facing: face() });
        if (guardNow && i % 6 === 0) cmd({ type: 'guard', held: true });
        if (!guardNow && (i - phaseAt) % 45 === 0) { cmd({ type: 'guard', held: false }); cmd({ type: 'attack', targetBodyId: boar.id, trajectory: 'low', weight: 'light' }); }
        if (i - phaseAt > 60 * 20 || me.health < 30) { cmd({ type: 'guard', held: false }); phase = 'retreat'; phaseAt = i; status(); }
      } else if (phase === 'retreat') {
        const goal = { x: 11312.5, z: 3122 }, gx = goal.x - me.pos.x, gz = goal.z - me.pos.z, gd = Math.hypot(gx, gz) || 1;
        if (sample) cmd({ type: 'move', x: gx / gd, z: gz / gd, sprint: true });
        if (i - phaseAt > 60 * 25) break;
      }
      tick();
      if (i % 120 === 0) status();
    }
    status();
    const ev = w.events.filter(e => (e.type === 'attack' || e.type === 'attack_missed' || e.type === 'kill' || e.type.startsWith('wildlife')) && (e.actor === 'p_5' || e.target === 'p_5' || e.actor === 'wild_1' || e.target === 'wild_1'));
    log('events', ev.map(e => [e.type, e.actor, e.target, e.data?.damage, !!e.data?.combat?.guardEventId, e.data?.guarded, e.summary]));
    log('rejected', rejected, 'guard now', r.session.snapshot().avatar.guarding);
  } finally { writeFileSync('.debug/foundation-probe/out4.txt', lines.join('\n')); }
}, 600000);
