import {MOVESETS,WEAPONS,RELAXED,DODGES} from './combat';
/** The canonical client/editor need a bounded subset; Tower retains its full repertoire. */
export const SHARED_MOTION_NAMES=new Set([
 ...[MOVESETS.fists,MOVESETS.sword].flatMap(s=>[s.idle,s.walk,s.run,s.guard,...s.hit,...s.death]),
 WEAPONS.fists.combo[0].clip,WEAPONS.fists.combo[1].clip,WEAPONS.axe.combo[0].clip,
 RELAXED.idle,RELAXED.walk,RELAXED.run,'Lie_StandUp',
 'unarmed/side_kick','unarmed/roundhouse_right','unarmed/slip_left',
 'unarmed/walk_backward','unarmed/walk_strafe_left','unarmed/walk_strafe_right',
 'sword_and_shield/sword and shield slash','sword_and_shield/sword and shield slash (2)',
 ...Object.values(DODGES),
]);
