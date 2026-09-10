import { expect, test } from 'vitest';
import { agencyWorkshop } from '../src/headless/agency/showcase';
import { advanceKernelLab } from '../src/headless/kernel/lab';
import { mechanismPanel } from '../src/sim/runtime/mechanismPanel';

test('mechanism panel offers evidence-dependent canonical attempts without exporting hidden topology',()=>{
  const scene=agencyWorkshop(741), {world,sim,avatar,game,assembly}=scene;
  const before=mechanismPanel(world,avatar).find(m=>m.assemblyId===assembly.id)!;
  expect(before.actions.map(a=>a.intent.kind)).toEqual(['inspect']);
  expect(JSON.stringify(before)).not.toMatch(/connections|efficiency|condition|method/);
  expect(game.intend('local',{kind:'inspect',assemblyId:assembly.id})).toBe(true);
  advanceKernelLab(world,sim,3);
  const after=mechanismPanel(world,avatar).find(m=>m.assemblyId===assembly.id)!;
  expect(after.actions.map(a=>a.intent.kind)).toContain('diagnose');
  expect(after.actions.map(a=>a.intent.kind)).toContain('test');
  expect(world.events.some(e=>e.actor===avatar.id&&e.type==='mechanism_inspected')).toBe(true);
});
