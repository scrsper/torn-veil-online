import {describe,it,expect} from 'vitest';
import {RealmSession} from '../src/sim/world/realms/session';
import {RealmRuntime} from '../src/server/realmRuntime';
import {INTERACTION_SPEC} from '../src/sim/physical/prediction';
import {trialKit} from '../src/sim/world/interiors/trialKit';
import {assessArcaneTransformation,TRANSFORMATIONS} from '../src/sim/physical/arcana/growth';

function city(){const r=new RealmRuntime(new RealmSession(718));r.apply({type:'bind',id:'city',epoch:'epoch'});return r;}
function command(r:RealmRuntime,sequence:number,value:any){return r.apply({type:'command',now:sequence*17,input:{version:2,type:'command',epoch:'epoch',controllerId:'city',bodyId:r.session.body.id,specRevision:INTERACTION_SPEC.revision,sequence,commandId:`city-${sequence}`,clientTimeMs:sequence*17,command:value}});}
const tick=(r:RealmRuntime,n=1)=>{let receipts:any[]=[];for(let i=0;i<n;i++)receipts.push(...r.apply({type:'step',now:i*17}));return receipts;};
const canonical=(r:RealmRuntime)=>{const x=JSON.parse(r.session.save());delete x.savedAt;return x;};

describe('one canonical realm controller',()=>{
 it('admits street combat through the same binding and advances one 60 Hz clock',()=>{
  const r=city(),p=r.session.person.id,b=r.session.body.id,t=r.session.world.physicalTime;
  expect(command(r,0,{type:'attack',trajectory:'high',weight:'light'}).status).toBe('received');
  expect(tick(r)[0].result).toBe('accepted');expect(r.session.body.combatAction?.kind).toBe('attack');
  tick(r,59);expect(r.session.world.physicalTime-t).toBeCloseTo(1,9);
  expect(r.session.snapshot().avatar.combatAction).not.toBeNull();
  expect(r.session.person.id).toBe(p);expect(r.session.body.id).toBe(b);expect(r.session.world.canonicalTower).toBeUndefined();
 });
 it('checkpoints pending street commands and releases held guard on disconnect',()=>{
  const r=city();command(r,0,{type:'guard',held:true});
  const replay=new RealmRuntime(new RealmSession(0,r.session.save()),r.checkpoint());
  const results=(receipts:any[])=>receipts.map(({appliedAtMs,...r})=>r);
  expect(results(tick(r))).toEqual(results(tick(replay)));expect(canonical(r)).toEqual(canonical(replay));
  expect(r.session.snapshot().avatar.guarding).toBe(true);
  r.apply({type:'disconnect'});tick(r,20);expect(r.session.snapshot().avatar.guarding).toBe(false);
  expect(r.controller.bridge.hasInteractionControl()).toBe(false);
 });
 it('does not apply old movement a second time when the shared controller is bound',()=>{
  const a=city(),b=city();a.session.move({x:1,z:0,sprint:false});
  for(let i=0;i<12;i++){command(a,i,{type:'move',x:0,z:1,sprint:false});command(b,i,{type:'move',x:0,z:1,sprint:false});tick(a);tick(b);}
  expect(a.session.body.pos).toEqual(b.session.body.pos);
  command(a,12,{type:'practice',mode:'reset'});expect(tick(a)[0].status).toBe('rejected');
 });
 it('raises authored physical armor on every subsequent floor without comparing ranks',()=>{
  for(let floor=2;floor<=100;floor++)expect(trialKit(floor,1).armor).toBeGreaterThan(trialKit(floor-1,1).armor);
 });
 it('retains meaningful gates and Gold control requirements without a policy lock',()=>{
  expect(TRANSFORMATIONS[0].victories).toBeGreaterThan(12);
  const r=city();r.session.person.ontology.stage='Silver';
  const a=assessArcaneTransformation(r.session.world,r.session.person,r.session.body);
  expect(a.next?.stage).toBe('Gold');expect(a.eligible).toBe(false);
  expect(a.reasons.some(s=>s.includes('97%'))).toBe(true);expect(a.reasons.some(s=>s.includes('paused'))).toBe(false);
 });
});
