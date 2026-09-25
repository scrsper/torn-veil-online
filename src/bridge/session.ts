import { setCrouchHeld,refreshCrouchHeld,crouchHeld } from '../sim/physical/posture';
import { setPracticeMode, practiceStatus, tickPractice, initializePractice } from './combatArena';
import { combatPresentation } from './combatPresentation';
import { combatState } from './combatState';
import { generateCombatArena } from '../sim/world/combatArena';
import { submitCombatInput, cancelCombatAction, captureCombatTransforms } from '../sim/physical/combatAction';
import { randomUUID, createHash } from 'node:crypto';
import { CommandQueue, type CommandReceipt, type InteractionCommand } from './commands';
import { INTERACTION_SPEC } from '../sim/physical/prediction';
import { applyInteractionMovement, collisionWindow, movementState } from '../sim/physical/interactionMovement';
import { mechanismPanel } from '../sim/runtime/mechanismPanel';
import { generatePlayableWorld, indexWilderness } from '../sim/world/playable';
import { RegionStream } from './regions';
import { wildlifeProjection } from './wildlife';
import { initializeWildlife } from '../sim/ecology/generation';
import { deserialize, serialize } from '../sim/persist/save';
import { GameSim, type PersonIntent, type SpawnOptions } from '../sim/runtime/gameSim';
import { knownName } from '../sim/mind/people';
import { inspectAgency } from '../sim/runtime/agencyInspection';
import { humanoidVisualState, projectAppearance } from './visualState';
import { appearanceProfile, type AppearanceProfile } from './appearanceProfile';
import { activityPresentation } from './activityPresentation';
import { SlotReservations, chooseStation, conversationStations, separationOffset } from './occupancy';
import { humanoidPresence } from './humanoidPresence';
import { combatReach } from '../sim/physical/combat';
import { World } from '../sim/core/world';
import { Simulation } from '../sim/mind/agent';
import { generateVillage } from '../sim/world/village';
import { moveByIntent } from '../sim/physical/input';
import { meleeStrike, MELEE_REACH, MELEE_COOLDOWN } from '../sim/physical/melee';
import { recogniseClass, type RecognisedClass } from '../sim/mind/vocation';
import { handInteractions, openContainerProjection, performContainerTransfer, performHandInteraction } from '../sim/physical/hand';
import { DialogueSystem, type DialogueState } from '../sim/mind/dialogue';
import { actionsForPerson } from '../sim/core/interaction';
import { B } from '../sim/physical/blocks';
import type { Body, Item, Person, Vec3 } from '../sim/core/types';
import { RESOURCE_MASS_KG } from '../sim/world/factory';
import { getPhysicalCapability } from '../sim/core/attributes';
import { EMPTY_CATALOGUE } from '../foundry/catalogue';
import type { CharacterCatalogue } from '../foundry/catalogue';
import { playerJournal } from './journal';

export const BRIDGE_VERSION = 1;
/** The routing key of the single-player developer bridge. Multiplayer servers use one key per account. */
export const LOCAL_CHANNEL = 'local';
/** Physical execution is visible; queued intentions and private goals are not. */
function visibleActivity(p: Person | undefined, pose: string): string {
  if (pose !== 'work') return pose;
  const a = p?.mind.plan.find(a => a.status === 'active');
  if(a?.type==='chop') return 'chop';
  if(a?.type==='build') return 'repair';
  if (a?.type === 'mechanism_task') {
    const kind = a.data?.kind;
    return ['inspect', 'diagnose', 'reverse_engineer'].includes(kind) ? 'inspect' : kind === 'test' ? 'operate' : 'repair';
  }
  return a?.type === 'operate_mechanism' ? 'operate' : pose;
}

/**
 * Transport-side state of one controller: input frontier, disposable command ledger, the open
 * dialogue and which appearance profiles this particular renderer has already received. It is
 * engine metadata — nothing here is written into a Person or read by simulated minds. The
 * controlled Person is routed through `GameSim` under the same channel id.
 */
export class ControllerChannel {
  move = { x: 0, z: 0, sprint: false, expires: 0 };
  sequence = -1;
  appliedSequence = -1;
  control: CommandQueue | null = null;
  controlGeometry = '';
  dialogueState: DialogueState | null = null;
  dialogueSpeakerBodyId: string | null = null;
  dialogueRevision = 0;
  /** Appearance deltas are per renderer: a profile delivered to one client was not delivered to another. */
  readonly appearanceSent = new Map<string, string>();
  readonly bodiesLastDelivered = new Set<string>();
  constructor(readonly id: string, readonly personId: string) {}
}

export interface BridgeSessionOptions {
  playable?: boolean; arena?: boolean; save?: string; characterCatalogue?: CharacterCatalogue;
  /** Spawn/attach the legacy single-player Traveler on the 'local' channel (default true). */
  defaultPlayer?: boolean;
}

export class BridgeSession {
  readonly arena:boolean;
  readonly world: World;
  readonly sim: Simulation;
  readonly game: GameSim;
  private slowAccum = 0;
  private interactionTick = 0;
  private readonly channels = new Map<string, ControllerChannel>();
  private readonly contactTimes=new Map<string,number>();
  /**
   * A dialogue is a small, ephemeral view onto canonical mind state.  The callbacks in a
   * DialogueState remain on this side of the bridge; Unreal receives only grounded text and
   * opaque option ids, then asks the simulation to perform the selected option.  This is
   * deliberately not a second dialogue implementation in C++.
   */
  private readonly dialogue: DialogueSystem;
  /** A class is a reading of a whole life; it does not change between two snapshots. Re-derived
   * on a slow cadence so the projection stays cheap — the derivation itself stays canonical. */
  private classes = new Map<string, RecognisedClass | null>();
  private classesAt = -Infinity;
  private readonly reservations = new SlotReservations();
  private readonly characterCatalogue: CharacterCatalogue;
  readonly regions = new RegionStream();
  constructor(seed = 918271, options: BridgeSessionOptions = {}) {
    this.arena=options.arena===true;
    this.characterCatalogue = options.characterCatalogue ?? EMPTY_CATALOGUE;
    const loaded = options.save ? deserialize(options.save) : null;
    if (options.save && !loaded) throw new Error('Cannot resume incompatible or invalid world save');
    this.world = loaded?.world ?? new World(seed);
    if (!loaded) {
      if (options.arena) generateCombatArena(this.world);
      else if (options.playable) generatePlayableWorld(this.world);
      else { generateVillage(this.world); initializeWildlife(this.world); }
    }
    this.sim = new Simulation(this.world);
    this.world.onEvent(e=>{if(e.type==='attack'&&e.data.combat?.actionId){this.contactTimes.set(e.data.combat.actionId,performance.now());if(this.contactTimes.size>256)this.contactTimes.delete(this.contactTimes.keys().next().value!);}});
    this.game = new GameSim(this.sim);
    if (options.defaultPlayer !== false) {
      if (!this.world.playerId) this.world.playerId = this.game.spawn(LOCAL_CHANNEL, 'Traveler', this.spawnPoint());
      this.openChannel(LOCAL_CHANNEL, this.world.playerId!);
    }
    indexWilderness(this.world);
    this.dialogue = new DialogueSystem(this.world, this.sim);
    initializePractice(this);
  }
  /** Arrival point for a new traveler: the first settlement (stable order) or, in the authored
   * village, the legacy road site. `index` staggers simultaneous arrivals a metre apart. */
  spawnPoint(index = 0): Vec3 {
    const w = this.world;
    const settlement = w.geography ? w.settlements().slice().sort((a,b)=>a.id.localeCompare(b.id))[0] : null;
    const base = settlement?.location ?? (() => {
      const first = w.geography!.roads.slice().sort((a,b) => a.length-b.length)[0];
      const site = w.geography!.sites.find(s => s.id === first?.from) ?? w.geography!.sites[0];
      return { x: site.x - 3.5, y: w.nav.floorY(site.x-4,site.z+120), z: site.z + 120.5 };
    })();
    if (!index) return { ...base };
    const x = base.x + (index % 4) - 1.5, z = base.z + Math.floor(index / 4) + 1;
    return { x, y: w.nav.floorY(Math.floor(x), Math.floor(z)), z };
  }
  save(): string { return serialize(this.world); }

  // ── channel lifecycle ─────────────────────────────────────────────────────────────────────
  channel(id = LOCAL_CHANNEL): ControllerChannel | undefined { return this.channels.get(id); }
  channelIds(): string[] { return [...this.channels.keys()]; }
  /** Route a connection to an existing living Person. Fails if another channel controls it. */
  openChannel(id: string, personId: string): ControllerChannel | null {
    const existing = this.channels.get(id);
    if (existing && existing.personId === personId) return existing;
    if (!this.game.attach(id, personId)) return null;
    if (existing) this.channels.delete(id);
    const ch = new ControllerChannel(id, personId);
    this.channels.set(id, ch);
    return ch;
  }
  /** A brand-new ordinary traveler for a new character; routed to channel `id`. */
  createCharacter(id: string, name: string, options: SpawnOptions = {}): string {
    const arrivals = this.world.persons().filter(p => p.occupation === 'traveler').length;
    const personId = this.game.spawn(id, name, this.spawnPoint(arrivals), options);
    this.channels.delete(id);
    this.channels.set(id, new ControllerChannel(id, personId));
    return personId;
  }
  /** Drop transport state; the Person stays under external control (a brief disconnect). */
  suspendChannel(id: string): void { this.resetInput(id); }
  /** Return the Person to ordinary autonomous life and forget the channel. */
  releaseChannel(id: string): void { this.resetInput(id); this.game.detach(id); this.channels.delete(id); }
  private need(id: string): ControllerChannel {
    const ch = this.channels.get(id); if (!ch) throw new Error(`No controller channel ${id}`); return ch;
  }
  private personOf(ch: ControllerChannel): Person | undefined { return this.world.person(ch.personId); }

  /** Urgent physical state, gated by current sight rather than a cached target intention. */
  combatFrame(channelId = LOCAL_CHANNEL) {
    const ch=this.channels.get(channelId);if(!ch)return null;
    const w=this.world,p=this.personOf(ch),viewer=p&&w.primaryBody(p.id);if(!viewer||!p)return null;
    const seen=new Set(p.mind.percepts.filter(percept=>percept.how==='saw').map(percept=>percept.bodyId));
    const bodies=w.activeBodies().filter(b=>{
      if(!b.combatAction||b.combatAction.completeAt<=w.physicalTime-.15)return false;
      if(b.ownerId===p.id)return true;
      const d=Math.hypot(b.pos.x-viewer.pos.x,b.pos.z-viewer.pos.z);
      return viewer.pose!=='sleep'&&(d<2.5||seen.has(b.id))&&d<26
        &&w.grid.lineOfSight({...viewer.pos,y:viewer.pos.y+1.5},{...b.pos,y:b.pos.y+1.2},27);
    });
    if(!bodies.length)return null;
    return {version:1,type:'combat_frame',tick:w.physicalTime,serverTimeMs:performance.now(),
      actions:bodies.map(b=>({...combatState(w,b,this.contactTimes.get(b.combatAction!.id)),pos:{...b.pos},vel:{...b.vel},yaw:b.yaw}))};
  }
  /**
   * Forget which appearance profiles have been delivered to this renderer, so its next snapshot
   * carries them again. A renderer joining (or re-joining) has cached nothing; `/health` builds
   * snapshots with `deliver=false` so it never consumes a delta.
   */
  resetAppearanceDelta(channelId = LOCAL_CHANNEL) {
    const ch = this.channels.get(channelId); if (!ch) return;
    ch.appearanceSent.clear(); ch.bodiesLastDelivered.clear();
  }
  resetInput(channelId = LOCAL_CHANNEL): void {
    const ch = this.channels.get(channelId); if (!ch) return;
    const b=ch.control&&this.world.body(ch.control.bodyId);if(b){setCrouchHeld(this.world,b,false);if(b.combatAction)b.combatAction.queuedInput=undefined;}
    this.regions.reset();
    ch.sequence = -1; ch.appliedSequence=-1; ch.move = { x: 0, z: 0, sprint: false, expires: 0 };
    ch.control?.cancel(this.world.physicalTime,performance.now()); ch.control=null; ch.controlGeometry='';
    this.closeDialogue(ch);
  }
  bindInteraction(controllerId: string, channelId = LOCAL_CHANNEL) {
    const ch=this.need(channelId),body=this.world.primaryBody(ch.personId);
    if(!body) throw new Error('No controlled manifestation');
    ch.control=new CommandQueue(randomUUID(),controllerId,body.id); ch.controlGeometry='';
    return {epoch:ch.control.epoch,controllerId,bodyId:body.id,specRevision:INTERACTION_SPEC.revision,specHash:createHash('sha256').update(JSON.stringify(INTERACTION_SPEC)).digest('hex'),stepSeconds:INTERACTION_SPEC.stepSeconds};
  }
  receiveCommand(input: unknown, now=performance.now(), channelId = LOCAL_CHANNEL): CommandReceipt | null {
    return this.channels.get(channelId)?.control?.receive(input,this.world.physicalTime,now)??null;
  }
  private executeCommand(ch: ControllerChannel, c: InteractionCommand,commandId?:string): string {
    const w=this.world,q=ch.control,b=q&&w.body(q.bodyId),p=b&&w.person(b.ownerId);
    if(!p||!b) return 'binding_mismatch';
    if(c.type==='practice'){if(c.mode==='reset'&&this.arena)ch.control?.cancel(w.physicalTime,performance.now());return setPracticeMode(this,c.mode);}
    if(!this.game.controlsBody(ch.id,b.id)) return 'binding_mismatch';
    if(c.type==='crouch'&&!c.held){setCrouchHeld(w,b,false);return 'accepted';}
    if(!movementState(w,p,b).eligible) return 'incapacitated';
    if(c.type==='move') {refreshCrouchHeld(w,b,c.crouch===true);applyInteractionMovement(w,p,b,c,INTERACTION_SPEC.stepSeconds);return 'accepted';}
    if(c.type==='crouch')return submitCombatInput(w,b.id,{kind:'duck',held:c.held,commandId});
    if(c.type==='attack') return submitCombatInput(w,b.id,{kind:'attack',trajectory:c.trajectory,targetBodyId:c.targetBodyId,commandId});
    if(c.type==='defend') return submitCombatInput(w,b.id,{kind:c.kind,side:c.side,direction:c.direction,commandId});
    if(c.type==='cancel') return cancelCombatAction(w,b.id);
    if(c.type==='interact') return performHandInteraction(this.sim,p,c.interactionId);
    if(c.type==='container_transfer') return performContainerTransfer(this.sim,p,c.containerId,c.itemId,c.direction);
    return 'unsupported_command';
  }
  /** Lightweight owning-controller confirmation, never a knowledge/global scene scan. */
  localState(channelId = LOCAL_CHANNEL) {
    const ch=this.channels.get(channelId),q=ch?.control,b=q&&this.world.body(q.bodyId),p=b&&this.world.person(b.ownerId);
    if(!ch||!q||!b||!p) return null;
    const geometry=collisionWindow(this.world,b),changed=geometry.revision!==ch.controlGeometry;
    ch.controlGeometry=geometry.revision;
    return {version:1,type:'local_state',epoch:q.epoch,controllerId:q.controllerId,bodyId:b.id,ack:q.ack,
      tick:this.world.physicalTime,interactionTick:this.interactionTick,serverTimeMs:performance.now(),state:movementState(this.world,p,b),combatAction:combatState(this.world,b,this.contactTimes.get(b.combatAction?.id??'')),bufferedCombatCommandId:b.combatAction?.queuedInput?.commandId??null,crouchHeld:crouchHeld(this.world,b),practice:practiceStatus(this),...(changed?{geometry}: {})};
  }
  /**
   * Controllers whose commands apply this tick, in a deterministic order that rotates every
   * interaction tick. Two people reaching for the same item on the same tick therefore do not
   * always resolve in favour of the same account; the order is a pure function of the tick and
   * the channel ids, so identical ordered inputs replay identically.
   */
  private applicationOrder(): ControllerChannel[] {
    const list = [...this.channels.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (list.length < 2) return list;
    const k = this.interactionTick % list.length;
    return [...list.slice(k), ...list.slice(0, k)];
  }
  /** Advance fast interaction at 60 Hz for every controller; slow population/cognition keeps elapsed 20 Hz work. */
  stepAll(now=performance.now()): Map<string, CommandReceipt[]> {
    const before=captureCombatTransforms(this.world);
    const dt=INTERACTION_SPEC.stepSeconds,w=this.world,wd=w.clock.advance(dt);w.physicalTime+=dt;this.interactionTick++;
    this.slowAccum+=dt;
    const order=this.applicationOrder();
    for(const ch of order){const cb=ch.control&&w.body(ch.control.bodyId);if(cb) cb.vel={x:0,y:0,z:0};}
    const receipts=new Map<string,CommandReceipt[]>();
    for(const ch of order) receipts.set(ch.id,ch.control?.apply(w.physicalTime,now,(c,e)=>this.executeCommand(ch,c,e.commandId))??[]);
    if(this.slowAccum>=.05-1e-9) {
      for(const ch of order) if(!ch.control) {
        const p=this.personOf(ch),b=p&&w.primaryBody(p.id);
        if(p&&b&&this.game.controlsBody(ch.id,b.id)) {const live=ch.move.expires>w.physicalTime;moveByIntent(this.sim,p,b,live?ch.move.x:0,live?ch.move.z:0,live&&ch.move.sprint,this.slowAccum);}
        ch.appliedSequence=ch.sequence;
      }
      this.slowAccum=0;
    }
    tickPractice(this,dt);
    this.sim.stepScheduled(dt,wd,before);
    return receipts;
  }
  stepInteraction(now=performance.now()): CommandReceipt[] { return this.stepAll(now).get(LOCAL_CHANNEL) ?? []; }
  intent(input: unknown, channelId = LOCAL_CHANNEL): { sequence: number; result: string } {
    if (!input || typeof input !== 'object') return { sequence: -1, result: 'invalid_message' };
    const ch = this.channels.get(channelId);
    if (!ch) return { sequence: -1, result: 'no_controller' };
    const m = input as Record<string, unknown>;
    const seq = m.sequence;
    if (m.version !== BRIDGE_VERSION || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= ch.sequence) return { sequence: -1, result: 'invalid_sequence_or_version' };
    ch.sequence = seq;
    const p = this.personOf(ch), b = p && this.world.primaryBody(p.id);
    if (!p || !b) return { sequence: seq, result: 'no_body' };
    if (!p.alive || b.dead) return { sequence: seq, result: 'dead' };
    let result = 'invalid_intent';
    if (m.type === 'person_action' && m.intent && typeof m.intent === 'object') {
      result = this.game.intend(ch.id, m.intent as PersonIntent) ? 'accepted' : 'invalid_intent';
    } else if (m.type === 'move' && typeof m.x === 'number' && typeof m.z === 'number' && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      ch.move = { x: Math.max(-1, Math.min(1, m.x)), z: Math.max(-1, Math.min(1, m.z)), sprint: m.sprint === true, expires: this.world.physicalTime + 0.3 };
      result = 'accepted';
    } else if (m.type === 'attack') {
      // The client names a target it can see; the SIMULATION decides whether that is a body
      // within reach of this person, and resolves the blow through the same Simulation.attack
      // every NPC uses. No damage number ever crosses this boundary.
      result = meleeStrike(this.sim, p, b, typeof m.targetBodyId === 'string' ? m.targetBodyId : null);
    } else if (m.type === 'interact') {
      result = performHandInteraction(this.sim, p, m.interactionId);
    } else if (m.type === 'container_transfer') {
      result = performContainerTransfer(this.sim, p, m.containerId, m.itemId, m.direction);
    } else if (m.type === 'talk') {
      result = this.beginDialogue(ch, p, typeof m.targetBodyId === 'string' ? m.targetBodyId : '');
    } else if (m.type === 'dialogue_option') {
      result = this.chooseDialogue(ch, typeof m.optionId === 'string' ? m.optionId : '');
    } else if (m.type === 'dialogue_close') {
      this.closeDialogue(ch); result = 'accepted';
    }
    return { sequence: seq, result };
  }
  step(dt = 0.05): void {
    const w = this.world;
    const wd = w.clock.advance(dt); w.physicalTime += dt;
    for (const ch of this.applicationOrder()) {
      const p = this.personOf(ch), b = p && w.primaryBody(p.id);
      if (!p || !b) continue;
      const live = ch.move.expires > w.physicalTime;
      moveByIntent(this.sim, p, b, live ? ch.move.x : 0, live ? ch.move.z : 0, live && ch.move.sprint, dt);
      ch.appliedSequence=ch.sequence;
    }
    this.sim.stepScheduled(dt, wd);
  }
  private classOf(id: string): RecognisedClass | null {
    const w = this.world;
    if (w.physicalTime - this.classesAt > 5) { this.classes.clear(); this.classesAt = w.physicalTime; }
    if (!this.classes.has(id)) { const p = w.person(id); this.classes.set(id, p ? recogniseClass(w, p) : null); }
    return this.classes.get(id) ?? null;
  }
  /**
   * Slice 3 embodiment projection for one visible canonical body.
   *
   * Appearance, activity family and physical station are all *derived* here from canonical state
   * the snapshot already carries; none of them is stored, and none is fed back into simulation.
   * `appearance` rides along only when its signature changed for this renderer.
   */
  private embodimentFor(b: Body, conversation: Map<string, { stand: { x: number; y: number; z: number }; yaw: number }>, crowd: Body[], sent: Map<string, string> | null, deliver = true) {
    const w = this.world, person = w.person(b.ownerId);
    if (!person) return null;
    const multiplier = getPhysicalCapability(person, w, { body: b }).movementMultiplier;
    const activity = activityPresentation(w, b, person, multiplier);
    const profile: AppearanceProfile | null = appearanceProfile(person, b.id, this.characterCatalogue, w.seed);
    const signature = profile?.signature ?? '';
    const fresh = !!profile && (!sent || sent.get(b.id) !== signature);
    // Only a snapshot that actually reaches a renderer may consume the delta.
    if (fresh && deliver && sent) sent.set(b.id, signature);
    const station = activity.station
      ? chooseStation(w, b, activity.station, activity.placeId, this.reservations, 4)
      : null;
    // Conversation spacing outranks a seat only when the person is standing.
    const ring = activity.family === 'socialize' && activity.posture !== 'sit' ? conversation.get(b.id) ?? null : null;
    const separation = station || ring ? { x: 0, z: 0 } : separationOffset(b, crowd);
    return {
      appearanceSignature: signature,
      ...(fresh && profile ? { appearance: profile } : {}),
      activity,
      station: station ? { slotId: station.slot.id, kind: station.slot.kind, stand: station.slot.stand, yaw: station.slot.yaw, posture: station.slot.posture, settleMetres: station.settleMetres } : null,
      conversation: ring,
      separation,
    };
  }
  snapshot(deliver = true, channelId = LOCAL_CHANNEL) {
    const ch = this.need(channelId);
    const w = this.world, p = this.personOf(ch)!;
    const knowledge = this.game.perceive(ch.id)!;
    const controlledBodyId=w.primaryBody(p.id)?.id;
    const visible = new Set(knowledge.people.map(p => p.bodyId)); if(controlledBodyId) visible.add(controlledBodyId);
    const residents = humanoidPresence(w, w.body(controlledBodyId));
    const controlledBody = w.body(controlledBodyId);
    if (controlledBody?.present && !residents.includes(controlledBody)) residents.push(controlledBody);
    this.reservations.expire(w.physicalTime);
    if (deliver) {
      // Anything newly in the body list gets its appearance again, because the actor that will
      // hold it is only created now.
      for (const body of residents) if (!ch.bodiesLastDelivered.has(body.id)) ch.appearanceSent.delete(body.id);
      ch.bodiesLastDelivered.clear();
      for (const body of residents) ch.bodiesLastDelivered.add(body.id);
    }
    // One conversation ring per cluster of people the simulation actually has talking.
    const talking = residents.filter(b => b.pose === 'talk' || w.person(b.ownerId)?.mind.goal?.type === 'socialize');
    const conversation = conversationStations(talking);
    const interactions=handInteractions(this.sim,p),talkTargets=this.talkTargets(ch,p,visible);
    const ownBody=w.body(controlledBodyId),carried=p.inventory.flatMap(id=>{const item=w.item(id);return item&&item.holderId===p.id?[item]:[];});
    const mobility=ownBody?{eligible:movementState(w,p,ownBody).eligible,fatigue:p.physiology.fatigue,
      speedMultiplier:getPhysicalCapability(p,w,{body:ownBody}).movementMultiplier,
      knownLoadKg:carried.reduce((sum,i)=>sum+(RESOURCE_MASS_KG[i.type]??0)*i.quantity,0),
      unweighedStacks:carried.filter(i=>RESOURCE_MASS_KG[i.type]===undefined).length,
      safeCarryKg:getPhysicalCapability(p,w,{body:ownBody}).safeCarryMassKg,
      restriction:!p.alive||ownBody.dead?'Dead':ownBody.pose==='sleep'?'Sleeping':ownBody.pose==='downed'||ownBody.subduedUntil>w.physicalTime?'Recovering':p.custody?.active||p.surrender?'Restrained':''}:null;
    return { version: BRIDGE_VERSION, type: 'snapshot', tick: w.physicalTime, worldTime: w.now, ack: ch.appliedSequence, playerId: p.id, controlledBodyId,
      wildlife: wildlifeProjection(w, w.body(controlledBodyId)),
      knowledge, mechanisms: mechanismPanel(w, p), interactions, mobility, container: openContainerProjection(this.sim,p), dialogue: this.dialogueProjection(ch), talkTargets,
      journal: playerJournal(w, p),
      interactionTargets:[...interactions.flatMap(a=>a.target?[{actionId:a.id,targetId:a.target.id,kind:a.target.kind,label:a.label,pos:a.target.pos}]:[]),
        ...talkTargets.map(t=>({actionId:`talk:${t.bodyId}`,targetId:t.bodyId,kind:'person',label:`Talk — ${t.name||'Unknown person'}`,pos:{...w.body(t.bodyId)!.pos}}))],
      bodies: residents.map(b => ({
        ...humanoidVisualState(b, visible.has(b.id) ? knownName(p, b.ownerId) : 'an unfamiliar person', visibleActivity(w.person(b.ownerId), b.pose), projectAppearance(w.person(b.ownerId))),
        combatAction:visible.has(b.id) ? combatState(w,b) : null,
        embodiment: this.embodimentFor(b, conversation, residents, ch.appearanceSent, deliver),
        incapacitated: b.pose === 'downed' || (visible.has(b.id) && (b.subduedUntil > w.physicalTime || !!w.person(b.ownerId)?.surrender || !!w.person(b.ownerId)?.custody?.active)),
        alive: !b.dead,
        speech: visible.has(b.id) ? w.person(b.ownerId)?.speech?.text ?? '' : '',
        ...(b.ownerId === p.id ? { inventory: p.inventory.flatMap(id => { const i=w.item(id); return i ? [{ id:i.id,name:i.type,type:i.type,quantity:i.quantity }] : []; }), health: b.health, maxHealth: b.maxHealth, needs: { ...p.needs }, wealth: p.wealth } : {}),
      })), combatActions:w.activeBodies().filter(b=>visible.has(b.id)).flatMap(b=>{const a=combatState(w,b);return a?[a]:[];}), combatPresentation: combatPresentation(w, visible, p.id), events: [] };
  }
  /** Whole-world humanoid set for the developer path only; never a presentation residency. */
  private developerBodies(): Body[] {
    return this.world.bodies().filter(b => b.shape === 'humanoid' && b.present);
  }
  /** Whole-world observability is available only through this explicitly named debug path. */
  developerSnapshot() {
    const w = this.world, local = this.channels.get(LOCAL_CHANNEL), lp = local && this.personOf(local);
    return {
      version: BRIDGE_VERSION, type: 'snapshot', tick: w.physicalTime, worldTime: w.now, ack: local?.sequence ?? -1, playerId: lp?.id ?? null,
      controllers: [...this.channels.values()].map(c => ({ channel: c.id, personId: c.personId })),
      interactions: lp ? handInteractions(this.sim, lp) : [],
      dialogue: local ? this.dialogueProjection(local) : null,
      talkTargets: local && lp ? this.talkTargets(local, lp) : [],
      bodies: this.developerBodies().flatMap(b => {
        const p = w.person(b.ownerId); if (!p) return [];
        return [{ ...humanoidVisualState(b, p.name, visibleActivity(p, b.pose), projectAppearance(p)),
          combatAction:combatState(w,b),
          embodiment: this.embodimentFor(b, new Map(), this.developerBodies(), null),
          reach: w.person(b.ownerId) ? combatReach(w, w.person(b.ownerId)!) : MELEE_REACH, cooldown: MELEE_COOLDOWN,
          attackTarget: b.attackTarget,
          health: b.health, maxHealth: b.maxHealth, alive: p.alive,
          incapacitated: b.pose === 'downed' || b.subduedUntil > w.physicalTime || !!p.surrender || !!p.custody?.active,
          occupation: p.occupation, age: p.age, gender: p.gender, slug: p.slug ?? null,
          // Capability before class (Constitution §12): derived, never assigned.
          recognisedClass: this.classOf(p.id),
          activity: p.mind.plan.find(a => a.status === 'active')?.type ?? b.pose,
          inventory: p.inventory.map(id => w.item(id)).filter(Boolean).map(it => ({ id: it!.id, name: it!.name, type: it!.type, quantity: it!.quantity, ownerId: it!.ownerId, holderId: it!.holderId })),
          weapon: this.sim.weaponName(p), needs: p.needs, wealth: p.wealth,
          speech: p.speech && p.speech.until > w.physicalTime ? p.speech.text : '',
          // Explicitly developer-only. These fields are never fed into a character's knowledge.
          debug: { goal: p.mind.goal, pursuits: p.mind.pursuits, concerns: p.mind.concerns, agency: inspectAgency(w, p.id, lp?.id) },
        }];
      }),
      combatPresentation: combatPresentation(w, new Set(w.activeBodies().filter(b => b.present).map(b => b.id))),
      events: w.events.filter(e => ['attack', 'death', 'kill', 'harvest', 'produce', 'trade', 'pickup', 'drop', 'resource_extracted', 'resource_depleted', 'resource_regrew', 'haul_deliver'].includes(e.type)).slice(-24).map(e => ({ id: e.id, type: e.type, actor: e.actor, target: e.target, summary: e.summary, data: e.data })),
    };
  }
  scene(channelId = LOCAL_CHANNEL) {
    const w = this.world;
    if (w.geography) {
      const ch = this.channels.get(channelId), pos = (ch && w.positionOf(ch.personId)) ?? this.spawnPoint(), size=w.geography.spec.regionSize;
      return { version: 1, type: 'scene', seed: w.seed, worldId: `seeded:${w.seed}`, geography: w.geography.spec, origin: { x: Math.floor(pos.x/size)*size, y: 0, z: Math.floor(pos.z/size)*size }, unitsPerMetre: 100, regional: true };
    }
    const g = w.grid;
    const terrain: number[][] = [];
    for (let x = 0; x < g.W; x++) for (let z = 0; z < g.D; z++) {
      const y = g.groundHeight(x, z);
      // A compact canonical surface sample.  The visual client decides how grass, paths,
      // fields, stone and water look; it does not decide their location or elevation.
      terrain.push([x, z, y, g.get(x, y, z)]);
    }
    const openings: { x: number; y: number; z: number; open: boolean }[] = [];
    const fences: { x: number; y: number; z: number }[] = [];
    for (let x = 0; x < g.W; x++) for (let z = 0; z < g.D; z++) for (let y = 0; y < g.H; y++) {
      const block = g.get(x, y, z);
      if (block === B.Door) openings.push({ x, y, z, open: g.isDoorOpen(x, y, z) });
      else if (block === B.Fence) fences.push({ x, y, z });
    }
    return { version: BRIDGE_VERSION, type: 'scene', seed: w.seed,
      // TS metres (x,y-up,z) map to UE centimetres (X=x,Y=z,Z=y), centred on the square.
      origin: this.arena?{x:20,y:0,z:20}:{ x: 96, y: 14, z: 96 }, unitsPerMetre: 100,
      arena:this.arena,
      places: w.places().map(p => ({ id: p.id, name: p.name, type: p.type, bounds: p.bounds, inside: p.inside, door: p.door })),
      resources: w.resourceNodes.map(n => ({ id: n.id, pos: n.pos, remaining: n.remaining, state: n.state })),
      // This is a read-only canonical geometry projection, bounded to this loaded simulation region.
      terrain: { width: g.W, depth: g.D, columns: terrain, openings, fences },
    };
  }

  private closeDialogue(ch: ControllerChannel): void {
    ch.dialogueState = null;
    ch.dialogueSpeakerBodyId = null;
    ch.dialogueRevision++;
  }

  private talkTargets(ch: ControllerChannel, player: Person, visible=new Set(this.game.perceive(ch.id)?.people.map(p=>p.bodyId))) {
    const w = this.world, source = w.primaryBody(player.id);
    if (!source || source.dead || !player.alive) return [];
    return w.bodies().flatMap(body => {
      if (!visible.has(body.id)||!body.present || body.ownerId === player.id || body.dead || body.shape !== 'humanoid') return [];
      const person = w.person(body.ownerId);
      if (!person || !person.alive || body.pose === 'sleep') return [];
      const carrying = player.inventory.map(id => w.item(id)).filter((item): item is Item => !!item);
      if (!actionsForPerson(w, player, person, carrying).some(action => action.kind === 'talk')) return [];
      const distance = Math.hypot(source.pos.x - body.pos.x, source.pos.y - body.pos.y, source.pos.z - body.pos.z);
      if (distance > 3.1 || !w.grid.lineOfPassage({ ...source.pos, y: source.pos.y + 1.2 }, { ...body.pos, y: body.pos.y + 1.2 }, 4.3)) return [];
      return [{ bodyId: body.id, entityId: person.id, name: knownName(player, person.id), distance }];
    }).sort((a, b) => a.distance - b.distance || a.bodyId.localeCompare(b.bodyId));
  }

  private beginDialogue(ch: ControllerChannel, player: Person, targetBodyId: string): string {
    const target = this.talkTargets(ch, player).find(candidate => candidate.bodyId === targetBodyId);
    if (!target) return 'interaction_unavailable';
    const speaker = this.world.person(target.entityId);
    if (!speaker) return 'interaction_unavailable';
    ch.dialogueState = this.dialogue.start(speaker, player);
    ch.dialogueSpeakerBodyId = targetBodyId;
    ch.dialogueRevision++;
    return 'accepted';
  }

  private chooseDialogue(ch: ControllerChannel, optionId: string): string {
    if (!ch.dialogueState) return 'no_dialogue';
    const prefix = `dialogue:${ch.dialogueRevision}:`;
    if (!optionId.startsWith(prefix)) return 'invalid_dialogue_option';
    const index = Number(optionId.slice(prefix.length));
    if (!Number.isSafeInteger(index) || index < 0 || index >= ch.dialogueState.options.length) return 'invalid_dialogue_option';
    // A menu remembers an offer, not permission to speak across distance or to a
    // sleeping person. Reuse the same current-body boundary as opening dialogue.
    const player = this.personOf(ch);
    if (!player || !this.talkTargets(ch, player).some(target => target.bodyId === ch.dialogueSpeakerBodyId)) {
      this.closeDialogue(ch);
      return 'interaction_unavailable';
    }
    const next = ch.dialogueState.options[index].next();
    if (next) ch.dialogueState = next;
    else { ch.dialogueState = null; ch.dialogueSpeakerBodyId = null; }
    ch.dialogueRevision++;
    return 'accepted';
  }

  private dialogueProjection(ch: ControllerChannel) {
    const state = ch.dialogueState;
    if (!state) return null;
    return {
      revision: ch.dialogueRevision,
      speakerId: state.speaker.id,
      speakerBodyId: ch.dialogueSpeakerBodyId,
      name: knownName(this.world.person(ch.personId)!, state.speaker.id),
      lines: state.lines,
      // Option ids resolve only against the current DialogueSystem state of this controller.
      // Nine keyboard shortcuts do not limit the canonical conversation. Clients
      // can scroll/focus the remaining choices; every id keeps revision fencing.
      options: state.options.map((option, index) => ({ id: `dialogue:${ch.dialogueRevision}:${index}`, label: option.label })),
    };
  }
}
