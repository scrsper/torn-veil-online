import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// The native probe samples presentation diagnostics after ordinary input dispatch.
// This measures observed startup, not hardware input-to-photon latency.
const file=process.argv[2];
if(!file)throw new Error('Usage: npx tsx scripts/analyze-martial-combat-probe.ts <probe.json> [summary.json]');
const raw=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
assert.equal(raw.status,'complete');
const frames=raw.samples.filter((s:any)=>s.event==='frame'), events=raw.samples.filter((s:any)=>s.event!=='frame');
const profiles:Record<string,unknown>={};
for(const [profile,expected] of Object.entries({
  untrained:['motor:basic-punch','motor:second-punch','motor:crude-kick'],
  partial:['unarmed:jab','motor:basic-punch','motor:crude-kick'],
  trained:['unarmed:jab','unarmed:cross','unarmed:low-kick'],
})){
  const press=events.find((e:any)=>e.event===profile+'_light_1');assert.ok(press);
  const seen=new Set<string>(),starts:any[]=[];
  for(const f of frames.filter((f:any)=>f.at>=press.at&&f.at<press.at+2.5)){
    const p=f.player;
    if(p.choreographyActive&&p.liveCommandId&&!seen.has(p.liveCommandId)){
      seen.add(p.liveCommandId);starts.push({at:f.at,commandId:p.liveCommandId,techniqueId:p.techniqueId,transition:p.transitionTechniqueId});
    }
  }
  assert.deepEqual(starts.map(s=>s.techniqueId),expected,profile+' sequence');
  const idle=frames.filter((f:any)=>f.at>=starts[0].at&&f.at<=starts[2].at&&!f.player.choreographyActive).length;
  assert.equal(idle,0,profile+' must not idle within a valid chain');
  if(profile==='trained')assert.deepEqual(starts.map(s=>s.transition),['','unarmed:jab-to-cross','unarmed:cross-to-low-kick']);
  else assert.ok(starts.every(s=>!s.transition));
  profiles[profile]={starts,idleFrames:idle};
}
const unbuffered=events.filter((e:any)=>e.event.endsWith('_light_1')||['trained_contact','trained_duck','trained_backstep'].includes(e.event));
const latency=unbuffered.map((e:any)=>{
  const previous=frames.filter((f:any)=>f.at<e.at).at(-1)?.player.liveCommandId;
  const start=frames.find((f:any)=>f.at>=e.at&&f.player.choreographyActive&&f.player.liveCommandId!==previous);
  assert.ok(start,e.event+' startup');return {input:e.event,milliseconds:(start.at-e.at)*1000};
});
assert.ok(frames.some((f:any)=>f.at>10.5&&f.player.liveOutcome==='hit'),'canonical contact must be observed');
const output={source:file,profiles,latency,latencyRangeMs:[Math.min(...latency.map((s:any)=>s.milliseconds)),Math.max(...latency.map((s:any)=>s.milliseconds))],
  diagnostics:raw.diagnostics,timingMethod:'Ordinary-key dispatch to first sampled active choreography. Capture stalls rendering; use an uncaptured run for latency. Not input-to-photon.'};
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({profiles:Object.keys(profiles),latencyRangeMs:output.latencyRangeMs,unbuffered:latency.length,buffered:raw.diagnostics.bufferedInputToStartupMs.count,idleFrames:0}));
