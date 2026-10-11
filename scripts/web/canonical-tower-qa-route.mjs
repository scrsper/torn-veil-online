/** Read-only route over the projected floor, used only by keyboard QA drivers. */
export function route(plan, from, to) {
  const start = [Math.floor(from.x), Math.floor(from.z)], goal = [Math.floor(to.x), Math.floor(to.z)], key = p => p.join(',');
  const walk = ([x, z]) => Math.abs(x + .5 - plan.origin.x) < plan.half && Math.abs(z + .5 - plan.origin.z) < plan.half
    && !plan.solids.some(s => s.y < 2.8 && s.y + s.h > 1 && x + .5 >= s.x && x + .5 < s.x + s.w && z + .5 >= s.z && z + .5 < s.z + s.d);
  const queue = [start], previous = new Map([[key(start), null]]); let found = null;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]; if (key(p) === key(goal)) { found = p; break; }
    for (const [dx, dz] of [[0,-1],[1,0],[0,1],[-1,0]]) { const n = [p[0]+dx,p[1]+dz]; if (!previous.has(key(n)) && walk(n)) { previous.set(key(n), p); queue.push(n); } }
  }
  if (!found) return [];
  const path = []; while (previous.get(key(found))) { path.push({ x: found[0] + .5, z: found[1] + .5 }); found = previous.get(key(found)); }
  return path.reverse();
}
