/** One launch surface. The live Observatory uses the owning realm host's World;
 * isolated experiments retain their own explicit historical entry points. */
const shell = (title: string, body: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Torn Veil</title><style>
*{box-sizing:border-box}body{margin:0;background:#111820;color:#ebe7dd;font:16px/1.6 system-ui}main{max-width:1000px;margin:auto;padding:32px 24px}h1{font:42px Georgia;margin:12px 0}h2{font:24px Georgia}small{color:#bcb8ab}a{color:#ded3a3}nav,.cards{display:flex;gap:12px;flex-wrap:wrap}nav a,.card{border:1px solid #626661;border-radius:8px;padding:12px 18px;background:#202b33}nav a{text-decoration:none}.card{flex:1;min-width:220px}.card a{font-size:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#17212a;padding:16px;border-radius:8px;font:13px/1.5 ui-monospace,monospace}button,select{font:inherit;background:#263845;color:#eee;border:1px solid #88938d;border-radius:5px;padding:6px 10px}details{margin:14px 0}#error{color:#ffc79b}ol{padding-left:22px}</style><main><small>TORN VEIL ONLINE</small><nav><a href="/">Home</a><a href="/?realms">Play</a><a href="/?realms&amp;character">Character</a><a href="/?realms&amp;destination=tower">Tower</a><a href="/observatory">Observatory</a><a href="/history">History</a></nav>${body}</main></html>`;

export function launchHome(path: string) {
  if(path==='/history')return shell('History',`<h1>Historical iterations</h1><p>Current play and the Observatory use the same persistent world. These earlier experiments have independent simulation state and are retained for comparison.</p><ul><li>Isometric canvas prototype — Play Torn Veil Isometric.cmd</li><li>Combat arena and camera experiments — their named .cmd launchers</li><li>Disposable Observatory scenarios — npm run observatory</li><li>Unreal project and authored assets — retained in the repository</li></ul><p>Changing a historical experiment does not advance your current character. To inspect your journey, use the current Observatory.</p>`);
  if(path==='/observatory')return shell('Observatory',`<h1>World Observatory</h1><p>Live inspection of the persistent world used by Play and the Tower.</p><p id="identity">Connecting…</p><p id="error"></p><label>Inspect person <select id="person"></select></label> <button id="refresh">Refresh</button><div id="view"></div><script type="module" src="/observatory-live.js"></script>`);
  return shell('Home',`<h1>Across the Veil</h1><p>Travel between Aether Reach and Cinderveil. Enter Chrysanthus with the same identity, injuries, possessions and earned development.</p><p id="identity">Checking current world…</p><p id="error"></p><div class="cards"><article class="card"><a href="/?realms">Continue journey</a><p>Explore the connected realms in third person.</p></article><article class="card"><a href="/?realms&amp;destination=tower">Visit the Tower</a><p>Walk to the entrance and resume your canonical trial.</p></article><article class="card"><a href="/observatory">Inspect the world</a><p>Read events, causal evidence and character development from this save.</p></article></div><p><a href="/?realms&amp;character">Character and belongings</a> · <a href="/history">Historical experiments</a></p><script type="module" src="/observatory-live.js"></script>`);
}

export const liveObservatoryScript = `
const el=id=>document.getElementById(id),json=v=>JSON.stringify(v,null,2);
async function load(){try{
 const id=el('person')?.value??'',r=await fetch('/realms/inspection?person='+encodeURIComponent(id));if(!r.ok)throw Error('World inspection unavailable');const s=await r.json();
 el('identity').textContent='Current '+s.build.commit.slice(0,12)+' · '+s.build.clientMode+' · persistent world '+s.world.seed+' · '+s.world.personId+' / '+s.world.bodyId+' · '+(s.ready?'ready':'paused');el('error').textContent='';
 const view=el('view');if(!view)return;
 const select=el('person');if(!select.options.length){for(const p of s.people){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' ('+p.id+')';select.append(o);}select.value=s.person.id;}
 view.replaceChildren();function detail(title,value,open=false){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');d.open=open;summary.textContent=title;pre.textContent=json(value);d.append(summary,pre);view.append(d);}
 detail('Identity, condition and canonical development',{overview:s.person.truth.overview,physiology:s.person.truth.physiology,progression:s.person.truth.progression,recognisedClass:s.recognisedClass,growth:s.growth},true);
 detail('Possessions and reversible equipment',s.person.truth.economy);
 detail('Mind, beliefs and remembered evidence',{mind:s.person.truth.mind,beliefs:s.person.beliefs,limits:s.person.beliefLimits,memories:s.person.memories});
 detail('Tower timing receipts',s.towerTiming);
 detail('John Smith: watch, quests and finite reserve (developer truth)',s.johnSmith);
 detail('Recent world events with stored causes',s.events);
 detail('Build, save and simulation identity',{build:s.build,save:s.save,world:s.world});
 }catch(e){el('error').textContent=String(e);}}
el('refresh')?.addEventListener('click',load);el('person')?.addEventListener('change',load);load();
`;
