import {describe,it,expect} from 'vitest';
import {BridgeSession} from '../src/bridge/session';
import {arrangeCombatArena} from '../src/bridge/combatArena';
import type {InteractionCommand} from '../src/bridge/commands';

function fixture(arena=true){
  const s=new BridgeSession(123,{arena});if(arena)arrangeCombatArena(s,'idle');
  const binding=s.bindInteraction('practice-test');let sequence=0;
  const queue=(command:InteractionCommand)=>{
    const seq=++sequence;
    return s.receiveCommand({version:2,type:'command',...binding,sequence:seq,commandId:`practice:${seq}`,clientTimeMs:seq,command},seq)!;
  };
  const advance=(ticks:number)=>{for(let i=0;i<ticks;i++)s.stepInteraction(sequence+1);};
  return {s,queue,advance};
}
describe('in-game scripted combat practice',()=>{
  it('stays passive until requested, then performs canonical preparation, contact and recovery',()=>{
    const {s,queue,advance}=fixture(),[p,n]=s.world.persons(),pb=s.world.primaryBody(p.id)!,nb=s.world.primaryBody(n.id)!;
    advance(90);expect(nb.combatAction).toBeUndefined();
    queue({type:'practice',mode:'repeat'});advance(62); // include the next 60 Hz tick at the one-second deadline
    expect(s.localState()?.practice).toMatchObject({scripted:true,mode:'repeat',ready:true});
    expect(nb.combatAction?.kind).toBe('attack');expect(nb.combatAction?.outcome).toBe('pending');expect(pb.health).toBe(pb.maxHealth);
    advance(30);expect(nb.combatAction?.outcome).toBe('hit');expect(pb.health).toBeLessThan(pb.maxHealth);
    expect(s.localState()?.practice?.lastContact).toBeTruthy();
    queue({type:'practice',mode:'passive'});advance(90);
    const count=s.world.events.filter(e=>e.type==='attack'&&e.actor===n.id).length;
    advance(90);expect(s.world.events.filter(e=>e.type==='attack'&&e.actor===n.id)).toHaveLength(count);
  });
  it('reset clears a buffered follow-up and queued commands and recovers an incapacitated player',()=>{
    const {s,queue,advance}=fixture(),b=s.world.primaryBody(s.world.playerId!)!;
    queue({type:'attack'});advance(1);advance(17);
    queue({type:'attack'});advance(1);expect(b.combatAction?.queuedInput).toBeDefined();
    b.health=0;b.pose='downed';
    queue({type:'practice',mode:'reset'});queue({type:'attack'});advance(1);
    expect(b.health).toBe(b.maxHealth);expect(b.pose).toBe('stand');expect(b.combatAction).toBeUndefined();
    advance(60);expect(b.combatAction).toBeUndefined();expect(s.localState()?.practice?.mode).toBe('passive');
  });
  it('rejects practice controls outside the isolated arena',()=>{
    const {s,queue}=fixture(false);queue({type:'practice',mode:'repeat'});
    expect(s.stepInteraction(10)[0]).toMatchObject({status:'rejected',result:'arena_only'});
    expect(s.localState()?.practice).toBeNull();
  });
});
