import {describe,it,expect} from 'vitest';
import {NullEngine,Scene,PBRMaterial,MeshBuilder} from '@babylonjs/core';
import {allowFocusedCutaway} from '../src/web/realms/focusedAssets';
describe('actual Babylon glTF cutaway alpha policy',()=>{
 it('makes mesh opacity effective while preserving opaque normal rendering',()=>{const engine=new NullEngine(),scene=new Scene(engine),material=new PBRMaterial('imported-roof',scene),roof=MeshBuilder.CreateBox('roof',{},scene);roof.material=material;material.transparencyMode=PBRMaterial.PBRMATERIAL_OPAQUE;roof.visibility=.12;expect(material.needAlphaBlendingForMesh(roof)).toBe(false);allowFocusedCutaway(material);expect(material.needAlphaBlendingForMesh(roof)).toBe(true);roof.visibility=1;expect(material.needAlphaBlendingForMesh(roof)).toBe(false);scene.dispose();engine.dispose();});
 it.each([PBRMaterial.PBRMATERIAL_ALPHATEST,PBRMaterial.PBRMATERIAL_ALPHABLEND])('retains authored explicit alpha mode %s',mode=>{const engine=new NullEngine(),scene=new Scene(engine),m=new PBRMaterial('foliage-or-glass',scene);m.transparencyMode=mode;allowFocusedCutaway(m);expect(m.transparencyMode).toBe(mode);scene.dispose();engine.dispose();});
});
