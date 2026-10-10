import type {Body, Item, Person} from '../core/types';
import type {World} from '../core/world';
import {itemDesign} from '../content/itemCollection';
export type EquipmentSlot = 'right-hand'|'left-hand'|'head'|'torso'|'left-shoulder'|'left-forearm'|'left-shin';
/** Physical placement only. Catalog abilities and armor protection remain descriptive. */
export function equipmentSlot(item:Pick<Item,'type'|'catalogId'>):EquipmentSlot|undefined {
 const d=item.catalogId?itemDesign(item.catalogId):undefined;
 if(d?.category==='Armor'){
  const t=d.type.toLowerCase();
  if(t.includes('shield'))return 'left-hand';
  if(t.includes('helmet'))return 'head';
  if(t.includes('pauldron'))return 'left-shoulder';
  if(t.includes('bracer'))return 'left-forearm';
  if(t.includes('greave'))return 'left-shin';
  if(t.includes('cuirass'))return 'torso';
 }
 if(['sword','dagger','axe','hammer','stick','stoneaxe','lantern','book'].includes(item.type))return 'right-hand';
 return undefined;
}
/** One binding lives on the physical item; inventory and body views are derived. */
export function equippedItems(w:World,p:Person,b:Body):Item[]{
 return p.inventory.flatMap(id=>{const i=w.item(id);return i&&i.holderId===p.id&&i.quantity>0&&!i.containerId&&i.equipped?.bodyId===b.id&&b.ownerId===p.id&&i.equipped.slot===equipmentSlot(i)?[i]:[];});
}
export function changeEquipment(w:World,p:Person,itemId:string,equip:boolean,bodyId=w.primaryBody(p.id)?.id):string {
 const b=bodyId?w.body(bodyId):undefined,i=w.item(itemId);
 if(!p.alive||!b||b.ownerId!==p.id||b.dead||!b.present||b.subduedUntil>w.physicalTime||['sleep','downed'].includes(b.pose)||p.custody?.active||p.surrender)return 'incapacitated';
 if(!i||i.holderId!==p.id||!p.inventory.includes(i.id)||i.quantity<=0||i.containerId)return 'not_carried';
 const slot=equipmentSlot(i);if(!slot)return 'not_equippable';
 if(i.equipped&&i.equipped.bodyId!==b.id)return 'equipped_elsewhere';
 if(equip&&(i.quantity!==1||i.condition===0))return 'unusable_item';
 if(!equip&&i.equipped?.bodyId!==b.id)return 'not_equipped';
 if(equip&&equippedItems(w,p,b).some(x=>x.id!==i.id&&x.equipped?.slot===slot))return 'slot_occupied';
 if(equip&&i.equipped?.bodyId===b.id)return 'accepted';
 b.equipmentMode='explicit';
 if(equip)i.equipped={bodyId:b.id,slot};else delete i.equipped;
 const event=w.emit(equip?'item_equipped':'item_unequipped',{actor:p.id,item:i.id,pos:{...b.pos},visibility:8,significance:.08,data:{bodyId:b.id,slot},summary:`${p.name} ${equip?'equipped':'unequipped'} ${i.name}`});
 i.provenance.push({tick:w.now,eventId:event.id,from:p.id,to:p.id,how:equip?'equipped':'unequipped'});
 return 'accepted';
}
export function equipmentProjection(w:World,b:Body){const p=w.person(b.ownerId);return p?equippedItems(w,p,b).map(i=>({id:i.id,catalogId:i.catalogId,type:i.type,slot:i.equipped!.slot})):[];}
