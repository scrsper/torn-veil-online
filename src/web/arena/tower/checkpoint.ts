import type {CapabilitySheet,EmergedClass} from './capability';
import { validJourney } from '../../../sim/progression/tower';
import type {Gear,Item} from './items';
import {newStats,type RunStats} from './achievements';
import type {SkillDef} from './skills';
import type {WeaponId} from '../combat';
import type {ArenaWorld} from '../world';
export const CHECKPOINT_KEY='tv.tower.expedition.v1';
export interface TowerCheckpoint {
 version:1; kind:'floor-start'; runId:string; climberId:string; savedAt:string; seed:number; floor:number; randomState:number;
 sheet:CapabilitySheet; gear:Partial<Record<WeaponId,Extract<Gear,{kind:'weapon'}>>>; armor:Extract<Gear,{kind:'armor'}>|null; charm:Extract<Gear,{kind:'charm'}>|null;
 known:SkillDef[]; slots:(string|null)[]; pending:string[]; classSkill:string|null; cls:EmergedClass|null; essences:string[]; confluence:string; scrolls:SkillDef[];
 stats:RunStats; earned:string[]; boxes:number[]; belt:Extract<Item,{kind:'elixir'}>[]; extraSlots:number; tierIdx:number; flaskBase:number;
 world:{level:number;xp:number;nextXp:number;mods:ArenaWorld['mods'];bonus:ArenaWorld['bonus'];weapon:WeaponId;hp:number;energy:number;mana:number;flasks:number;cooldowns:number[];weaponImbue:ArenaWorld['weaponImbue'];imbue:ArenaWorld['imbue'];potion:ArenaWorld['potion'];wardHp:number;wardT:number;time:number};
}
export type CheckpointRead={status:'empty'}|{status:'ready';checkpoint:TowerCheckpoint}|{status:'corrupt'|'incompatible'|'unavailable';message:string};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const number=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12;
const text=(x:unknown)=>typeof x==='string'&&x.length<=500;
const array=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max;
const numbers=(x:unknown)=>object(x)&&Object.values(x).every(number);
const weapons=['fists','greatsword','axe','bow'];
/** Reject malformed data before any live run is changed. Serialized data never owns scene objects. */
export function validCheckpoint(x:unknown):x is TowerCheckpoint {
 if(!object(x)||x.version!==1||x.kind!=='floor-start'||!text(x.runId)||!text(x.climberId)||!text(x.savedAt)||!Number.isInteger(x.seed)||!number(x.seed)||!Number.isInteger(x.floor)||Number(x.floor)<1||Number(x.floor)>100||!Number.isInteger(x.randomState)||!number(x.randomState))return false;
 const s=x.sheet,w=x.world;
 if(object(s)&&s.journey!==undefined&&!validJourney(s.journey))return false;
 if(!object(s)||!numbers(s.style)||!['fists','blade','heavy','axe','bow'].every(k=>number((s.style as Record<string,unknown>)[k]))||!numbers(s.affinity)||!['flame','frost','storm','swift','iron','shadow','verdance','water','gravity','time'].every(k=>number((s.affinity as Record<string,unknown>)[k]))||!numbers(s.history)||!['kills','bosses','floors','tomes','boons','nearDeaths','noWeaponFloors'].every(k=>number((s.history as Record<string,unknown>)[k]))||!array(s.forms,8)||!(s.forms as unknown[]).every(f=>['bolt','nova','wave','field','lance','weave','ward','step'].includes(String(f)))||![s.vitality,s.might,s.agility,s.manaControl].every(number))return false;
 if(!object(w)||![w.level,w.xp,w.nextXp,w.hp,w.energy,w.mana,w.flasks,w.wardHp,w.wardT,w.time].every(number)||!numbers(w.mods)||!['damage','atkSpeed','move','regen','range'].every(k=>number((w.mods as Record<string,unknown>)[k]))||!numbers(w.bonus)||!['damage','atkSpeed','move','maxHpUpgrades'].every(k=>number((w.bonus as Record<string,unknown>)[k]))||!weapons.includes(String(w.weapon))||!array(w.cooldowns,7)||!(w.cooldowns as unknown[]).every(number)||!object(w.weaponImbue)||!object(w.potion)||!['haste','might','stone','clarity'].every(k=>number((w.potion as Record<string,unknown>)[k])))return false;
 if(w.imbue!==null&&(!object(w.imbue)||!text(w.imbue.e)||!number(w.imbue.t)||!number(w.imbue.p)))return false;
 if(!object(x.gear)||!Object.entries(x.gear).every(([k,g])=>weapons.includes(k)&&validGear(g,'weapon'))||!(x.armor===null||validGear(x.armor,'armor'))||!(x.charm===null||validGear(x.charm,'charm')))return false;
 if(!array(x.known,200)||!(x.known as unknown[]).every(validSkill)||!array(x.scrolls,5)||!(x.scrolls as unknown[]).every(validSkill)||!array(x.slots,7)||!array(x.pending,200))return false;
 const ids=(x.known as SkillDef[]).map(k=>k.id);if(new Set(ids).size!==ids.length||!(x.slots as unknown[]).every(id=>id===null||ids.includes(String(id)))||!(x.pending as unknown[]).every(id=>ids.includes(String(id)))||!(x.classSkill===null||ids.includes(String(x.classSkill))))return false;
 if(x.cls!==null&&(!object(x.cls)||!text(x.cls.id)||!text(x.cls.name)||!text(x.cls.pattern)||!object(x.cls.boon)||!number(x.cls.boon.amount)))return false;
 return numbers(x.stats)&&Object.keys(newStats()).every(k=>number((x.stats as Record<string,unknown>)[k]))&&array(x.earned,100)&&(x.earned as unknown[]).every(text)&&array(x.boxes,100)&&(x.boxes as unknown[]).every(n=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=5)&&array(x.essences,12)&&(x.essences as unknown[]).every(text)&&text(x.confluence)&&array(x.belt,50)&&(x.belt as unknown[]).every(b=>object(b)&&b.kind==='elixir'&&text(b.id)&&text(b.name)&&['mana','haste','might','stone','clarity','elemental'].includes(String(b.potion)))&&[x.extraSlots,x.tierIdx,x.flaskBase].every(number);
}
function validGear(x:unknown,kind:string){return object(x)&&x.kind===kind&&text(x.id)&&text(x.name)&&text(x.base)&&[x.item,x.rarity,x.score].every(number)&&array(x.affixes,20)&&(x.affixes as unknown[]).every(a=>object(a)&&text(a.stat)&&number(a.value))&&(kind!=='weapon'||weapons.includes(String(x.slot))&&text(x.mesh)&&['r','l'].includes(String(x.hand)))&&(kind!=='armor'||number(x.reduction));}
function validSkill(x:unknown){return object(x)&&['id','name','icon','color','text','kernel','source'].every(k=>text(x[k]))&&['cost','cooldown','power','rank','uses'].every(k=>number(x[k]))&&array(x.riders,20)&&(x.riders as unknown[]).every(text);}
export function readCheckpoint(storage?:Pick<Storage,'getItem'>):CheckpointRead {
 try {const raw=(storage??localStorage).getItem(CHECKPOINT_KEY);if(!raw)return {status:'empty'};if(raw.length>500000)throw Error('Checkpoint exceeds supported size');const x:unknown=JSON.parse(raw);if(object(x)&&x.version!==1)return {status:'incompatible',message:'This expedition was saved with a different version. Download it before starting a new climb.'};if(!validCheckpoint(x))throw Error('Invalid checkpoint');return {status:'ready',checkpoint:x};}
 catch(e){return {status:e instanceof SyntaxError||String(e).includes('checkpoint')||String(e).includes('Checkpoint')?'corrupt':'unavailable',message:'This expedition could not be loaded. Its data is retained; download it for recovery or explicitly start a new climb.'};}
}
export function writeCheckpoint(x:TowerCheckpoint,storage?:Pick<Storage,'setItem'>):boolean {try {if(!validCheckpoint(x))return false;const raw=JSON.stringify(x);if(raw.length>500000)return false;(storage??localStorage).setItem(CHECKPOINT_KEY,raw);return true;}catch{return false;}}
export function endCheckpoint(runId:string,storage?:Pick<Storage,'getItem'|'removeItem'>):void {try {const store=storage??localStorage,x=JSON.parse(store.getItem(CHECKPOINT_KEY)??'null');if(x?.runId===runId)store.removeItem(CHECKPOINT_KEY);}catch{/* Preserve unknown or legacy data. */}}
export function downloadCheckpoint():void {try{const raw=localStorage.getItem(CHECKPOINT_KEY);if(!raw)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='tower-expedition-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch{/* Storage is unavailable; the notice remains visible. */}}
