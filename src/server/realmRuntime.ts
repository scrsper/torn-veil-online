import { RealmSession } from '../sim/world/realms/session';
import { TowerController } from './towerController';
import { applyTowerCommand, type TowerCommand } from './canonicalTower';
import { applyExpeditionCommand, validateExpeditionSave, type ExpeditionCommand } from './realmExpedition';
import type { MovementInput } from '../sim/physical/prediction';

/** Ordered host operations. Recorded server time, never client time, expires input.
 * The replay replica uses the same canonical simulation; it is not a second ruleset. */
export type RealmOperation = {type:'bind';id:string;epoch:string}
  | {type:'step';now:number} | {type:'frame'} | {type:'disconnect'} | {type:'adopt_focused';migration?:import('../sim/world/realms/session').FocusedTowerMigration}
  | {type:'command';input:unknown;now:number} | {type:'move';input:MovementInput}
  | {type:'interact'} | {type:'confirm';id:number} | {type:'cancel'}
  | {type:'navigate';target:'portal'|'tower'}
  | {type:'tower';command:TowerCommand} | {type:'expedition';command:ExpeditionCommand};
export interface RealmContinuation {
  citySteps:number;
  realm:ReturnType<RealmSession['checkpointControl']>;
  tower:ReturnType<TowerController['bridge']['checkpointControl']>|null;
  controller?:ReturnType<TowerController['bridge']['checkpointControl']>|null;
}
export class RealmRuntime {
  controller:TowerController;
  get tower():TowerController|null { return this.session.world.canonicalTower?.active ? this.controller : null; }
  private citySteps=0;
  constructor(public session:RealmSession, continuation?:RealmContinuation) {
    validateExpeditionSave(session);
    this.controller=new TowerController(session);
    if(continuation){this.citySteps=continuation.citySteps;session.restoreControl(continuation.realm);
      if(continuation.tower){if(!this.tower)throw Error('Tower continuation without active Tower');this.tower.bridge.restoreControl(continuation.tower);}
      else if(continuation.controller)this.controller.bridge.restoreControl(continuation.controller);}
  }
  checkpoint():RealmContinuation { return {citySteps:this.citySteps,realm:this.session.checkpointControl(),tower:this.tower?.bridge.checkpointControl()??null,controller:this.tower?null:this.controller.bridge.checkpointControl()}; }
  apply(op:RealmOperation):any {
    const s=this.session;
    switch(op.type){
      case 'adopt_focused':{
        const result=s.adoptFocusedWorld(op.migration);
        this.controller.bridge.resetInput();return result;
      }
      case 'bind': return this.controller.bind(op.id,op.epoch);
      case 'command':{
        const receipt=this.controller.bridge.receiveCommand(op.input,op.now);
        const command=(op.input as {command?:{type?:string;x?:number;z?:number;facing?:number;crouch?:boolean}})?.command;
        if(receipt?.status==='received' && command?.type==='move' && (command.x || command.z || command.facing!==undefined || command.crouch))s.body.path=null;
        return receipt;
      }
      case 'step':return s.world.realmExpedition?.active?[]:this.controller.step(op.now);
      // Projection currently delivers only transport deltas, but record its ordering
      // too, so future projection changes cannot silently create a replay gap.
      case 'frame':return this.tower?.frame()??s.snapshot();
      case 'disconnect':this.controller.bridge.resetInput();s.stop();return;
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
          this.controller=new TowerController(s);
          return {value};
        }catch(e){const restored=new RealmRuntime(new RealmSession(0,before),control);
          this.session=restored.session;this.controller=restored.controller;this.citySteps=restored.citySteps;
          return {error:String(e)};}
      }
    }
  }
}
