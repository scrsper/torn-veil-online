import { setPracticeMode, practiceStatus, tickPractice } from './combatArena';
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
import { deserialize, serialize } from '../sim/persist/save';
import { GameSim, type PersonIntent } from '../sim/runtime/gameSim';
import { knownName } from '../sim/mind/people';
import { humanoidVisualState } from './visualState';
import { combatReach } from '../sim/physical/combat';
import { World } from '../sim/core/world';
import { Simulation } from '../sim/mind/agent';
import { generateVillage } from '../sim/world/village';
import { moveByIntent } from '../sim/physical/input';
import { meleeStrike, MELEE_REACH, MELEE_COOLDOWN } from '../sim/physical/melee';
import { recogniseClass, type RecognisedClass } from '../sim/mind/vocation';
import { handInteractions, performHandInteraction } from '../sim/physical/hand';
import { DialogueSystem, type DialogueState } from '../sim/mind/dialogue';
import { actionsForPerson } from '../sim/core/interaction';
import { B } from '../sim/physical/blocks';
import type { Item, Person } from '../sim/core/types';

export const BRIDGE_VERSION = 1;
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
export class BridgeSession {
  readonly arena:boolean;
  readonly world: World;
  readonly sim: Simulation;
  readonly game: GameSim;
  private move = { x: 0, z: 0, sprint: false, expires: 0 };
  private sequence = -1;
  private appliedSequence = -1;
  private slowAccum = 0;
  private interactionTick = 0;
  private control: CommandQueue | null = null;
  private controlGeometry = '';
  private readonly contactTimes=new Map<string,number>();
  /**
   * A dialogue is a small, ephemeral view onto canonical mind state.  The callbacks in a
   * DialogueState remain on this side of the bridge; Unreal receives only grounded text and
   * opaque option ids, then asks the simulation to perform the selected option.  This is
   * deliberately not a second dialogue implementation in C++.
   */
  private readonly dialogue: DialogueSystem;
  private dialogueState: DialogueState | null = null;
  private dialogueSpeakerBodyId: string | null = null;
  private dialogueRevision = 0;
  /** A class is a reading of a whole life; it does not change between two snapshots. Re-derived
   * on a slow cadence so the projection stays cheap — the derivation itself stays canonical. */
  private classes = new Map<string, RecognisedClass | null>();
  private classesAt = -Infinity;
  readonly regions = new RegionStream();
  constructor(seed = 918271, options: { playable?: boolean; arena?:boolean; save?: string } = {}) {
    this.arena=options.arena===true;
    const loaded = options.save ? deserialize(options.save) : null;
    if (options.save && !loaded) throw new Error('Cannot resume incompatible or invalid world save');
    this.world = loaded?.world ?? new World(seed);
    if (!loaded) { if(options.arena)generateCombatArena(this.world);else if (options.playable) generatePlayableWorld(this.world); else generateVillage(this.world); }
    this.sim = new Simulation(this.world);
    this.world.onEvent(e=>{if(e.type==='attack'&&e.data.combat?.actionId){this.contactTimes.set(e.data.combat.actionId,performance.now());if(this.contactTimes.size>256)this.contactTimes.delete(this.contactTimes.keys().next().value!);}});
    this.game = new GameSim(this.sim);
    if (!this.world.playerId) {
      const first = this.world.geography!.roads.slice().sort((a,b) => a.length-b.length)[0];
      const site = this.world.geography!.sites.find(s => s.id === first?.from) ?? this.world.geography!.sites[0];
      const x = site.x - 4, z = site.z + 120;
      this.world.playerId = this.game.spawn('local', 'Traveler', { x: x + .5, y: this.world.nav.floorY(x,z), z: z + .5 });
    }
    this.game.attach('local', this.world.playerId!); indexWilderness(this.world);
    this.dialogue = new DialogueSystem(this.world, this.sim);
  }
  save(): string { return serialize(this.world); }
  /** Urgent physical state, gated by current sight rather than a cached target intention. */
  combatFrame() {
    const w=this.world,p=w.person(w.playerId!),viewer=p&&w.primaryBody(p.id);if(!viewer||!p)return null;
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
  resetInput(): void {
    this.regions.reset();
    this.sequence = -1; this.appliedSequence=-1; this.move = { x: 0, z: 0, sprint: false, expires: 0 };
    this.control?.cancel(this.world.physicalTime,performance.now()); this.control=null; this.controlGeometry='';
    this.closeDialogue();
  }
  bindInteraction(controllerId: string) {
    const body=this.world.primaryBody(this.world.playerId!);
    if(!body) throw new Error('No controlled manifestation');
    this.control=new CommandQueue(randomUUID(),controllerId,body.id); this.controlGeometry='';
    return {epoch:this.control.epoch,controllerId,bodyId:body.id,specRevision:INTERACTION_SPEC.revision,specHash:createHash('sha256').update(JSON.stringify(INTERACTION_SPEC)).digest('hex'),stepSeconds:INTERACTION_SPEC.stepSeconds};
  }
  receiveCommand(input: unknown, now=performance.now()): CommandReceipt | null {
    return this.control?.receive(input,this.world.physicalTime,now)??null;
  }
  private executeCommand(c: InteractionCommand,commandId?:string): string {
    const w=this.world,q=this.control,b=q&&w.body(q.bodyId),p=b&&w.person(b.ownerId);
    if(!p||!b) return 'binding_mismatch';
    if(c.type==='practice'){if(c.mode==='reset')this.control?.cancel(w.physicalTime,performance.now());return setPracticeMode(this,c.mode);}
    if(!this.game.controlsBody('local',b.id)) return 'binding_mismatch';
    if(!movementState(w,p,b).eligible) return 'incapacitated';
    if(c.type==='move') {applyInteractionMovement(w,p,b,c,INTERACTION_SPEC.stepSeconds);return 'accepted';}
    if(c.type==='attack') return submitCombatInput(w,b.id,{kind:'attack',trajectory:c.trajectory,targetBodyId:c.targetBodyId,commandId});
    if(c.type==='defend') return submitCombatInput(w,b.id,{kind:c.kind,side:c.side,direction:c.direction,commandId});
    if(c.type==='cancel') return cancelCombatAction(w,b.id);
    if(c.type==='interact') return performHandInteraction(this.sim,p,c.interactionId);
    return 'unsupported_command';
  }
  /** Lightweight owning-controller confirmation, never a knowledge/global scene scan. */
  localState() {
    const q=this.control,b=q&&this.world.body(q.bodyId),p=b&&this.world.person(b.ownerId);
    if(!q||!b||!p) return null;
    const geometry=collisionWindow(this.world,b),changed=geometry.revision!==this.controlGeometry;
    this.controlGeometry=geometry.revision;
    return {version:1,type:'local_state',epoch:q.epoch,controllerId:q.controllerId,bodyId:b.id,ack:q.ack,
      tick:this.world.physicalTime,interactionTick:this.interactionTick,serverTimeMs:performance.now(),state:movementState(this.world,p,b),combatAction:combatState(this.world,b,this.contactTimes.get(b.combatAction?.id??'')),bufferedCombatCommandId:b.combatAction?.queuedInput?.commandId??null,practice:practiceStatus(this),...(changed?{geometry}: {})};
  }
  /** Advance fast interaction at 60 Hz; slow population/cognition keeps elapsed 20 Hz work. */
  stepInteraction(now=performance.now()): CommandReceipt[] {
    const before=captureCombatTransforms(this.world);
    const dt=INTERACTION_SPEC.stepSeconds,w=this.world,wd=w.clock.advance(dt);w.physicalTime+=dt;this.interactionTick++;
    this.slowAccum+=dt;
    const cb=this.control&&w.body(this.control.bodyId);if(cb) cb.vel={x:0,y:0,z:0};
    const receipts=this.control?.apply(w.physicalTime,now,(c,e)=>this.executeCommand(c,e.commandId))??[];
    if(this.slowAccum>=.05-1e-9) {
      if(!this.control) {
        const p=w.person(w.playerId),b=p&&w.primaryBody(p.id);
        if(p&&b) {const live=this.move.expires>w.physicalTime;moveByIntent(this.sim,p,b,live?this.move.x:0,live?this.move.z:0,live&&this.move.sprint,this.slowAccum);}
        this.appliedSequence=this.sequence;
      }
      this.slowAccum=0;
    }
    tickPractice(this,dt);
    this.sim.stepScheduled(dt,wd,before);
    return receipts;
  }
  intent(input: unknown): { sequence: number; result: string } {
    if (!input || typeof input !== 'object') return { sequence: -1, result: 'invalid_message' };
    const m = input as Record<string, unknown>;
    const seq = m.sequence;
    if (m.version !== BRIDGE_VERSION || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= this.sequence) return { sequence: -1, result: 'invalid_sequence_or_version' };
    this.sequence = seq;
    const p = this.world.person(this.world.playerId)!;
    const b = this.world.primaryBody(p.id)!;
    let result = 'invalid_intent';
    if (m.type === 'person_action' && m.intent && typeof m.intent === 'object') {
      result = this.game.intend('local', m.intent as PersonIntent) ? 'accepted' : 'invalid_intent';
    } else if (m.type === 'move' && typeof m.x === 'number' && typeof m.z === 'number' && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      this.move = { x: Math.max(-1, Math.min(1, m.x)), z: Math.max(-1, Math.min(1, m.z)), sprint: m.sprint === true, expires: this.world.physicalTime + 0.3 };
      result = 'accepted';
    } else if (m.type === 'attack') {
      // The client names a target it can see; the SIMULATION decides whether that is a body
      // within reach of this person, and resolves the blow through the same Simulation.attack
      // every NPC uses. No damage number ever crosses this boundary.
      result = meleeStrike(this.sim, p, b, typeof m.targetBodyId === 'string' ? m.targetBodyId : null);
    } else if (m.type === 'interact') {
      result = performHandInteraction(this.sim, p, m.interactionId);
    } else if (m.type === 'talk') {
      result = this.beginDialogue(p, typeof m.targetBodyId === 'string' ? m.targetBodyId : '');
    } else if (m.type === 'dialogue_option') {
      result = this.chooseDialogue(typeof m.optionId === 'string' ? m.optionId : '');
    } else if (m.type === 'dialogue_close') {
      this.closeDialogue(); result = 'accepted';
    }
    return { sequence: seq, result };
  }
  step(dt = 0.05): void {
    const w = this.world;
    const wd = w.clock.advance(dt); w.physicalTime += dt;
    const p = w.person(w.playerId)!;
    const b = w.primaryBody(p.id)!;
    const live = this.move.expires > w.physicalTime;
    moveByIntent(this.sim, p, b, live ? this.move.x : 0, live ? this.move.z : 0, live && this.move.sprint, dt);
    this.sim.step(dt, wd); this.sim.flushSpeech();
    this.appliedSequence=this.sequence;
  }
  private classOf(id: string): RecognisedClass | null {
    const w = this.world;
    if (w.physicalTime - this.classesAt > 5) { this.classes.clear(); this.classesAt = w.physicalTime; }
    if (!this.classes.has(id)) { const p = w.person(id); this.classes.set(id, p ? recogniseClass(w, p) : null); }
    return this.classes.get(id) ?? null;
  }
  snapshot() {
    const w = this.world, p = w.person(w.playerId)!;
    const knowledge = this.game.perceive('local')!;
    const controlledBodyId=w.primaryBody(p.id)?.id;
    const visible = new Set(knowledge.people.map(p => p.bodyId)); if(controlledBodyId) visible.add(controlledBodyId);
    return { version: BRIDGE_VERSION, type: 'snapshot', tick: w.physicalTime, worldTime: w.now, ack: this.appliedSequence, playerId: p.id, controlledBodyId,
      knowledge, mechanisms: mechanismPanel(w, p), interactions: handInteractions(this.sim, p), dialogue: this.dialogueProjection(), talkTargets: this.talkTargets(p),
      bodies: w.activeBodies().filter(b => b.present && b.shape === 'humanoid' && visible.has(b.id)).map(b => ({
        ...humanoidVisualState(b, knownName(p, b.ownerId), visibleActivity(w.person(b.ownerId), b.pose), w.person(b.ownerId)?.appearance),
        combatAction:combatState(w,b),
        incapacitated: b.pose === 'downed' || b.subduedUntil > w.physicalTime || !!w.person(b.ownerId)?.surrender || !!w.person(b.ownerId)?.custody?.active,
        alive: !b.dead,
        speech: w.person(b.ownerId)?.speech?.text ?? '',
        ...(b.ownerId === p.id ? { inventory: p.inventory.flatMap(id => { const i=w.item(id); return i ? [{ id:i.id,name:i.type,type:i.type,quantity:i.quantity }] : []; }), health: b.health, maxHealth: b.maxHealth, needs: { ...p.needs }, wealth: p.wealth } : {}),
      })), combatActions:w.activeBodies().filter(b=>visible.has(b.id)).flatMap(b=>{const a=combatState(w,b);return a?[a]:[];}), combatPresentation: combatPresentation(w, visible, p.id), events: [] };
  }
  /** Whole-world observability is available only through this explicitly named debug path. */
  developerSnapshot() {
    const w = this.world;
    return {
      version: BRIDGE_VERSION, type: 'snapshot', tick: w.physicalTime, worldTime: w.now, ack: this.sequence, playerId: w.playerId,
      interactions: handInteractions(this.sim, w.person(w.playerId)!),
      dialogue: this.dialogueProjection(),
      // The client can show the nearest person it may legitimately address.  It receives no
      // hidden memories/knowledge; the actual greeting and all option availability remain in
      // DialogueSystem on a validated talk intent.
      talkTargets: this.talkTargets(w.person(w.playerId)!),
      bodies: w.bodies().filter(b => b.shape === 'humanoid' && b.present).flatMap(b => {
        const p = w.person(b.ownerId); if (!p) return [];
        return [{ ...humanoidVisualState(b, p.name, visibleActivity(p, b.pose), p.appearance),
          combatAction:combatState(w,b),
          reach: w.person(b.ownerId) ? combatReach(w, w.person(b.ownerId)!) : MELEE_REACH, cooldown: MELEE_COOLDOWN,
          attackTarget: b.attackTarget,
          health: b.health, maxHealth: b.maxHealth, alive: p.alive,
          incapacitated: b.pose === 'downed' || b.subduedUntil > w.physicalTime || !!p.surrender || !!p.custody?.active,
          occupation: p.occupation, age: p.age, gender: p.gender, slug: p.slug ?? null, appearance: p.appearance,
          // Capability before class (Constitution §12): derived, never assigned, and carrying the
          // canonical evidence it was read from. Null for most people, which is the ordinary case.
          recognisedClass: this.classOf(p.id),
          activity: p.mind.plan.find(a => a.status === 'active')?.type ?? b.pose,
          inventory: p.inventory.map(id => w.item(id)).filter(Boolean).map(it => ({ id: it!.id, name: it!.name, type: it!.type, quantity: it!.quantity, ownerId: it!.ownerId, holderId: it!.holderId })),
          weapon: this.sim.weaponName(p), needs: p.needs, wealth: p.wealth,
          speech: p.speech && p.speech.until > w.physicalTime ? p.speech.text : '',
          // Explicitly developer-only. These fields are never fed into a character's knowledge.
          debug: { goal: p.mind.goal, pursuits: p.mind.pursuits, concerns: p.mind.concerns },
        }];
      }),
      combatPresentation: combatPresentation(w, new Set(w.activeBodies().filter(b => b.present).map(b => b.id))),
      events: w.events.filter(e => ['attack', 'death', 'kill', 'harvest', 'produce', 'trade', 'pickup', 'drop', 'resource_extracted', 'resource_depleted', 'resource_regrew', 'haul_deliver'].includes(e.type)).slice(-24).map(e => ({ id: e.id, type: e.type, actor: e.actor, target: e.target, summary: e.summary, data: e.data })),
    };
  }
  scene() {
    const w = this.world;
    if (w.geography) { const p=w.positionOf(w.playerId!)!,size=w.geography.spec.regionSize; return { version: 1, type: 'scene', seed: w.seed, worldId: `seeded:${w.seed}`, geography: w.geography.spec, origin: { x: Math.floor(p.x/size)*size, y: 0, z: Math.floor(p.z/size)*size }, unitsPerMetre: 100, regional: true }; }
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
      // This is a read-only canonical geometry projection, intentionally separate from the
      // Unreal culture/style profile.  It is bounded to this loaded simulation region; future
      // streamed regions can provide the same shape independently.
      terrain: { width: g.W, depth: g.D, columns: terrain, openings, fences },
    };
  }

  private closeDialogue(): void {
    this.dialogueState = null;
    this.dialogueSpeakerBodyId = null;
    this.dialogueRevision++;
  }

  private talkTargets(player: Person) {
    const w = this.world, source = w.primaryBody(player.id);
    if (!source || source.dead || !player.alive) return [];
    return w.bodies().flatMap(body => {
      if (!body.present || body.ownerId === player.id || body.dead || body.shape !== 'humanoid') return [];
      const person = w.person(body.ownerId);
      if (!person || !person.alive || body.pose === 'sleep') return [];
      const carrying = player.inventory.map(id => w.item(id)).filter((item): item is Item => !!item);
      if (!actionsForPerson(w, player, person, carrying).some(action => action.kind === 'talk')) return [];
      const distance = Math.hypot(source.pos.x - body.pos.x, source.pos.y - body.pos.y, source.pos.z - body.pos.z);
      if (distance > 3.1 || !w.grid.lineOfPassage({ ...source.pos, y: source.pos.y + 1.2 }, { ...body.pos, y: body.pos.y + 1.2 }, 4.3)) return [];
      return [{ bodyId: body.id, entityId: person.id, name: knownName(player, person.id), distance }];
    }).sort((a, b) => a.distance - b.distance || a.bodyId.localeCompare(b.bodyId));
  }

  private beginDialogue(player: Person, targetBodyId: string): string {
    const target = this.talkTargets(player).find(candidate => candidate.bodyId === targetBodyId);
    if (!target) return 'interaction_unavailable';
    const speaker = this.world.person(target.entityId);
    if (!speaker) return 'interaction_unavailable';
    this.dialogueState = this.dialogue.start(speaker, player);
    this.dialogueSpeakerBodyId = targetBodyId;
    this.dialogueRevision++;
    return 'accepted';
  }

  private chooseDialogue(optionId: string): string {
    if (!this.dialogueState) return 'no_dialogue';
    const prefix = `dialogue:${this.dialogueRevision}:`;
    if (!optionId.startsWith(prefix)) return 'invalid_dialogue_option';
    const index = Number(optionId.slice(prefix.length));
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.dialogueState.options.length) return 'invalid_dialogue_option';
    const next = this.dialogueState.options[index].next();
    if (next) this.dialogueState = next;
    else { this.dialogueState = null; this.dialogueSpeakerBodyId = null; }
    this.dialogueRevision++;
    return 'accepted';
  }

  private dialogueProjection() {
    const state = this.dialogueState;
    if (!state) return null;
    return {
      revision: this.dialogueRevision,
      speakerId: state.speaker.id,
      speakerBodyId: this.dialogueSpeakerBodyId,
      name: knownName(this.world.person(this.world.playerId)!, state.speaker.id),
      lines: state.lines,
      // The native panel exposes enough of a canonical menu for merchant/trade branches to be
      // reachable without inventing a renderer-side shortcut.  This remains a presentation
      // limit: option ids resolve only against the current DialogueSystem state.
      options: state.options.slice(0, 9).map((option, index) => ({ id: `dialogue:${this.dialogueRevision}:${index}`, label: option.label })),
    };
  }
}
