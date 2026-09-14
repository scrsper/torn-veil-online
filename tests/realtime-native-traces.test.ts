import { expect, test } from 'vitest';
import traces from '../docs/evidence/realtime/movement-traces.json';
import { predictMovement, type CollisionColumn, type MovementState } from '../src/sim/physical/prediction';

const flat = (): CollisionColumn => ({ floor: 0, walkable: true, solids: [] });
const run = (name: string, frames?: number): MovementState => {
  const c = traces.cases.find((x) => x.name === name)!;
  const s: MovementState = { pos: c.state.position, yaw: c.state.yaw, speed: c.state.speed, eligible: c.state.eligible };
  let out = s;
  const columns = (c.columns ?? {}) as Record<string, CollisionColumn>;
  for (let i = 0; i < (frames ?? c.frames); i++) out = predictMovement(out, c.input, c.dt, (x, z) => columns[`${x},${z}`] ?? flat());
  return out;
};

test('native reference traces agree with canonical predictor', () => {
  for(const trace of traces.cases) {
    const result=run(trace.name);
    for(const axis of ['x','y','z'] as const) expect(result.pos[axis],`${trace.name}.${axis}`).toBeCloseTo(trace.expect[axis],5);
    expect(result.yaw,`${trace.name}.yaw`).toBeCloseTo(trace.expect.yaw,5);
  }
  const diagonal = run('diagonal-normalized');
  expect(diagonal.pos.x).toBeCloseTo(0.70710678, 5);
  expect(diagonal.pos.z).toBeCloseTo(0.70710678, 5);
  expect(run('sprint').pos.x).toBeCloseTo(1.55, 5);
  expect(run('wall-block').pos.x).toBeLessThan(2);
  expect(run('stair-step').pos.y).toBe(1);
  const whole = run('frame-partition');
  const first = run('frame-partition', 30);
  const c = traces.cases[4];
  const second = (() => { let s = first; for (let i = 0; i < 30; i++) s = predictMovement(s, c.input, c.dt, () => flat()); return s; })();
  expect(second.pos.x).toBeCloseTo(whole.pos.x, 5);
  expect(second.pos.z).toBeCloseTo(whole.pos.z, 5);
  const unknown = predictMovement({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 2, eligible: true }, { x: 1, z: 0, sprint: false }, c.dt, () => undefined);
  expect(unknown.pos.x).toBe(0);
});
