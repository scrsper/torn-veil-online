import {MOVESETS,WEAPONS} from './combat';
/** The canonical client/editor need a bounded subset; Tower retains its full repertoire. */
export const SHARED_MOTION_NAMES=new Set([
 ...[MOVESETS.fists,MOVESETS.sword].flatMap(s=>[s.idle,s.walk,s.run,s.guard,...s.hit,...s.death]),
 WEAPONS.fists.combo[0].clip,WEAPONS.fists.combo[1].clip,WEAPONS.axe.combo[0].clip,
]);
