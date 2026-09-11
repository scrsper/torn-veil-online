/**
 * Real WebSocket loopback latency harness for the canonical bridge.
 *
 * The delay knobs below are an application-message proxy: they delay messages in
 * this client harness, after/before WebSocket transport. They are deliberately
 * reported as such and must not be read as network latency.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

export type LatencyHarnessOptions = {
  delayMs?: number;
  jitterMs?: number;
  messageCount?: number;
  seed?: number;
  port?: number;
  legacy?: boolean;
  sourceRoot?: string;
  combat?: boolean;
  world?: 'arena' | 'playable';
};

export type LatencySummary = {
  protocol:number;
  authoritativeApplicationMeasured:boolean;
  serverMemory?: unknown;
  eventLoopMs?: unknown;
  harness: 'realtime-loopback';
  transport: 'WebSocket loopback';
  applicationMessageDelayProxyMs: number;
  applicationMessageJitterMs: number;
  delaySemantics: 'client-side application-message delay; includes proxy delay in observed ages';
  counts: { sent: number; results: number; snapshots: number; correlatedResults: number; correlatedSnapshots: number; sequenceViolations: number; applied:number; rejected:number; combatAccepted:number; combatRejected:number };
  roundTripMs: { count: number; p50: number; p95: number; p99: number; min: number; max: number };
  receivedRoundTripMs: { count: number; p50: number; p95: number; p99: number; min: number; max: number };
  appliedRoundTripMs: { count: number; p50: number; p95: number; p99: number; min: number; max: number };
  receivedRoundTripByKind?: Record<string, LatencySummary['roundTripMs']>;
  appliedRoundTripByKind?: Record<string, LatencySummary['roundTripMs']>;
  snapshotAckAgeMs: { count: number; p50: number; p95: number; p99: number; min: number; max: number };
  load: { durationMs: number; intentsPerSecond: number; snapshotsPerSecond: number; heapUsedBytes: number };
  clock: { offsetMs: number; uncertaintyMs: number; probes: number };
  queueMs: { count: number; p50: number; p95: number; p99: number; min: number; max: number };
  scheduler?: unknown;
  transportTimings?: unknown;
  bridgeLog?: unknown;
};

type WireMessage = { type?: string; sequence?: number; ack?: number; result?: string; [key: string]: unknown };

const sleep = (ms: number) => new Promise<void>(resolveSleep => setTimeout(resolveSleep, ms));
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
}
function stats(values: number[]): LatencySummary['roundTripMs'] {
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), min: values.length ? Number(Math.min(...values).toFixed(3)) : 0, max: values.length ? Number(Math.max(...values).toFixed(3)) : 0 };
}
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close(() => resolvePort(port)); });
  });
}
function waitForHttp(url: string, child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const started = performance.now();
  return new Promise((resolveReady, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) return reject(new Error(`bridge exited with ${child.exitCode}`));
      try { const response = await fetch(url); if (response.ok) return resolveReady(); } catch { /* still starting */ }
      if (performance.now() - started > timeoutMs) return reject(new Error('timed out waiting for bridge health endpoint'));
      setTimeout(poll, 50);
    };
    void poll();
  });
}

/** Run one real bridge loopback measurement. Safe to call repeatedly; each run has a disposable save. */
export async function runRealtimeLatency(options: LatencyHarnessOptions = {}): Promise<LatencySummary> {
  const delayMs = Math.max(0, options.delayMs ?? 0), jitterMs = Math.max(0, options.jitterMs ?? 0);
  const messageCount = Math.max(1, Math.floor(options.messageCount ?? 40));
  const port = options.port ?? await freePort();
  const repoRoot = resolve(dirnameFromHere(), '../../..');
  const temp = mkdtempSync(join(tmpdir(), 'torn-veil-realtime-'));
  const save = join(temp, 'world.json');
  const childEnv = { ...process.env };
  delete childEnv.TORN_VEIL_SAVE;
  delete childEnv.TORN_VEIL_WORLD;
  const world = options.world ?? (options.combat ? 'arena' : undefined);
  Object.assign(childEnv, { TORN_VEIL_PORT: String(port), ...(world ? { TORN_VEIL_WORLD: world } : { TORN_VEIL_SAVE: save }) });
  const child = spawn(process.execPath, [resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'), 'src/bridge/server.ts'], { cwd: options.sourceRoot??repoRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let bridgeLog = '';
  const captureLog = (chunk: Buffer) => { bridgeLog = (bridgeLog + chunk.toString()).slice(-128_000); };
  child.stdout?.on('data', captureLog); child.stderr?.on('data', captureLog);
  const started = performance.now();
  const sentAt = new Map<number, number>();
  const receivedRoundTrips: number[] = [], appliedRoundTrips: number[] = [], ackAges: number[] = [], queueTimes: number[] = [], probeOffsets: number[] = [], probeRtts: number[] = [];
  const receivedRoundTripsByKind = new Map<string, number[]>(), appliedRoundTripsByKind = new Map<string, number[]>();
  let snapshots = 0, correlatedResults = 0, correlatedSnapshots = 0, sequenceViolations = 0, lastAck = -1, lastLocalAck = -1, received = 0, applied = 0,rejected=0,combatAccepted=0,combatRejected=0;
  let targetBodyId: string | undefined;
  let interaction: { epoch:string; controllerId:string; bodyId:string; specRevision:string } | undefined;
  const commandIds = new Map<string, number>();
  const commandKinds = new Map<string, string>();
  const probes = new Map<number, number>();
  let sent = 0;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outboundReadyAt = performance.now();
  let inboundReadyAt = performance.now();
  let logicalStartAt = 0;
  let random = (options.seed ?? 0x5eed) >>> 0;
  const nextDelay = () => { random = (1664525 * random + 1013904223) >>> 0; return (random / 0x1_0000_0000) * jitterMs; };
  try {
    await waitForHttp(`http://127.0.0.1:${port}/health`, child);
    socket = await new Promise<WebSocket>((resolveSocket, rejectSocket) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'X-Torn-Veil-Client': 'unreal', 'X-Torn-Veil-Region-Protocol': '2', 'X-Torn-Veil-Interaction-Protocol': '2' } });
      s.once('open', () => resolveSocket(s)); s.once('error', rejectSocket);
    });
    socket.on('message', bytes => {
      const receivedAt = performance.now();
      inboundReadyAt = Math.max(inboundReadyAt, receivedAt + delayMs * 2 / 3 + (jitterMs ? nextDelay() * 2 / 3 : 0));
      const deliver = () => {
        const deliveredAt = performance.now();
        let message: WireMessage;
        try { message = JSON.parse(bytes.toString()) as WireMessage; } catch { return; }
        if (message.type === 'presentation_chunk' && typeof message.transferId === 'number' && typeof message.index === 'number') {
          socket?.send(JSON.stringify({ version: 1, type: 'presentation_ack', transferId: message.transferId, index: message.index }));
        }
        if (message.type === 'hello' && message.interaction) interaction = message.interaction as typeof interaction;
        if (message.type === 'clock_probe' && typeof message.clientTimeMs === 'number' && typeof message.serverTimeMs === 'number') {
          const probe = probes.get(message.clientTimeMs);
           if (probe !== undefined) { probes.delete(message.clientTimeMs); const rtt=deliveredAt-probe; probeRtts.push(rtt); probeOffsets.push(message.serverTimeMs-(probe+rtt/2)); }
        } else if(options.legacy&&message.type==='result'&&typeof message.sequence==='number') {
          const at=sentAt.get(message.sequence);if(at!==undefined){correlatedResults++;receivedRoundTrips.push(deliveredAt-at);}
        } else if (message.type === 'command_receipt') {
          const receiptCommandId = typeof message.commandId === 'string' ? message.commandId : undefined;
          if (message.status === 'received') received++; else if (message.status === 'applied' || message.status === 'rejected' || message.status === 'cancelled') { applied++;if(message.status!=='applied')rejected++; if (receiptCommandId !== undefined && commandKinds.get(receiptCommandId)==='combat') { if(message.status==='applied')combatAccepted++; else combatRejected++; } if (message.status === 'applied' && typeof message.serverTimeMs === 'number' && typeof message.receivedAtMs === 'number') queueTimes.push(message.serverTimeMs-message.receivedAtMs); }
          const at = receiptCommandId !== undefined ? sentAt.get(commandIds.get(receiptCommandId) ?? -1) : undefined;
          const kind = receiptCommandId !== undefined ? commandKinds.get(receiptCommandId) : undefined;
          if (at !== undefined && message.status === 'received') { correlatedResults++; const rtt=deliveredAt-at; receivedRoundTrips.push(rtt); if (kind) (receivedRoundTripsByKind.get(kind) ?? (receivedRoundTripsByKind.set(kind, []), receivedRoundTripsByKind.get(kind)!)).push(rtt); }
          if (at !== undefined && (message.status === 'applied' || message.status === 'rejected' || message.status === 'cancelled')) { const rtt=deliveredAt-at; appliedRoundTrips.push(rtt); if (kind) (appliedRoundTripsByKind.get(kind) ?? (appliedRoundTripsByKind.set(kind, []), appliedRoundTripsByKind.get(kind)!)).push(rtt); }
        } else if (message.type === 'snapshot') {
          snapshots++;
          if (options.combat && Array.isArray(message.bodies) && !targetBodyId) { const own = typeof message.controlledBodyId==='string' ? message.controlledBodyId : undefined; const target = (message.bodies as Array<{bodyId?:unknown}>).find(b=>typeof b.bodyId==='string'&&b.bodyId!==own); targetBodyId=typeof target?.bodyId==='string' ? target.bodyId : undefined; }
          if (typeof message.ack === 'number') {
            if (message.ack < lastAck) sequenceViolations++;
            const at = message.ack>lastAck?sentAt.get(message.ack):undefined;
            lastAck = Math.max(lastAck, message.ack);
            if (at !== undefined) { correlatedSnapshots++; ackAges.push(deliveredAt - at); }
          }
        } else if (message.type === 'local_state' && typeof message.ack === 'number') {
          if (message.ack < lastLocalAck) sequenceViolations++;
          const at = message.ack>lastLocalAck?sentAt.get(message.ack):undefined;
          lastLocalAck = Math.max(lastLocalAck, message.ack);
          if (at !== undefined) { correlatedSnapshots++; ackAges.push(deliveredAt - at); }
        }
      };
      if(delayMs===0&&jitterMs===0)deliver();else timer=setTimeout(deliver,Math.max(0,inboundReadyAt-receivedAt));
    });
    await sleep(200+delayMs+jitterMs); // greeting must traverse the declared impairment too
    if (!options.legacy&&!interaction) throw new Error('v2 interaction binding missing from hello');
    for (let i=0;!options.legacy&&i<8;i++) {
      const sent=performance.now(); probes.set(sent,sent);
      const probe=()=>socket?.send(JSON.stringify({version:1,type:'clock_probe',clientTimeMs:sent}));
      if(delayMs===0&&jitterMs===0)probe();else setTimeout(probe,delayMs/3+nextDelay()/3);
      await sleep(30);
    }
    await sleep(delayMs+jitterMs+50);
    logicalStartAt = performance.now()+10; outboundReadyAt = logicalStartAt;
    const events: Array<{ index: number; kind: 'combat'|'movement'; scheduledAt: number; commandId: string }> = [];
    if (options.combat) {
      for (let i = 0; i < messageCount; i++) events.push({ index: i, kind: 'combat', scheduledAt: logicalStartAt + i * 800, commandId: `latency-combat-${i + 1}` });
      const movementCount = Math.ceil((messageCount - 1) * 800 / 16.7) + 1;
      for (let i = 0; i < movementCount; i++) events.push({ index: i, kind: 'movement', scheduledAt: logicalStartAt + i * 16.7, commandId: `latency-movement-${i + 1}` });
    } else {
      for (let i = 0; i < messageCount; i++) events.push({ index: i, kind: 'movement', scheduledAt: logicalStartAt + i * 16.7, commandId: `latency-${i + 1}` });
    }
    events.sort((a, b) => a.scheduledAt - b.scheduledAt || (a.kind === 'movement' ? -1 : 1));
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const event = events[eventIndex], sequence = eventIndex + 1, commandId=event.commandId, scheduledAt=event.scheduledAt;
      commandIds.set(commandId,sequence); commandKinds.set(commandId, event.kind); sent++;
      // Keep the proxy ordered and pace the baseline at the 60 Hz interaction step;
      // a burst would measure queue overflow rather than steady-state latency.
      setTimeout(()=>{
        const logicalAt=performance.now();sentAt.set(sequence,logicalAt);
        outboundReadyAt=Math.max(outboundReadyAt,logicalAt+delayMs/3+nextDelay()/3);
        const combatCommand=event.kind === 'combat' ? (event.index%2===0 ? {type:'attack',targetBodyId} : {type:'defend',kind:'duck'}) : {type:'move',x:0,z:0,sprint:false};
        const send=()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(options.legacy?{version:1,type:'move',sequence,x:0,z:0,sprint:false}:{version:2,type:'command',...interaction,sequence,commandId,clientTimeMs:logicalAt,command:combatCommand}));};
        if(delayMs===0&&jitterMs===0)send();else setTimeout(send,Math.max(0,outboundReadyAt-performance.now()));
      },Math.max(0,scheduledAt-performance.now()));
    }
    // Ordered proxy delivery can span one delay interval per message; wait for both
    // outbound and inbound queues to drain before taking the final counts.
    await sleep((options.combat ? messageCount * 800 : messageCount * 16.7)+delayMs+jitterMs+750);
    if(!options.legacy&&applied!==sent) throw new Error(`Unresolved commands: ${applied}/${sent}`);
    const durationMs = performance.now() - started;
    const metrics=await fetch(`http://127.0.0.1:${port}/metrics`).then(r=>r.json()).catch(()=>undefined);
    const offset=probeOffsets.length?probeOffsets.reduce((a,b)=>a+b,0)/probeOffsets.length:0;
    const appliedStats=stats(appliedRoundTrips), receivedStats=stats(receivedRoundTrips);
    const transportTimings = Array.isArray((metrics as any)?.transportTimings)
      ? (metrics as any).transportTimings.map((timing: Record<string, unknown>) => ({ ...timing, kind: commandKinds.get(typeof timing.commandId === 'string' ? timing.commandId : '') ?? 'unknown' }))
      : (metrics as any)?.transportTimings;
    const byKind = (source: Map<string, number[]>) => Object.fromEntries([...source.entries()].map(([kind, values]) => [kind, stats(values)]));
    const bridgeEvents = bridgeLog.split(/\r?\n/).flatMap(line => { try { const event=JSON.parse(line) as Record<string, unknown>; return typeof event.event === 'string' && ['presentation_transfer','startup_send','connected','binding'].includes(event.event) ? [event] : []; } catch { return []; } });
    return { protocol:options.legacy?1:2,authoritativeApplicationMeasured:!options.legacy,serverMemory:(metrics as any)?.memory,eventLoopMs:(metrics as any)?.eventLoopMs,harness: 'realtime-loopback', transport: 'WebSocket loopback', applicationMessageDelayProxyMs: delayMs, applicationMessageJitterMs: jitterMs, delaySemantics: 'client-side application-message delay; includes proxy delay in observed ages', counts: { sent, results: correlatedResults, snapshots, correlatedResults, correlatedSnapshots, sequenceViolations,applied:applied-rejected,rejected,combatAccepted,combatRejected }, roundTripMs: appliedStats, receivedRoundTripMs: receivedStats, appliedRoundTripMs: appliedStats, receivedRoundTripByKind: byKind(receivedRoundTripsByKind), appliedRoundTripByKind: byKind(appliedRoundTripsByKind), snapshotAckAgeMs: stats(ackAges), queueMs: stats(queueTimes), clock:{offsetMs:Number(offset.toFixed(3)),uncertaintyMs:Number((probeRtts.length?Math.max(...probeRtts)/2:0).toFixed(3)),probes:probeOffsets.length}, load: { durationMs: Number(durationMs.toFixed(3)), intentsPerSecond: Number((sent / (durationMs / 1000)).toFixed(3)), snapshotsPerSecond: Number((snapshots / (durationMs / 1000)).toFixed(3)), heapUsedBytes: process.memoryUsage().heapUsed }, scheduler:(metrics as any)?.scheduler,transportTimings,bridgeLog: bridgeEvents };
  } finally {
    if (timer) clearTimeout(timer);
    socket?.close(); child.kill();
    try { rmSync(temp, { recursive: true, force: true }); } catch { /* disposable cleanup is best effort */ }
  }
}

function dirnameFromHere(): string { return resolve(fileURLToPath(import.meta.url), '..'); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delay = Number(process.env.TORN_VEIL_LATENCY_DELAY ?? 0), jitter = Number(process.env.TORN_VEIL_LATENCY_JITTER ?? 0), count = Number(process.env.TORN_VEIL_LATENCY_COUNT ?? 40);
  runRealtimeLatency({ delayMs: delay, jitterMs: jitter, messageCount: count, legacy:process.env.TORN_VEIL_LATENCY_LEGACY==='1',combat:process.env.TORN_VEIL_LATENCY_COMBAT==='1',world:process.env.TORN_VEIL_LATENCY_WORLD==='playable'?'playable':process.env.TORN_VEIL_LATENCY_WORLD==='arena'?'arena':undefined,sourceRoot:process.env.TORN_VEIL_LATENCY_SOURCE_ROOT }).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
