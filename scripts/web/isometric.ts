/** Isolated isometric UI acceptance. Never uses a saved user world/profile. */
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { LiveServer } from '../../src/server/live';
import { loadConfig, type ReleaseIdentity } from '../../src/server/config';
import { AccountRegistry } from '../../src/server/accounts';
import { WebGateway } from '../../src/webgate/gateway';
import { SAVE_VERSION } from '../../src/sim/persist/save';
import { B } from '../../src/sim/physical/blocks';
import { setExternalControl } from '../../src/sim/runtime/controllers';

const orbit = process.env.TVO_CAMERA_VIEW === 'orbit';
const root = mkdtempSync(join(tmpdir(), 'tvo-dialogue-ui-')), out = resolve(process.env.TVO_ISOMETRIC_EVIDENCE_DIR ?? '.debug/isometric'); mkdirSync(out, { recursive: true });
const reserve = createServer(); await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r));
const port = (reserve.address() as { port: number }).port; await new Promise<void>(r => reserve.close(() => r()));
const path = join(root, 'config.json');
writeFileSync(path, JSON.stringify({ env: 'dev', port, bind: ['127.0.0.1'], webGateway: true, seed: 918271, createWorldIfMissing: true, checkpointSeconds: 3600, backupMinutes: 600 }));
mkdirSync(join(root, 'credentials')); writeFileSync(join(root, 'credentials', 'admin.token'), 'isolated-dialogue-ui-admin-0123456789');
const token = new AccountRegistry(join(root, 'credentials', 'accounts.json')).add('dialogue-ui', 'Dialogue UI acceptance');
const release: ReleaseIdentity = { version: 'dialogue-ui', revision: 'test', dirty: false, builtAtIso: '', protocol: 1, saveSchema: SAVE_VERSION, generatorVersion: 'playable-1', node: process.version };
const server = new LiveServer(loadConfig(path), release, () => {});
const gateway = new WebGateway({ port: 0, upstream: { host: '127.0.0.1', port }, credentials: { account: 'dialogue-ui', token }, staticDir: resolve(process.env.TVO_ISOMETRIC_BUNDLE ?? '.debug/isometric/bundle') });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, recordVideo: orbit ? {dir:join(root,'video'),size:{width:1280,height:800}} : undefined });
const errors: string[] = [], modelRequests: string[] = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/:(11434|1234)\b|chat\/completions/.test(r.url())) modelRequests.push(r.url()); });
await page.addInitScript('window.__name = (f) => f;');
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No inference HTTP networking permitted'); };
try {
  await server.open(); await server.listen(); await gateway.listen();
  await page.goto(gateway.issueLaunchUrl()); await page.goto(`${gateway.url}/?autoplay=1&name=Traveler&view=${orbit ? 'orbit' : 'isometric'}`);
  await page.waitForFunction(() => (window as any).__tv?.ready === true, undefined, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const own = () => page.evaluate(() => { const tv = (window as any).__tv; return { pos: {...tv.predictor.predicted.pos}, yaw: tv.predictor.predicted.yaw, moveYaw:tv.rig.moveYaw, mode: tv.settings.viewMode, cameraMode: tv.camera.mode, wealth: tv.own()?.wealth }; });
  const checks: Record<string, unknown>[] = [];
  const note = (name: string, passed: boolean, evidence: unknown) => { checks.push({ name, passed, evidence }); console.log(JSON.stringify({name,passed,evidence})); };
  await page.screenshot({ path: join(out, '01-isometric-settlement.png') });
  if (orbit) {
    const before=await page.evaluate(()=>({yaw:(window as any).__tv.rig.yaw,pitch:(window as any).__tv.rig.pitch}));
    for(let i=0;i<8;i++) {await page.mouse.move(500,450);await page.mouse.down({button:'middle'});await page.mouse.move(1150,500,{steps:12});await page.mouse.up({button:'middle'});}
    await page.mouse.wheel(0,-600);await page.waitForTimeout(900);
    const after=await page.evaluate(()=>({yaw:(window as any).__tv.rig.yaw,pitch:(window as any).__tv.rig.pitch,distance:(window as any).__tv.camera.position.subtract((window as any).__tv.regions.toRender((window as any).__tv.predictor.predicted.pos)).length()}));
    note('outdoor orbit tilt and zoom',Math.abs(after.yaw-before.yaw)>.1&&after.pitch>=.32&&after.pitch<=1.05&&Number.isFinite(after.distance),{before,after,dragTurns:8});
    await page.mouse.wheel(0,600);await page.waitForTimeout(900);
  }

  const before = await own();
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w'); await page.waitForTimeout(300);
  const walked = await own(); note('screen-up walking', orbit ? -(walked.pos.x-before.pos.x)*Math.sin(before.moveYaw)-(walked.pos.z-before.pos.z)*Math.cos(before.moveYaw)>.5 : walked.pos.x > before.pos.x + .2 && walked.pos.z < before.pos.z - .2, {before,after:walked});
  await page.keyboard.down('Shift'); await page.keyboard.down('s'); await page.waitForTimeout(1200); await page.keyboard.up('s'); await page.keyboard.up('Shift'); await page.waitForTimeout(300);
  const ran = await own(); note('screen-down running', orbit ? (ran.pos.x-walked.pos.x)*Math.sin(walked.moveYaw)+(ran.pos.z-walked.pos.z)*Math.cos(walked.moveYaw)>.5 : ran.pos.x < walked.pos.x -.2 && ran.pos.z > walked.pos.z+.2, {before:walked,after:ran});
  await page.screenshot({ path: join(out, '02-after-movement.png') });
  for(const key of ['i','j']) { await page.keyboard.press(key); await page.waitForFunction(()=>(window as any).__tv.modal.isOpen); await page.keyboard.press('Escape'); await page.waitForFunction(()=>!(window as any).__tv.modal.isOpen); await page.waitForTimeout(300); }
  note('repeat interrupted menu flows', !(await page.evaluate(() => (window as any).__tv.modal.isOpen)), null);
  const playerId = await page.evaluate(() => (window as any).__tv.link.hello.playerId);
  const w = server.session.world, player = w.person(playerId)!, pb = w.primaryBody(playerId)!;
  const npc = w.livingPersons().filter(p => p.id !== playerId && !p.hostile && p.age > 20 && /baker|merchant/.test(p.occupation)).sort((a,b)=> { const aa=w.primaryBody(a.id)!,bb=w.primaryBody(b.id)!; return Math.hypot(aa.pos.x-pb.pos.x,aa.pos.z-pb.pos.z)-Math.hypot(bb.pos.x-pb.pos.x,bb.pos.z-pb.pos.z); })[0];
  const body = w.primaryBody(npc.id)!; const original = {...body.pos}; setExternalControl(npc, true);
  // Explicit bounded UI fixture only: natural world keeps running; ordinary input above is separate.
  pb.pos = {...body.pos, x:body.pos.x+1}; body.pose = 'stand';
  player.mind.percepts = [{ entityId: npc.id, bodyId: body.id, how: 'saw', pos: { ...body.pos }, tick: w.now, distance: 1 }];
  await page.waitForTimeout(3500);
  const pointFor = () => page.evaluate(id => {const tv=(window as any).__tv;const target=tv.snapshot.interactionTargets.find((t:any)=>t.kind==='person' && (t.targetId===id || false));const t=target??tv.snapshot.interactionTargets.find((t:any)=>t.kind==='person');if(!t)throw Error('No canonical nearby person interaction');const v=tv.camera.position.constructor.Project(tv.regions.toRender(t.pos),tv.camera.getWorldMatrix().constructor.Identity(),tv.ctx.scene.getTransformMatrix(),tv.camera.viewport.toGlobal(1600,1000));return {x:v.x,y:v.y};}, body.id);
  const targetPoint=await pointFor();
  await page.mouse.move(targetPoint.x,targetPoint.y); await page.waitForTimeout(300); await page.keyboard.press('e');
  const input = page.locator('.tv-speech-input'); await input.waitFor({ state: 'visible', timeout: 12000 });
  note('root dialogue options',true,await page.locator('button.tv-opt').allTextContents());
  await page.waitForTimeout(750);
  const bounds=await page.locator('.tv-talk').boundingBox();
  note('settled conversation fits viewport',!!bounds && bounds.x>=0 && bounds.x+bounds.width<=1601 && bounds.y>=0 && bounds.y+bounds.height<=1001,bounds);
  await page.screenshot({ path: join(out, '03-isometric-conversation.png') });
  const trade = page.getByRole('button', { name: /^Trade$/i });
  if (await trade.count()) await trade.first().click();
  const tradeOption=page.locator('button.tv-opt').filter({hasText:/Trade/}).first();
  if(await tradeOption.count()) { await tradeOption.click(); await page.waitForTimeout(500); }
  const buy = page.locator('button.tv-opt').filter({hasText:/Buy /i}).first();
  if (await buy.count()) {
    const wallet = (await own()).wealth; await buy.click(); await page.waitForTimeout(300);
    const confirmation = page.getByRole('button',{name:'Confirm',exact:true});
    await page.screenshot({path:join(out,'03b-trade-confirm.png')});
    note('trade confirmation shown',await confirmation.isVisible(),null);
    await page.getByRole('button',{name:'Not now',exact:true}).click();
    note('cancel purchase keeps wealth',(await own()).wealth===wallet,{wallet});
    await buy.click(); await confirmation.click(); await page.waitForTimeout(1000);
    note('canonical purchase reduces wealth',(await own()).wealth<wallet,{before:wallet,after:(await own()).wealth});
  } else note('canonical sale offer available',false,{occupation:npc.occupation});
  await page.getByRole('button',{name:/^Goodbye/}).click(); await page.waitForFunction(()=>!(window as any).__tv.dialogue.isOpen); await page.waitForTimeout(700);
  const repeatedPoint=await pointFor();
  await page.mouse.move(repeatedPoint.x,repeatedPoint.y); await page.keyboard.press('e'); await input.waitFor({state:'visible',timeout:12000}); await page.keyboard.press('Escape'); await page.waitForFunction(()=>!(window as any).__tv.dialogue.isOpen);
  note('conversation repeat and interruption', !(await page.evaluate(() => (window as any).__tv.dialogue.isOpen)), {fixture:'NPC co-location and direct observation, disclosed'});
  body.pos = original; setExternalControl(npc, false);
  const actorRendering=(bodyId?:string) => page.evaluate(targetId=>{
      const tv=(window as any).__tv,id=targetId??tv.snapshot.controlledBodyId,a=tv.actors.get(id);
      if(!a)return {bodyId:id,actorPresent:false};
      const meshes=a.visual.root.getChildMeshes(false),own=new Set(meshes),head=tv.actors.headPoint(id);
      const Matrix=tv.camera.getWorldMatrix().constructor, Vector=tv.camera.position.constructor;
      const screen=Vector.Project(head,Matrix.Identity(),tv.ctx.scene.getTransformMatrix(),tv.camera.viewport.toGlobal(1600,1000));
      const ray=tv.ctx.scene.createPickingRay(screen.x,screen.y,Matrix.Identity(),tv.camera,false);ray.length=head.subtract(ray.origin).length();
      const hits=(tv.ctx.scene.multiPickWithRay(ray,(m:any)=>!own.has(m)&&m.isEnabled()&&m.isVisible&&m.visibility>0&&!/sky|atmosphere/.test(m.name))??[]).filter((h:any)=>h.pickedPoint&&h.distance<ray.length && !(h.pickedMesh.material?.clipPlane?.signedDistanceTo(h.pickedPoint)>0));
      return {bodyId:id,actorPresent:true,rootEnabled:a.visual.root.isEnabled(),rootPosition:{x:a.visual.root.position.x,y:a.visual.root.position.y,z:a.visual.root.position.z},meshCount:meshes.length,groups:[...new Set(meshes.map((m:any)=>m.renderingGroupId))],enabledMeshes:meshes.filter((m:any)=>m.isEnabled()&&m.isVisible).length,inFrustum:meshes.filter((m:any)=>m.isInFrustum(tv.ctx.scene._frustumPlanes)).length,head:{x:head.x,y:head.y,z:head.z},bounds:meshes.slice(0,3).map((m:any)=>({name:m.name,min:m.getBoundingInfo().boundingBox.minimumWorld,max:m.getBoundingInfo().boundingBox.maximumWorld})),possibleHeadOccluders:hits.map((h:any)=>({name:h.pickedMesh.name,distance:h.distance})).slice(0,10)};
    },bodyId);
  const visible = (r:Awaited<ReturnType<typeof actorRendering>>) => r.actorPresent && r.rootEnabled && r.enabledMeshes>0 && r.possibleHeadOccluders?.length===0;
  const walkPath = async (path: {x:number;y:number;z:number}[]) => {
    for(const point of path) {
      const deadline=Date.now()+4000;
      while(Date.now()<deadline) {
        const p=(await own()).pos, dx=point.x-p.x,dz=point.z-p.z;
        if(Math.hypot(dx,dz)<.18)break;
        const yaw=await page.evaluate(()=>(window as any).__tv.rig.moveYaw);
        const mx=dx*Math.cos(yaw)-dz*Math.sin(yaw),my=-dx*Math.sin(yaw)-dz*Math.cos(yaw),keys:string[]=[];
        if(Math.abs(mx)>.1)keys.push(mx>0?'d':'a');if(Math.abs(my)>.1)keys.push(my>0?'w':'s');
        for(const key of keys)await page.keyboard.down(key);await page.waitForTimeout(Math.max(16,Math.min(100,Math.hypot(dx,dz)*100)));for(const key of keys)await page.keyboard.up(key);
      }
    }
    await page.waitForTimeout(700);
  };
  const indoor = [...w.entities.values()].find((e: any) => e.kind === 'place' && e.indoor && e.inside && Math.hypot(e.inside.x-pb.pos.x,e.inside.z-pb.pos.z)<90) as any;
  if(!indoor?.door)throw Error('Required interior fixture unavailable');
  if(indoor?.door) {
    // Explicit test start at the canonical doorway; keyboard travel through the actual collision follows.
    pb.pos = {...indoor.door,x:indoor.door.x+.5,z:indoor.door.z+.5}; await page.waitForTimeout(1500);
    const doorway={...pb.pos};
    const doorCell=[{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}].map(d=>({x:indoor.door.x+d.x,y:indoor.door.y,z:indoor.door.z+d.z})).find(p=>w.grid.get(p.x,p.y,p.z)===B.Door);
    if(!doorCell)throw Error('No canonical door cell');
    // Disclosed closed-door starting fixture; ordinary movement must perform the same canonical opening as NPCs.
    w.setDoorOpen(doorCell,false,player.id);await page.waitForTimeout(500);
    const closedStart=(await own()).pos,initialClosed=!w.grid.isDoorOpen(doorCell.x,doorCell.y,doorCell.z);
    const yaw=await page.evaluate(()=>(window as any).__tv.rig.moveYaw);
    const wx=indoor.inside.x-closedStart.x,wz=indoor.inside.z-closedStart.z;
    const dx=(wx*Math.cos(yaw)-wz*Math.sin(yaw)-wx*Math.sin(yaw)-wz*Math.cos(yaw))/2,dz=(wx*Math.cos(yaw)-wz*Math.sin(yaw)+wx*Math.sin(yaw)+wz*Math.cos(yaw))/2;
    const blockedKeys=[...(Math.abs(dx+dz)>.22?[dx+dz>0?'d':'a']:[]),...(Math.abs(dx-dz)>.22?[dx-dz>0?'w':'s']:[])];
    for(const key of blockedKeys)await page.keyboard.down(key);await page.waitForTimeout(600);for(const key of blockedKeys)await page.keyboard.up(key);
    await page.waitForTimeout(500);const blocked=(await own()).pos;
    note('keyboard movement canonically opens the closed door',initialClosed && w.grid.isDoorOpen(doorCell.x,doorCell.y,doorCell.z) && Math.hypot(blocked.x-closedStart.x,blocked.z-closedStart.z)>.5,{before:closedStart,after:blocked,doorCell,initialClosed,opened:w.grid.isDoorOpen(doorCell.x,doorCell.y,doorCell.z),fixture:'closed starting state through canonical setDoorOpen in disposable world; movement opens it normally'});
    const path = w.nav.findPath(pb.pos,indoor.inside) ?? [indoor.inside];
    await walkPath(path);
    let arrived=false;
    const at=(await own()).pos; arrived=Math.hypot(at.x-indoor.inside.x,at.z-indoor.inside.z)<1.2;
    const cut=await page.evaluate(()=>(window as any).__tv.ctx.scene.meshes.filter((m:any)=>m.metadata?.cutawayBounds && m.material?.clipPlane?.d>-100000).length);
    const rendering=await actorRendering();
    note('interior entry actor unobscured',visible(rendering),rendering);
    await page.screenshot({path:join(out,'04-isometric-cutaway.png')});note('keyboard entry and occupied cutaway',arrived&&cut>0,{arrived,at,goal:indoor.inside,path,clippedMeshes:cut,fixture:'test begins at canonical doorway; actual keys enter the physical building'});
    const candidates=[];
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++) {
      if(Math.hypot(dx,dz)<1.5)continue;
      const goal={x:Math.floor(at.x)+dx+.5,y:at.y,z:Math.floor(at.z)+dz+.5},b=indoor.bounds;
      if(goal.x<=b.x0+.6||goal.x>=b.x1-.6||goal.z<=b.z0+.6||goal.z>=b.z1-.6)continue;
      const route=w.nav.findPath(pb.pos,goal);if(route?.length)candidates.push({goal,route});
    }
    const traversal=candidates.sort((a,b)=>a.route.length-b.route.length)[0];
    if(!traversal)throw Error('No traversable interior fixture');
    await walkPath(traversal.route);const traversed=(await own()).pos,traversalRendering=await actorRendering();
    note('interior traversal actor unobscured',Math.hypot(traversed.x-traversal.goal.x,traversed.z-traversal.goal.z)<.65&&visible(traversalRendering),{at:traversed,goal:traversal.goal,rendering:traversalRendering});
    await page.screenshot({path:join(out,'04b-interior-traversal.png')});
    for(const key of ['i','j']) {await page.keyboard.press(key);await page.waitForFunction(()=>(window as any).__tv.modal.isOpen);await page.keyboard.press('Escape');await page.waitForFunction(()=>!(window as any).__tv.modal.isOpen);}
    const returnPath=w.nav.findPath(pb.pos,doorway);if(!returnPath)throw Error('No interior exit path');
    await walkPath(returnPath);const exited=(await own()).pos,exitRendering=await actorRendering();
    note('keyboard exit actor unobscured',Math.hypot(exited.x-doorway.x,exited.z-doorway.z)<.65&&visible(exitRendering),{at:exited,goal:doorway,rendering:exitRendering});
    await page.screenshot({path:join(out,'04c-interior-exit.png')});
    const reentry=w.nav.findPath(pb.pos,indoor.inside);if(!reentry)throw Error('No repeat interior entry path');await walkPath(reentry);const retraverse=w.nav.findPath(pb.pos,traversal.goal);if(!retraverse)throw Error('No repeat interior traversal');await walkPath(retraverse);
    note('repeated keyboard entry after menus',Math.hypot(pb.pos.x-traversal.goal.x,pb.pos.z-traversal.goal.z)<.65,{at:{...pb.pos},goal:traversal.goal});
    const combatApproach=w.nav.findPath(pb.pos,indoor.inside);if(!combatApproach)throw Error('No interior combat approach');await walkPath(combatApproach);
  }
  // A high unarmed jab requires an upright human hurt volume, not a low boar's silhouette.
  // Only the upright NPC is staged beside the player after actual interior travel; commands resolve contact.
  const targetPosition=[{x:.55,z:-.55},{x:-.55,z:-.55},{x:.55,z:.55},{x:-.55,z:.55},{x:.8,z:0},{x:-.8,z:0},{x:0,z:-.8},{x:0,z:.8}]
    .map(d=>({...pb.pos,x:pb.pos.x+d.x,z:pb.pos.z+d.z}))
    .find(p=>[-.3,.3].every(dx=>[-.3,.3].every(dz=>[.1,1.1].every(dy=>!w.grid.isSolidAt(p.x+dx,p.y+dy,p.z+dz)))) && w.grid.lineOfPassage({...pb.pos,y:pb.pos.y+1.4},{...p,y:p.y+1.4}));
  if(!targetPosition)throw Error('No clear nearby upright combat fixture');
  body.pos=targetPosition; body.pose='stand'; setExternalControl(npc,true);
  const hpBefore=body.health;
  await page.waitForTimeout(1800); await page.keyboard.press('f'); await page.waitForTimeout(350);
  await page.keyboard.press('h'); await page.waitForTimeout(1200);
  const targetRendering=await actorRendering(body.id);
  note('locked melee target unobscured',visible(targetRendering),targetRendering);
  note('canonical melee contact',body.health<hpBefore,{before:hpBefore,after:body.health,targetBodyId:body.id,playerPosition:{...pb.pos},targetPosition:{...body.pos},action:pb.combatAction,fixture:'upright adult NPC staged beside player after keyboard interior traversal in disposable validation world'});
  await page.keyboard.press('Space'); await page.waitForTimeout(800);
  const combatRendering=await actorRendering();
  note('interior combat actor unobscured',visible(combatRendering),combatRendering);
  await page.screenshot({path:join(out,'05-interior-combat.png')});
  if (orbit) {
    await page.keyboard.press('f'); await page.waitForTimeout(100);
    const released=await page.evaluate(()=>(window as any).__tv.controller.lockedBodyId===null);
    await page.keyboard.press('f'); await page.waitForTimeout(100);
    const acquired=await page.evaluate(()=>(window as any).__tv.controller.lockedBodyId!==null);
    note('lock release and reacquisition through ordinary input',released&&acquired,{released,acquired});
    await page.keyboard.down('d'); await page.waitForTimeout(100); await page.keyboard.press('Space'); await page.waitForTimeout(100); await page.keyboard.up('d');
    const dodge=await page.evaluate(()=>{const c=(window as any).__tv.controller;return {intent:c.lastCombat,move:{...c.lastMoveWorld}};});
    const direction=dodge.intent?.direction, length=direction?Math.hypot(direction.x,direction.z):0;
    const movement=Math.hypot(dodge.move.x,dodge.move.z);
    note('directional dodge follows camera-relative input',dodge.intent?.defend==='sidestep'&&Math.abs(length-1)<.01&&movement>.5&&direction.x*dodge.move.x+direction.z*dodge.move.z>.95,{...dodge,length});
  }
  body.pos=original; setExternalControl(npc,false);
  note('combat controls emit canonical commands', !!await page.evaluate(()=>(window as any).__tv.controller.lastCombat), await page.evaluate(()=>{const tv=(window as any).__tv;return {lastCombat:tv.controller.lastCombat,bodyAction:tv.own()?.combatAction}}));
  await page.screenshot({path:join(out,'05-isometric-action.png')});
  await page.evaluate(() => (window as any).__tv.updateSettings({viewMode:'third-person'})); await page.waitForTimeout(500);
  const third = await own(); const restored=await page.evaluate(()=>(window as any).__tv.ctx.scene.meshes.every((m:any)=>!m.metadata?.cutawayBounds || m.material.clipPlane.d===-1e8)); await page.evaluate(view => (window as any).__tv.updateSettings({viewMode:view}),orbit?'orbit':'isometric'); await page.waitForTimeout(500);
  note('view switch round-trip',third.cameraMode===0 && (await own()).cameraMode===(orbit?0:1) && restored,{cutawaysRestored:restored});
  if (orbit) {
    const resources=()=>page.evaluate(()=>{const tv=(window as any).__tv;return {meshes:tv.ctx.scene.meshes.length,materials:tv.ctx.scene.materials.length,pendingBuilds:tv.regions.pendingBuilds,fps:tv.ctx.engine.getFps()};});
    const before=await resources();
    for(let i=0;i<6;i++){await page.evaluate(()=>(window as any).__tv.updateSettings({viewMode:'isometric'}));await page.waitForTimeout(150);await page.evaluate(()=>(window as any).__tv.updateSettings({viewMode:'orbit'}));await page.waitForTimeout(150);}
    const after=await resources();note('repeated projection switches retain scene resources',after.meshes<=before.meshes+5&&after.materials<=before.materials+5,{before,after,roundTrips:6});
  }
  writeFileSync(join(out,'browser-evidence.json'),JSON.stringify({checks,errors,fixture:'Movement, interior entry/traversal/exit/reentry and menus use ordinary input. Dialogue co-location, doorway starting position, initial canonical closed-door state and adult combat target staging are disclosed fixtures. No human/controller acceptance.',modelRequests},null,2));
  if(errors.length || checks.some(c=>c.passed===false)) throw Error('Browser checks failed; inspect evidence');
  console.log('Isometric browser checks passed.');
 } finally {
  globalThis.fetch = fetchBefore;
  const videoPath=orbit ? await page.video()?.path() : null;
  await browser.close();
  try { if(videoPath)copyFileSync(videoPath,join(out,'orbit-playthrough.webm')); }
  finally {
    await gateway.close(); await server.stopInProcess('dialogue UI complete');
    const ownedRelative=relative(resolve(tmpdir()),resolve(root));
    if(!ownedRelative || ownedRelative.startsWith('..') || isAbsolute(ownedRelative))throw Error('Refusing cleanup outside owned temporary root');
    rmSync(root,{recursive:true,force:true});
  }
}
