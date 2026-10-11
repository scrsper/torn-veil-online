/**
 * Browser-side view of the Living Alpha protocol. These are *observer-scoped projections* the
 * server chose to send; the client never derives canonical truth from them and never reads hidden
 * cognition. Unknown fields are tolerated (the server may add optional fields); unknown message
 * types are surfaced through `onUnknown` rather than silently dropped or trusted.
 *
 * The constants here mirror src/server/protocol.ts and src/bridge/streaming.ts. They are duplicated
 * on purpose (those modules import the authoritative World and must never enter a browser bundle);
 * tests/web-boundary.test.ts asserts they stay equal.
 */
export const ALPHA_PROTOCOL = 1;
export const REGION_PROTOCOL = 2;
export const INTERACTION_SPEC_REVISION = 'tv-interaction-6';

export interface Vec3 { x: number; y: number; z: number }

export interface CharacterSummary { personId: string; name: string; alive: boolean }
export interface HelloMessage {
  type: 'hello'; regionProtocol: number; alphaProtocol: number; release: string; worldId: string; controls: boolean; playerId: string;
  interaction?: { epoch: string; controllerId: string; bodyId: string; specRevision: string; specHash: string; stepSeconds: number };
  account: { id: string; displayName: string; developer: boolean };
  character: { personId: string; name: string; created: boolean; characters: CharacterSummary[] };
  durability: { checkpointSeconds: number; lastCheckpointIso: string | null };
  maintenance: { message: string; at: number } | null;
}
export interface SceneMessage {
  type: 'scene'; seed: number; worldId: string; regional?: boolean; origin: Vec3; unitsPerMetre: number;
  geography?: { size: number; regionSize: number; settlements: number; timeScale: number };
}
export interface RegionsStateMessage { type: 'regions_state'; origin: Vec3; center: string; resident: string[]; unload: string[] }

export type TerrainColumn = [x: number, z: number, top: number, block: number, water: number, forest: number];
export interface PlaceProjection {
  id: string; type: string; bounds: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };
  inside: Vec3; door: Vec3 | null; indoor: boolean; visualSeed: number; wallHeight: number; family: string;
}
export interface FurnishingProjection { role: string; pos: Vec3; yaw: number; support: number }
export interface RegionProjection {
  id: string; seed: number; bounds: { x0: number; z0: number; x1: number; z1: number };
  terrain: { stride: number; columns: TerrainColumn[] };
  openings: [x: number, y: number, z: number, open: number][];
  fences: [x: number, y: number, z: number, yaw: number][];
  paths: [x: number, y: number, z: number][];
  furnishings: FurnishingProjection[];
  places: PlaceProjection[];
  roads: { id: string; points: { x: number; y: number; z: number }[] }[];
  settlements: { id: string; bounds: { x0: number; z0: number; x1: number; z1: number } }[];
  dressingExclusions: { bounds: { x0: number; z0: number; x1: number; z1: number } }[];
  decoration: { classification: string; seed: number; collision: boolean; gameplay: boolean };
  structures?: { runs: number[]; trees?: { x: number; y: number; z: number; height: number; species: 'oak' | 'pine'; variant: number; yaw: number }[] };
}
export interface ResourceProjection { id: string; kind: string; pos: Vec3; state: string; remaining: number; growthStage?: 'felled' | 'sapling' | 'young' | 'mature'; capacity?: number; unit?: string; forage?: unknown; physicallyAvailable?: boolean }
export interface ItemProjection { id: string; type: string; pos: Vec3; quantity: number }
export interface ContainerProjection { id: string; name: string; pos: Vec3; open: boolean; capacity: number; used: number }
export interface DoorProjection { id: string; pos: Vec3; open: boolean; yaw: number }
export interface DynamicsProjection {
  resources: ResourceProjection[]; wildlife: WildlifeFrame; items: ItemProjection[]; containers: ContainerProjection[];
  crops: { id: string; pos: Vec3; state: string; growth: number }[];
  mechanisms: { id: string; pos: Vec3; parts: number; condition: number; state: string; operatedSeconds: number }[];
  construction: { id: string; bounds: unknown; pos: Vec3; state: string; progress: number }[];
  fires: { id: string; pos: Vec3; lit: boolean; intensity: number }[];
  doors: DoorProjection[];
  environment: { kind: string; intensity: number; nextChangeAt: number; wind: number };
  worldTime: number;
}
export interface VistaProjection { center: string; origin: { x: number; z: number }; stride: number; side: number; heights: string; forest: string; surface: string; settlements: { id: string; bounds: { x0: number; z0: number; x1: number; z1: number } }[] }
export interface PresentationPayload { regions: RegionProjection[]; dynamicRegion?: string; dynamic?: DynamicsProjection; vista?: VistaProjection }

export interface WildlifeBody {
  bodyId: string; creatureId: string; speciesId: string; regionId: string | null;
  bodyPlan: { id: string; shape: string; heightM: number; radiusM: number };
  pos: Vec3; yaw: number; vel: Vec3; scale: number; ageClass: 'juvenile' | 'adult'; condition: number;
  alive: boolean; dead: boolean; present: boolean;
  activity: 'idle' | 'walk' | 'forage' | 'eat' | 'drink' | 'rest' | 'sleep' | 'flee' | 'dead';
  defense: 'warn' | 'charge' | 'strike' | 'recover' | 'retreat' | null; defenseAtViewer: boolean;
}
export interface WildlifeFrame { version: 1; scope: 'observed'; complete: true; bodies: WildlifeBody[] }

export interface AppearanceDescription {
  archetype: string; culture: string; presentation: 'feminine' | 'masculine' | 'androgynous';
  skinTone: string; faceShape: string; hairStyle: string; hairColor: string; eyeColor: string; frame: string; stature: string;
  garmentSilhouette: string; garmentPalette: string; accessories: string[]; culturalTags: string[];
  grooming: number; wear: number; status: string; agePresentation: string; roleCues: string[];
}
export interface ProjectedAppearance {
  skin: number; hair: number; shirt: number; pants: number; apron?: number; hat?: number; hatStyle?: string; height?: number; build?: number; beard?: number;
  description?: AppearanceDescription;
}
export interface ActivityPresentation {
  speed: number; placeId: string | null; facingEntityId: string | null; targetPos: Vec3 | null; carried: unknown;
  injury: { impaired: boolean; severity: number; movementMultiplier: number };
  family: string; detail: string; posture: 'stand' | 'sit' | 'lie' | string; locomotion: string; station: unknown;
  /** What the canonical state was derived from (pose, action, goal). */
  evidence?: { pose?: string | null; action?: string | null; goal?: string | null };
}
export interface CombatActionState {
  id: string; commandId?: string; actorBodyId: string; kind: string; definition: string; techniqueId?: string; techniqueName?: string;
  trajectory: 'high' | 'mid' | 'low'; variant?: string; moveId?: string; startedAt: number; activeAt: number; recoveryAt: number; completeAt: number;
  phase: 'requested' | 'accepted' | 'preparation' | 'active' | 'recovery' | 'complete' | 'interrupted' | string; outcome: string;
  facing: number; direction: Vec3; distance: number; reach: number; radius: number; duck: number;
  contact: { bodyId: string; region: string; position: Vec3; at: number; eventId: string; decidedAtMs?: number } | null;
  pos?: Vec3; vel?: Vec3; yaw?: number;
}
export interface BodyState {
  bodyId: string; entityId: string; name: string; pos: Vec3; velocity: Vec3; yaw: number; crouch?: number;
  pose: string; activity: string; speed: number; attackSeq: number; hitSeq: number; lastAttackAt: number; lastHitAt: number;
  dead: boolean; incapacitated: boolean; alive?: boolean; appearance?: ProjectedAppearance;
  combatAction: CombatActionState | null; guarding: boolean; speech: string;
  embodiment?: {
    appearanceSignature: string; appearance?: { description: AppearanceDescription; signature: string };
    activity: ActivityPresentation; station: { stand: Vec3; yaw: number; posture: string; kind: string } | null;
    conversation: { stand: Vec3; yaw: number } | null; separation: { x: number; z: number };
  } | null;
  presentationSex?: 'm'|'f';
  equipment?: {id:string;catalogId?:string;type:string;slot:import('../../sim/physical/equipment').EquipmentSlot}[];
  inventory?: { id: string; name: string; type: string; quantity: number }[];
  health?: number; maxHealth?: number; needs?: Record<string, number>; wealth?: number;
}
export interface InteractionTarget { actionId: string; targetId: string; kind: string; label: string; title?: string; verb?: string; reason?: string; pos: Vec3 }
/** Row shapes the server projects; taken from its own definitions so a renamed or missing field is a compile error here, not a blank label in a menu. Type-only, so nothing is bundled. */
import type { CarriedItemRow, PlayerActionRow } from '../../bridge/playerActions';
import type { HandInteraction as ServerHandInteraction } from '../../sim/physical/hand';
export type CarriedRow = CarriedItemRow;
export type ActionRow = PlayerActionRow;
export type HandInteraction = ServerHandInteraction;
export interface DialogueProjection { revision: number; speakerId: string; speakerBodyId: string | null; name: string; lines: string[]; options: { id: string; label: string }[] }
export interface KnownPerson { entityId: string; name: string; knownName: boolean; recognition: string; bodyId: string; pos: Vec3 }
export interface SnapshotMessage {
  type: 'snapshot'; tick: number; worldTime: number; ack: number; playerId: string; controlledBodyId: string;
  wildlife: WildlifeFrame; knowledge: { avatarId: string; people: KnownPerson[]; [k: string]: unknown };
  mechanisms: unknown; interactions: HandInteraction[]; mobility: { eligible: boolean; fatigue: number; speedMultiplier: number; knownLoadKg: number; unweighedStacks: number; safeCarryKg: number; restriction: string } | null;
  container: unknown; dialogue: DialogueProjection | null; talkTargets: { bodyId: string; entityId: string; name: string; distance: number }[];
  talkRefusals: { bodyId: string; entityId: string; name: string; distance: number; reason: string }[];
  carried: CarriedRow[]; abilities: ActionRow[]; work: unknown; journal: JournalProjection;
  interactionTargets: InteractionTarget[]; bodies: BodyState[]; combatActions: CombatActionState[];
  combatPresentation: { version: number; firstAvailableSeq: number; latestSeq: number; events: CombatPresentationEvent[] }; events: unknown[];
}
export interface CombatPresentationEvent { seq: number; kind: string; [k: string]: unknown }
export interface JournalProjection {
  commitments: unknown[]; obligations: unknown[]; injuries: unknown[]; skills: unknown[];
  condition: { fatigue: number; energy: number; hydration: number; sleepDebt: number }; stage: string;
  foundations: { id: string; value: number; progress: number }[]; techniques: unknown[]; techniqueHistory: unknown[]; practice: unknown[];
  practiceHoursRequired: number; veil: unknown; advancement: { eligible: boolean; path: string | null; remaining: string[] } & Record<string, unknown>;
  [k: string]: unknown;
}
export interface MovementState { pos: Vec3; yaw: number; speed: number; eligible: boolean; crouch?: number }
export interface LocalStateMessage {
  type: 'local_state'; epoch: string; controllerId: string; bodyId: string; ack: number; tick: number; interactionTick: number; serverTimeMs: number;
  state: MovementState; combatAction: CombatActionState | null; bufferedCombatCommandId: string | null; crouchHeld: boolean; practice: unknown;
  geometry?: { revision: string; x: number; z: number; size: number; columns: { floor: number; walkable: boolean; solids: number[] }[] };
}
export interface CombatFrameMessage { type: 'combat_frame'; tick: number; serverTimeMs: number; actions: CombatActionState[] }
export interface CommandReceiptMessage {
  type: 'command_receipt'; commandId: string; sequence: number; epoch: string; status: 'received' | 'applied' | 'rejected' | 'cancelled';
  result: string; tick: number; receivedAtMs: number; serverTimeMs: number; clientTimeMs: number;
}
export interface ResultMessage { type: 'result'; sequence: number; result: string; generation?: number; savedAtIso?: string; speech?: string; fallback?: boolean }
export interface MaintenanceMessage { type: 'maintenance'; message: string; atMs: number; inMs: number }

export type InteractionCommand =
  | { type: 'move'; x: number; z: number; sprint: boolean; facing?: number; crouch?: boolean }
  | { type: 'attack'; targetBodyId?: string; trajectory?: 'high' | 'mid' | 'low'; weight?: 'light' | 'heavy' }
  | { type: 'interact'; interactionId: string }
  | { type: 'container_transfer'; containerId: string; itemId: string; direction: 'into' | 'out' }
  | { type: 'defend'; kind: 'sidestep' | 'backstep' | 'duck'; side?: -1 | 1; direction?: { x: number; z: number } }
  | { type: 'crouch' | 'guard'; held: boolean }
  | { type: 'practice'; mode: 'passive' | 'repeat' | 'reset' | 'recovery' | 'normal' }
  | { type: 'cancel' };

/** Close codes the server uses (src/server/protocol.ts CLOSE). */
export const CLOSE = { superseded: 4000, authFailed: 4001, forbidden: 4003, characterUnavailable: 4009, incompatible: 4010, full: 4029, maintenance: 4503, noCharacter: 4404 } as const;
