import assert from 'node:assert/strict';
/**
 * Ordinary-control quality acceptance against an explicitly isolated saved host.
 * Requires TV_QUALITY_ISOLATED=1, TV_QUALITY_URL and TV_QUALITY_EXPECT_SAVE.
 * Optional TV_QUALITY_OUTPUT must be a NEW directory (existing evidence is never
 * overwritten). TV_QUALITY_MODE=restart also requires TV_QUALITY_BASELINE pointing
 * to a prior journey.json with a completed town return, after the parent has
 * stopped/restarted that exact host. TV_QUALITY_MODE=resume continues an interrupted
 * foreign approach using the original journey.json as its identity baseline.
 * This script never starts a host, edits a save, injects movement, or grants power.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import {createContactQA} from './presentation-contact-qa.mjs';
import {httpFailureEvidence,recoveredCrossingBackpressure} from './presentation-network-qa.mjs';
if (process.env.TV_QUALITY_ISOLATED !== '1' || !process.env.TV_QUALITY_URL || !process.env.TV_QUALITY_EXPECT_SAVE)
  throw Error('Require explicit isolated URL, expected save path, and TV_QUALITY_ISOLATED=1.');
const target = new URL(process.env.TV_QUALITY_URL), mode = process.env.TV_QUALITY_MODE ?? 'journey';
assert.ok(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port && target.port !== '7510');
assert.ok(!target.username && !target.password);
assert.ok(['journey', 'restart', 'resume','home-recovery'].includes(mode));
if (mode !== 'journey') assert.ok(process.env.TV_QUALITY_BASELINE, 'Restart/resume requires the prior journey.json');
const restartBaseline = mode !== 'journey' ? JSON.parse(await readFile(process.env.TV_QUALITY_BASELINE, 'utf8')) : null;
if (mode === 'restart') assert.ok(restartBaseline.endUniverse && restartBaseline.endTown?.ready,
  'Restart baseline must have completed the canonical return to a rendered town, even if a presentation check failed');
if (mode === 'resume'||mode==='home-recovery') assert.ok(restartBaseline.baseline, 'Resume requires the original identity and inventory baseline');
const health = await (await fetch(new URL('/realms/health', target))).json();
const key = p => resolve(p).replaceAll('\\', '/').toLowerCase();
assert.equal(key(health.savePath), key(process.env.TV_QUALITY_EXPECT_SAVE));
if (restartBaseline) assert.equal(key(restartBaseline.savePath), key(health.savePath), 'Restart must use the exact prior save');
assert.equal(health.ready, true); assert.equal(health.saveError, '');
const output = resolve(process.env.TV_QUALITY_OUTPUT ?? `.debug/presentation-quality-${mode}-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const report = { mode, started: new Date().toISOString(), savePath: health.savePath,
  note: 'Ordinary UI quality/recovery acceptance against a parent-created isolated capability fixture. No client capability grant, observer teleport, save edit or direct movement injection. This is not a progression-earned character claim.',
  checks: [], samples: [], details: [], errors: [], errorLocations: [], warnings: [], http: [], commands: {}, glbResponses: [], traces: [] };
const comparisonPath=process.env.TV_QUALITY_COMPARE??'docs/evidence/atlas-flight/final-run/journey.json';
const comparisonBaseline=JSON.parse(await readFile(comparisonPath,'utf8'));
const check = (ok, label) => { assert.ok(ok, label); report.checks.push(label); console.log('PASS ' + label); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
const watchdog = setTimeout(() => void browser.close(), mode === 'restart' ? 300000 : 660000);
const error = (message, location = '') => {
  // Shader diagnostics can print entire programs; preserve the actual compiler
  // reason and counts without storing megabytes of generated shader source.
  if (/BJS .*: (Uniforms:|Defines:|Attributes:|Vertex code:|Fragment code:|#version)/.test(message)) {
    report.shaderDiagnosticBlocks = (report.shaderDiagnosticBlocks ?? 0) + 1; return;
  }
  const detail = message.slice(0, 1200);
  if (report.errors.length < 25 && !report.errors.includes(detail)) {
    report.errors.push(detail); report.errorLocations.push({message:detail,path:location ? new URL(location,target).pathname : ''});
    console.log('BROWSER ERROR ' + detail.slice(0, 500));
  }
};
page.on('pageerror', e => error(e.message));
page.on('console', m => {
  if (m.type() === 'error') error(m.text(),m.location().url);
  if (m.type() === 'warning' && /missing|fallback|stand.in|unavailable|clip|motion|retarget/i.test(m.text()) && report.warnings.length < 25)
    report.warnings.push(m.text().slice(0, 1200));
});
page.on('response', async r => {
  const path = new URL(r.url()).pathname;
  if(r.status()===200&&path==='/realms/universe'&&r.request().method()==='GET')report.lastUniverseSuccessAt=Date.now();
  const optionalMotion = /\/arena\/(?:mixamo_clips|unarmed_clips)\.glb$/i.test(path);
  if (/\.glb$/i.test(path) && report.glbResponses.length < 80) {
    const contentType = r.headers()['content-type'] ?? '';
    report.glbResponses.push({ path, status: r.status(), contentType, optionalMotion });
    if (/html/i.test(contentType) && !optionalMotion) error(`Required GLB URL returned HTML: ${path}`);
  }
  if (r.status() < 400 || report.http.length >= 25) return;
  const entry = httpFailureEvidence(r,Date.now());
  report.http.push(entry);
  // Record host rejection reasons, never response bodies/session tokens.
  if (entry.path.startsWith('/realms/universe')) try { entry.reason = String((await r.json()).error ?? '').slice(0, 240); }
  catch(e){entry.bodyReadFailure={kind:e?.name??'Error',reason:'response-body-unavailable'};}
});
page.on('request', r => {
  if (r.method() !== 'POST') return;
  try {
    const data = r.postDataJSON(), type = data?.command?.type ?? data?.type;
    if (type) report.commands[type] = (report.commands[type] ?? 0) + 1;
  } catch {}
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imagePath = path => relative(output, resolve(path)).replaceAll('\\', '/');
const comparisonPage = async () => {
  const oldFolder = dirname(resolve(process.env.TV_QUALITY_COMPARE ?? 'docs/evidence/atlas-flight/final-run/journey.json'));
  const pairs = [
    ['01-town-preview','00-town-preview','Town preview'],
    ['02-ground-default','01-town-on-foot','Ground view'],
    ['08-vertical-ascent','02-personal-ascent','Personal ascent'],
    ['10-between-worlds','03-between-worlds','Between worlds'],
    ['13-other-world-ground','05-other-world-ground','Foreign ground'],
    ['15-returned-home','07-returned-home','Returned home'],
  ];
  const images = pairs.filter(([name]) => report.samples.some(s => s.name === name)).map(([after,legacy,title]) => {
    const before=comparisonBaseline.samples.some(s=>s.name===after)?after:legacy;
    return `<section><h2>${title}</h2><div class="pair"><figure><img src="${escape(imagePath(resolve(oldFolder,before+'.png')))}" alt="Prior ${title}"><figcaption>Prior normal-quality run</figcaption></figure><figure><img src="${after}.png" alt="Current ${title}"><figcaption>Current capture · ${after}</figcaption></figure></div></section>`;}).join('');
  const closeups = report.samples.filter(s => /ground-close|walking|hover-front|near-wall|moving-ascent|moving-flight|return-cruise-side|guard-|contact-/.test(s.name)).map(s =>
    `<figure><img src="${s.name}.png" alt="${escape(s.name)}"><figcaption>${escape(s.name)}</figcaption></figure>`).join('');
  const details = report.details.map(s => `<figure><img src="${s.name}.png" alt="${escape(s.name)}"><figcaption>${escape(s.name)} · native screenshot clip around ${s.actualSkinVertices?'actual skinned sole vertices':'actual joint positions'}</figcaption></figure>`).join('');
  const rows = report.samples.filter(s => s.metrics).map(s => `<tr><td>${escape(s.name)}</td><td>${s.metrics.p50.toFixed(1)} / ${s.metrics.p95.toFixed(1)}</td><td>${s.metrics.draws}</td><td>${escape(s.avatar?.motion?.source?.source)} / ${escape(s.avatar?.motion?.source?.sourceClip)}</td><td>${escape(s.avatar?.motion?.source?.retargetLook)}</td><td>${escape(s.avatar?.motion?.flight?.phase)}</td></tr>`).join('');
  const sources = [...new Set(report.samples.filter(s => s.avatar?.motion?.source).map(s => JSON.stringify(s.avatar.motion.source)))].map(s => `<li><code>${escape(s)}</code></li>`).join('');
  await writeFile(resolve(output, 'comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Torn Veil presentation comparison</title>
<style>body{max-width:1500px;margin:32px auto;padding:0 22px;background:#111820;color:#e9eef1;font:16px/1.55 system-ui}h1,h2{font-weight:550}.note{max-width:1050px;color:#bac9d2}.pair,.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0 0 20px}img{width:100%;height:auto;background:#05080b;border:1px solid #36454e}figcaption{color:#b8c7cf;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;border-bottom:1px solid #35454f;padding:9px}code{overflow-wrap:anywhere;font-size:12px}a{color:#a6d5ff}.status{color:#e1c891}@media(max-width:900px){.pair,.gallery{grid-template-columns:1fr}table{font-size:11px}}</style>
<h1>Torn Veil · presentation quality comparison</h1><p class="status">${report.failure ? 'Failed check: '+escape(report.failure) : report.finished ? 'Browser pass complete; separate checkpoint restart evidence is required.' : 'Run in progress; captures are added as they are recorded.'}</p>
<p class="note">Both runs use 1440×900 headed Chrome and normal presentation quality. World positions, camera framing, orbit, lighting and asset residency may differ; compare the recorded states before interpreting timing differences. No image manipulation: full captures and native screenshot clips only. All poses and viewpoints use ordinary input. This is an isolated capability fixture, not earned progression.</p>
<p><a href="journey.json">Read exact checks and observations</a> · ${report.checks.length} checks recorded · ${report.errors.length} raw browser console/runtime errors · ${report.http.filter(h=>!h.optionalMotion&&!h.recoveredBackpressure).length} unclassified or unrecovered HTTP failures · ${report.http.filter(h=>h.recoveredBackpressure).length} recovered save-busy responses</p>${images}
<h2>Character, motion and camera closeups</h2><div class="gallery">${closeups}${details}</div>
<h2>Frame samples and actual motion provenance</h2><p class="note">Each timing sample contains120 animation frames. A requested animation name alone is not evidence of its source. Verified source IDs, actual source clips, destination rigs and hashes appear below.</p><table><thead><tr><th>Capture</th><th>Frame p50 / p95 ms</th><th>Draws</th><th>Source / actual clip</th><th>Rig</th><th>Flight pose</th></tr></thead><tbody>${rows}</tbody></table><ul>${sources}</ul>
<h2>Limits</h2><p class="note">One machine, one generated system and one endowed character. The gallery does not certify every asset, body, seed, ability capacity or collision configuration. Optional private motion packs may be unavailable; their HTTP results and truthful fallbacks are recorded separately. Camera-frustum asset IDs do not prove unoccluded pixels. Lighting and mesh/rig observations still require visual review.</p></html>`);
};
const save = async () => { await writeFile(resolve(output, 'journey.json'), JSON.stringify(report, null, 2)); await comparisonPage(); };
const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
const read = () => page.evaluate(() => {
  const d = window.__tvUniverse, c = d?.campaign, s = c?.active ? d?.snapshot : d?.preview ?? d?.snapshot;
  return { state: s?.state, status: s?.status, system: s?.system, preview: d?.preview,
    revision: s?.revision, lastSeq: s?.lastSeq,
    campaign: c ? { active: c.active, personId: c.personId, bodyId: c.bodyId, name: c.name, health: c.health, inventory: c.inventory,
      canExplore: c.canExplore, canReturn: c.canReturn, flight: c.flight, message: c.message,
      footSupport:c.footSupport?{id:c.footSupport.id,available:c.footSupport.available,reason:c.footSupport.reason,origin:c.footSupport.origin,radius:c.footSupport.radius,triangles:c.footSupport.triangles.length}:null } : null,
    atlas: d?.atlas, avatar: d?.avatar, camera: d?.camera, lighting: d?.lighting, settlements: d?.settlements, terrain: d?.stats, vessel: d?.vessel,footSupport:d?.footSupport,
    phase: document.querySelector('[data-phase]')?.textContent, toast: document.querySelector('.astral-toast:not([hidden])')?.textContent };
});
const detailClips = async (name, view) => {
  const c = view.camera, landmarks = view.avatar?.landmarks;
  if (!c || !landmarks) return;
  const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
  const norm = a => {const n=Math.hypot(a.x,a.y,a.z);return{x:a.x/n,y:a.y/n,z:a.z/n};};
  const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
  const cross = (a,b) => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
  const forward=norm(sub(c.target,c.position)),right=norm(cross(forward,c.up)),up=cross(right,forward),focal=450/Math.tan(c.fov/2);
  const project=p=>{const delta=sub(p,c.position),z=dot(delta,forward);return z>.05?{x:720+dot(delta,right)/z*focal,y:450-dot(delta,up)/z*focal}:null;};
  for(const [label,names,padding] of [['hands',['hand_l','hand_r'],100],['feet',['foot_l','foot_r'],100],['head',['head'],130]]) {
    const points=names.map(n=>landmarks[n]).filter(Boolean).map(project).filter(Boolean);
    if(points.length!==names.length||points.some(p=>p.x<0||p.x>1440||p.y<0||p.y>900))continue;
    const x=Math.floor(Math.max(0,Math.min(...points.map(p=>p.x))-padding)),y=Math.floor(Math.max(0,Math.min(...points.map(p=>p.y))-padding));
    const x1=Math.ceil(Math.min(1440,Math.max(...points.map(p=>p.x))+padding)),y1=Math.ceil(Math.min(900,Math.max(...points.map(p=>p.y))+padding));
    const detailName=`${name}-${label}`,clip={x,y,width:x1-x,height:y1-y};
    await page.screenshot({path:resolve(output,detailName+'.png'),clip});
    report.details.push({name:detailName,sourceCapture:name,landmarks:names,clip});
  }
};
const projectedAvatar = view => {
  const c=view.camera,l=view.avatar?.landmarks;if(!c||!l)return null;
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const norm=a=>{const n=Math.hypot(a.x,a.y,a.z);return{x:a.x/n,y:a.y/n,z:a.z/n};};
  const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
  const forward=norm(sub(c.target,c.position)),right=norm(cross(forward,c.up)),up=cross(right,forward),focal=450/Math.tan(c.fov/2);
  const points=Object.entries(l).map(([name,p])=>{const d=sub(p,c.position),z=dot(d,forward);return{name,x:720+dot(d,right)/z*focal,y:450-dot(d,up)/z*focal,z};});
  const visible=points.filter(p=>p.z>.05&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  return {kind:'projected-rig-landmarks-not-full-mesh',points,
    height:visible.length?Math.max(...visible.map(p=>p.y))-Math.min(...visible.map(p=>p.y)):null,
    width:visible.length?Math.max(...visible.map(p=>p.x))-Math.min(...visible.map(p=>p.x)):null,
    allInside:points.every(p=>p.z>.05&&p.x>15&&p.x<1425&&p.y>15&&p.y<825)};
};
const capture = async name => {
  const metrics = await page.evaluate(() => new Promise(resolve => {
    const intervals = [], draws = [], motionSamples = [], cameraSamples = [], lightingSamples=[]; let last = performance.now(), previousDraw = null;
    const frame = now => {
      intervals.push(now - last); last = now;
      const r = window.__tvUniverse.render;
      if (intervals.length % 15 === 0) {
        const avatar = window.__tvUniverse.avatar;
        motionSamples.push({ clip: avatar.motion?.dominantClip, frame: avatar.motion?.frame, source: avatar.motion?.source, flightPose: avatar.motion?.flight, joints: avatar.joints });
        cameraSamples.push(window.__tvUniverse.camera);
        lightingSamples.push(window.__tvUniverse.lighting);
      }
      if (previousDraw !== null) draws.push(r.drawCalls >= previousDraw ? r.drawCalls - previousDraw : r.drawCalls);
      previousDraw = r.drawCalls;
      if (intervals.length < 120) return requestAnimationFrame(frame);
      intervals.sort((a, b) => a - b); draws.sort((a, b) => a - b);
      resolve({ p50: intervals[60], p95: intervals[114], draws: draws[59], activeMeshes: r.activeMeshes, totalMeshes: r.totalMeshes, motionSamples, cameraSamples,lightingSamples });
    };
    requestAnimationFrame(frame);
  }));
  await page.screenshot({ path: resolve(output, name + '.png') });
  const view = await read();
  view.projectedAvatar=projectedAvatar(view);
  report.samples.push({ name, metrics, ...view });
  if(/moving-flight|between-worlds|return-cruise-side/.test(name)
    &&(!view.state.cruise||Math.hypot(...Object.values(view.state.velocity))<=50)){
    await save();await stopBlockedDeparture('A planned moving-flight capture did not have active navigation and speed above50m/s.');
  }
  if (name === '05-ground-close-front'||/moving-flight-(side|front)/.test(name)) await detailClips(name, view);
  console.log(JSON.stringify({ capture: name, metrics: { ...metrics, motionSamples: undefined, cameraSamples: undefined,lightingSamples:undefined }, mode: view.state?.mode, altitude: view.status?.altitude,
    phase: view.state?.personalFlight?.phase, mana: view.campaign?.flight.manaAvailable, settlements: view.settlements, avatar: view.avatar?.ready,
    avatarPixelHeight:view.projectedAvatar?.height,avatarInsidePlayfield:view.projectedAvatar?.allInside,errors: report.errors.length }));
  await save();
};
const select = async id => {
  if (!(await page.locator('.astral-chart').isVisible())) await page.locator('[data-chart-toggle]').click();
  const state = await read(), index = state.system.planets.findIndex(p => p.id === id);
  await page.locator('.astral-world').nth(index).click();
  await wait(id => window.__tvUniverse.snapshot.state.targetPlanetId === id, id);
};
const navigate = async id => {
  await select(id); await page.locator('[data-cruise]').click();
  await wait(() => window.__tvUniverse.snapshot.state.cruise);
  const start=await read(), deadline=Date.now()+6000;
  while(Date.now()<deadline){
    await page.waitForTimeout(250);
    const current=await read();
    if(distance(current.state.position,start.state.position)>5)return;
    const collision=current.state.events.at(-1);
    if(Date.now()>deadline-3000&&Math.hypot(...Object.values(current.state.velocity))<.5
      &&collision?.type==='collision'&&current.state.tick-collision.tick<5){
      await stopBlockedDeparture('Assisted departure remained blocked by canonical geometry.');
    }
  }
  await stopBlockedDeparture('Assisted departure did not make bounded progress.');
};
const arrive = id => wait(id => {
  const s = window.__tvUniverse.snapshot;
  return s.state.mode === 'flight' && !s.state.cruise && s.status.nearestPlanetId === id && s.status.altitude < 250;
}, id, 120000);
const land = async id => {
  await page.locator('[data-launch]').click();
  await wait(id => window.__tvUniverse.snapshot.state.mode === 'surface' && window.__tvUniverse.snapshot.state.landedPlanetId === id, id, 45000);
  await page.waitForTimeout(500);
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const inventory = items => items.map(({ id, name, quantity }) => ({ id, name, quantity })).sort((a, b) => a.id.localeCompare(b.id));
const sameIdentity = (view, expected, label) => {
  const current = view.campaign ?? view, prior = expected.campaign ?? expected;
  assert.deepEqual([current.personId, current.bodyId], [prior.personId, prior.bodyId]);
  assert.deepEqual(inventory(current.inventory), inventory(prior.inventory));
  check(true, label);
};
const townReady = () => wait(() => window.tvRealms?.ready && window.tvRealms.inspect().focused.instances > 0
  && window.tvRealms.inspect().focused.pending === 0, null, 90000);
const townRead = () => page.evaluate(() => {
  const d = window.tvRealms, s = d.state, i = d.inspect();
  return { ready: d.ready, personId: s.person.id, bodyId: s.body.id, inventory: s.person.inventory, position: s.body.pos,
    loaded: i.loaded, focused: i.focused, meshes: i.meshes, camera: i.camera, controlledBody: i.controlledBody,
    controlledLook: { assetPath: i.controlledLook?.assetPath, motion: i.controlledLook?.motion } };
});
const townCapture = async name => {
  await townReady();
  const begin = page.getByRole('button', { name: 'Begin journey', exact: true });
  if (await begin.isVisible()) await begin.click();
  await page.waitForTimeout(500);
  const view = await townRead(); check(view.controlledBody?.enabled, 'Controlled town character is rendered');
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  report.samples.push({ name, town: view }); await save(); return view;
};
const openUniverse = async () => {
  if (!(await page.locator('#rv-universe').isVisible())) await page.locator('.rv-wayfinder > summary').click();
  await page.locator('#rv-universe').click(); await page.waitForURL('**/?universe&campaign');
  await wait(() => window.__tvUniverse?.campaign?.canExplore && window.__tvUniverse.avatar.ready
    && window.__tvUniverse.settlements.focused > 0 && window.__tvUniverse.camera, null, 90000);
};
const returnToTown = async (expected, name) => {
  const view = await read(); check(view.campaign.canReturn, 'Home surface admits canonical return');
  await page.locator('[data-campaign-return]').click(); await page.waitForURL('**/?realms');
  const town = await townCapture(name); sameIdentity(town, expected, 'Fully rendered town retains original person, body and inventory');
  return town;
};
const stopBlockedDeparture=async reason=>{
  report.departureBlocked={reason,state:await read()};
  await page.locator('[data-brake]').click();
  if((await read()).state.mode==='flight'){
    await page.locator('[data-launch]').click();
    await wait(()=>window.__tvUniverse.snapshot.state.mode==='surface',null,8000);
  }
  report.endUniverse=await read();
  if(contactQA)await contactQA.stop();
  if(report.endUniverse.campaign.canReturn)report.endTown=await returnToTown(initial,'blocked-departure-returned-town');
  throw Error(reason+' Landed safely before stopping the bounded run.');
};
const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
const orbit = async radians => {
  let remaining = radians, measured = 0;
  while (Math.abs(remaining) > .001) {
    const part = Math.sign(remaining) * Math.min(Math.abs(remaining), 1.2);
    const before = (await read()).camera;
    await page.mouse.move(600, 400); await page.mouse.down({ button: 'left' });
    await page.mouse.move(600 - part / .004, 400, { steps: 18 }); await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(100);
    const after = (await read()).camera;
    measured += wrap(after.yaw - before.yaw); remaining -= part;
  }
  return measured;
};
const zoom = async delta => { await page.mouse.move(720, 430); await page.mouse.wheel(0, delta); await page.waitForTimeout(700); };
const recenter = async () => { await page.keyboard.press('r'); await page.waitForTimeout(700); };
const nearWallProbe = async () => {
  const start=await read();
  await page.keyboard.down('a');
  try {await page.waitForTimeout(850);} finally {await page.keyboard.up('a');}
  await page.waitForTimeout(350);
  const reached=await read(), delta=Object.fromEntries(['x','y','z'].map(k=>[k,reached.state.position[k]-start.state.position[k]]));
  const moved=Math.hypot(delta.x,delta.y,delta.z), direction=moved>.01?Object.fromEntries(['x','y','z'].map(k=>[k,delta[k]/moved])):null;
  const observations=[];
  for(let i=0;i<4;i++){
    await orbit(Math.PI/2);await capture(`06-near-wall-orbit-${i+1}`);
    const v=await read();observations.push({camera:v.camera,avatar:v.avatar,position:v.state.position});
  }
  await recenter();
  report.nearWall={start:start.state.position,reached:reached.state.position,moved,observations,
    observedContraction:observations.some(v=>v.camera.obstructionDistance<v.camera.desiredDistance-.25)};
  if(direction){
    await page.keyboard.down('d');
    try {
      const deadline=Date.now()+6000;
      while(Date.now()<deadline){
        const v=await read(), remaining=['x','y','z'].reduce((n,k)=>n+(v.state.position[k]-start.state.position[k])*direction[k],0);
        if(remaining<.2)break;
        await page.waitForTimeout(100);
      }
    }finally{await page.keyboard.up('d');}
  }
  await page.waitForTimeout(350);
  const returned=await read();report.nearWall.returned=returned.state.position;
  report.nearWall.returnedAvatar=returned.avatar;
  const avatarProblems=[];
  for(const v of [...observations,{avatar:returned.avatar}]){
    const a=v.avatar,clearance=a.cameraClearance??a.cameraDistance;
    if(clearance<=1.25&&(!a.cameraOccluded||a.visible))avatarProblems.push('Avatar remained visible inside the near-camera threshold.');
    if(clearance>=1.6&&(a.cameraOccluded||!a.visible))avatarProblems.push('Avatar did not restore after the camera cleared the hysteresis distance.');
    if(!a.motion?.source||!a.joints||Object.keys(a.joints).length===0)avatarProblems.push('Animation diagnostics disappeared while camera visibility changed.');
  }
  if(avatarProblems.length){report.presentationFailures??=[];report.presentationFailures.push(...new Set(avatarProblems));}
  else check(true,'Near-wall avatar visibility follows lens clearance while motion diagnostics remain available');
  report.nearWall.returnDistance=distance(returned.state.position,start.state.position);
  if(report.nearWall.returnDistance>=1.2){
    report.nearWall.signedRemaining=direction?['x','y','z'].reduce((n,k)=>n+(returned.state.position[k]-start.state.position[k])*direction[k],0):0;
    report.nearWall.limitation=report.nearWall.signedRemaining<0
      ?'Bounded reverse sidestep overshot the starting point; no corrective forced movement was used.'
      :'Bounded reverse sidestep did not restore the start; geography or input timing remains unclassified.';
  }else check(true,'Bounded near-wall sidestep returns to the open street using ordinary controls');
  check(returned.state.mode==='surface','Near-wall orbit remains on the canonical surface');
  await save();
};
const guardWallProbe = async () => {
  const start=await read(),began=Date.now(),observations=[],positions=[];
  await zoom(-1500);await recenter();
  let hidden=false;
  for(let attempt=0;attempt<3&&!hidden&&Date.now()-began<42000;attempt++){
    await page.keyboard.down('a');
    try{await page.waitForTimeout(attempt===0?650:400);}finally{await page.keyboard.up('a');}
    await page.waitForTimeout(250);
    const reached=await read();positions.push({attempt,elapsed:Date.now()-began,position:reached.state.position});
    for(let i=0;i<8&&Date.now()-began<47000;i++){
      await orbit(Math.PI/4);
      const v=await read();
      const observation={attempt,orbit:i,elapsed:Date.now()-began,position:v.state.position,camera:v.camera,avatar:v.avatar};
      observations.push(observation);
      if(v.avatar.cameraOccluded&&!v.avatar.visible){
        hidden=true;await capture('guard-near-wall-hidden');break;
      }
    }
  }
  const reached=await read(),delta=Object.fromEntries(['x','y','z'].map(k=>[k,reached.state.position[k]-start.state.position[k]]));
  const moved=Math.hypot(delta.x,delta.y,delta.z);
  if(moved>.01&&Date.now()-began<52000){
    const direction=Object.fromEntries(['x','y','z'].map(k=>[k,delta[k]/moved]));
    await page.keyboard.down('d');
    try{
      const deadline=Math.min(began+55000,Date.now()+4000);
      while(Date.now()<deadline){
        const v=await read(),remaining=['x','y','z'].reduce((n,k)=>n+(v.state.position[k]-start.state.position[k])*direction[k],0);
        if(remaining<.2)break;
        await page.waitForTimeout(80);
      }
    }finally{await page.keyboard.up('d');}
  }
  await zoom(600);await recenter();
  const restored=await read();await capture('guard-near-wall-restored');
  report.guardWall={start:start.state.position,positions,observations,moved,returned:restored.state.position,
    restored:{camera:restored.camera,avatar:restored.avatar},elapsed:Date.now()-began,
    minimumClearance:Math.min(...observations.map(v=>v.avatar.cameraClearance)),
    observedHidden:hidden,observedRestored:restored.avatar.cameraClearance>=1.6&&restored.avatar.visible&&!restored.avatar.cameraOccluded};
  const problems=[];
  for(const v of [...observations,{camera:restored.camera,avatar:restored.avatar}]){
    if(![v.camera.position,v.camera.target,v.camera.up].every(p=>Object.values(p).every(Number.isFinite))
      ||distance(v.camera.position,v.camera.target)<=1e-4)problems.push('Near-wall camera eye/target became degenerate or non-finite.');
    const a=v.avatar;
    if(a.cameraClearance<=1.25&&(!a.cameraOccluded||a.visible))problems.push('Avatar remained visible inside the near-camera cutoff.');
    if(a.cameraClearance>=1.6&&(a.cameraOccluded||!a.visible))problems.push('Avatar failed to restore beyond the hysteresis distance.');
    if(!a.motion?.source||!a.joints||Object.keys(a.joints).length===0)problems.push('Rig diagnostics disappeared during near-camera hiding.');
  }
  if(problems.length){report.presentationFailures??=[];report.presentationFailures.push(...new Set(problems));}
  else check(true,'Bounded ground wall probe preserves finite camera geometry, visibility rules and live rig diagnostics');
  check(restored.state.mode==='surface','Guard wall probe remains on the canonical surface');
  await save();
};
const groundFraming = async () => {
  const framing=await page.evaluate(()=>{
    const d=window.__tvUniverse,c=d.camera,l=d.avatar.landmarks;
    const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
    const norm=a=>{const n=Math.hypot(a.x,a.y,a.z);return{x:a.x/n,y:a.y/n,z:a.z/n};};
    const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
    const forward=norm(sub(c.target,c.position)),right=norm(cross(forward,c.up)),up=cross(right,forward),focal=450/Math.tan(c.fov/2);
    const project=p=>{const delta=sub(p,c.position),z=dot(delta,forward);return{x:720+dot(delta,right)/z*focal,y:450-dot(delta,up)/z*focal,z};};
    const hud=[...document.querySelectorAll('.astral-actions button,.astral-readouts,.astral-camera-hint')].filter(e=>!e.hidden).map(e=>{
      const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};
    });
    const feet=['foot_l','foot_r'].map(name=>({name,...project(l[name])}));
    const clear=feet.every(p=>p.z>.05&&p.x>20&&p.x<1420&&p.y>30&&p.y<870
      &&hud.every(r=>p.x+20<r.x||p.x-20>r.x+r.width||p.y+30<r.y||p.y-30>r.y+r.height));
    const marker=document.querySelector('[data-target]');
    return{feet,hud,clear,groundMarkerHidden:!marker||marker.hidden||getComputedStyle(marker).display==='none'};
  });
  report.groundFraming=framing;
  check(framing.groundMarkerHidden,'Ground view hides the world marker over the character');
  check(framing.clear,'Both projected foot landmarks and a boot-sized margin clear the viewport and HUD');
};
const cameraOnly = async (before, counts, label, cruising = false) => {
  const after = await read();
  assert.deepEqual(report.commands, counts, 'Camera input must not send any gameplay commands');
  check(after.state.cruise === before.state.cruise && after.state.targetPlanetId === before.state.targetPlanetId, label + ': route state unchanged');
  if (!cruising) check(distance(after.state.forward, before.state.forward) < 1e-7, label + ': canonical heading unchanged');
  return after;
};
const checkRecenter = camera => {
  const p = camera.worldPosition, b = camera.renderedBodyPosition, u = camera.up, h = camera.tangentHeading;
  const eye = { x: p.x - b.x, y: p.y - b.y, z: p.z - b.z }, radial = eye.x*u.x + eye.y*u.y + eye.z*u.z;
  const tangent = { x: eye.x-u.x*radial, y: eye.y-u.y*radial, z: eye.z-u.z*radial };
  const dot = (tangent.x*h.x+tangent.y*h.y+tangent.z*h.z) / Math.hypot(tangent.x,tangent.y,tangent.z) / Math.hypot(h.x,h.y,h.z);
  check(dot < -.9, 'Recenter places the camera behind the transported character heading');
};
const checkProvenance = view => {
  const source = view.avatar.motion?.source;
  check(view.avatar.motionAvailability?.ual?.loaded && view.avatar.motionAvailability.ual.verified, 'UAL motion pack is loaded and hash verified');
  check(source?.source === 'quaternius-ual-standard' && source.sha256 === '69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997',
    'Visible idle reports the actual verified CC0 source, not a requested fallback alias');
  check(source.sourceClip === 'Idle_Loop' && !!source.retargetLook, 'Idle names its actual source clip and destination rig');
};
const traceTransit = async destination => page.evaluate(destination => new Promise(resolve => {
  const samples = [], framePeaks = [], falseBrakeFrames=[],frameClockFailures=[],clockSources={}; let last = -Infinity, start = performance.now(), previous = null, speedWindow=null,maxFrameAngle = 0, maxFrameRate=0,maxFrameExcess=0,steadyFrameSamples=0;
  const angle = (a,b) => Math.acos(Math.max(-1, Math.min(1, (a.x*b.x+a.y*b.y+a.z*b.z) / Math.hypot(a.x,a.y,a.z) / Math.hypot(b.x,b.y,b.z))));
  const frame = now => {
    const d = window.__tvUniverse, s = d?.snapshot;
    if (!s || !d.camera) return resolve({ failure: 'Camera or canonical state disappeared', samples, framePeaks, maxFrameAngle,maxFrameRate,maxFrameExcess,steadyFrameSamples,falseBrakeFrames,frameClockFailures,clockSources });
    const camera = structuredClone(d.camera);
    const clockSource=camera.frameClock?.source??'missing';clockSources[clockSource]=(clockSources[clockSource]??0)+1;
    if(clockSource!=='timeline'&&frameClockFailures.length<30)frameClockFailures.push({ms:now-start,frameClock:camera.frameClock??null});
    const flight=structuredClone(d.avatar.motion?.flight),totalSpeed=Math.hypot(s.state.velocity.x,s.state.velocity.y,s.state.velocity.z);
    const revision=s.revision??s.state.tick;
    if(!speedWindow||Math.max(speedWindow.max,totalSpeed)-Math.min(speedWindow.min,totalSpeed)>.05){
      speedWindow={start:now,min:totalSpeed,max:totalSpeed,revision,updates:1};
    }else{
      speedWindow.min=Math.min(speedWindow.min,totalSpeed);speedWindow.max=Math.max(speedWindow.max,totalSpeed);
      if(revision!==speedWindow.revision){speedWindow.updates++;speedWindow.revision=revision;}
    }
    const stableSpeed=totalSpeed>100&&now-speedWindow.start>=400&&speedWindow.updates>=4;
    if (previous) {
      const delta = angle(previous.up, camera.up);
      const dt=now-previous.ms,limit=(camera.maxHorizonSpeed??Math.PI/2)*dt/1000;
      maxFrameRate=Math.max(maxFrameRate,delta/(dt/1000));
      maxFrameExcess=Math.max(maxFrameExcess,delta-limit);
      // Velocity is held between host replies. Require multiple host updates and
      // at least400ms within.05m/s before calling any brake phase false.
      if(stableSpeed){
        steadyFrameSamples++;
        if(flight?.phase==='brake'&&falseBrakeFrames.length<30)falseBrakeFrames.push({ms:now-start,dt,totalSpeed,window:structuredClone(speedWindow),flight});
      }
      if (delta > maxFrameAngle) {
        maxFrameAngle = delta;
        framePeaks.push({ms:now-start,dt:now-previous.ms,angle:delta,from:previous.up,to:camera.up,nearestPlanetId:s.status.nearestPlanetId,frameClock:camera.frameClock});
        if(framePeaks.length>60)framePeaks.shift();
      }
    }
    previous = {ms:now,up:camera.up};
    if (now - last >= 95) {
      last = now;
      samples.push({ ms: now - start, nearestPlanetId: s.status.nearestPlanetId, altitude: s.status.altitude,
        body: s.state.position, forward: s.state.forward, velocity:s.state.velocity,speed:Math.hypot(s.state.velocity.x,s.state.velocity.y,s.state.velocity.z),
        cruise: s.state.cruise,revision,stableSpeed,flight,camera, lighting: structuredClone(d.lighting) });
    }
    if ((!s.state.cruise && s.status.nearestPlanetId === destination) || now - start > 120000 || samples.length >= 1300) return resolve({ samples, framePeaks, maxFrameAngle,maxFrameRate,maxFrameExcess,steadyFrameSamples,falseBrakeFrames,frameClockFailures,clockSources });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}), destination);
const assessTransit = trace => {
  assert.ok(!trace.failure, trace.failure);
  let switches = 0, maxUpAngle = 0,maxCoarseExcess=0;
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x*b.x+a.y*b.y+a.z*b.z) / Math.hypot(a.x,a.y,a.z) / Math.hypot(b.x,b.y,b.z))));
  for (let i = 1; i < trace.samples.length; i++) {
    const a = trace.samples[i - 1], b = trace.samples[i];
    if (a.nearestPlanetId !== b.nearestPlanetId) switches++;
    const change=angle(a.camera.up,b.camera.up),seconds=(b.ms-a.ms)/1000;
    maxUpAngle = Math.max(maxUpAngle, change);
    maxCoarseExcess=Math.max(maxCoarseExcess,change-(b.camera.maxHorizonSpeed??Math.PI/2)*seconds);
    for (const point of [b.camera.worldPosition, b.camera.worldTarget, b.camera.renderedBodyPosition])
      assert.ok(point && Object.values(point).every(Number.isFinite), 'Camera positions remain finite');
  }
  trace.summary = { switches, maxUpAngleRadians: maxUpAngle,maxCoarseExcess,
    steadyFrameSamples:trace.steadyFrameSamples,falseBrakeFrames:trace.falseBrakeFrames?.length,clockSources:trace.clockSources };
  report.traces.push(trace);
  check(switches > 0, 'Continuous route crosses a nearest-world boundary');
  check(trace.clockSources?.timeline>0&&trace.frameClockFailures?.length===0,'Every sampled render frame uses the browser timeline for camera transport');
  check(trace.maxFrameExcess<.003,'Automatic horizon rotation respects the advertised90deg/s cap each rendered frame');
  check(maxCoarseExcess<.006,'Coarse camera samples also respect the horizon rotation cap');
  if(trace.steadyFrameSamples>0)check(trace.falseBrakeFrames.length===0,'Measured steady total speed does not create false braking poses as the radial frame turns');
  else trace.summary.poseCoverage='No sufficiently long steady total-speed interval; phase correctness remains a coverage limitation.';
};
const recordAssessment=async trace=>{
  try{assessTransit(trace);}catch(error){
    if(!report.traces.includes(trace))report.traces.push(trace);
    report.presentationFailures??=[];report.presentationFailures.push(String(error));
    await save();
  }
};
const contactQA=process.env.TV_QUALITY_CONTACTS==='1'
  ?createContactQA({page,report,output,read,capture,save,check,orbit,zoom,recenter}):null;
let initial;
try {
  if(mode==='home-recovery'){
    await page.goto(target.href,{waitUntil:'domcontentloaded'});
    await wait(()=>window.__tvUniverse?.ready&&window.__tvUniverse.avatar.ready,null,90000);
    initial=restartBaseline.baseline;report.baseline=initial;
    const current=await read();sameIdentity(current,initial,'Recovery retains original identity and inventory');
    check(current.status.nearestPlanetId===current.system.planets[0].id,'Recovery begins at home');
    if(current.state.mode==='flight'){
      await page.locator('[data-brake]').click();
      await page.waitForTimeout(200);
      await page.locator('[data-launch]').click();
      await wait(()=>window.__tvUniverse.snapshot.state.mode==='surface',null,8000);
    }
    await capture('18-recovered-home-ground');
    report.endUniverse=await read();
    report.endTown=await returnToTown(initial,'19-recovered-town-ready');
  } else if (mode === 'resume') {
    await page.goto(target.href, {waitUntil:'domcontentloaded'});
    await wait(() => window.__tvUniverse?.ready && window.__tvUniverse.avatar.ready, null, 90000);
    initial = restartBaseline.baseline; report.baseline=initial;
    let current=await read();
    sameIdentity(current,initial,'Resumed canonical journey retains original identity and inventory');
    const home=current.system.planets[0].id, foreign=current.status.nearestPlanetId;
    check(foreign!==home,'Resume starts at the foreign world from the preserved first run');
    check(current.campaign.active,'Resume preserves the active canonical journey');
    if(current.state.mode==='flight') await land(foreign);
    await capture('13-other-world-ground');
    current=await read();
    const parked=structuredClone(current.state.parkedVessel);
    check(current.state.landedVesselPosition===null,'Foreign personal landing has no local vessel');
    check(!current.phase.includes('within 60 m')&&current.phase.includes('vessel parked on'),'Foreign surface HUD names actual parked-vessel world');
    sameIdentity(current,initial,'Foreign landing retains original body and full inventory');
    await page.reload({waitUntil:'domcontentloaded'});
    await wait(() => window.__tvUniverse?.ready && window.__tvUniverse.avatar.ready,null,90000);
    const reloaded=await read();
    sameIdentity(reloaded,initial,'Foreign reload retains original body and full inventory');
    assert.deepEqual(reloaded.state.parkedVessel,parked);
    check(reloaded.state.landedPlanetId===foreign,'Reload preserves the foreign landing');
    await capture('14-reloaded-foreign-ground');
    await page.keyboard.press('g');
    await wait(() => !!window.__tvUniverse.snapshot.state.personalFlight);
    await navigate(home);
    if(await page.locator('.astral-chart').isVisible())await page.locator('[data-chart-toggle]').click();
    const transit=traceTransit(home).catch(error=>({failure:String(error),samples:[]}));
    await page.waitForTimeout(700);
    await orbit(Math.PI/2);await capture('17-return-cruise-side');await recenter();
    await arrive(home);
    const trace=await transit;
    // Preserve and report the coarse threshold, but do not interrupt a resumed
    // recovery solely on that disputed threshold. Per-frame evidence is kept.
    await recordAssessment(trace);
    await land(home);await capture('15-returned-home');
    const returned=await read();
    sameIdentity(returned,initial,'Home return retains original body and full inventory');
    assert.deepEqual(returned.state.parkedVessel,parked);
    check(!!returned.state.landedVesselPosition,'Home landing restores access to original parked vessel');
    report.endUniverse=returned;
    report.endTown=await returnToTown(initial,'16-returned-town-ready');
  } else {
  await page.goto(new URL('/?realms', target).href, { waitUntil: 'domcontentloaded' });
  const firstTown = await townCapture('00-town-rendered');
  if (mode === 'restart') {
    sameIdentity(firstTown, restartBaseline.baseline, 'Exact restarted save renders the same body and full inventory');
    check(distance(firstTown.position, restartBaseline.endTown.position) < .000001,
      'Exact restarted host retains the final canonical town position');
  }
  await openUniverse();
  initial = await read();
  report.baseline = initial;
  sameIdentity(initial, firstTown, 'Town and spherical preview share canonical identity and items');
  check(!initial.campaign.active && !!initial.preview, 'Inactive page projects actual town before entry');
  checkProvenance(initial);
  await capture('01-town-preview');
  if (mode === 'restart') {
    assert.deepEqual(initial.state.parkedVessel, restartBaseline.endUniverse.state.parkedVessel);
    assert.deepEqual(initial.state.discoveries, restartBaseline.endUniverse.state.discoveries);
    check(!initial.campaign.active && !initial.state.personalFlight,
      'Exact restarted checkpoint remains inactive on the surface');
    check(true, 'Restart preserves discoveries and the original parked vessel');
  } else check(initial.campaign.flight.canCrossSpace, 'Isolated fixture is admitted for interplanetary personal flight');
  const currentPreview = await read();
  await page.locator('[data-board]').click();
  await wait(() => window.__tvUniverse.campaign.active && window.__tvUniverse.snapshot.state.mode === 'surface');
  const entered = await read();
  check(distance(entered.state.position, currentPreview.state.position) < .05, 'Explore preserves the actual current preview position');
  check(entered.state.settlementRevision === 1 && entered.state.explorerId === initial.campaign.personId, 'Mapped settlement traversal retains canonical identity');
  if (mode === 'restart') {
    if(contactQA)await contactQA.start('restored-idle');
    await capture('02-restored-reentry');
    if(contactQA){await contactQA.stage('restored-idle');await page.waitForTimeout(1800);await contactQA.stop({required:true});}
    if(process.env.TV_QUALITY_GUARD==='1'){
      const before=await read(),counts=structuredClone(report.commands),views=[];
      await zoom(-1500);
      check(Math.abs((await read()).camera.preferredDistance-3)<.01,'Ordinary wheel input reaches the supported 3m minimum zoom');
      for(let i=0;i<4;i++){
        await orbit(Math.PI/2);await capture(`guard-minzoom-orbit-${i+1}`);
        const v=await read();views.push({camera:v.camera,avatar:v.avatar});
      }
      await zoom(600);await recenter();
      const restored=await cameraOnly(before,counts,'Minimum-zoom guard orbit');
      report.guard={views,restored:{camera:restored.camera,avatar:restored.avatar},
        minimumClearance:Math.min(...views.map(v=>v.avatar.cameraClearance)),
        observedHidden:views.some(v=>v.avatar.cameraOccluded&&!v.avatar.visible)};
      for(const v of views){
        check([v.camera.position,v.camera.target,v.camera.up].every(p=>Object.values(p).every(Number.isFinite))
          &&distance(v.camera.position,v.camera.target)>1e-4,'Sampled minimum-zoom camera has finite distinct eye and target');
      }
      check(distance(restored.state.position,before.state.position)<.01,'Guard camera probe does not move the canonical body');
      await guardWallProbe();
    }
    report.endUniverse = await read();
    report.endTown = await returnToTown(initial, '03-restored-town-ready');
  } else {
  const httpBeforeHelp = report.http.length;
  await page.locator('[data-help]').click();
  await page.waitForTimeout(350);
  check(report.http.length === httpBeforeHelp, 'Opening ground controls produces no rejected travel command');
  const beforeHelp = JSON.stringify(report.commands);
  await page.keyboard.press('g'); await page.keyboard.press('f'); await page.keyboard.press('c');
  await page.waitForTimeout(350);
  check(JSON.stringify(report.commands) === beforeHelp, 'Help suppresses G/F/C travel commands');
  await page.locator('[data-close-help]').click();
  await recenter();
  await capture('02-ground-default');
  const orbitBefore = await read(), orbitCommands = structuredClone(report.commands);
  await zoom(-500);
  const zoomed = await read();
  check(zoomed.camera.preferredDistance < orbitBefore.camera.preferredDistance && zoomed.camera.renderedDistance < orbitBefore.camera.renderedDistance,
    'Actual wheel input zooms the rendered camera toward the character');
  await capture('03-ground-close-back');
  let totalOrbit = await orbit(Math.PI / 2); await capture('04-ground-close-side-a');
  totalOrbit += await orbit(Math.PI / 2); await capture('05-ground-close-front');
  try{await groundFraming();}catch(error){report.presentationFailures??=[];report.presentationFailures.push(String(error));}
  totalOrbit += await orbit(Math.PI / 2); await capture('06-ground-close-side-b');
  totalOrbit += await orbit(Math.PI / 2);
  check(Math.abs(totalOrbit - Math.PI * 2) < .15, 'Ordinary drag completes a measured 360-degree free orbit');
  await zoom(500); await recenter();
  const afterCamera = await cameraOnly(orbitBefore, orbitCommands, 'Ground orbit and zoom');
  checkRecenter(afterCamera.camera);
  check(Math.abs(afterCamera.camera.preferredDistance - orbitBefore.camera.preferredDistance) < .05,
    'Reversing wheel input restores the preferred distance');
  if(contactQA){
    try{await contactQA.groundRoute();}
    catch(error){
      report.endUniverse=await read();
      if(report.endUniverse.campaign.canReturn)report.endTown=await returnToTown(initial,'contact-route-stopped-town');
      throw error;
    }
  }else{
    await page.keyboard.down('w');
    try { await capture('07-walking-authored-motion'); } finally { await page.keyboard.up('w'); }
  }
  await page.waitForTimeout(350);
  const walked = await read();
  check(distance(walked.state.position, entered.state.position) > .2, 'Ordinary walking moves the canonical body during motion capture');
  const beforeLift = await read();
  if(contactQA)await contactQA.start('takeoff');
  await page.keyboard.press('g');
  await wait(() => !!window.__tvUniverse.snapshot.state.personalFlight);
  const lifted = await read();
  check(lifted.state.personalFlight.bodyId === initial.campaign.bodyId, 'G lifts the same canonical body');
  check(Math.hypot(...['x','y','z'].map(k => lifted.state.position[k] - beforeLift.state.position[k])) < 3, 'Lift begins at the walked position without relocating to the vessel');
  const parked = structuredClone(lifted.state.parkedVessel);
  check(!!parked, 'Vessel has a retained parked position');
  check(await page.locator('[data-warp]').isDisabled(), 'Personal flight cannot use vessel warp');
  await page.keyboard.down('e');
  const ascentCapture = capture('08-vertical-ascent');
  await page.waitForTimeout(600);
  const movingAscent=await read();
  await page.screenshot({path:resolve(output,'08-moving-ascent.png')});
  report.samples.push({name:'08-moving-ascent',...movingAscent});
  if(Math.hypot(...Object.values(movingAscent.state.velocity))<=50){
    await page.keyboard.up('e');await ascentCapture;
    await stopBlockedDeparture('Expected moving ascent did not exceed50m/s after bounded ordinary rise input.');
  }
  await page.waitForTimeout(300); await page.keyboard.up('e'); await page.locator('[data-brake]').click();
  await ascentCapture; await page.waitForTimeout(700);
  const airborne = await read();
  if(contactQA)await contactQA.stop();
  if(airborne.status.altitude<10)await stopBlockedDeparture('Vertical departure stayed at ground height after ordinary ascent input.');
  check(airborne.avatar.visible && airborne.avatar.phase === 'flight', 'Shared hero is visible in personal flight');
  check(airborne.avatar.motion?.flight?.weight > .8 && airborne.avatar.motion.flight.phase !== 'ground',
    'Airborne character uses a bounded flight presentation phase');
  check(airborne.campaign.flight.manaAvailable < beforeLift.campaign.flight.manaAvailable, 'Powered flight spends canonical mana');
  const hoverCommands = structuredClone(report.commands);
  await orbit(Math.PI); await capture('09-hover-front');
  await orbit(Math.PI); await recenter();
  await cameraOnly(airborne, hoverCommands, 'Hover free orbit');
  const home = airborne.system.planets[0].id;
  const other = airborne.system.planets.filter(p => p.id !== home).sort((a, b) => {
    const distance = p => Math.hypot(...['x','y','z'].map(k => p.center[k] - airborne.state.position[k]));
    return distance(a) - distance(b);
  })[0].id;
  await navigate(other);
  if (await page.locator('.astral-chart').isVisible()) await page.locator('[data-chart-toggle]').click();
  const transit = traceTransit(other).catch(error => ({ failure: String(error), samples: [] }));
  await page.waitForTimeout(600);
  const cruising = await read(), cruiseCameraCommands = structuredClone(report.commands);
  if(!cruising.state.cruise||Math.hypot(...Object.values(cruising.state.velocity))<=50)
    await stopBlockedDeparture('Cruise camera acceptance requires active navigation and actualspeed above50m/s.');
  check(true,'Cruise camera checks begin with active navigation and actualspeed above50m/s');
  await recenter();
  await orbit(Math.PI / 2); await capture('10-moving-flight-side');
  await orbit(Math.PI / 2); await capture('10-moving-flight-front');
  await zoom(-160); await zoom(160); await recenter();
  await cameraOnly(cruising, cruiseCameraCommands, 'Cruise free orbit and zoom', true);
  await capture('10-between-worlds');
  await wait(home => window.__tvUniverse.snapshot.status.nearestPlanetId !== home, home, 90000);
  await capture('11-nearest-world-transition');
  await arrive(other); await recordAssessment(await transit); await capture('12-other-world-approach');
  if(contactQA)await contactQA.start('foreign-landing');
  await land(other);if(contactQA)await contactQA.stage('foreign-idle');await capture('13-other-world-ground');
  if(contactQA){await page.waitForTimeout(1200);await contactQA.stop({required:true});}
  const landed = await read();
  check(landed.avatar.motion?.flight?.weight < .05, 'Landing eases the flight presentation back to ground motion');
  check(landed.state.landedVesselPosition === null, 'Foreign personal landing has no local vessel');
  check(!landed.phase.includes('within 60 m') && landed.phase.includes('vessel parked on'), 'Foreign surface HUD describes the parked vessel on its actual world');
  assert.deepEqual(landed.campaign.inventory, initial.campaign.inventory);
  check(landed.campaign.personId === initial.campaign.personId && landed.campaign.bodyId === initial.campaign.bodyId, 'Foreign landing retains full canonical identity and inventory');
  assert.deepEqual(landed.state.parkedVessel, parked);
  check(landed.state.discoveries.some(d => d.planetId === other && d.explorerId === initial.campaign.personId), 'Personal landing records the same explorer discovery');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(() => window.__tvUniverse?.ready && window.__tvUniverse.avatar.ready, null, 90000);
  const reloaded = await read();
  check(reloaded.campaign.personId === initial.campaign.personId && reloaded.campaign.bodyId === initial.campaign.bodyId && reloaded.state.landedPlanetId === other, 'Reload preserves body, person and foreign landing');
  assert.deepEqual(reloaded.campaign.inventory, initial.campaign.inventory);
  assert.deepEqual(reloaded.state.parkedVessel, parked);
  assert.deepEqual(reloaded.state.discoveries, landed.state.discoveries);
  check(true, 'Foreign reload retains the complete discovery records and parked vessel');
  await capture('14-reloaded-foreign-ground');
  await page.keyboard.press('g'); await wait(() => !!window.__tvUniverse.snapshot.state.personalFlight);
  await navigate(home); await arrive(home);
  if(contactQA)await contactQA.start('home-landing');
  await land(home);if(contactQA)await contactQA.stage('home-idle');
  await capture('15-returned-home');
  if(contactQA){await page.waitForTimeout(1200);await contactQA.stop({required:true});}
  const returned = await read();
  check(returned.state.parkedVessel && returned.state.landedVesselPosition, 'Home landing restores access to the original parked vessel');
  assert.deepEqual(returned.state.parkedVessel, parked);
  assert.deepEqual(returned.campaign.inventory, initial.campaign.inventory);
  check(returned.campaign.personId === initial.campaign.personId && returned.campaign.bodyId === initial.campaign.bodyId, 'Home return retains full canonical identity and inventory');
  if(!contactQA)await nearWallProbe();
  report.endUniverse = await read();
  report.endTown = await returnToTown(initial, '16-returned-town-ready');
  }
  }
  if (mode === 'journey') {
    const baselinePath = process.env.TV_QUALITY_COMPARE ?? 'docs/evidence/atlas-flight/final-run/journey.json';
    const before = JSON.parse(await readFile(baselinePath, 'utf8'));
    const names = { '01-town-preview':'00-town-preview', '02-ground-default':'01-town-on-foot',
      '10-between-worlds':'03-between-worlds', '13-other-world-ground':'05-other-world-ground', '15-returned-home':'07-returned-home' };
    report.comparison = { baseline: baselinePath, note: 'Single-machine 120-frame samples; different camera framing/settings are recorded, so these are not identical render workloads.',
      captures: report.samples.filter(s => names[s.name]).map(after => {
        const prior = before.samples.find(s=>s.name===after.name)??before.samples.find(s => s.name === names[after.name]);
        return { after: after.name, before: prior?.name, priorMetrics: prior ? { p50:prior.metrics.p50,p95:prior.metrics.p95,draws:prior.metrics.draws } : null,
          currentMetrics: { p50:after.metrics.p50,p95:after.metrics.p95,draws:after.metrics.draws },
          canonicalPositionDifference: prior?.state?.position && after.state?.position ? distance(prior.state.position, after.state.position) : null };
      }) };
  }
  for(const entry of report.http)entry.recoveredBackpressure=recoveredCrossingBackpressure(entry,report.lastUniverseSuccessAt);
  report.expectedConsoleErrors=report.errorLocations.filter(e=>e.path==='/realms/universe'&&e.message.includes('503')
    &&report.http.some(h=>h.recoveredBackpressure)).map(e=>e.message);
  check(report.http.every(entry => entry.optionalMotion||entry.recoveredBackpressure),
    'No rejected commands, failed required assets or unrecovered network requests during journey');
  check(report.errors.every(e=>report.expectedConsoleErrors.includes(e)),
    'No unexpected browser runtime or asset errors (raw recoverable backpressure remains recorded)');
  const lightSamples=report.samples.flatMap(s=>s.metrics?.lightingSamples??[]);
  if(lightSamples.length)check(lightSamples.every(s=>s.casters<=112&&s.triangles<=240000),'All sampled normal-quality shadow workloads remain within112 casters and240k triangles');
  check(!report.presentationFailures?.length,'All recorded presentation checks passed after safe canonical return');
  report.finished = new Date().toISOString();
} catch (e) {
  report.failure = String(e); console.error(e);
  try { report.lastState = await read(); await page.screenshot({ path: resolve(output, 'failure.png') }); } catch {}
  process.exitCode = 1;
} finally {
  if(contactQA)try{await contactQA.release();await contactQA.stop();}catch{}
  await save(); clearTimeout(watchdog); await browser.close();
}
