import { hudReducer, initialHudState, progressFraction, stubObjectives, type ObjectiveAPI, type HudAction } from './sliceHudState';
import './sliceHud.css';
/** Owns only transient DOM; never awards XP or completes an objective. */
export class SliceHud {
 private state = initialHudState();
 private root = document.createElement('section');
 private progress = document.createElement('div');
 private tracker = document.createElement('div');
 private journal = document.createElement('section');
 private map = document.createElement('canvas');
 private compass = document.createElement('div');
 private banner = document.createElement('div');
 private timer = 0;
 private unsubscribe: () => void;
 constructor(parent: HTMLElement, api: ObjectiveAPI = stubObjectives) {
  this.root.className='tv-slice'; this.progress.className='tv-progress';this.tracker.className='tv-objectives';this.journal.className='tv-objective-journal';this.compass.className='tv-compass';this.banner.className='tv-banner';this.banner.setAttribute('aria-live','polite');
  this.journal.hidden=true;this.map.width=144;this.map.height=144;this.map.className='tv-minimap';this.map.setAttribute('aria-label','Nearby orientation map with Tower marker');
  this.root.append(this.map,this.progress,this.tracker,this.journal,this.compass,this.banner);parent.append(this.root);
  this.dispatch({type:'objectives',objectives:api.getActiveObjectives()});this.unsubscribe=api.subscribe(e=>this.dispatch(e));
 }
 dispatch(a: HudAction) { const previous=this.state;this.state=hudReducer(previous,a);if(previous!==this.state)this.draw(); }
 get journalOpen(){return this.state.journal;}
 private draw(){
  this.progress.replaceChildren();const label=document.createElement('span');label.textContent=`${this.state.rank} · ${this.state.xp===null?'Source progression':`${this.state.xp} / ${this.state.nextXp??'—'} XP`}`;const bar=document.createElement('progress');bar.max=1;bar.value=progressFraction(this.state);bar.setAttribute('aria-label','Rank experience');this.progress.append(label,bar);
  this.tracker.replaceChildren();this.journal.replaceChildren();const heading=document.createElement('h2');heading.textContent='Objectives · J';this.journal.append(heading);
  if(!this.state.objectives.length){const p=document.createElement('p');p.textContent='No known objectives. Explore and speak with nearby residents.';this.journal.append(p);}
  for(const o of this.state.objectives){const p=document.createElement('p');p.textContent=`${o.complete?'✓ ':''}${o.title} · ${Math.max(0,o.current)} / ${Math.max(1,o.target)}`;if(!o.complete&&this.tracker.childElementCount<3)this.tracker.append(p.cloneNode(true));const d=document.createElement('p');d.textContent=o.description;this.journal.append(p,d);}
  this.journal.hidden=!this.state.journal;
 }
 announce(text:string){this.banner.textContent=text;clearTimeout(this.timer);this.timer=window.setTimeout(()=>this.banner.textContent='',4200);}
 damage(value:number){if(!Number.isFinite(value)||value<=0)return;const n=document.createElement('b');n.className='tv-damage';n.textContent=`−${Math.round(value)}`;this.root.append(n);window.setTimeout(()=>n.remove(),1100);}
 bearing(pos:{x:number;z:number},yaw:number,tower?:{x:number;z:number}){
  // Camera rig yaw points from the target toward the eye; heading faces away from the eye.
  yaw+=Math.PI;
  const c=this.map.getContext('2d');if(c){c.clearRect(0,0,144,144);c.fillStyle='#111b24d9';c.fillRect(0,0,144,144);c.strokeStyle='#bd9c6055';for(const r of [24,48,68]){c.beginPath();c.arc(72,72,r,0,Math.PI*2);c.stroke();}c.fillStyle='#eee4ce';c.fillText('N',68,14);c.save();c.translate(72,72);c.rotate(yaw);c.beginPath();c.moveTo(0,-7);c.lineTo(-4,5);c.lineTo(4,5);c.closePath();c.fill();c.restore();if(tower){const dx=(tower.x-pos.x)*.5,dz=(tower.z-pos.z)*.5,scale=Math.min(1,56/(Math.hypot(dx,dz)||1));c.fillStyle='#edce89';c.fillText('◆',68+dx*scale,76-dz*scale);}}
 const degrees=((yaw*180/Math.PI)%360+360)%360;this.compass.textContent=`N · E · S · W   ${Math.round(degrees)}°${tower?`   ◆ Tower ${Math.round(Math.hypot(tower.x-pos.x,tower.z-pos.z))}m · ${Math.round((Math.atan2(tower.x-pos.x,tower.z-pos.z)*180/Math.PI+360)%360)}°`:''}`;}
 dispose(){this.unsubscribe();clearTimeout(this.timer);this.root.remove();}
}
