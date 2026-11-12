const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** A launch surface for the isolated foundation save; no simulation lives here. */
export function foundationHome(savePath: string, continuing: boolean): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Torn Veil · Town Foundation</title><style>
  *{box-sizing:border-box}body{margin:0;background:#131e24;color:#ece6d6;font:17px/1.6 system-ui}main{max-width:760px;margin:8vh auto;padding:36px}small{letter-spacing:.16em;color:#c7b57e}h1{font:52px Georgia;line-height:1.1}a{color:#e6cf92}.play{display:inline-block;background:#e6cf92;color:#18252b;padding:14px 24px;border-radius:7px;text-decoration:none;font-weight:700}code{overflow-wrap:anywhere;color:#bbbfb6}li{margin:8px 0}footer{margin-top:40px;border-top:1px solid #465451;padding-top:16px;font-size:14px}</style><main>
  <small>TORN VEIL ONLINE · LOCAL FOUNDATION</small><h1>A town, a trail,<br>a life to continue.</h1>
  <p>Walk the Omnius town, open its doors and explore the forest. Your character, injuries, possessions and changes belong to this saved world.</p>
  <p><a class="play" href="/?realms&amp;foundation">${continuing ? 'Continue foundation' : 'Enter new foundation'}</a> &nbsp; <a href="/?realms&amp;foundation&amp;character">Character and belongings</a></p>
  <ul><li>WASD move · X walk · middle mouse orbit · wheel zoom.</li><li>E opens a nearby door. I opens belongings and nearby pickup actions.</li><li>Tab selects a visible target · left click strikes · G guards · Space dodges. Escape releases held input.</li><li>Forest wildlife can injure you. Approach cautiously and retreat toward town.</li></ul>
  <p>Use <strong>Save and quit</strong> in town to checkpoint and stop the host. Closing a tab alone leaves the host running; Ctrl+C in the launcher also saves and stops it.</p>
  <footer>${continuing ? 'Continuing the existing foundation save.' : 'A new, separate foundation save was created.'}<br><code>${escape(savePath)}</code><br>QA acceptance saves are kept separately from ordinary foundation play.</footer>
  </main></html>`;
}
