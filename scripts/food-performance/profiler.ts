/** Developer-only nested counters. Never attached to a World or serialized. */
export function createProfile(labels: readonly string[]) {
  const calls: Record<string, { calls: number; inclusiveMs: number; selfMs: number }> = Object.fromEntries(labels.map(label => [label, { calls: 0, inclusiveMs: 0, selfMs: 0 }]));
  const work: Record<string, { calls: number; amount: number }> = {};
  const stack: { label: string; began: number; children: number }[] = [];
  return {
    enter(label: string) { stack.push({ label, began: performance.now(), children: 0 }); },
    leave(label: string) {
      const now = performance.now(), frame = stack.pop();
      if (!frame || frame.label !== label) throw Error(`Unbalanced profiling scope ${label}`);
      const elapsed = now - frame.began, entry = calls[label] ??= { calls: 0, inclusiveMs: 0, selfMs: 0 };
      entry.calls++; entry.inclusiveMs += elapsed; entry.selfMs += elapsed - frame.children;
      if (stack.length) stack[stack.length - 1].children += elapsed;
    },
    work(label: string, amount = 1) { const entry = work[label] ??= { calls: 0, amount: 0 }; entry.calls++; entry.amount += amount; },
    snapshot() { if (stack.length) throw Error('Profiling ended with active scopes'); return { calls, work }; },
  };
}
