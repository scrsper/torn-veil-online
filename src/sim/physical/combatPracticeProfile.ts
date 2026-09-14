import type { World } from '../core/world';
/** Explicit test entitlement/profile, owned by this runtime world and never serialized.
 * This grants executable arena content, not knowledge or martial mastery. */
const profiles=new WeakMap<World,{bodies:Set<string>;recovery:boolean}>();
export function configureCombatPractice(w:World,bodies:string[],recovery:boolean):void {profiles.set(w,{bodies:new Set(bodies),recovery});}
export function arenaRepertoire(w:World,bodyId:string):boolean {return profiles.get(w)?.bodies.has(bodyId)??false;}
export function combatEffortScale(w:World,bodyId:string):number {const p=profiles.get(w);return p?.recovery&&p.bodies.has(bodyId) ? .4 : 1;}
