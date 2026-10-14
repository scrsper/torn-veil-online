import { projectAppearanceDescription } from '../../core/appearance';
import {humanoidVisualState,projectAppearance} from '../../../bridge/visualState';
import {combatState} from '../../../bridge/combatState';
import {guardHeld} from '../../physical/guard';
import {equipmentProjection} from '../../physical/equipment';
import {arcaneProgress} from '../../physical/arcana/growth';
import {handInteractions} from '../../physical/hand';
import {recogniseClass} from '../../mind/vocation';
import type {Body} from '../../core/types';
import { World } from '../../core/world';
import { Simulation } from '../../mind/agent';
import type { MovementInput } from '../../physical/prediction';
import { applyInteractionMovement, movementState } from '../../physical/interactionMovement';
import { captureCombatTransforms, combatBusy } from '../../physical/combatAction';
import { travelPath } from '../../physical/travel';
import { serialize, deserialize } from '../../persist/save';
import { generateRealms } from './generate';
import { RealmGrid } from './grid';
import { REALMS, REALM_CHUNK, CENTER, portalPoint, realmAt, realmResidency, type Point, type RealmId } from './layout';
import {FOCUSED_CATALOG} from '../assets/focusedRuntime';
import {placedPoint} from '../assets/focused';
import {FOCUSED_GENERATOR} from '../assets/focusedLayouts';
import {FoldedRealmGrid} from '../interiors/grid';
import {validCanonicalTower} from '../interiors/towerPersistence';

export interface FocusedTowerMigration {
  policy:'preserve-canonical-floors-v1'; runId:string; revision:number;
}

export class RealmSession {
  readonly world: World;
  readonly sim: Simulation;
  private input: MovementInput = { x: 0, z: 0, sprint: false };
  private inputUntil = 0;
  private pending: { id: number; from: RealmId; to: RealmId; expires: number } | null = null;
  private transitionId = 0;
  private lastRegion = '';
  private classAt=-Infinity;
  private recognised:ReturnType<typeof recogniseClass>=null;
  constructor(seed = 918271, saved?: string) {
    if (saved) {
      const restored = deserialize(saved);
      if (!restored?.world.realmSpec) throw new Error('Realm save is invalid or incompatible; original retained.');
      this.world = restored.world;
    } else { this.world = new World(seed); generateRealms(this.world); }
    this.sim = new Simulation(this.world);
  }
  get body() { return this.world.primaryBody(this.world.playerId!)!; }
  get person() { return this.world.person(this.world.playerId!)!; }
  get grid() { return this.world.grid as RealmGrid; }
  adoptFocusedWorld(migration?:FocusedTowerMigration):void{
    const w=this.world;if(w.realmSpec?.focusedKit)return;
    if(w.realmExpedition)throw Error('Checkpoint-only legacy expedition needs a separate migration; the original save is retained');
    const run=w.canonicalTower;
    if(run&&(!migration||migration.policy!=='preserve-canonical-floors-v1'||migration.runId!==run.id||migration.revision!==run.revision))throw Error('Existing Tower progress requires coordinated geometry migration; the original save is retained');
    if(run&&(!w.interiors||!validCanonicalTower(w,run,31)))throw Error('Retained canonical Tower integrity failed; the original save is retained');
    const spec={...w.realmSpec!,focusedKit:1 as const,focusedGeometrySha:FOCUSED_CATALOG.geometrySha256,focusedGenerator:FOCUSED_GENERATOR},next=w.interiors?new FoldedRealmGrid(spec,w.interiors):new RealmGrid(spec),town=next.focusedTown!,geometry=next.focusedGeometry!,start=town.spawn;
    const floor=geometry.supportAt(start.x,start.z,start.y);if(floor===null||!geometry.fits(start.x,floor,start.z,.3,1.75))throw Error('Approved town arrival failed actual controller clearance');
    const residentMoves=w.persons().filter(p=>p.id!==this.person.id).flatMap(p=>{const body=w.primaryBody(p.id);return body&&realmAt(body.pos.x,body.pos.z)==='brass'?[body]:[];}).map((body,i)=>{
      const placement=town.placements.find(p=>p.assetId===(i%2?'tv_32_01_general_store':'tv_31_01_tavern'))!,candidate=placedPoint(FOCUSED_CATALOG.sources[placement.assetId].spawn,placement),y=geometry.supportAt(candidate[0],candidate[2],1.0625);
      if(y===null||!geometry.fits(candidate[0],y,candidate[2],.3,1.75))throw Error('Town resident arrival failed actual clearance');return {body,pos:{x:candidate[0],y,z:candidate[2]}};
    });
    const old=w.grid;next.applyDiffs([...old.diffs]);next.restoreDoorStates([...old.doorStates]);next.recording=old.recording;
    // Existing folded descriptors, enemies, sources, receipts and active body stay
    // literal. Only the exterior return address changes; future floors use the kit.
    const returnPos=run?.realm==='brass'?{...town.tower.entry}:run?.returnPos;
    if(returnPos&&run?.realm==='brass'&&!geometry.fits(returnPos.x,returnPos.y,returnPos.z,.3,1.75))throw Error('Retained Tower return landing failed actual clearance');
    w.realmSpec=spec;w.grid=next;w.initNav();
    if(run&&returnPos)run.returnPos={...returnPos};
    if(!run?.active){this.stop();this.body.pos={...start,y:floor};this.body.vel={x:0,y:0,z:0};}
    for(const move of residentMoves){move.body.pos=move.pos;move.body.vel={x:0,y:0,z:0};move.body.path=null;move.body.pathGoal=null;}
  }
  move(input: MovementInput): void {
    if ((this.world.realmExpedition?.active || this.world.canonicalTower?.active)) return;
    if (!input || ![input.x, input.z].every(Number.isFinite) || Math.abs(input.x) > 1 || Math.abs(input.z) > 1 || typeof input.sprint !== 'boolean') return;
    if (input.facing !== undefined && (!Number.isFinite(input.facing) || Math.abs(input.facing) > Math.PI)) return;
    // Use the existing shared bounded turn evaluator; the camera never sets a body yaw.
    this.input = { x: input.x, z: input.z, sprint: input.sprint, ...(input.facing === undefined ? {} : { facing: input.facing }) }; this.inputUntil = this.world.physicalTime + .25;
    if (input.x || input.z) this.body.path = null;
  }
  stop(): void { this.input = { x: 0, z: 0, sprint: false }; this.pending = null; this.body.path = null; }
  navigate(target: 'portal' | 'tower'): boolean {
    if ((this.world.realmExpedition?.active || this.world.canonicalTower?.active) || this.pending || !movementState(this.world, this.person, this.body).eligible || combatBusy(this.body, this.world.physicalTime)) return false;
    const realm = realmAt(this.body.pos.x, this.body.pos.z)!;
    const destination = target === 'portal' ? { ...portalPoint(realm), z: portalPoint(realm).z - 2 } : realm==='brass'&&this.grid.focusedTown?this.grid.focusedTown.tower.entry:{ x: REALMS[realm].offset + CENTER + 48.5, y: 1, z: CENTER + 48.5 };
    const path = this.world.nav.findPath(this.body.pos, destination);
    if (!path) return false;
    this.body.path = path; this.body.pathIndex = 0; this.body.pathGoal = destination; return true;
  }
  step(dt: number): void {
    if ((this.world.realmExpedition?.active || this.world.canonicalTower?.active)) return;
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return;
    const w = this.world, before = captureCombatTransforms(w);
    this.advanceMovement(dt);
    w.physicalTime += dt;
    this.sim.stepScheduled(dt, w.clock.advance(dt), before);
  }
  /** Shared controller cadence: move on this World without advancing a second clock. */
  advanceMovement(dt: number, guidedOnly = false): void {
    if (this.world.realmExpedition?.active || this.world.canonicalTower?.active || !Number.isFinite(dt) || dt <= 0 || dt > .1) return;
    const w = this.world, b = this.body, old = { ...b.pos };
    const region = `${realmAt(b.pos.x, b.pos.z)}:${Math.floor(b.pos.x / REALM_CHUNK)},${Math.floor(b.pos.z / REALM_CHUNK)}`;
    if (region !== this.lastRegion) { w.nav.rebuildAll(); this.lastRegion = region; }
    const input = guidedOnly || this.pending || w.physicalTime > this.inputUntil ? { x: 0, z: 0, sprint: false } : this.input;
    b.vel = { x: 0, y: 0, z: 0 };
    applyInteractionMovement(w, this.person, b, input, dt);
    const physical = movementState(w, this.person, b);
    if (b.path && !this.pending && physical.eligible && !combatBusy(b, w.physicalTime)) travelPath(w, b, dt, physical.speed, .3, 1.8);
    b.vel = { x: (b.pos.x - old.x) / dt, y: 0, z: (b.pos.z - old.z) / dt };
    if (b.poseUntil <= w.physicalTime && physical.eligible) b.pose = Math.hypot(b.vel.x, b.vel.z) > .1 ? 'walk' : 'stand';
    if (this.pending && this.pending.expires < w.physicalTime) this.pending = null;
    // Canonical residents use ordinary cognition. Population is deliberately four;
    // no decorative skyline implies an unbounded population running this loop.
    w.grid.dirtyChunks.clear();
  }
  nearbyDoor() {
    const p = this.body.pos, realm = realmAt(p.x, p.z);
    if (!realm) return undefined;
    const cx = Math.floor((p.x - REALMS[realm].offset) / REALM_CHUNK), cz = Math.floor(p.z / REALM_CHUNK);
    const doors = [];
    for (let x = Math.max(0, cx - 1); x <= Math.min(63, cx + 1); x++) for (let z = Math.max(0, cz - 1); z <= Math.min(63, cz + 1); z++)
      for (const b of this.grid.chunk(realm, x, z).buildings) if (Math.hypot(p.x - b.door.x - .5, p.z - b.door.z - .5) < 4.5) doors.push(b);
    return doors.sort((a, b) => this.world.distance2d(p, a.door) - this.world.distance2d(p, b.door))[0];
  }
  interact(): string {
    if ((this.world.realmExpedition?.active || this.world.canonicalTower?.active)) return 'Resume the expedition or return to the atrium.';
    if (!movementState(this.world, this.person, this.body).eligible || combatBusy(this.body, this.world.physicalTime)) return 'This body cannot interact.';
    const w = this.world, p = this.body.pos, realm = realmAt(p.x, p.z) ?? w.canonicalTower?.realm ?? 'aether';
    if (this.pending) return 'Choose whether to cross the threshold.';
    if (w.distance2d(p, portalPoint(realm)) < 4.5) {
      this.pending = { id: ++this.transitionId, from: realm, to: realm === 'aether' ? 'brass' : 'aether', expires: w.physicalTime + 30 };
      return 'The Veil opens. Cross to the other realm?';
    }
    const b = this.nearbyDoor();
    if (b) {
      const open = !w.isDoorOpen(b.door);
      if (!open && Math.abs(p.z - b.door.z - .5) < 1.1) return 'Step clear of the doorway before closing it.';
      w.setDoorOpen(b.door, open, this.person.id);
      w.nav.rebuildArea(b.x - 1, b.z - 1, b.x + b.w + 1, b.z + 2);
      return `${b.name}: ${open ? 'open' : 'closed'}.`;
    }
    return this.inTower() ? 'Tower atrium. Choose Ascend Tower to begin or continue your expedition.' : 'Approach a door or the luminous threshold and press E.';
  }
  confirm(id: number): boolean {
    const t = this.pending;
    if ((this.world.realmExpedition?.active || this.world.canonicalTower?.active) || !t || t.id !== id || t.expires < this.world.physicalTime || this.world.distance2d(this.body.pos, portalPoint(t.from)) >= 4.5 || !movementState(this.world, this.person, this.body).eligible || combatBusy(this.body, this.world.physicalTime) || this.body.recoil) return false;
    const destination = portalPoint(t.to), from = { ...this.body.pos };
    // Destination is resolved and checked before changing the existing body. No new
    // Person, inventory, class or progression sheet is created by a crossing.
    const arrival = { ...destination, z: destination.z - 5 };
    const geometry=this.grid.movementGeometryAt(arrival.x,arrival.z);if(geometry){const y=geometry.supportAt(arrival.x,arrival.z,arrival.y);if(y===null||!geometry.fits(arrival.x,y,arrival.z,.3,1.8))return false;arrival.y=y;}
    if (!this.world.nav.isWalkable(Math.floor(arrival.x), Math.floor(arrival.z))) return false;
    this.body.pos = arrival; this.body.vel = { x: 0, y: 0, z: 0 }; this.body.path = null; this.body.pathGoal = null;
    this.world.emit('realm_crossed', { actor: this.person.id, pos: arrival, visibility: 14, loudness: 8, significance: .4,
      data: { portalId: `veil:threshold:${t.from}`, fromRealm: t.from, toRealm: t.to, from }, summary: `${this.person.name} crossed the Veil to ${REALMS[t.to].name}.` });
    this.pending = null; this.inputUntil = 0; this.world.nav.rebuildAll(); return true;
  }
  cancel(): void { this.pending = null; this.inputUntil = 0; }
  inTower(): boolean {
    const p = this.body.pos, realm = realmAt(p.x, p.z);
    if (!realm) return false;
    if(realm==='brass'&&this.grid.focusedTown){const b=this.grid.focusedTown.tower;return p.x>b.x+.6&&p.x<b.x+b.w-.6&&p.z>b.z+.6&&p.z<b.z+b.d-.6;}
    const b = this.grid.chunk(realm, 32, 32).buildings[0];
    return p.x > b.x && p.x < b.x + b.w - 1 && p.z > b.z && p.z < b.z + b.d - 1;
  }
  save(): string { return serialize(this.world); }
  /** Host-only continuation state for lossless journal checkpoint replay. */
  checkpointControl() { return structuredClone({input:this.input,inputUntil:this.inputUntil,pending:this.pending,transitionId:this.transitionId,lastRegion:this.lastRegion}); }
  restoreControl(s: ReturnType<RealmSession['checkpointControl']>) {
    this.input=structuredClone(s.input);this.inputUntil=s.inputUntil;this.pending=structuredClone(s.pending);
    this.transitionId=s.transitionId;this.lastRegion=s.lastRegion;
  }
  private visual(body:Body) {
    const person=this.world.person(body.ownerId)!;
    return {...humanoidVisualState(body,person.name,body.pose,projectAppearance(person)),presentationSex:person.gender,
      equipment:equipmentProjection(this.world,body),combatAction:combatState(this.world,body),guarding:guardHeld(this.world,body),speech:person.speech?.text??''};
  }
  snapshot() {
    const w = this.world, p = this.body.pos, realm = realmAt(p.x, p.z) ?? w.canonicalTower?.realm ?? 'aether';
    if(w.physicalTime-this.classAt>5){this.recognised=recogniseClass(w,this.person);this.classAt=w.physicalTime;}
    const door = this.nearbyDoor(), portal = w.distance2d(p, portalPoint(realm)) < 4.5;
    const visible=w.persons().filter(n=>n.id===this.person.id||w.primaryBody(n.id)?.present&&realmAt(w.primaryBody(n.id)!.pos.x,w.primaryBody(n.id)!.pos.z)===realm&&w.distance2d(p,w.primaryBody(n.id)!.pos)<80&&w.grid.lineOfSight({...p,y:p.y+1.6},{...w.primaryBody(n.id)!.pos,y:w.primaryBody(n.id)!.pos.y+1.6},80));
    return { focusedAssets:realm==='brass'?this.grid.focusedTown:null,realm, realmName: REALMS[realm].name, subtitle: REALMS[realm].subtitle, seed: w.seed, time: w.physicalTime, worldTime: w.now,
      person: { id: this.person.id, name: this.person.name, rank: this.person.ontology.stage, inventory: this.person.inventory.map(id => { const i = w.item(id)!; return { id, name: i.name, quantity: i.quantity }; }) },
      body: { id: this.body.id, pos: { ...p }, yaw: this.body.yaw, hp: this.body.health, maxHp: this.body.maxHealth },
      avatar:this.visual(this.body),
      growth:arcaneProgress(w,this.person,this.body),
      development:{recognisedClass:this.recognised,skills:{...this.person.skills},practice:this.person.capability?.bySkill??{}},
      interactions:handInteractions(this.sim,this.person),
      casts:visible.flatMap(n=>{const b=w.primaryBody(n.id),c=b?.arcana?.cast;return b&&c&&c.completeAt+.3>=w.physicalTime?[{...c,origin:{...b.pos}}]:[];}),
      expedition: w.realmExpedition ? { active: w.realmExpedition.active, status: w.realmExpedition.status, runId: w.realmExpedition.runId, revision: w.realmExpedition.revision } : null,
      canonicalTower: w.canonicalTower ? { active: w.canonicalTower.active, status: w.canonicalTower.status, runId: w.canonicalTower.id, revision: w.canonicalTower.revision, floor: w.canonicalTower.floor } : null,
      tower: this.inTower(), pending: this.pending ? { ...this.pending, destination: REALMS[this.pending.to].name } : null,
      prompt: portal ? 'E · Cross the Veil' : door ? `E · ${w.isDoorOpen(door.door) ? 'Close' : 'Open'} ${door.name}` : this.inTower() ? 'Tower of Chrysanthus · Atrium' : 'WASD · Explore   Shift · Run   E · Interact',
      doors: [...w.grid.doorStates].map(([index, open]) => ({ index, open })),
      residents: w.persons().filter(n => n.id !== this.person.id).flatMap(n => { const b = w.primaryBody(n.id); return b && realmAt(b.pos.x, b.pos.z) === realm && w.distance2d(p, b.pos) < 80 && w.grid.lineOfSight({ ...p, y: p.y + 1.6 }, { ...b.pos, y: b.pos.y + 1.6 }, 80) ? [{ id: n.id, visual:this.visual(b), name: n.name, pos: b.pos, yaw: b.yaw, vel: b.vel, appearance: { ...n.appearance, description: n.appearance.description ? projectAppearanceDescription(n.appearance.description, n.age, n.occupation) : undefined } }] : []; }),
      stats: { canonicalPeople: w.persons().length, cachedChunks: this.grid.cachedChunks, persistedEdits: w.grid.diffs.size, doors: w.grid.doorStates.size, eventCount: w.events.length } };
  }
  regionPlan() { return realmResidency(this.world.canonicalTower?.active ? this.world.canonicalTower.returnPos : this.body.pos); }
}

export type RealmSnapshot = ReturnType<RealmSession['snapshot']>;
