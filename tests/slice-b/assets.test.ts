import { describe,it,expect,vi } from 'vitest';
import { parseManifest,loadOptionalAsset } from '../../src/web/presentation/assetManifest';
const entry={id:'tower-chest',path:'props/chest.glb',sha256:'a'.repeat(64),license:'CC0-1.0'};
describe('optional asset provenance and fallback',()=>{
 it('rejects missing licenses, hashes, traversal and duplicate IDs',()=>{expect(parseManifest({version:1,assets:[entry,entry,{...entry,id:'bad',path:'../secret.glb'},{...entry,id:'unlicensed',license:''},{...entry,id:'hash',sha256:'bad'}]}).assets).toEqual([entry]);expect(parseManifest(null).assets).toEqual([]);});
 it('silently uses fallback for missing manifests and failed imports',async()=>{const load=vi.fn().mockRejectedValue(Error('absent'));const fallback=vi.fn(()=> 'procedural');expect(await loadOptionalAsset(parseManifest(null),'tower-chest',load,fallback)).toBe('procedural');expect(load).not.toHaveBeenCalled();expect(await loadOptionalAsset({version:1,assets:[entry]},entry.id,load,fallback)).toBe('procedural');});
 it('passes verified manifest URL and hash to importer',async()=>{const load=vi.fn(async()=> 'GLB');expect(await loadOptionalAsset({version:1,assets:[entry]},entry.id,load,()=> 'fallback')).toBe('GLB');expect(load).toHaveBeenCalledWith('/arena/creator/optional-assets/props/chest.glb',entry.sha256);});
});
