import type { Occupation, ScheduleEntry, Person, EntityId } from '../core/types';

/** Schedules are default rhythms of life, not scripts. The decision system weighs them against everything else. */
export function scheduleFor(p: Person, refs: { work: EntityId | null; home: EntityId | null; tavern: EntityId; square: EntityId; chapel: EntityId; stall?: EntionId | null; field?: EntityId | null; saw?: EntityId | null; shift?: string }): ScheduleEntry[] {
  const W = refs.work, H = refs.home, T = refs.tavern, S = refs.square, C = refs.chapel;
  const e = (start: number, end: number, activity: ScheduleEntry['activity'], placeId: EntityId | null | undefined, label: string): ScheduleEntry => ({ start, end, activity, placeId: placeId ?? undefined, label });
  switch (p.occupation) {
    case 'smith': case 'apprentice':
      return [e(21, 6, 'sleep', H, 'sleep'), e(6, 7, 'eat', H, 'breakfast'), e(7, 12, 'work', W, 'forge'), e(12, 13, 'eat', T, 'lunch at the tavern'), e(13, 18, 'work', W, 'forge'), e(18, 21, 'socialize', T, 'evening at the tavern')];
    case 'baker':
      return p.age < 25
        ? [e(21, 5, 'sleep', H, 'sleep'), e(5, 8, 'work', W, 'help at the ovens'), e(8, 12, 'work', refs.stall ?? W, 'sell bread at the market'), e(12, 13, 'eat', H, 'lunch'), e(13, 17, 'socialize', S, 'afternoon in the square'), e(17, 21, 'socialize', T, 'evening')]
        : [e(20, 4, 'sleep', H, 'sleep'), e(4, 12, 'work', W, 'bake'), e(12, 13, 'eat', H, 'lunch'), e(13, 17, 'work', W, 'bake'), e(17, 20, 'socialize', T, 'evening')];
    case 'innkeeper': return [e(23, 7, 'sleep', H, 'sleep'), e(7, 14, 'work', W, 'run the tavern'), e(14, 16, 'eat', H, 'rest'), e(16, 23, 'work', W, 'run the tavern')];
    case 'cook': return [e(22, 6, 'sleep', H, 'sleep'), e(6, 7, 'eat', H, 'breakfast'), e(7, 14, 'work', W, 'cook'), e(14, 16, 'socialize', S, 'market errands'), e(16, 22, 'work', W, 'cook')];
    case 'server': return [e(23, 8, 'sleep', H, 'sleep'), e(8, 11, 'work', W, 'clean the tavern'), e(11, 14, 'work', W, 'serve'), e(14, 17, 'socialize', S, 'afternoon off'), e(17, 23, 'work', W, 'serve')];
    case 'merchant': return [e(21, 7, 'sleep', H, 'sleep'), e(7, 8, 'eat', H, 'breakfast'), e(8, 12, 'work', W, 'mind the store'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'work', W, 'mind the store'), e(18, 21, 'socialize', p.traits.sociability > 0.5 ? T : H, 'evening')];
    case 'priest': return [e(21, 5, 'sleep', H, 'sleep'), e(5, 7, 'worship', C, 'morning prayer'), e(7, 8, 'worship', C, 'morning service'), e(8, 12, 'work', C, 'tend the chapel'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'socialize', S, 'visit the flock'), e(18, 19, 'worship', C, 'evening service'), e(19, 21, 'work', C, 'evening duties')];
    case 'acolyte': return [e(21, 5, 'sleep', H, 'sleep'), e(5, 8, 'worship', C, 'prayers'), e(8, 12, 'work', C, 'tend the chapel'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'work', C, 'tend the graves'), e(18, 19, 'worship', C, 'evening service'), e(19, 21, 'socialize', S, 'evening walk')];
    case 'captain': return [e(22, 6, 'sleep', H, 'sleep'), e(6, 7, 'eat', H, 'breakfast'), e(7, 12, 'patrol', null, 'patrol'), e(12, 13, 'eat', T, 'lunch'), e(13, 19, 'patrol', null, 'patrol'), e(19, 22, 'socialize', T, 'evening')];
    case 'guard':
      if (refs.shift === 'night') return [e(9, 17, 'sleep', H, 'sleep'), e(17, 18, 'eat', T, 'supper'), e(18, 24, 'patrol', null, 'night patrol'), e(0, 6, 'patrol', null, 'night patrol'), e(6, 9, 'socialize', T, 'off duty')];
      if (refs.shift === 'late') return [e(1, 9, 'sleep', H, 'sleep'), e(9, 10, 'eat', H, 'breakfast'), e(10, 16, 'guard_post', null, 'gate watch'), e(16, 17, 'eat', T, 'supper'), e(17, 22, 'patrol', null, 'patrol'), e(22, 1, 'socialize', T, 'off duty')];
      return [e(22, 5, 'sleep', H, 'sleep'), e(5, 6, 'eat', H, 'breakfast'), e(6, 14, 'guard_post', null, 'gate watch'), e(14, 15, 'eat', T, 'lunch'), e(15, 18, 'patrol', null, 'patrol'), e(18, 22, 'socialize', T, 'off duty')];
    case 'farmer':
      if (refs.stall) return [e(21, 5, 'sleep', H, 'sleep'), e(5, 6, 'eat', H, 'breakfast'), e(6, 8, 'work', refs.field ?? W, 'field work'), e(8, 12, 'work', refs.stall, 'sell at the market'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'work', refs.field ?? W, 'field work'), e(18, 21, 'socialize', p.traits.sociability > 0.5 ? T : H, 'evening')];
      return [e(20, 5, 'sleep', H, 'sleep'), e(5, 6, 'eat', H, 'breakfast'), e(6, 12, 'work', W, 'field work'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'work', W, 'field work'), e(18, 20, 'socialize', p.traits.sociability > 0.5 ? T : H, 'evening')];
    case 'miller': return [e(21, 6, 'sleep', H, 'sleep'), e(6, 7, 'eat', H, 'breakfast'), e(7, 12, 'work', W, 'mill grain'), e(12, 13, 'eat', H, 'lunch'), e(13, 17, 'work', W, 'mill grain'), e(17, 21, 'socialize', T, 'evening at the tavern')];
    case 'hunter': return [e(21, 4, 'sleep', H, 'sleep'), e(4, 13, 'work', W, 'hunt'), e(13, 16, 'work', refs.stall ?? S, 'sell game'), e(16, 19, 'socialize', T, 'evening'), e(19, 21, 'idle', H, 'mend gear')];
    case 'herbalist': return [e(20, 5, 'sleep', H, 'sleep'), e(5, 11, 'work', W, 'gather herbs'), e(11, 15, 'work', H, 'brew'), e(15, 18, 'socialize', S, 'visit the village'), e(18, 20, 'idle', H, 'evening')];
    case 'woodcutter': return [e(22, 6, 'sleep', H, 'sleep'), e(6, 7, 'eat', H, 'breakfast'), e(7, 13, 'work', W, 'cut timber'), e(13, 17, 'work', refs.saw ?? W, 'saw planks'), e(17, 22, 'drink', T, 'drink at the tavern')];
    case 'elder': return [e(21, 7, 'sleep', H, 'sleep'), e(7, 8, 'eat', H, 'breakfast'), e(8, 12, 'socialize', S, 'hold court in the square'), e(12, 14, 'eat', H, 'lunch and rest'), e(14, 18, 'socialize', T, 'afternoon at the tavern'), e(18, 19, 'worship', C, 'evening service'), e(19, 21, 'idle', H, 'evening')];
    case 'vagrant': return [e(2, 10, 'sleep', H, 'sleep it off'), e(10, 17, 'idle', S, 'beg in the square'), e(17, 2, 'drink', T, 'drink')];
    case 'child': return [e(20, 7, 'sleep', H, 'sleep'), e(7, 8, 'eat', H, 'breakfast'), e(8, 12, 'play', S, 'play'), e(12, 13, 'eat', H, 'lunch'), e(13, 18, 'play', S, 'play'), e(18, 20, 'idle', H, 'evening at home')];
    case 'bandit': return [e(23, 7, 'sleep', H, 'sleep'), e(7, 12, 'guard_post', W, 'watch the camp'), e(12, 13, 'eat', W, 'eat'), e(13, 19, 'guard_post', W, 'watch the camp'), e(19, 23, 'drink', W, 'drink by the fire')];
    default: return [e(22, 6, 'sleep', H, 'sleep'), e(6, 22, 'wander', null, 'wander')];
  }
}
type EntionId = EntityId;

export function currentScheduleEntry(p: Person, hourF: number): ScheduleEntry | null {
  for (const s of p.schedule) {
    if (s.start <= s.end) { if (hourF >= s.start && hourF < s.end) return s; }
    else if (hourF >= s.start || hourF < s.end) return s;
  }
  return null;
}
