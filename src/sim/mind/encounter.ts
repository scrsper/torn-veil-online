import type { Appearance, Body, EntityId, Person, Pose } from '../core/types';
import type { World } from '../core/world';
import { learn } from './knowledge';
import { remember } from './memory';
import { agePresentationFor } from '../core/appearance';

export interface ObservedPerson { subjectId: EntityId; bodyId: EntityId; how: 'saw' | 'heard'; distance?: number; observerBodyId?: EntityId; }
export type RecognitionLevel = 'unknown' | 'familiar' | 'recognized' | 'identified';
export interface EncounterCues { bodyId: EntityId; shape: Body['shape']; appearance: { skin: number; hair: number; shirt: number; pants: number; hat?: number; hatStyle?: Appearance['hatStyle']; height: number; build: number; beard?: number; apron?: number; description?: Record<string, unknown> }; activity: Pose; placeId?: EntityId; ageBand?: string; pos?: { x: number; y: number; z: number }; at?: number; }
export interface RecognitionResult { subjectId: EntityId; bodyId: EntityId; level: RecognitionLevel; cues: EncounterCues; identityMatched: boolean; }
const keyFor = (subject: EntityId, body: EntityId) => `encounter:${subject}:${body}`;
const MIN_REENCOUNTER_SECONDS = 60;

export function appearanceSignature(cues: EncounterCues): string {
  // Coarse physical cues, not an ID hash or exact generated numeric fingerprint.
  const a = cues.appearance, d = a.description;
  return JSON.stringify(d ? [d.skinTone, d.hairColor, d.hairStyle, d.faceShape, d.frame, d.stature]
    : [a.skin, a.hair, a.beard ?? 0, Math.round(a.height * 4), Math.round(a.build * 4)]);
}
export function visibleCues(world: World, body: Body): EncounterCues {
  const a = world.person(body.ownerId)?.appearance; const d = a?.description;
  return { bodyId: body.id, shape: body.shape, appearance: { skin: a?.skin ?? 0, hair: a?.hair ?? 0, shirt: a?.shirt ?? 0, pants: a?.pants ?? 0, ...(a?.hat === undefined ? {} : { hat: a.hat }), ...(a?.hatStyle === undefined ? {} : { hatStyle: a.hatStyle }), height: a?.height ?? 1, build: a?.build ?? 1, ...(a?.beard === undefined ? {} : { beard: a.beard }), ...(a?.apron === undefined ? {} : { apron: a.apron }), ...(d ? { description: { presentation: d.presentation, skinTone: d.skinTone, faceShape: d.faceShape, hairStyle: d.hairStyle, hairColor: d.hairColor, eyeColor: d.eyeColor, frame: d.frame, stature: d.stature, garmentSilhouette: d.garmentSilhouette, garmentPalette: d.garmentPalette, accessories: [...d.accessories] } } : {}) }, activity: body.pose, placeId: world.placeAt(body.pos)?.id };
}
export function observableSignature(world: World, body: Body): string { return appearanceSignature(visibleCues(world, body)); }
export function anchorIdentityToObservation(observer: Person, subject: EntityId, signature: string): void { const item = observer.knowledge[`identity:${subject}`]; if (!item?.claim.identity) return; const prior = Array.isArray(item.claim.identity.signatures) ? item.claim.identity.signatures : []; item.claim.identity.signatures = [...new Set([...prior, signature])].slice(-8); }
/** Copy only appearance evidence already held by another mind; never resolve a signature from
 * canonical target state during testimony. The recipient must already hold the identity claim. */
export function shareIdentityObservation(from: Person, to: Person, subject: EntityId): void {
  const signatures = from.knowledge[`identity:${subject}`]?.claim.identity?.signatures;
  if (Array.isArray(signatures)) for (const signature of signatures) anchorIdentityToObservation(to, subject, signature);
}

export function readRecognition(observer: Person, subject: EntityId, bodyId: EntityId, signature: string): RecognitionLevel {
  const item = observer.knowledge[keyFor(subject, bodyId)]; if (!item?.claim.encounter) return 'unknown';
  const observations = item.claim.observations ?? [], identity = observer.knowledge[`identity:${subject}`]?.claim.identity;
  if (identity?.signatures?.includes(signature)) return 'identified';
  const matches = observations.filter((o: { signature: string }) => o.signature === signature).length;
  if (matches >= 3) return 'recognized';
  if (matches >= 2) return 'familiar';
  return 'unknown';
}

export function recognizeEncounter(world: World, observer: Person, observed: ObservedPerson, sensed = false): RecognitionResult | null {
  if (observed.how !== 'saw' || observed.subjectId === observer.id) return null;
  const target = world.person(observed.subjectId), tb = world.body(observed.bodyId), ob = observed.observerBodyId ? world.body(observed.observerBodyId) : world.primaryBody(observer.id);
  if (!target || !observer.alive || !tb?.present || tb.ownerId !== target.id || !ob?.present || ob.ownerId !== observer.id || ob.dead || ob.health <= 0 || ['sleep', 'downed'].includes(ob.pose)) return null;
  const retained = observer.knowledge[keyFor(target.id, tb.id)];
  // Physical sensing already established visibility. Attention to appearance need not rebuild
  // a description at 5 Hz; keep presence fresh and sample it at the cognitive cadence.
  if (sensed && retained && world.physicalTime - (retained.claim.lastPhysicalSampleAt ?? -Infinity) < (observer.cognitiveLOD === 'lightweight' ? 3 : 1)) {
    retained.claim.lastSeenAt = world.now;
    return null;
  }
  const eye = { x: ob.pos.x, y: ob.pos.y + 1.5, z: ob.pos.z }, d = Math.hypot(tb.pos.x - eye.x, tb.pos.z - eye.z);
  if (!sensed) {
    const h = world.clock.hourF, light = h > 6 && h < 19 ? 1 : h > 5 && h < 20 ? 0.6 : 0.3;
    const range = (world.weather.kind === 'fog' ? 14 : 28) * (0.5 + light * 0.5);
    const dot = ((tb.pos.x - ob.pos.x) * -Math.sin(ob.yaw) + (tb.pos.z - ob.pos.z) * -Math.cos(ob.yaw)) / (d + 1e-5);
    if (d > range || d >= 2.5 && dot <= -0.1 || !world.grid.lineOfSight(eye, { x: tb.pos.x, y: tb.pos.y + 1.2, z: tb.pos.z }, 32)) return null;
  }
  const cues = visibleCues(world, tb), signature = appearanceSignature(cues), item = observer.knowledge[keyFor(target.id, tb.id)];
  Object.assign(cues, { pos: { ...tb.pos }, at: world.now, ageBand: agePresentationFor(target.age) });
  const old = item?.claim.observations ?? [], last = old.at(-1);
  // Once a face is familiar, routine departures from the view cone are not fresh episodes.
  // Keep live cues current, but retain unchanged re-encounters at most once per world hour.
  const interval = old.length >= 3 ? 3600 : observer.cognitiveLOD === 'lightweight' ? 300 : MIN_REENCOUNTER_SECONDS;
  const gated = !last || signature !== last.signature || world.now - last.at >= interval && (old.length < 3 || world.now - (item?.claim.lastSeenAt ?? 0) >= 30);
  const identity = observer.knowledge[`identity:${target.id}`]?.claim.identity, identityMatched = !!identity?.signatures?.includes(signature);
  if (gated) {
    const event = world.emit('perceived', { actor: observer.id, target: target.id, category: 'cognition', significance: 0.18,
      data: { how: 'saw', observation: structuredClone(cues), encounter: true }, summary: 'A person retained an encounter' });
    const observations = [...old, { at: world.now, signature, event: event.id }].slice(-8);
    const claim = { encounter: true, subjectId: target.id, bodyId: tb.id, cues, observations, lastSeenAt: world.now, lastSampleAt: world.now, lastPhysicalSampleAt: world.physicalTime, significance: 0.18 };
    const confidence = Math.min(0.85, 0.5 + observations.filter((o: { signature: string }) => o.signature === signature).length * 0.1);
    const source = { type: 'witnessed' as const, viaEvent: event.id };
    const learned = learn(world, observer, { key: keyFor(target.id, tb.id), kind: 'fact', claim, confidence, source }, true) ?? item;
    if (learned) Object.assign(learned, { claim, confidence, source, learnedAt: world.now, sharedWith: [] });
    remember(world, observer, { type: 'encounter', summary: identityMatched ? 'I recognized a person I had been introduced to' : 'I encountered a person',
      eventId: event.id, entities: [target.id], source, significance: identityMatched ? 0.3 : 0.18 }, true);
  } else if (item) {
    item.claim.lastSeenAt = world.now;
    item.claim.lastSampleAt = world.now;
    item.claim.lastPhysicalSampleAt = world.physicalTime;
    item.claim.cues = cues;
  }
  return { subjectId: target.id, bodyId: tb.id, level: identityMatched ? 'identified' : readRecognition(observer, target.id, tb.id, signature), cues, identityMatched };
}
