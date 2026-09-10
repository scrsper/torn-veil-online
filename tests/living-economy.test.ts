import { setExternalControl } from '../src/sim/runtime/controllers';
import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v, step } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { makeHousehold, joinHousehold, provisionHousehold, homeFood, observeHome } from '../src/sim/world/household';
import { buyFoodHere, findAccessibleFood, eatFood, restockTavern, BREW_RATIO, mill, takePortionInHand } from '../src/sim/world/metabolism';
import { economicOperatorFor, wholesaleBuyerFor } from '../src/sim/world/trade';
import { stockAt, addPlaceStock } from '../src/sim/world/stock';
import { registerGameGround, extractFromNode, maintainResourceNodes } from '../src/sim/world/resources';
import { createFire, igniteFire } from '../src/sim/world/fire';
import { noteFoodShortage, learnPlace, knownFoodPlace } from '../src/sim/mind/knowledge';
import { createHaulTask, claimHaulTask, loadHaulCargo, depositHaulCargo, affordableHaulQuantity, maintainHauls } from '../src/sim/logistics/haul';
import { payWage, createRequest, acceptRequest, completeRequest } from '../src/sim/core/requests';
import { productionSummary, generateProductionNeeds } from '../src/sim/world/production';
import { newWorld, serialize, deserialize } from '../src/sim/persist/save';
import { moveByIntent } from '../src/sim/physical/input';
import type { World } from '../src/sim/core/world';
import { committedUnits, willingnessFor } from '../src/sim/world/commerce';
import { activityLevelFor, stepPhysiology, syncNeeds } from '../src/sim/core/physiology';
import { getPhysicalCapability } from '../src/sim/core/attributes';
import { noteWorkBlocked } from '../src/sim/world/shortfall';

const cash = (w: World) => w.persons().reduce((n,p)=>n+p.wealth,0) + w.households().reduce((n,h)=>n+h.wealth,0);
function family() {
  const tw = createTestWorld(7301);
  const home = makePlace(tw.world, 'house', 'home', {x0:2,z0:2,x1:8,z1:8,y0:1,y1:4}, {inside:v(4,1,4)});
  const parent = addPerson(tw,'Parent','farmer',home.inside,{homeId:home.id,controlled:true});
  const child = addPerson(tw,'Child','child',home.inside,{homeId:home.id,controlled:true});
  const h = makeHousehold(tw.world,'Family',home.id);
  joinHousehold(tw.world,parent,h); joinHousehold(tw.world,child,h);
  return {...tw,home,parent,child,h};
}

describe('household provisioning',()=>{
  it('brings owned surplus food home from work without needing a purchase or money',()=>{
    const tw=family(), {world,parent}=tw;
    const work=makePlace(world,'wilderness','Gathering ground',{x0:12,z0:12,x1:17,z1:17,y0:1,y1:4},{inside:v(14,1,14)});
    observeHome(world,parent); setExternalControl(parent, false); parent.schedule=[]; parent.mind.thinkInterval=0.25; parent.wealth=0;
    world.primaryBody(parent.id)!.pos={...work.inside};
    const stock=makeItem(world,'meat','catch',{owner:parent.id,placeId:work.id,pos:work.inside,quantity:6});
    stock.createdAt=world.now-86400;
    const before=cash(world); step(tw,60);
    const pantry=homeFood(world,parent);
    // The existing provision action picks up two meals and keeps one for the carrier.
    expect(pantry.reduce((n,i)=>n+i.quantity,0)).toBe(1);
    expect(pantry[0].createdAt).toBe(stock.createdAt);
    expect(stock.quantity).toBe(4);
    expect(world.items().filter(i=>i.type==='meat').reduce((n,i)=>n+i.quantity,0)).toBe(6);
    expect(world.events.some(e=>e.type==='purchase_made'&&e.actor===parent.id)).toBe(false);
    expect(cash(world)).toBe(before);
  });

  it('retains age and proportional spoilage when picking up a portion of older food',()=>{
    const {world,parent,home}=family();
    const fresh=makeItem(world,'bread','fresh bread',{owner:parent.id,holder:parent.id,quantity:1});
    const older=makeItem(world,'bread','older bread',{owner:parent.id,placeId:home.id,pos:home.inside,quantity:4});
    older.createdAt=world.now-86400; older.spoilAccum=0.5;
    const taken=takePortionInHand(world,parent,older,2,'for the household')!;
    expect(taken.id).not.toBe(fresh.id); expect(fresh.quantity).toBe(1);
    expect(taken.createdAt).toBe(older.createdAt); expect(taken.quantity).toBe(2);
    expect(taken.spoilAccum).toBe(0.25); expect(older.spoilAccum).toBe(0.25);
  });

  it('an ordinary goal buys food and carries it home for dependants before the shopper is hungry',()=>{
    const tw=family(), {world,parent,home}=tw, tavern=world.place(tw.places.tavern)!;
    setExternalControl(parent, false); parent.mind.thinkInterval=0.25; parent.schedule=[]; parent.wealth=30;
    const seller=addPerson(tw,'Seller','innkeeper',tavern.inside,{controlled:true,workId:tavern.id});
    addPlaceStock(world,'bread',20,tavern.id,seller.id,undefined,'seeded'); learnPlace(world,parent,tavern,{type:'prior'});
    observeHome(world,parent); step(tw,60);
    expect(world.runTally.household_food_deposited??0).toBeGreaterThan(0);
    expect(homeFood(world,parent).reduce((n,i)=>n+i.quantity,0)).toBeGreaterThan(0);
    expect(world.events.some(e=>e.type==='goal_changed'&&e.actor===parent.id&&e.data.to==='provision_home')).toBe(true);
  });
  it('shares conserved money and food, retains batch age, and feeds a dependent after the shopper leaves',()=>{
    const {world,sim,parent,child,home,h}=family();
    parent.wealth=80; child.wealth=0;
    const carried=makeItem(world,'bread','bread',{owner:parent.id,holder:parent.id,quantity:5});
    carried.createdAt=world.now-86400; carried.spoilAccum=0.5;
    const before=cash(world);
    expect(sim.provisionHousehold(parent)).toBe(true);
    expect(carried.quantity).toBe(1); expect(h.wealth).toBe(12);
    const pantry=homeFood(world,child)[0];
    expect(pantry.quantity).toBe(4); expect(pantry.ownerId).toBe(h.id);
    expect(pantry.createdAt).toBe(carried.createdAt);
    expect(pantry.spoilAccum!+carried.spoilAccum!).toBeCloseTo(0.5);
    world.primaryBody(parent.id)!.pos=v(20,1,20); child.physiology.energy=0;
    expect(findAccessibleFood(world,child,home.id)?.id).toBe(pantry.id);
    eatFood(world,child,pantry); expect(child.physiology.energy).toBeGreaterThan(0);
    expect(provisionHousehold(world,child)).toBe(true);
    expect(child.wealth).toBe(6); expect(h.wealth).toBe(6); expect(cash(world)).toBe(before);
  });

  it('refuses remote pantry and purse access, unrelated co-residents, and free vendor stock',()=>{
    const tw=family(), {world,parent,child,home,h}=tw;
    parent.wealth=0; h.wealth=12;
    makeItem(world,'bread','bread',{owner:h.id,placeId:home.id,pos:home.inside,quantity:4});
    world.primaryBody(child.id)!.pos=v(20,1,20);
    expect(provisionHousehold(world,child)).toBe(false);
    expect(findAccessibleFood(world,child,home.id)).toBeNull();
    const outsider=addPerson(tw,'Lodger','farmer',home.inside,{homeId:home.id}); home.residents.push(outsider.id);
    expect(findAccessibleFood(world,outsider,home.id)).toBeNull();
    const tavern=world.place(tw.places.tavern)!; tavern.ownerId=parent.id;
    makeItem(world,'bread','shop stock',{owner:parent.id,placeId:tavern.id,pos:tavern.inside,quantity:2});
    world.primaryBody(outsider.id)!.pos={...tavern.inside};
    expect(findAccessibleFood(world,outsider,tavern.id)).toBeNull();
  });

  it('updates pantry beliefs through visits rather than remote inventory changes',()=>{
    const {world,parent,home,h}=family(); observeHome(world,parent);
    world.primaryBody(parent.id)!.pos=v(20,1,20);
    makeItem(world,'bread','delivery',{owner:h.id,placeId:home.id,pos:home.inside,quantity:4}); observeHome(world,parent);
    expect(parent.knowledge[`pantry:${h.id}`].claim.quantity).toBe(0);
    world.primaryBody(parent.id)!.pos={...home.inside}; observeHome(world,parent);
    expect(parent.knowledge[`pantry:${h.id}`].claim.quantity).toBe(4);
  });
});

describe('food access and earned circulation',()=>{
  it('lets an actual replacement operate new production without transferring a dead owners estate',()=>{
    const tw=createTestWorld(), {world}=tw;
    const place=makePlace(world,'mill','Mill',{x0:2,z0:2,x1:8,z1:8,y0:1,y1:4},{inside:v(4,1,4)});
    const former=addPerson(tw,'Former','miller',place.inside), replacement=addPerson(tw,'Replacement','farmer',place.inside);
    place.ownerId=former.id; place.workers.push(former.id); former.alive=false;
    const estate=addPlaceStock(world,'flour',30,place.id,former.id,undefined,'old output');
    addPlaceStock(world,'grain',3,place.id,replacement.id,undefined,'bought inputs');
    expect(mill(world,replacement).ok).toBe(true);
    expect(world.itemsAtPlaces([place.id]).some(i=>i.type==='flour'&&i.ownerId===replacement.id&&i.quantity>0)).toBe(true);
    world.workStints.push({id:'replacement-stint',personId:replacement.id,placeId:place.id,resource:'flour',startedAt:world.now,batches:1,skillAtStart:0,reason:'the mill had no worker'});
    expect(economicOperatorFor(world,place.id)).toBe(replacement.id); expect(wholesaleBuyerFor(world,place.id)).toBe(replacement.id);
    expect(place.ownerId).toBe(former.id); expect(estate.ownerId).toBe(former.id); expect(estate.quantity).toBe(30);
    generateProductionNeeds(world);
    expect(world.requests.some(r=>r.type==='production'&&r.payload.resource==='flour'&&r.requesterId===replacement.id)).toBe(true);
    const customer=addPerson(tw,'Customer','innkeeper',world.place(tw.places.tavern)!.inside); customer.wealth=40;
    world.place(tw.places.tavern)!.ownerId=customer.id;
    const task=createHaulTask(world,{resource:'flour',quantity:2,sourcePlaceId:place.id,destPlaceId:tw.places.tavern,requesterId:customer.id,priority:1,reason:'new flour'});
    const before=replacement.wealth; claimHaulTask(world,task,replacement);
    expect(loadHaulCargo(world,task,replacement)).toBe(true); expect(replacement.wealth).toBeGreaterThan(before); expect(estate.quantity).toBe(30);
  });

  it('does not turn freight into personal property when its carrier buys an older batch of food',()=>{
    const tw=createTestWorld(), {world}=tw, tavern=world.place(tw.places.tavern)!;
    const seller=addPerson(tw,'Seller','baker',tavern.inside), buyer=addPerson(tw,'Carrier','farmer',tavern.inside);
    buyer.wealth=50;
    const cargo=makeItem(world,'bread','cargo',{owner:seller.id,holder:buyer.id,quantity:8}); cargo.haulTaskId='shipment';
    const source=addPlaceStock(world,'bread',5,tavern.id,seller.id,undefined,'baked'); source.createdAt=world.now-86400; source.spoilAccum=0.5;
    const bought=buyFoodHere(world,buyer,2).food!;
    expect(bought.id).not.toBe(cargo.id); expect(cargo.ownerId).toBe(seller.id); expect(cargo.quantity).toBe(8);
    expect(bought.createdAt).toBe(source.createdAt); expect(bought.spoilAccum!+source.spoilAccum!).toBeCloseTo(0.5);
  });

  it('keeps different producers timber in separate ownership even when it shares a stockpile',()=>{
    const tw=createTestWorld(), {world}=tw;
    const a=addPerson(tw,'One','woodcutter',v(2,1,2)), b=addPerson(tw,'Two','woodcutter',v(2,1,2));
    const first=addPlaceStock(world,'log',2,tw.places.square,a.id,undefined,'felled');
    const second=addPlaceStock(world,'log',3,tw.places.square,b.id,undefined,'felled');
    expect(first.id).not.toBe(second.id); expect(first.quantity).toBe(2); expect(second.ownerId).toBe(b.id);
    expect(addPlaceStock(world,'log',1,tw.places.square,a.id,undefined,'felled').id).toBe(first.id);
    expect(first.quantity).toBe(3);
  });

  it('pays the actual carrier for a partial delivery once, rather than withholding all wages or paying for undelivered goods',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.chapel)!, dest=world.place(tw.places.tavern)!;
    const buyer=addPerson(tw,'Buyer','innkeeper',dest.inside), worker=addPerson(tw,'Carrier','farmer',source.inside);
    dest.ownerId=buyer.id; buyer.wealth=50; worker.wealth=0;
    addPlaceStock(world,'grain',3,source.id,buyer.id,undefined,'owned supply');
    const task=createHaulTask(world,{resource:'grain',quantity:10,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:buyer.id,priority:1,reason:'delivery'});
    const req=world.requests.find(r=>r.id===task.requestId)!; req.reward=20;
    claimHaulTask(world,task,worker); expect(loadHaulCargo(world,task,worker)).toBe(true);
    world.primaryBody(worker.id)!.pos={...dest.inside}; expect(depositHaulCargo(world,task,worker)).toBe(true);
    expect(task.delivered).toBe(3); expect(worker.wealth).toBe(6); expect(req.paid).toBe(6); expect(buyer.wealth).toBe(44);
    expect(depositHaulCargo(world,task,worker)).toBe(false); expect(completeRequest(world,req)).toBe(0); expect(worker.wealth).toBe(6);
  });

  it('uses paid work to recover food access instead of repeatedly attempting a known unaffordable meal',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.chapel)!, dest=world.place(tw.places.tavern)!;
    const keeper=addPerson(tw,'Keeper','innkeeper',dest.inside,{controlled:true}); dest.ownerId=keeper.id; keeper.wealth=50;
    const worker=addPerson(tw,'Worker','farmer',source.inside); worker.wealth=0;
    worker.schedule=[{start:0,end:24,activity:'work',placeId:source.id,label:'routine duties'}];
    worker.mind.thinkInterval=0.25; worker.knowledge={}; worker.physiology.energy=0.1;
    learnPlace(world,worker,dest,{type:'prior'}); noteFoodShortage(world,worker,dest.id,'unaffordable',3);
    addPlaceStock(world,'bread',15,dest.id,keeper.id,undefined,'baked');
    addPlaceStock(world,'grain',20,source.id,keeper.id,undefined,'harvested');
    createHaulTask(world,{resource:'grain',quantity:20,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:keeper.id,priority:1,reason:'grain for brewing'});
    step(tw,60);
    expect(world.events.some(e=>e.type==='wage_paid'&&e.target===worker.id)).toBe(true);
    expect(world.events.some(e=>e.type==='food_consumed'&&e.actor===worker.id)).toBe(true);
    expect(worker.physiology.energy).toBeGreaterThan(0.1);
  });

  it('tries another known counter after empty shelves even when it sees the first shop sign again',()=>{
    const tw=createTestWorld(), {world}=tw, first=world.place(tw.places.tavern)!;
    const second=makePlace(world,'store','Other food shop',{x0:20,z0:20,x1:24,z1:24,y0:1,y1:3},{inside:v(22,1,22)});
    const buyer=addPerson(tw,'Buyer','villager',first.inside,{controlled:true});
    learnPlace(world,buyer,first,{type:'prior'}); learnPlace(world,buyer,second,{type:'prior'});
    noteFoodShortage(world,buyer,first.id); learnPlace(world,buyer,first,{type:'witnessed'});
    expect(knownFoodPlace(world,buyer)).toBe(second.id);
    noteFoodShortage(world,buyer,second.id);
    expect(knownFoodPlace(world,buyer)).toBeUndefined(); // must search, not invent a stocked shop
    world.clock.worldSeconds+=2*3600;
    expect(knownFoodPlace(world,buyer)).toBeDefined();
  });

  it('searches another counter for food when every known shop was recently empty',()=>{
    const tw=createTestWorld(), {world}=tw, first=world.place(tw.places.tavern)!;
    const second=makePlace(world,'bakery','Bakery',{x0:25,z0:25,x1:31,z1:31,y0:1,y1:3},{inside:v(28,1,28)});
    const buyer=addPerson(tw,'Buyer','villager',first.inside), seller=addPerson(tw,'Baker','baker',second.inside,{controlled:true});
    buyer.physiology.energy=0.02; buyer.traits.sociability=1; buyer.needs.social=1; buyer.traits.piety=0; buyer.schedule=[];
    learnPlace(world,buyer,first,{type:'prior'}); learnPlace(world,buyer,second,{type:'prior'});
    noteFoodShortage(world,buyer,first.id); noteFoodShortage(world,buyer,second.id);
    addPlaceStock(world,'bread',8,second.id,seller.id,undefined,'baked');
    const before=cash(world); expect(knownFoodPlace(world,buyer)).toBeUndefined();
    step(tw,110);
    expect(world.events.some(e=>e.type==='purchase_made'&&e.actor===buyer.id&&e.placeId===second.id)).toBe(true);
    expect(world.events.some(e=>e.type==='food_consumed'&&e.actor===buyer.id)).toBe(true);
    expect(cash(world)).toBeCloseTo(before);
  });

  it('lets critical hunger compete above sociability when a meal is known and affordable',()=>{
    const tw=createTestWorld(), {world}=tw, shop=world.place(tw.places.tavern)!;
    const buyer=addPerson(tw,'Hungry sociable buyer','villager',world.place(tw.places.square)!.inside);
    const seller=addPerson(tw,'Seller','innkeeper',shop.inside,{controlled:true});
    buyer.physiology.energy=0.02; buyer.traits.sociability=1; buyer.needs.social=1; buyer.traits.piety=0; buyer.schedule=[];
    syncNeeds(buyer);
    learnPlace(world,buyer,shop,{type:'prior'}); addPlaceStock(world,'bread',8,shop.id,seller.id,undefined,'baked');
    step(tw,1);
    expect(buyer.mind.goal?.type).toBe('eat');
    step(tw,59);
    expect(world.events.some(e=>e.type==='food_consumed'&&e.actor===buyer.id)).toBe(true);
    expect(buyer.physiology.energy).toBeGreaterThan(0.02);
  });

  it('does not mistake another workers production order for a way to obtain its own meal',()=>{
    const tw=createTestWorld(), {world}=tw, tavern=world.place(tw.places.tavern)!;
    const cook=addPerson(tw,'Hungry cook','cook',tavern.inside,{workId:tavern.id,traits:{sociability:0,piety:0}});
    const other=addPerson(tw,'Working cook','cook',tavern.inside,{controlled:true,workId:tavern.id});
    cook.skills.cooking=0.6; cook.schedule=[]; cook.physiology.energy=0; syncNeeds(cook);
    noteFoodShortage(world,cook,tavern.id);
    const req=createRequest(world,{type:'production',requesterId:other.id,requesterPlaceId:tavern.id,
      reward:3,cause:'stew for the tavern',payload:{resource:'stew',quantity:3,placeId:tavern.id}});
    acceptRequest(world,req,other);
    step(tw,1);
    expect(cook.mind.goal?.data?.foodSearch).toBe(true);
    expect(cook.mind.decision?.candidates.some(c=>c.reasons.includes('I know how to make stew'))).toBe(false);
    expect(req.acceptedBy).toBe(other.id);
  });

  it('does not advertise purchases the issuer cannot fund',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.chapel)!, dest=world.place(tw.places.tavern)!;
    const seller=addPerson(tw,'Farmer','farmer',source.inside), buyer=addPerson(tw,'Buyer','innkeeper',dest.inside);
    dest.ownerId=buyer.id; buyer.wealth=0;
    addPlaceStock(world,'grain',30,source.id,seller.id,undefined,'harvest');
    const order={resource:'grain' as const,quantity:20,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:buyer.id,priority:1,reason:'grain for brewing'};
    expect(affordableHaulQuantity(world,order)).toBe(0);
    buyer.wealth=20;
    expect(affordableHaulQuantity(world,order)).toBeGreaterThan(0);
    expect(affordableHaulQuantity(world,order)).toBeLessThan(20);
  });

  it('can buy at a small counter within arrival reach, but cannot name a distant shop to buy remotely',()=>{
    const tw=createTestWorld(), {world}=tw;
    const stall=makePlace(world,'stall','counter',{x0:2,z0:2,x1:3,z1:3,y0:1,y1:4},{inside:v(2.5,1,2.5)});
    const seller=addPerson(tw,'Baker','baker',stall.inside), buyer=addPerson(tw,'Buyer','farmer',v(4,1,2.5));
    buyer.wealth=20; addPlaceStock(world,'bread',5,stall.id,seller.id,undefined,'baked');
    expect(buyFoodHere(world,buyer,1,stall.id).food?.quantity).toBe(1);
    world.primaryBody(buyer.id)!.pos=v(20,1,20);
    expect(buyFoodHere(world,buyer,1,stall.id).reason).toBe('unavailable');
  });

  it('replaces promised outgoing stock through ordinary production demand',()=>{
    const tw=createTestWorld(), {world}=tw;
    const bakery=makePlace(world,'bakery','Bakery',{x0:2,z0:2,x1:8,z1:8,y0:1,y1:4},{inside:v(4,1,4)});
    const baker=addPerson(tw,'Baker','baker',bakery.inside,{workId:bakery.id}); bakery.workers.push(baker.id);
    addPlaceStock(world,'bread',40,bakery.id,baker.id,undefined,'baked');
    generateProductionNeeds(world); expect(world.requests.filter(r=>r.payload.resource==='bread')).toHaveLength(0);
    createHaulTask(world,{resource:'bread',quantity:30,sourcePlaceId:bakery.id,destPlaceId:tw.places.tavern,requesterId:baker.id,priority:1,reason:'household demand'});
    generateProductionNeeds(world);
    expect(world.requests.some(r=>r.type==='production'&&r.payload.resource==='bread')).toBe(true);
    expect(stockAt(world,'bread',bakery.id)).toBe(40);
  });

  it('fills a carrier across several batches from one producer without taking another producers stock',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.square)!, dest=world.place(tw.places.tavern)!;
    const seller=addPerson(tw,'Farmer','farmer',source.inside), other=addPerson(tw,'Other','farmer',source.inside);
    const buyer=addPerson(tw,'Buyer','innkeeper',dest.inside), hauler=addPerson(tw,'Carrier','farmer',source.inside);
    buyer.wealth=100; dest.ownerId=buyer.id;
    for(let i=0;i<3;i++) addPlaceStock(world,'grain',5,source.id,seller.id,undefined,'harvest');
    const separate=addPlaceStock(world,'grain',5,source.id,other.id,undefined,'harvest');
    const task=createHaulTask(world,{resource:'grain',quantity:15,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:buyer.id,priority:1,reason:'brewing'});
    claimHaulTask(world,task,hauler); expect(loadHaulCargo(world,task,hauler)).toBe(true);
    expect(task.carried).toBe(15); expect(separate.quantity).toBe(5);
  });
  it('reserves a shipment once across batches instead of withholding every batch of bread',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.tavern)!, dest=world.place(tw.places.chapel)!;
    const seller=addPerson(tw,'Baker','baker',source.inside);
    const a=addPlaceStock(world,'bread',5,source.id,seller.id,undefined,'baked');
    const b=addPlaceStock(world,'bread',5,source.id,seller.id,undefined,'baked');
    const task=createHaulTask(world,{resource:'bread',quantity:6,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:seller.id,priority:1,reason:'delivery'});
    expect(committedUnits(world,a)+committedUnits(world,b)).toBe(0);
    claimHaulTask(world,task,seller);
    expect(committedUnits(world,a)+committedUnits(world,b)).toBe(6);
    expect(willingnessFor(world,seller,a).available+willingnessFor(world,seller,b).available).toBe(4);
  });
  it('compares local offers and records unaffordability without claiming the shop is empty',()=>{
    const tw=createTestWorld(), {world}=tw, tavern=world.place(tw.places.tavern)!;
    const seller=addPerson(tw,'Seller','innkeeper',tavern.inside,{workId:tavern.id});
    const buyer=addPerson(tw,'Buyer','farmer',tavern.inside); buyer.wealth=3; seller.traits.greed=0.5;
    addPlaceStock(world,'meat',2,tavern.id,seller.id,undefined,'seeded');
    addPlaceStock(world,'ale',2,tavern.id,seller.id,undefined,'seeded');
    const before=cash(world), result=buyFoodHere(world,buyer,3);
    expect(result.food?.type).toBe('ale'); expect(result.food?.quantity).toBe(1); expect(cash(world)).toBe(before);
    expect(buyFoodHere(world,buyer,1)).toMatchObject({food:null,reason:'unaffordable',price:3});
    const ev=world.emit('resource_shortage',{actor:buyer.id,placeId:tavern.id,data:{need:'food',reason:'unaffordable'}});
    learnPlace(world,buyer,tavern,{type:'self'}); const confidence=buyer.knowledge[`svc:${tavern.id}`].confidence;
    noteFoodShortage(world,buyer,tavern.id,'unaffordable',3,ev.id);
    expect(buyer.knowledge[`svc:${tavern.id}`].confidence).toBe(confidence);
    expect(buyer.knowledge[`food-access:${tavern.id}`].source.viaEvent).toBe(ev.id);
    world.primaryBody(buyer.id)!.pos=v(2,1,2); expect(buyFoodHere(world,buyer,1).reason).toBe('unavailable');
  });

  it('does not report self-payments or promised rewards as actual wages',()=>{
    const tw=createTestWorld(), worker=addPerson(tw,'Worker','baker',v(5,1,5));
    const payer=addPerson(tw,'Owner','baker',v(5,1,5)); payer.wealth=1;
    expect(payWage(tw.world,worker.id,worker,3)).toBe(0);
    const req=createRequest(tw.world,{type:'production',requesterId:payer.id,reward:3,cause:'bread needed',payload:{}});
    acceptRequest(tw.world,req,worker); expect(completeRequest(tw.world,req)).toBe(1);
    expect(completeRequest(tw.world,req)).toBe(0); expect(productionSummary(tw.world).wagesPaid).toBe(1);
  });

  it('pays each source owner before loading affordable goods and never pays again on delivery',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.square)!, dest=world.place(tw.places.tavern)!;
    const seller=addPerson(tw,'Hunter','hunter',source.inside), second=addPerson(tw,'Second','hunter',source.inside);
    const buyer=addPerson(tw,'Cook','cook',dest.inside), hauler=addPerson(tw,'Carrier','farmer',source.inside);
    dest.ownerId=buyer.id; buyer.wealth=5;
    const first=addPlaceStock(world,'meat',2,source.id,seller.id,undefined,'hunted');
    first.createdAt=world.now-3600; first.spoilAccum=0.8;
    const other=addPlaceStock(world,'meat',3,source.id,second.id,undefined,'hunted');
    const before=cash(world), sellerCash=seller.wealth, secondCash=second.wealth;
    const task=createHaulTask(world,{resource:'meat',quantity:4,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:buyer.id,priority:1,reason:'cook needs meat'});
    claimHaulTask(world,task,hauler); expect(loadHaulCargo(world,task,hauler)).toBe(true);
    expect(first.quantity).toBe(1); expect(other.quantity).toBe(3);
    const cargo=world.item(task.cargoItemId)!;
    expect(cargo.createdAt).toBe(first.createdAt); expect(cargo.spoilAccum).toBeCloseTo(0.4);
    expect(first.spoilAccum).toBeCloseTo(0.4);
    expect(seller.wealth-sellerCash).toBe(4); expect(second.wealth).toBe(secondCash);
    expect(depositHaulCargo(world,task,hauler)).toBe(true);
    const delivered=world.itemsAtPlaces([dest.id]).find(i=>i.type==='meat'&&i.quantity>0)!;
    expect(delivered.createdAt).toBe(first.createdAt); expect(delivered.spoilAccum).toBeCloseTo(0.4);
    expect(seller.wealth-sellerCash).toBe(4); expect(cash(world)).toBe(before);
    expect(loadHaulCargo(world,task,hauler)).toBe(false); expect(first.quantity).toBe(1); expect(other.quantity).toBe(3);
  });
});

describe('real brewing and finite local hunting',()=>{
  it('a hungry baker can fetch missing inputs and produce a meal after finding empty counters',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.chapel)!;
    const bakery=makePlace(world,'bakery','Bakery',{x0:18,z0:18,x1:26,z1:26,y0:1,y1:3},{inside:v(22,1,22)});
    const baker=addPerson(tw,'Baker','baker',bakery.inside,{workId:bakery.id});
    bakery.ownerId=baker.id; bakery.workers.push(baker.id); baker.skills.baking=0.6;
    baker.schedule=[]; baker.physiology.energy=0.15; baker.wealth=0;
    learnPlace(world,baker,bakery,{type:'prior'}); noteFoodShortage(world,baker,bakery.id);
    noteWorkBlocked(world,baker,bakery.id,'flour','bread');
    addPlaceStock(world,'flour',10,source.id,baker.id,undefined,'milled');
    createHaulTask(world,{resource:'flour',quantity:10,sourcePlaceId:source.id,destPlaceId:bakery.id,requesterId:baker.id,priority:1,reason:'flour for bread'});
    step(tw,120);
    expect(world.events.some(e=>e.type==='resource_delivered'&&e.actor===baker.id)).toBe(true);
    expect(world.events.some(e=>e.type==='resource_transformed'&&e.actor===baker.id)).toBe(true);
    expect(world.events.some(e=>e.type==='food_consumed'&&e.actor===baker.id)).toBe(true);
    expect(baker.physiology.energy).toBeGreaterThan(0.15);
    expect(baker.wealth).toBe(0); // self-employment nourishes through real output, not a fake wage
  });
  it('sleep in the shared physiological step restores fatigue and capacity for the next shift',()=>{
    const tw=createTestWorld(), {world}=tw, p=addPerson(tw,'Worker','baker',v(4,1,4));
    p.attributes.endurance = p.attributes.vitality = 8; // Explicit ordinary recovery reference.
    p.physiology.fatigue=0.95; p.physiology.sleepDebt=6; p.physiology.energy=0.6;
    const before=getPhysicalCapability(p,world).currentExertionCapacity;
    stepPhysiology(world,p,2,'sleep',{indoor:true,daylight:0});
    expect(p.physiology.fatigue).toBe(0);
    expect(p.physiology.sleepDebt).toBeCloseTo(3.8);
    expect(p.physiology.energy).toBeLessThan(0.6); // sleeping still consumes calories
    expect(getPhysicalCapability(p,world).currentExertionCapacity).toBeGreaterThan(before);
  });
  it('charges actual travel and labor rather than a planned heavy job',()=>{
    const {world,...tw}=createTestWorld();
    const p=addPerson({world,...tw},'Worker','farmer',v(4,1,4));
    const body=world.primaryBody(p.id)!;
    p.mind.goal={type:'haul',key:'haul:',utility:0.8,reasons:[],createdAt:world.now};
    p.mind.plan=[{type:'goto',status:'active',pos:v(8,1,8)}];
    body.pose='walk'; expect(activityLevelFor(p,body,world)).toBe('walk');
    body.pose='haul'; expect(activityLevelFor(p,body,world)).toBe('haul');
    body.pose='stand'; p.mind.plan=[]; expect(activityLevelFor(p,body,world)).toBe('idle');
    p.mind.plan=[{type:'gather',status:'active'}]; body.pose='work';
    expect(activityLevelFor(p,body,world)).toBe('quarry');
    registerGameGround(world,world.place(tw.places.square)!.id,8);
    p.mind.plan[0].data={nodeId:world.resourceNodes[0].id};
    expect(activityLevelFor(p,body,world)).toBe('walk');
  });
  it('requires local grain and heat, conserves money, and stops when inputs run out',()=>{
    const tw=createTestWorld(), {world}=tw, tavern=world.place(tw.places.tavern)!;
    const brewer=addPerson(tw,'Brewer','innkeeper',tavern.inside,{workId:tavern.id}); tavern.ownerId=brewer.id;
    const before=cash(world); expect(restockTavern(world,brewer)).toBe(false);
    addPlaceStock(world,'grain',BREW_RATIO.in,tavern.id,brewer.id,undefined,'seeded'); expect(restockTavern(world,brewer)).toBe(false);
    const fire=createFire(world,tavern.id,tavern.inside,false);
    addPlaceStock(world,'stick',2,tavern.id,brewer.id,undefined,'seeded'); expect(igniteFire(world,fire,brewer,'stick',2)).toBe(true);
    expect(restockTavern(world,brewer)).toBe(true);
    expect(stockAt(world,'grain',tavern.id)).toBe(0); expect(stockAt(world,'ale',tavern.id)).toBe(BREW_RATIO.out);
    expect(restockTavern(world,brewer)).toBe(false); expect(cash(world)).toBe(before); expect(world.runTally.supply_cost_amount??0).toBe(0);
  });

  it('depletes a hunting ground, leaves output there, and recovers gradually from canonical time',()=>{
    const tw=createTestWorld(), {world}=tw, ground=world.place(tw.places.square)!;
    const hunter=addPerson(tw,'Hunter','hunter',ground.inside); hunter.skills.hunting=0.6;
    registerGameGround(world,ground.id,6); const node=world.resourceNodes[0], before=cash(world);
    expect(extractFromNode(world,node,hunter)).toBe(3); expect(extractFromNode(world,node,hunter)).toBe(3);
    expect(extractFromNode(world,node,hunter)).toBe(0); expect(node.state).toBe('depleted'); expect(stockAt(world,'meat',ground.id)).toBe(6);
    world.clock.worldSeconds+=node.regrowHours*3600/2; maintainResourceNodes(world);
    expect(node.remaining).toBeCloseTo(3); maintainResourceNodes(world); expect(node.remaining).toBeCloseTo(3);
    world.primaryBody(hunter.id)!.pos=v(1,1,1); expect(extractFromNode(world,node,hunter)).toBe(0); expect(cash(world)).toBe(before);
  });

  it('a scheduled forest shift performs timed hunting instead of generic work',()=>{
    const tw=createTestWorld(), {world}=tw;
    const ground=makePlace(world,'wilderness','Hunting ground',{x0:20,z0:20,x1:26,z1:26,y0:1,y1:3},{inside:v(23,1,23)});
    const hunter=addPerson(tw,'Hunter','hunter',ground.inside,{workId:ground.id});
    hunter.skills.hunting=0.6; hunter.mind.thinkInterval=0.25; hunter.traits.sociability=0;
    hunter.schedule=[{start:0,end:24,activity:'work',placeId:ground.id,label:'hunt'}];
    registerGameGround(world,ground.id,8);
    step(tw,20); expect(stockAt(world,'meat',ground.id)).toBe(0); // less than 30 minutes of labor
    step(tw,20); expect(stockAt(world,'meat',ground.id)).toBeGreaterThan(0);
    expect(world.events.some(e=>e.type==='resource_extracted'&&e.actor===hunter.id)).toBe(true);
  });

  it('harvests finite ripe crops even when current grain and bread stocks are high',()=>{
    const tw=createTestWorld(), {world}=tw;
    const farm=makePlace(world,'farm','Farm',{x0:20,z0:20,x1:26,z1:26,y0:1,y1:3},{inside:v(22.5,1,22.5)});
    const farmer=addPerson(tw,'Farmer','farmer',farm.inside,{workId:farm.id});
    farmer.traits.sociability=0; farmer.traits.piety=0;
    farmer.schedule=[{start:0,end:24,activity:'work',placeId:farm.id,label:'field shift'}];
    const plot={x:22,y:1,z:22,crop:'wheat' as const,state:'mature' as const,growth:1,maturedAt:world.now,plantedAt:world.now-42*86400};
    world.fields.push({id:'test-field',placeId:farm.id,ownerId:farmer.id,soilMoisture:0.5,plots:[plot]});
    addPlaceStock(world,'grain',600,farm.id,farmer.id,undefined,'stored');
    addPlaceStock(world,'bread',200,farm.id,farmer.id,undefined,'stored');
    step(tw,35);
    expect(world.events.some(e=>e.type==='crop_harvested'&&e.actor===farmer.id)).toBe(true);
    expect(stockAt(world,'grain',farm.id)).toBeGreaterThan(600);
    expect(plot.state).toBe('harvested');
  });

  it('controlled movement renews a progressing haul, but standing idle releases it',()=>{
    const tw=createTestWorld(), {world}=tw;
    const source=makePlace(world,'store','Source',{x0:28,z0:20,x1:34,z1:26,y0:1,y1:3},{inside:v(31,1,23)});
    const person=addPerson(tw,'Player','farmer',v(10,1,23),{controlled:true});
    addPlaceStock(world,'log',2,source.id,person.id,undefined,'stored');
    const task=createHaulTask(world,{resource:'log',quantity:1,sourcePlaceId:source.id,destPlaceId:tw.places.square,requesterId:person.id,priority:0.8,reason:'stock'});
    claimHaulTask(world,task,person); world.clock.worldSeconds+=30*60;
    const body=world.primaryBody(person.id)!; moveByIntent(tw.sim,person,body,1,0,false,0.1);
    expect(body.pos.x).toBeGreaterThan(10);
    world.clock.worldSeconds+=30*60; maintainHauls(world); expect(task.claimantId).toBe(person.id);
    world.clock.worldSeconds+=45*60; maintainHauls(world); expect(task.status).toBe('needed');
  });

  it('an expired claimant cannot take or unload a replacement carriers shipment',()=>{
    const tw=createTestWorld(), {world}=tw, source=world.place(tw.places.square)!;
    const dest=makePlace(world,'store','Store',{x0:20,z0:20,x1:24,z1:24,y0:1,y1:3},{inside:v(22,1,22)});
    const buyer=addPerson(tw,'Buyer','merchant',dest.inside), old=addPerson(tw,'Old carrier','farmer',source.inside);
    const carrier=addPerson(tw,'Carrier','farmer',source.inside); dest.ownerId=buyer.id;
    addPlaceStock(world,'log',2,source.id,buyer.id,undefined,'stored');
    const task=createHaulTask(world,{resource:'log',quantity:1,sourcePlaceId:source.id,destPlaceId:dest.id,requesterId:buyer.id,priority:0.8,reason:'stock'});
    claimHaulTask(world,task,old); world.clock.worldSeconds+=3600; maintainHauls(world);
    expect(task.status).toBe('needed'); claimHaulTask(world,task,carrier);
    expect(world.requests.find(r=>r.id===task.requestId)?.acceptedBy).toBe(carrier.id);
    expect(loadHaulCargo(world,task,old)).toBe(false); expect(stockAt(world,'log',source.id)).toBe(2);
    expect(loadHaulCargo(world,task,carrier)).toBe(true);
    expect(depositHaulCargo(world,task,old)).toBe(false); expect(task.status).toBe('in_transit');
    world.primaryBody(carrier.id)!.pos={...dest.inside};
    expect(depositHaulCargo(world,task,carrier)).toBe(true); expect(stockAt(world,'log',dest.id)).toBe(1);
  });

  it('persists household funds and hunting pressure',()=>{
    const {world}=newWorld(7302), p=world.livingPersons().find(p=>p.householdId)!;
    const h=world.households().find(h=>h.id===p.householdId)!; h.wealth=7;
    const node=world.resourceNodes.find(n=>n.kind==='game')!; node.remaining=2.5; node.renewedAt=world.now-120;
    const loaded=deserialize(serialize(world))!.world;
    expect(loaded.households().find(q=>q.id===h.id)?.wealth).toBe(7);
    expect(loaded.resourceNodes.find(q=>q.id===node.id)).toMatchObject({remaining:2.5,renewedAt:node.renewedAt});
  });
});
