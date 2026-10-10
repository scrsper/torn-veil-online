import type {AssetRecord} from '../ontology/schema';
export interface AssetProvider {
 readonly id:string;
 list():readonly AssetRecord[];
 get(id:string):AssetRecord|undefined;
 /** Providers supply geometry metadata, never gameplay identity. */
 capabilities:readonly string[];
}
export class RegistryProvider implements AssetProvider {
 constructor(public readonly id:string,private readonly records:readonly AssetRecord[],public capabilities:readonly string[]=['prebuilt']){}
 list(){return this.records.filter(a=>a.provider===this.id);}
 get(id:string){return this.list().find(a=>a.id===id);}
}
export class QuaterniusProvider extends RegistryProvider{constructor(a:readonly AssetRecord[]){super('quaternius',a,['prebuilt','rigged','animation']);}}
export class MPFBProvider extends RegistryProvider{constructor(a:readonly AssetRecord[]){super('mpfb',a,['offline-morphology']);}}
export class LocalAssetProvider extends RegistryProvider{constructor(a:readonly AssetRecord[]){super('local',a);}}
export class GeneratedAssetProvider extends RegistryProvider{constructor(a:readonly AssetRecord[]){super('generated',a,['offline-build']);}}
export class ProviderRegistry {
 constructor(private readonly providers:readonly AssetProvider[]){const ids=providers.map(p=>p.id);if(new Set(ids).size!==ids.length)throw Error('Duplicate provider ID');const assets=providers.flatMap(p=>[...p.list()]);if(new Set(assets.map(a=>a.id)).size!==assets.length)throw Error('Duplicate asset ID');}
 get(id:string){for(const p of this.providers){const a=p.get(id);if(a)return a;}return undefined;}
}
