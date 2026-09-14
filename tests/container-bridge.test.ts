import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { InteractionCommand } from '../src/bridge/commands';
import { makeContainer } from '../src/sim/core/container';
import { makeItem } from '../src/sim/world/factory';

function commands(session: BridgeSession) {
  const binding = session.bindInteraction('container-test'); let sequence = 0;
  return (command: InteractionCommand) => {
    const next = ++sequence;
    session.receiveCommand({version:2,type:'command',...binding,sequence:next,commandId:`container:${next}`,clientTimeMs:next,command});
    return session.stepInteraction(100 + next)[0];
  };
}

describe('canonical container bridge', () => {
  it('projects only a reachable open container and revalidates transfers server-side', () => {
    const session = new BridgeSession(213), world = session.world;
    const person = world.person(world.playerId)!, body = world.primaryBody(person.id)!;
    const chest = makeContainer(world,{name:'Test chest',capacity:8,pos:{...body.pos,x:body.pos.x+.7}});
    const carried = makeItem(world,'bread','Test bread',{holder:person.id,owner:person.id,quantity:2});
    const contained = makeItem(world,'lantern','Test lantern',{container:chest.id});
    const send = commands(session);

    expect(session.snapshot().container).toBeNull();
    expect(session.snapshot().interactions).toContainEqual(expect.objectContaining({id:`open:${chest.id}`}));
    expect(send({type:'interact',interactionId:`open:${chest.id}`})).toMatchObject({status:'applied'});
    expect(session.snapshot().container).toMatchObject({id:chest.id,items:[{id:contained.id}]});

    expect(send({type:'container_transfer',containerId:chest.id,itemId:carried.id,direction:'into'})).toMatchObject({status:'applied'});
    expect(person.inventory).not.toContain(carried.id);
    expect(session.snapshot().container!.items.map(i=>i.id)).toEqual([contained.id,carried.id]);
    expect(send({type:'container_transfer',containerId:chest.id,itemId:contained.id,direction:'out'})).toMatchObject({status:'applied'});
    expect(person.inventory).toContain(contained.id);

    body.pos.x += 10;
    expect(session.snapshot().container).toBeNull();
    expect(send({type:'container_transfer',containerId:chest.id,itemId:carried.id,direction:'out'})).toMatchObject({status:'rejected',result:'interaction_unavailable'});
  });

  it('persists the projected container and item location through a bridge save', () => {
    const session = new BridgeSession(214), world = session.world;
    const person = world.person(world.playerId)!, body = world.primaryBody(person.id)!;
    const chest = makeContainer(world,{name:'Persistent chest',open:true,capacity:8,pos:{...body.pos,x:body.pos.x+.7}});
    const item = makeItem(world,'book','Field notes',{container:chest.id});
    const resumed = new BridgeSession(214,{save:session.save()});
    expect(resumed.snapshot().container).toMatchObject({id:chest.id,items:[{id:item.id,name:'Field notes'}]});
    expect(resumed.world.item(item.id)?.containerId).toBe(chest.id);
  });
});
