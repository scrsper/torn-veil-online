import type { BrowserSpec } from '../run';
import { startGame, movePlayerTo, aimCursorAt, advanceWorld, openDialogueWith, readDialogue, chooseDialogueOption } from '../helpers';

export const agencyKnowledge: BrowserSpec = {
  name: 'avatar knowledge inspection hides canonical identity and private mind state',
  run: async (page, baseURL) => {
    await startGame(page, 741, baseURL);
    const target = await page.evaluate(() => {
      const g = (window as any).game, w = g.world;
      const p = w.persons().find((p: any) => p.id !== w.playerId && p.alive);
      // This tests the inspection/identity UI. Keep the subject in place while aiming;
      // autonomous movement and mutual introductions are covered by canonical tests.
      g.playerSession.attach('inspection-fixture', p.id);
      const square = w.places().find((place: any) => place.type === 'square');
      w.primaryBody(p.id).pos = { ...square.inside };
      return { id: p.id, name: p.name, pos: { ...w.primaryBody(p.id).pos } };
    });
    await movePlayerTo(page, target.pos, 2);
    await advanceWorld(page, 0.3, 0.05);
    // ARPG interaction projects the cursor onto the avatar's eye-height plane.
    const eyeY = await page.evaluate(() => (window as any).game.ctrl.eye().y);
    await aimCursorAt(page, { ...target.pos, y: eyeY });
    const aimed = await page.evaluate(() => {
      const t = (window as any).game.inter.target;
      return { kind: t?.kind, person: t?.person?.id, block: t?.name };
    });
    if (aimed.person !== target.id) throw new Error(`Inspection fixture did not target its subject: ${JSON.stringify(aimed)}`);
    const before = await page.evaluate(id => (window as any).game.playerSession.beliefs('local', id), target.id);
    if (before.knownName || JSON.stringify(before).includes(target.name)) throw new Error('Proximity leaked canonical identity');
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => (document.getElementById('person-knowledge') as HTMLElement)?.style.display === 'block', undefined, { timeout: 5000 }).catch(async () => {
      const state = await page.evaluate(() => {
        const g = (window as any).game;
        return { target: g.inter.target?.kind, person: g.inter.target?.person?.id, enabled: g.inter.enabled,
          focus: document.activeElement?.tagName, panel: document.getElementById('person-knowledge')?.getAttribute('style'),
          player: g.ctrl.body.pos, camera: g.ctrl.mode };
      });
      throw new Error(`Knowledge panel did not open: ${JSON.stringify(state)}`);
    });
    const panel = await page.locator('#person-knowledge').innerText();
    if (!panel.includes('unfamiliar person') || /current goal|honesty|intellect|attributes|skills/.test(panel)) throw new Error(`Normal inspection leaked hidden truth: ${panel}`);
    await page.keyboard.press('Escape');
    await openDialogueWith(page, target.id);
    const dialogue = await readDialogue(page);
    if (dialogue.speaker.includes(target.name)) throw new Error('Dialogue header leaked the unknown name');
    await chooseDialogueOption(page, 'Who are you?');
    const after = await page.evaluate(id => (window as any).game.playerSession.beliefs('local', id), target.id);
    if (!after.knownName || after.name !== target.name || !after.identity.source.viaEvent) throw new Error('Introduction failed to create provenance-bearing identity');
  },
};
