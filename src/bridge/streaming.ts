import type { World } from '../sim/core/world';
import { projectRegionSteps, regionDynamics, RegionStream } from './regions';

export const REGION_PROTOCOL = 2;
export const MAX_PRESENTATION_MESSAGE_BYTES = 128 * 1024;
export const MAX_PRESENTATION_TRANSFER_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
type Transfer = { id: number; regionId: string; bytes: Buffer; index: number; count: number };

/** One bounded transfer per client. Each chunk is acknowledged by the native client;
 * the final acknowledgement follows application. A slow renderer cannot queue a world
 * ahead of snapshots. Residency and all queued data are disposable presentation state. */
export class RegionalTransport {
  private readonly planner = new RegionStream();
  private pending = new Set<string>();
  private wanted: string[] = [];
  private center = '';
  private transfer?: Transfer;
  private awaitingAck = false;
  private serial = 0;
  private lastDynamicAt = -Infinity;
  private dynamicSignature = '';
  private building?:{id:string;steps:ReturnType<typeof projectRegionSteps>;started:number;cpuMs:number;slices:number;maxSliceMs:number};
  constructor(private log: (event: Record<string, unknown>) => void = () => {}) {}

  acknowledge(id: unknown, index: unknown): boolean {
    const t=this.transfer;
    if(!t || !this.awaitingAck || t.id!==id || t.index!==index) return false;
    this.awaitingAck=false;
    if(++t.index===t.count) this.transfer=undefined;
    return true;
  }

  state(w: World) {
    const plan=this.planner.plan(w); if(!plan) return null;
    for(const id of plan.unload) this.pending.delete(id);
    for(const id of plan.changed) this.pending.add(id);
    if(this.building&&(plan.unload.includes(this.building.id)||plan.changed.includes(this.building.id)))this.building=undefined;
    this.wanted=plan.wanted;
    const moved=this.center!==plan.center; this.center=plan.center;
    return moved || plan.unload.length ? {version:1,streamVersion:REGION_PROTOCOL,type:'regions_state',origin:plan.origin,center:plan.center,resident:plan.wanted,regions:[],unload:plan.unload} : null;
  }

  /** Disposable preparation only. The server grants three milliseconds after urgent traffic.
   * Static CLI callers may drain synchronously; live sockets never do. */
  prepare(w:World,budgetMs=3,now=performance.now()):void {
    if(this.awaitingAck||this.transfer||budgetMs<=0||!this.wanted.length)return;
      const start=performance.now(), id=this.building?.id??this.wanted.find(id=>this.pending.has(id));
      let payload: unknown;
      if(id) {
        if(!this.building){const [x,z]=id.split(',').map(Number);this.building={id,steps:projectRegionSteps(w,x,z),started:start,cpuMs:0,slices:0,maxSliceMs:0};this.pending.delete(id);}
        const job=this.building;
        do {
          const result=job.steps.next();
          if(result.done){payload={regions:[result.value],dynamicRegion:id,dynamic:regionDynamics(w,new Set([id]))};break;}
        } while(performance.now()-start<budgetMs);
        if(!payload){const elapsed=performance.now()-start;job.cpuMs+=elapsed;job.slices++;job.maxSliceMs=Math.max(job.maxSliceMs,elapsed);return;}
      } else {
        if(now-this.lastDynamicAt<1000) return;
        this.lastDynamicAt=now;
        const dynamic=regionDynamics(w,new Set(this.wanted));
        // Quantize only presentation time notifications; canonical time is untouched.
        const signature=JSON.stringify({...dynamic,worldTime:Math.floor(dynamic.worldTime/60)});
        if(signature===this.dynamicSignature) return;
        this.dynamicSignature=signature; payload={regions:[],dynamic};
      }
      const bytes=Buffer.from(JSON.stringify(payload));
      if(bytes.length>MAX_PRESENTATION_TRANSFER_BYTES) throw new Error(`Presentation transfer ${id??'dynamic'} exceeds bounded assembly limit: ${bytes.length}`);
      this.transfer={id:++this.serial,regionId:id??'',bytes,index:0,count:Math.ceil(bytes.length/CHUNK_BYTES)};
      const elapsed=performance.now()-start,job=this.building;
      this.log({event:'presentation_transfer',region:id??'dynamic',bytes:bytes.length,chunks:this.transfer.count,
        projectionMs:+((job?.cpuMs??0)+elapsed).toFixed(2),projectionWallMs:+(performance.now()-(job?.started??start)).toFixed(2),
        projectionSlices:(job?.slices??0)+1,maxProjectionSliceMs:+Math.max(job?.maxSliceMs??0,elapsed).toFixed(2)});
      this.building=undefined;
  }

  next(w: World, now=performance.now(),budgetMs=Infinity) {
    if(this.awaitingAck)return null;
    if(!this.transfer)this.prepare(w,budgetMs,now);
    if(!this.transfer)return null;
    const t=this.transfer;
    this.awaitingAck=true;
    const message={version:1,streamVersion:REGION_PROTOCOL,type:'presentation_chunk',transferId:t.id,regionId:t.regionId,index:t.index,count:t.count,data:t.bytes.subarray(t.index*CHUNK_BYTES,(t.index+1)*CHUNK_BYTES).toString('base64')};
    if(Buffer.byteLength(JSON.stringify(message))>MAX_PRESENTATION_MESSAGE_BYTES) throw new Error('Presentation chunk exceeded wire bound');
    return message;
  }
}
