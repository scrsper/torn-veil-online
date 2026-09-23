/**
 * Living Alpha network contract, shared by the live server, probes and (mirrored in C++) the
 * Unreal client. Bump ALPHA_PROTOCOL whenever a client built for the old value could misread
 * or mis-send something; the server then refuses that client with an explicit close reason.
 */
export const ALPHA_PROTOCOL = 1;

/** Upgrade headers. A browser page cannot set custom WebSocket headers, so requiring them also
 * keeps web pages from driving a character. Tokens travel inside the Tailscale/WireGuard tunnel
 * or loopback only; the server never listens on a public interface. */
export const H = {
  client: 'x-torn-veil-client',
  protocol: 'x-torn-veil-alpha-protocol',
  region: 'x-torn-veil-region-protocol',
  interaction: 'x-torn-veil-interaction-protocol',
  account: 'x-torn-veil-account',
  token: 'x-torn-veil-token',
  character: 'x-torn-veil-character',
  characterName: 'x-torn-veil-character-name',
  characterSex: 'x-torn-veil-character-sex',
} as const;

/** WebSocket close codes (4000–4999 are application-defined). Reasons are human readable and
 * shown verbatim by the client's connection screen. */
export const CLOSE = {
  superseded: 4000,
  authFailed: 4001,
  forbidden: 4003,
  characterUnavailable: 4009,
  incompatible: 4010,
  full: 4029,
  maintenance: 4503,
  noCharacter: 4404,
} as const;

export type CharacterRequest = { kind: 'auto' } | { kind: 'existing'; personId: string } | { kind: 'new'; name: string; sex: 'f' | 'm' };

const NAME = /^[A-Za-z][A-Za-z '-]{1,30}[A-Za-z]$/;
export function parseCharacterRequest(character: unknown, name: unknown, sex: unknown): CharacterRequest | null {
  const c = typeof character === 'string' ? character.trim() : '';
  if (!c || c === 'auto') return { kind: 'auto' };
  if (c === 'new') {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!NAME.test(n)) return null;
    return { kind: 'new', name: n, sex: sex === 'm' ? 'm' : 'f' };
  }
  return /^p_[0-9]{1,9}$/.test(c) ? { kind: 'existing', personId: c } : null;
}
