/** A short reveal offset; input immediately yields to the ordinary collision-aware camera. */
export function spawnReveal(elapsed: number, reducedMotion: boolean): number {
 if(reducedMotion||!Number.isFinite(elapsed))return 0;
 const t=Math.max(0,Math.min(1,elapsed/3.5));return (1-t)*(1-t)*.22;
}
export function onboarding(parent:HTMLElement){
 const overlay=document.createElement('section');overlay.className='tv-welcome';overlay.innerHTML='<article><small>ENTER THE CONNECTED REALMS</small><h1>Torn Veil</h1><p>A living world. One identity across every threshold.</p><p>WASD move · Shift run · X walk<br>MMB orbit · Wheel zoom<br>LMB strike · RMB guard · Space evade<br>Tab target · E interact · I character · J objectives</p><button>Begin journey</button></article>';parent.append(overlay);
 let open=true;const close=()=>{open=false;overlay.remove();};overlay.querySelector('button')!.onclick=close;
 return {get open(){return open;},close};
}

/** Consume every key while onboarding owns input; only dismissal keys close it. */
export function welcomeKey(welcome: { readonly open: boolean; close(): void }, code: string): boolean {
 if (!welcome.open) return false;
 if (['Enter','Escape','KeyW','KeyA','KeyS','KeyD'].includes(code)) welcome.close();
 return true;
}
