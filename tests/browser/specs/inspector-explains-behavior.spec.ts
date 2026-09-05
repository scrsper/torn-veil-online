import type { BrowserSpec } from '../run';
import { startGame, advanceWorld, inspect, readCanonicalState } from '../helpers';

/**
 * v0.8 §10/§16: the Simulation Inspector should explain WHY an NPC is doing what it's doing —
 * goal, reasons, and current action — not just what it's doing. Reads the real rendered panel
 * (`#inspector .body`), not the underlying Mind object directly.
 */
export const inspectorExplainsBehavior: BrowserSpec = {
  name: 'Inspector explains an NPC\'s current goal and reasons',
  run: async (page, baseURL) => {
    await startGame(page, 918271, baseURL);
    await advanceWorld(page, 3600 * 2); // let everyone settle into a real goal

    const target = await readCanonicalState(page, () => {
      const w = (window as any).game.world;
      const p = w.persons().find((p: any) => p.alive && !p.controlled && p.mind.goal && p.mind.goal.reasons?.length);
      return p ? { id: p.id, goalType: p.mind.goal.type, reasons: p.mind.goal.reasons } : null;
    });
    if (!target) throw new Error('No living NPC with an active, reasoned goal found after 2 simulated hours');

    const text = await inspect(page, target.id);
    if (!text.toLowerCase().includes(target.goalType.toLowerCase())) throw new Error(`Inspector text does not mention the current goal type '${target.goalType}': ${text.slice(0, 400)}`);
    const mentionsAReason = target.reasons.some((r: string) => r && text.includes(r));
    if (!mentionsAReason) throw new Error(`Inspector text does not include any of the goal's real reasons ${JSON.stringify(target.reasons)}: ${text.slice(0, 400)}`);
    if (!/current action/i.test(text)) throw new Error(`Inspector text missing a "Current action" section: ${text.slice(0, 400)}`);
  },
};
