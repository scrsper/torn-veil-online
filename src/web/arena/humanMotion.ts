import sources from '../presentation/motionSources.json';
export const UAL_SOURCE = sources.ual;
/** Only aliases with an actually corresponding authored source are mapped. */
export const UAL_CLIPS: Readonly<Record<string, string>> = {
  'unarmed/idle_neutral': 'Idle_Loop',
  'unarmed/walk_forward': 'Walk_Loop',
  'unarmed/run_jog': 'Jog_Fwd_Loop',
  'unarmed/run_sprint': 'Sprint_Loop',
};

/** Refuse an HTML fallback, changed revision, or unverified local replacement. */
export async function verifyHumanMotion(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== UAL_SOURCE.bytes) throw Error('CC0 motion size differs from the audited library');
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== UAL_SOURCE.sha256) throw Error('CC0 motion hash differs from the audited library');
}
