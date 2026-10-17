import { App } from './app';

/** Boot the browser client. Everything else lives in App; this stays tiny so the bundle entry is obvious. */
const params = new URLSearchParams(location.search);
const start = params.has('world') ? import('./planet/world').then(m => m.startPlanetWorld()) : params.has('ascent') ? import('./realms/ascent').then(m => m.startCanonicalAscent()) : params.has('motion-review') ? import('./motion/review').then(m => m.startMotionReview()) : params.has('realms') ? import('./realms/client').then(m => m.startRealms()) : params.has('arena') ? import('./arena/arena').then(m => m.startArena()) : params.has('gym')||params.has('town')||params.has('historical-lab')||params.has('session')||params.has('stream') ? App.start() : import('./realms/client').then(m => m.startRealms());
if(params.has('arena')||params.has('gym')||params.has('town')||params.has('historical-lab')){
 const historical=document.createElement('div');historical.textContent='Historical comparison lab — current game: Play Torn Veil.cmd';
 Object.assign(historical.style,{position:'fixed',top:'0',left:'0',right:'0',zIndex:'10000',textAlign:'center',background:'#4b3528',color:'#fff',font:'12px system-ui',pointerEvents:'none'});document.body.append(historical);
}
start.catch(e => {
  console.error('[tv] fatal', e);
  const ui = document.getElementById('ui');
  if (ui) ui.textContent = `Torn Veil could not start: ${String(e && (e as Error).message || e)}`;
});
