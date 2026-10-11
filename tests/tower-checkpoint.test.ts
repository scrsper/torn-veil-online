import {describe,it,expect,vi,afterEach} from 'vitest';
import {CHECKPOINT_KEY,readCheckpoint,writeCheckpoint,endCheckpoint,type TowerCheckpoint} from '../src/web/arena/tower/checkpoint';
import {newSheet,recordClass,loadCodex} from '../src/web/arena/tower/capability';
import {newStats,recordEarned,loadEarned} from '../src/web/arena/tower/achievements';
import {ESSENCES,cloneSkill} from '../src/web/arena/tower/skills';
import {mulberry} from '../src/web/render/noise';
const storage=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>{data.delete(key);},data};};
const checkpoint=():TowerCheckpoint=>({version:1,kind:'floor-start',runId:'run-a',climberId:'climber-a',savedAt:'2026-10-05T00:00:00Z',seed:29,floor:11,randomState:123,sheet:newSheet(),gear:{greatsword:{kind:'weapon',id:'rolled-weapon-a',name:'Worn Oathbreaker',base:'Oathbreaker',item:1,rarity:0,affixes:[],score:1,slot:'greatsword',style:'heavy',mesh:'W_oathbreaker',hand:'r'}},armor:null,charm:null,known:[cloneSkill(ESSENCES.fire.skill)],slots:['ess-fire',null],pending:[],classSkill:null,cls:null,essences:['fire'],confluence:'',scrolls:[],stats:newStats(),earned:['first-blood'],boxes:[],belt:[{kind:'elixir',id:'elixir-a',name:'Mana Draught',potion:'mana'}],extraSlots:1,tierIdx:0,flaskBase:3,world:{level:2,xp:20,nextXp:140,mods:{damage:1,atkSpeed:1,move:1,regen:1,range:1},bonus:{damage:1,atkSpeed:1,move:1,maxHpUpgrades:1},weapon:'greatsword',hp:750,energy:85,mana:55,flasks:3,cooldowns:[0,2],weaponImbue:{greatsword:'flame'},imbue:null,potion:{haste:0,might:0,stone:0,clarity:0},wardHp:0,wardT:0,time:400}});
afterEach(()=>vi.unstubAllGlobals());
describe('Tower floor-boundary checkpoints',()=>{
 it('never replaces a readable checkpoint with a payload larger than the reader accepts',()=>{
  const s=storage(),x=checkpoint();expect(writeCheckpoint(x,s)).toBe(true);const before=s.getItem(CHECKPOINT_KEY);
  x.known=Array.from({length:200},(_,i)=>({...cloneSkill(ESSENCES.fire.skill),id:`large-${i}`,riders:Array(20).fill('x'.repeat(500))}));x.slots=[x.known[0].id,null];
  expect(writeCheckpoint(x,s)).toBe(false);expect(s.getItem(CHECKPOINT_KEY)).toBe(before);expect(readCheckpoint(s).status).toBe('ready');
 });
 it('preserves identities, rolled gear, gift, learned skill references and consumables in a detached snapshot',()=>{
  const s=storage(),x=checkpoint();x.sheet.affinity.time=1;x.sheet.forms=['bolt'];expect(writeCheckpoint(x,s)).toBe(true);x.world.hp=1;x.gear.greatsword!.name='changed';
  const read=readCheckpoint(s);expect(read.status).toBe('ready');if(read.status!=='ready')throw Error('missing');
  expect(read.checkpoint).toMatchObject({runId:'run-a',climberId:'climber-a',floor:11,world:{hp:750,mana:55},gear:{greatsword:{id:'rolled-weapon-a',name:'Worn Oathbreaker'}},sheet:{affinity:{time:1}}});
  expect(read.checkpoint.slots[0]).toBe(read.checkpoint.known[0].id);expect(read.checkpoint.belt).toHaveLength(1);
 });
 it('rejects corrupt, incompatible and dangling skill data without altering saved or legacy data',()=>{
  const s=storage();s.setItem('legacy-world-save','keep');s.setItem(CHECKPOINT_KEY,'{broken');expect(readCheckpoint(s).status).toBe('corrupt');expect(s.getItem(CHECKPOINT_KEY)).toBe('{broken');
  s.setItem(CHECKPOINT_KEY,JSON.stringify({...checkpoint(),version:7}));expect(readCheckpoint(s).status).toBe('incompatible');
  const x=checkpoint();x.slots=['missing'];expect(writeCheckpoint(x,s)).toBe(false);expect(s.getItem('legacy-world-save')).toBe('keep');
 });
 it('ends only the matching expedition and retains lifetime and legacy records',()=>{
  const s=storage();s.setItem('tv.tower.codex.v1','old');writeCheckpoint(checkpoint(),s);endCheckpoint('different-run',s);expect(readCheckpoint(s).status).toBe('ready');endCheckpoint('run-a',s);expect(readCheckpoint(s).status).toBe('empty');expect(s.getItem('tv.tower.codex.v1')).toBe('old');
 });
 it('replays the same subsequent loot stream from the saved generator state',()=>{
  const a=mulberry(29);a();a();const state=a.state(),expected=[a(),a(),a()];const b=mulberry(0);b.restore(state);expect([b(),b(),b()]).toEqual(expected);
 });
 it('records an achievement or class receipt once across floor retries while preserving legacy records',()=>{
  const s=storage();vi.stubGlobal('localStorage',s);s.setItem('tv.tower.achievements.v1',JSON.stringify({'first-blood':2}));recordEarned('first-blood','run-a:first-blood');recordEarned('first-blood','run-a:first-blood');expect(loadEarned()['first-blood']).toBe(3);expect(JSON.parse(s.getItem('tv.tower.achievements.v1')!)['first-blood']).toBe(2);
  const cls={id:'fists+ascetic',name:'Ascetic',pattern:'fists',boon:{stat:'damage' as const,amount:.1},tier:'Normal' as const};recordClass(cls,1,29,'run-a:1:class');recordClass(cls,1,29,'run-a:1:class');expect(loadCodex()[0].times).toBe(1);
 });
});
