import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import { PlayerController, type Candidate } from '../src/web/game/controller';
import { DEFAULT_SETTINGS } from '../src/web/game/bindings';
import { CameraRig } from '../src/web/game/cameraRig';
import { ActorManager } from '../src/web/actors/actorManager';
import { RegionManager } from '../src/web/world/regionManager';
afterEach(() => vi.restoreAllMocks());
function controller() {
  const sent: any[] = [], edges = new Set<string>(); let connected = true, acting = true;
  const targets: Candidate[] = [{bodyId:'enemy',pos:{x:0,y:0,z:5},kind:'person',hostile:true,name:'Enemy',dead:false}];
  const input = {releaseSerial:0,move:{x:0,y:0},pressed:(a:string)=>edges.has(a),isDown:()=>false,releaseAll:()=>{edges.clear();input.releaseSerial++;},stopAutoWalk:()=>{}};
  const cam = {yaw:Math.PI,moveYaw:Math.PI,cutaway:true,isometric:false,aimYaw:null};
  const predictor = {predicted:{pos:{x:0,y:0,z:0}},advanceBy:()=>{}};
  const link = {sendCommand:(c:any)=>{if(!connected)return null;sent.push(c);return {commandId:`c${sent.length}`,sequence:sent.length};}};
  const c = new PlayerController(link as any,predictor as any,input as any,cam as any,()=>DEFAULT_SETTINGS,{canAct:()=>acting,conversationPartner:()=>null},()=>targets,()=>({x:0,y:0,z:0}));
  return {c,sent,edges,input,cam,targets,setConnected:(v:boolean)=>connected=v,setActing:(v:boolean)=>acting=v};
}
it('acquires behind-camera orbit targets, toggles off and drops lost/dead/distant targets while paused',()=>{
  const h=controller();h.cam.yaw=0;h.cam.moveYaw=0;h.c.toggleLock();expect(h.c.lockedBodyId).toBe('enemy');h.c.toggleLock();expect(h.c.lockedBodyId).toBeNull();
  for(const loss of ['dead','distance','missing']){
    h.targets.splice(0,h.targets.length,{bodyId:'enemy',pos:{x:0,y:0,z:5},kind:'person',hostile:true,name:'Enemy',dead:false});h.c.setLock('enemy');h.setActing(false);
    if(loss==='dead')h.targets[0].dead=true;else if(loss==='distance')h.targets[0].pos.z=27;else h.targets.length=0;
    h.c.update(.016);expect(h.c.lockedBodyId).toBeNull();
  }
});
it.each([0,Math.PI/2,Math.PI,-Math.PI/2])('sends normalized camera-relative diagonal dodge at yaw %s',yaw=>{
  const h=controller();h.cam.moveYaw=yaw;h.input.move={x:Math.SQRT1_2,y:Math.SQRT1_2};h.edges.add('dodge');h.c.update(.016);
  const d=h.sent.at(-1);expect(d.type).toBe('defend');expect(d.direction.x).toBeCloseTo((-Math.sin(yaw)+Math.cos(yaw))*Math.SQRT1_2);expect(d.direction.z).toBeCloseTo((-Math.cos(yaw)-Math.sin(yaw))*Math.SQRT1_2);expect(Math.hypot(d.direction.x,d.direction.z)).toBeCloseTo(1);
});
it('keeps neutral dodge a canonical backstep and does not consume its debounce on failed transport',()=>{
  const h=controller();vi.spyOn(performance,'now').mockReturnValue(1000);h.edges.add('dodge');h.setConnected(false);h.c.update(.016);h.setConnected(true);h.c.update(.016);expect(h.sent).toEqual([{type:'defend',kind:'backstep',side:1}]);h.c.update(.016);expect(h.sent).toHaveLength(1);
});
it('sends each attack edge to existing canonical buffering with the actual locked target',()=>{
  const h=controller();h.c.toggleLock();h.edges.add('lightAttack');h.c.update(.016);h.edges.clear();h.c.update(.016);h.edges.add('heavyAttack');h.c.update(.016);
  expect(h.sent.map(c=>[c.type,c.weight,c.targetBodyId])).toEqual([['attack','light','enemy'],['attack','heavy','enemy']]);
});
it('lost focus clears latched sprint/focus/crouch and sends guard release',()=>{
  const h=controller();h.c.guardHeld=h.c.focusHeld=h.c.sprintHeld=h.c.crouchToggled=true;(h.c as any).guardWanted=true;h.input.releaseAll();h.c.update(.016);
  expect(h.c.guardHeld||h.c.focusHeld||h.c.sprintHeld||h.c.crouchToggled).toBe(false);expect(h.sent).toContainEqual({type:'guard',held:false});
});
it('keeps a live canonical strike visible until its buffered follow-up actually starts',()=>{
  const action={commandId:'first',phase:'recovery',kind:'attack',moveId:'jab',startedAt:0,activeAt:.1,recoveryAt:.2,completeAt:1};
  const actor:any={body:{combatAction:action},yaw:0,predicted:{commandId:'second',moveId:'cross',weight:'light',startedAtMs:400,prep:.1,active:.1,recovery:.2}};
  const manager:any={actors:new Map([['own',actor]])};
  const pose=(ActorManager.prototype as any).combatFor.call(manager,actor,450,.45);expect(pose.moveId).toBe('jab');expect(pose.predicted).not.toBe(true);
  ActorManager.prototype.applyLocalCombat.call(manager,'own',action as any,'second');expect(actor.predicted).toBeNull();
  const next={...action,commandId:'second',moveId:'cross',startedAt:1,completeAt:2};ActorManager.prototype.applyLocalCombat.call(manager,'own',next as any,null);
  expect((ActorManager.prototype as any).combatFor.call(manager,actor,1100,1.1).moveId).toBe('cross');
  ActorManager.prototype.applyLocalCombat.call(manager,'own',{...next,phase:'interrupted'} as any,null);
  expect((ActorManager.prototype as any).combatFor.call(manager,actor,1100,1.1)).toBeNull();
});
it('pulls inside an obstruction immediately and recovers gradually after it clears',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',Vector3.Zero(),scene);let blocked=false;
  const rig=new CameraRig(camera,()=>({...DEFAULT_SETTINGS,viewMode:'orbit'}),{blocked:(x,y,z)=>blocked&&Math.hypot(x,z)>2,ground:()=>0});const p={x:0,y:1.55,z:0};
  try{for(let i=0;i<60;i++)rig.update(.05,p,0);const far=Vector3.Distance(camera.position,new Vector3(0,1.55,0));blocked=true;rig.update(.016,p,0);const close=Vector3.Distance(camera.position,new Vector3(0,1.55,0));expect(close).toBeLessThan(3);blocked=false;rig.update(.016,p,0);const recovered=Vector3.Distance(camera.position,new Vector3(0,1.55,0));expect(recovered).toBeGreaterThan(close);expect(recovered).toBeLessThan(far-2);}finally{scene.dispose();engine.dispose();}
});
it('cuts a building hiding the locked fighter even when it does not obscure the player',()=>{
  const plane={d:-1e8},bounds={x0:10,x1:20,z0:10,z1:20,y0:0,y1:7};const context:any={origin:{x:0,y:0,z:0},regions:new Map([['r',{windows:{meshes:[]},meshes:[{metadata:{cutawayBounds:bounds},material:{clipPlane:plane}}]}]])};
  RegionManager.prototype.updateCutaway.call(context,{x:0,y:0,z:30},new Vector3(0,10,0),{x:15,y:0,z:15});expect(plane.d).toBe(-.8);
  RegionManager.prototype.updateCutaway.call(context,{x:0,y:0,z:30},new Vector3(0,10,0));expect(plane.d).toBe(-1e8);
});
