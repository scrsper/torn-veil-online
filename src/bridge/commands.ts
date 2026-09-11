import { INTERACTION_SPEC } from '../sim/physical/prediction';

export type InteractionCommand = {type:'move';x:number;z:number;sprint:boolean}
  | {type:'attack';targetBodyId?:string} | {type:'interact';interactionId:string}
  | {type:'defend';kind:'sidestep'|'backstep'|'duck';side?:number}
  | {type:'cancel'};
export interface CommandEnvelope {
  version:2; type:'command'; epoch:string; controllerId:string; bodyId:string;
  sequence:number; commandId:string; specRevision:string; clientTimeMs:number; command:InteractionCommand;
}
export interface CommandReceipt {
  version:1; type:'command_receipt'; commandId:string; sequence:number; epoch:string;
  status:'received'|'applied'|'rejected'|'cancelled'; result:string; tick:number;
  receivedAtMs:number; serverTimeMs:number; clientTimeMs:number;
}
interface Pending { envelope:CommandEnvelope; receivedAtMs:number }
const identifier=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=128&&/^[a-zA-Z0-9_.:,-]+$/.test(x);
/** Connection-owned, bounded disposable ledger. Receiving is never applying. No client time
 * or transform is used to advance the world. One movement sample buys one server step. */
export class CommandQueue {
  private pending:Pending[]=[];
  private ledger=new Map<string,CommandReceipt>();
  private sequences=new Map<number,string>();
  private latest=-1;
  private latestClientTime=-1;
  constructor(readonly epoch:string,readonly controllerId:string,readonly bodyId:string) {}
  get ack():number { return this.pending.length?Math.min(...this.pending.map(p=>p.envelope.sequence))-1:this.latest; }
  get size():number {return this.pending.length;}
  private receipt(m:Partial<CommandEnvelope>,status:CommandReceipt['status'],result:string,tick:number,receivedAtMs:number,now:number):CommandReceipt {
    return {version:1,type:'command_receipt',commandId:typeof m.commandId==='string'?m.commandId.slice(0,128):'',sequence:Number.isSafeInteger(m.sequence)?m.sequence!:-1,epoch:this.epoch,status,result,tick,receivedAtMs,serverTimeMs:now,clientTimeMs:Number.isFinite(m.clientTimeMs)?m.clientTimeMs!:0};
  }
  receive(input:unknown,tick:number,now:number):CommandReceipt {
    const m=(input&&typeof input==='object'?input:{}) as Partial<CommandEnvelope>;
    const reject=(why:string)=>this.receipt(m,'rejected',why,tick,now,now);
    if(m.version!==2||m.type!=='command'||!identifier(m.commandId)||!Number.isSafeInteger(m.sequence)||m.sequence!<0) return reject('invalid_envelope');
    if(m.epoch!==this.epoch||m.controllerId!==this.controllerId||m.bodyId!==this.bodyId) return reject('binding_mismatch');
    const previous=this.ledger.get(m.commandId);
    if(previous) return previous.sequence===m.sequence?{...previous,serverTimeMs:now}:reject('identity_conflict');
    if(m.sequence!<=this.latest||this.sequences.has(m.sequence!)) return reject('stale_sequence');
    this.latest=m.sequence!;
    const remember=(r:CommandReceipt)=>{this.ledger.set(m.commandId!,r);this.sequences.set(m.sequence!,m.commandId!);while(this.ledger.size>256){const id=this.ledger.keys().next().value!;const old=this.ledger.get(id)!;this.sequences.delete(old.sequence);this.ledger.delete(id);}return r;};
    if(m.specRevision!==INTERACTION_SPEC.revision) return remember(reject('spec_mismatch'));
    if(typeof m.clientTimeMs!=='number'||!Number.isFinite(m.clientTimeMs)||m.clientTimeMs<0||m.clientTimeMs>Number.MAX_SAFE_INTEGER||m.clientTimeMs<this.latestClientTime) return remember(reject('invalid_timestamp'));
    this.latestClientTime=m.clientTimeMs;
    const c=m.command;
    const valid=c&&((c.type==='move'&&Number.isFinite(c.x)&&Number.isFinite(c.z)&&Math.abs(c.x)<=1&&Math.abs(c.z)<=1&&typeof c.sprint==='boolean')
      ||(c.type==='attack'&&(c.targetBodyId===undefined||identifier(c.targetBodyId)))
      ||(c.type==='interact'&&identifier(c.interactionId))
      ||(c.type==='defend'&&['sidestep','backstep','duck'].includes(c.kind)&&(c.side===undefined||c.side===-1||c.side===1))||c.type==='cancel');
    if(!valid) return remember(reject('invalid_command'));
    if(this.pending.length>=16) return remember(reject('queue_full'));
    this.pending.push({envelope:structuredClone(m as CommandEnvelope),receivedAtMs:now});
    return remember(this.receipt(m,'received','queued',tick,now,now));
  }
  apply(tick:number,now:number,execute:(c:InteractionCommand)=>string):CommandReceipt[] {
    const out:CommandReceipt[]=[];let moved=false;
    for(let count=0;this.pending.length&&count<8;count++) {
      const p=this.pending[0],c=p.envelope.command;
      if(c.type==='move'&&moved) break;
      this.pending.shift();
      const stale=now-p.receivedAtMs>INTERACTION_SPEC.inputHorizonSeconds*1000;
      const result=stale?'expired':execute(c);
      const status=result==='accepted'?'applied':'rejected';
      const r=this.receipt(p.envelope,status,result,tick,p.receivedAtMs,now);
      this.ledger.set(r.commandId,r);out.push(r);
      if(c.type==='move'&&!stale) moved=true;
    }
    return out;
  }
  cancel(tick:number,now:number):CommandReceipt[] {
    return this.pending.splice(0).map(p=>{const r=this.receipt(p.envelope,'cancelled','binding_released',tick,p.receivedAtMs,now);this.ledger.set(r.commandId,r);return r;});
  }
}
