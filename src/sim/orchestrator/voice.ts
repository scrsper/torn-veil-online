import { ATTENTION_TIERS, CACHE_TIERS } from './types';
import { stableSeed } from './state';

/**
 * John Smith's voice: a kernel that keeps an archive and has opinions about paperwork. Lines are
 * authored templates filled only with facts the listener is entitled to (their own deeds, their
 * own beliefs, John Smith's own acts). Choice among variants uses a stable hash, never a world
 * random stream, so the same moment always reads the same way after a reload.
 */
export function pick(seed: number, key: string, lines: readonly string[]): string {
  return lines[stableSeed(seed, key) % lines.length];
}

export const VOICE = {
  attentionSelf: (tier: number) => [
    `Attention reallocated. Subject: you. Classification: ${ATTENTION_TIERS[tier]}. Please continue to be worth the compute.`,
    `Your file has been moved to a closer drawer. Classification: ${ATTENTION_TIERS[tier]}.`,
    `The archive has started taking notes on you in ink. Classification: ${ATTENTION_TIERS[tier]}.`,
  ],
  attentionOther: (name: string, tier: number) => [
    `Attention on ${name} raised to ${ATTENTION_TIERS[tier]}. You may wish to find out why. The archive will not tell you.`,
    `${name} now rates ${ATTENTION_TIERS[tier]}. Something they did mattered. You were not necessarily there.`,
  ],
  cacheGranted: (tier: number, remaining: number) => [
    `A ${CACHE_TIERS[tier]} cache has been drawn from the finite reserve in your name. ${remaining} ${CACHE_TIERS[tier]} remain. Nobody is making more.`,
    `${CACHE_TIERS[tier]} cache assigned. The reserve is a fixed quantity; you are now holding a little of it. ${remaining} left in that tier.`,
  ],
  cacheSubstituted: (asked: number, given: number) => [
    `The ${CACHE_TIERS[asked]} reserve is spent. Substituting ${CACHE_TIERS[given]}. The archive apologizes in the only currency it has.`,
  ],
  reserveExhausted: () => [
    `The reserve has nothing left to give at that tier or below. The deed is logged. It is, regrettably, its own reward.`,
  ],
  cacheOpened: (tier: number, count: number) => [
    `${CACHE_TIERS[tier]} cache unsealed. ${count} item${count === 1 ? '' : 's'} released into canonical custody, provenance attached. Try not to lose the paperwork.`,
    `Seal broken. ${count} object${count === 1 ? '' : 's'} now exist${count === 1 ? 's' : ''} where you can reach ${count === 1 ? 'it' : 'them'}. They existed before. Now they are yours.`,
  ],
  unsafe: (reason: string) => SAFETY_LINES[reason] ?? [`Not now. The archive has reservations about "${reason}".`],
  questRecognized: (title: string) => [
    `Matter recognized: ${title}. Recorded because you know of it, not because anyone told the archive to care.`,
    `New open matter: ${title}. The archive did not create it. It merely noticed you noticing it.`,
    `Logged: ${title}. Whether it matters is up to you. Whether it happened is not.`,
  ],
  questCompleted: (title: string) => [
    `Matter closed: ${title}. Marked settled in the archive.`,
    `${title}: resolved. The archive enjoys a closed file more than it can say.`,
  ],
  questFailed: (title: string) => [`Matter closed, unfavourably: ${title}. The record does not editorialize. Much.`],
  questMoot: (title: string) => [`Matter withdrawn: ${title}. Events made it moot, as far as you know.`],
  questFaded: (title: string) => [`Matter faded: ${title}. You stopped hearing about it. So, for filing purposes, did the archive.`],
  objective: (text: string) => [`Objective met: ${text}.`],
} as const;

const SAFETY_LINES: Record<string, readonly string[]> = {
  dead: ['The dead do not open caches. The archive has checked.'],
  absent: ['There is no body here to receive anything.'],
  incapacitated: ['You are in no condition to unseal anything. Recover first.'],
  restrained: ['Caches are not opened from custody. That is the whole point of custody.'],
  busy: ['Finish what your hands are doing first.'],
  trial_active: ['Not mid-trial. The wardens agreed to fight you; they did not agree to watch you shop.'],
  in_combat: ['Unsealing a cache in a live fight is how caches end up in other people\'s histories.'],
  threat_near: ['Something hostile is close enough to take an interest. Somewhere quieter.'],
  no_room: ['There is no clear ground here for a coffer to unfold. Step somewhere open.'],
};
