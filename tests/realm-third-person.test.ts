import { describe, expect, it } from 'vitest';
import { cameraRelativeMove, primaryCamera, travelFacing, smoothYaw, groundViewYaw } from '../src/web/realms/thirdPerson';
import { AdaptiveCamera, CAMERA_LIMITS } from '../src/web/game/adaptiveCamera';
import { RealmSession } from '../src/sim/world/realms/session';
import { INTERACTION_SPEC } from '../src/sim/physical/prediction';

describe('primary third-person locomotion', () => {
  it('matches forward and screen-right axes in the right-handed view at cardinal orbits', () => {
    for (const [yaw, forward, right] of [[0,[0,-1],[1,0]], [Math.PI/2,[-1,0],[0,-1]], [Math.PI,[0,1],[-1,0]], [-Math.PI/2,[1,0],[0,1]]] as const) {
      const f = cameraRelativeMove(0,1,yaw), r = cameraRelativeMove(1,0,yaw), back = cameraRelativeMove(0,-1,yaw);
      expect([f.x,f.z][0]).toBeCloseTo(forward[0]); expect(f.z).toBeCloseTo(forward[1]);
      expect(r.x).toBeCloseTo(right[0]); expect(r.z).toBeCloseTo(right[1]);
      expect(back.x).toBeCloseTo(-f.x); expect(back.z).toBeCloseTo(-f.z);
      expect(Math.hypot(...Object.values(cameraRelativeMove(1,1,yaw)))).toBeCloseTo(1);
    }
  });
  it('uses the visible eased orbit rather than jumping to input yaw mid-orbit', () => {
    const c = new AdaptiveCamera(), open = (_f:unknown,_d:unknown,max:number)=>max, pivot={x:0,y:1.3,z:0};
    c.update(1/60,{pivot},open);c.addLook(-Math.PI/2,0);const pose=c.update(1/60,{pivot},open);
    expect(c.renderedYaw).toBeLessThan(c.yaw);
    const move=cameraRelativeMove(0,1,c.renderedYaw), view={x:pose.target.x-pose.position.x,z:pose.target.z-pose.position.z};
    expect((move.x*view.x+move.z*view.z)/Math.hypot(view.x,view.z)).toBeGreaterThan(.99);
  });
  it('retains elevated perspective and the Tower tactical range without changing other clients', () => {
    const {camera}=primaryCamera('realm');expect(camera.pitch*180/Math.PI).toBeCloseTo(22);expect(camera.preferred).toBe(4);
    camera.zoom(100);expect(camera.preferred).toBe(18);camera.zoom(-100);expect(camera.preferred).toBe(3);
    expect(new AdaptiveCamera().limits.maxDistance).toBe(CAMERA_LIMITS.maxDistance);
    expect(camera.limits.maxDistance).toBeGreaterThan(13*Math.hypot(1,.8));
  });
  it('follows the actual focused view in a close obstructed combat frame', () => {
    const eye={x:0,z:1.5},target={x:2,z:-1},move=cameraRelativeMove(0,1,groundViewYaw(eye,target));
    const dx=target.x-eye.x,dz=target.z-eye.z;
    expect((move.x*dx+move.z*dz)/Math.hypot(dx,dz)).toBeCloseTo(1);
    expect(Math.abs(groundViewYaw(eye,target))).toBeGreaterThan(.5);
  });
  it('keeps camera preferences separate from world state and ignores invalid values', () => {
    const store=new Map<string,string>(), storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}};
    const a=primaryCamera('realm',storage);a.camera.yaw=.8;a.camera.pitch=.7;a.camera.preferred=15;a.persist();
    const restored=primaryCamera('realm',storage);expect(restored.camera.yaw).toBe(.8);expect(restored.camera.preferred).toBe(15);
    expect(primaryCamera('tower',storage).camera.yaw).toBe(0);
    store.set('torn-veil.primary-camera.realm.v3','{"yaw":20,"pitch":-100,"distance":100000}');
    const bad=primaryCamera('realm',storage);expect(bad.camera.yaw).toBe(Math.PI);expect(bad.camera.preferred).toBe(4);
  });
  it('adapts old named framing while retaining arbitrary legacy zoom preferences',()=>{
    const store=new Map<string,string>(),storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}};
    store.set('torn-veil.primary-camera.realm.v2',JSON.stringify({yaw:.8,pitch:23*Math.PI/180,distance:5.4}));
    const adapted=primaryCamera('realm',storage).camera;expect(adapted.preferred).toBe(4);expect(adapted.pitch*180/Math.PI).toBeCloseTo(22);expect(adapted.yaw).toBe(.8);
    store.set('torn-veil.primary-camera.realm.v2',JSON.stringify({yaw:.8,pitch:.7,distance:15}));
    const chosen=primaryCamera('realm',storage).camera;expect(chosen.preferred).toBe(15);expect(chosen.pitch).toBe(.7);
  });
  it('takes the short wrap-around turn and leaves idle facing unchanged', () => {
    expect(travelFacing({x:0,z:0})).toBeUndefined();
    expect(travelFacing({x:0,z:-1})).toBeCloseTo(0);
    const a=Math.PI-.03,b=-Math.PI+.03,next=smoothYaw(a,b,1/60);
    expect(next-a).toBeGreaterThan(0);expect(next-a).toBeLessThan(.06);
  });
  it('routes facing through canonical bounded turns and preserves save identity and belongings', () => {
    const s=new RealmSession(918271), before=s.snapshot(), oldYaw=s.body.yaw;
    s.move({x:0,z:1,sprint:false,facing:Math.PI});s.step(.05);
    const turn=Math.abs(Math.atan2(Math.sin(s.body.yaw-oldYaw),Math.cos(s.body.yaw-oldYaw)));
    expect(turn).toBeGreaterThan(0);expect(turn).toBeLessThanOrEqual(INTERACTION_SPEC.facingRadiansPerSecond*.05+1e-9);
    expect(s.body.pos.z).toBeGreaterThan(before.body.pos.z);
    const loaded=new RealmSession(0,s.save());expect(loaded.body.yaw).toBe(s.body.yaw);
    expect(loaded.body.id).toBe(before.body.id);expect(loaded.person.id).toBe(before.person.id);
    expect(loaded.snapshot().person.inventory).toEqual(before.person.inventory);expect(loaded.person.ontology.stage).toBe(before.person.rank);
  });
  it('refuses invalid facing instead of accepting a camera-owned body transform', () => {
    for(const facing of [NaN,Infinity,Math.PI+.001]) {
      const s=new RealmSession(918271),before={...s.body.pos};s.move({x:1,z:0,sprint:true,facing});s.step(.05);
      expect(s.body.pos).toEqual(before);
    }
  });
});
