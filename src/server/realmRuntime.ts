import { RealmSession } from '../sim/world/realms/session';
import { TowerController } from './towerController';
import { applyTowerCommand, type TowerCommand } from './canonicalTower';
import { applyExpeditionCommand, validateExpeditionSave, type ExpeditionCommand } from './realmExpedition';
import type { MovementInput } from '../sim/physical/prediction';

/** Ordered host operations. Recorded server time, never client time, expires input.
 * The replay replica uses the same canonical simulation; it is not a second ruleset. */
export type RealmOperation = {type:'bind';id:string;epoch:string}
  | {type:'step';now:number} | {type:'frame'} | {type:'disconnect'}
  | {type:'command';input:unknown;now:number} | {type:'move';input:MovementInput}
  | {type:'interact'} | {type:'confirm';id:number} | {type:'cancel'}
  | {type:'navigate';target:'portal'|'tower'}
  | {type:'tower';command:TowerCommand} | {type:'expedition';command:ExpeditionCommand};
export interface RealmContinuation {
  citySteps:number;
  realm:ReturnType<RealmSession['checkpointControl']>;
  tower:ReturnType<TowerController['bridge']['checkpointControl']>|null;
}
export class RealmRuntime {
  tower:TowerController|null=null;
  private citySteps=0;
  constructor(public session:RealmSession, continuation?:RealmContinuation) {
    validateExpeditionSave(session);
    if(session.world.canonicalTower?.active)this.tower=new TowerController(session);
    if(continuation){this.citySteps=continuation.citySteps;session.restoreControl(continuation.realm);
      if(continuation.tower){if(!this.tower)throw Error('Tower continuation without active Tower');this.tower.bridge.restoreControl(continuation.tower);}}
  }
  checkpoint():RealmContinuation { return {citySteps:this.citySteps,realm:this.session.checkpointControl(),tower:this.tower?.bridge.checkpointControl()??null}; }
  apply(op:RealmOperation):any {
    const s=this.session;
    switch(op.type){
      case 'bind': return this.tower?.bind(op.id,op.epoch)??null;
      case 'command':return this.tower?.bridge.receiveCommand(op.input,op.now)??null;
      case 'step':if(s.world.canonicalTower?.active){if(!this.tower)throw Error('Missing Tower controller');return this.tower.step(op.now);}
        if(++this.citySteps>=3){this.citySteps=0;s.step(.05);}return [];
      // Projection currently delivers only transport deltas, but record its ordering
      // too, so future projection changes cannot silently create a replay gap.
      case 'frame':return this.tower?.frame()??s.snapshot();
      case 'disconnect':this.tower?.bridge.resetInput();s.stop();return;
      case 'move':return s.move(op.input);
      case 'interact':return s.interact();
      case 'confirm':return s.confirm(op.id);
      case 'cancel':return s.cancel();
      case 'navigate':return s.navigate(op.target);
      case 'tower':case 'expedition':{
        // Rare structural mutations retain one rollback capture. Routine autosaves
        // never enter this path and never stringify the live history.
        const before=s.save(),control=this.checkpoint();
        try {
          const value=op.type==='tower'?applyTowerCommand(s,op.command):applyExpeditionCommand(s,op.command);
          this.tower=s.world.canonicalTower?.active?new TowerController(s):null;
          return {value};
        }catch(e){const restored=new RealmRuntime(new RealmSession(0,before),control);
          this.session=restored.session;this.tower=restored.tower;this.citySteps=restored.citySteps;
          return {error:String(e)};}
      }
    }
  }
}
