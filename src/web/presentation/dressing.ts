import { RNG } from '../../sim/core/rng';
/** Independent cosmetic stream. Never consumes World.rng or creates entities/solids. */
export function facadeDressing(seed: number) {
 const rng = new RNG(seed).fork(0x44524553);
 return { studOffset: rng.range(3.6, 3.9), shelfHeights: [1.9, 2.6] as readonly number[] };
}
