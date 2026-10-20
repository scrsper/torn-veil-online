import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {stageHumanMotion} from './stage-human-motion.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'web/public');
stageHumanMotion();
const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
const sources=[process.env.TV_REALMS_ASSETS,join(dirname(common),'web/public')].filter(Boolean).map(p=>resolve(p));
const required=[
 ['arena/mixamo_clips.glb','91dfc81c73db1be5983119f586550ce6c201389d9b3c24e755ca143367484de7','Existing user Mixamo packs; Adobe game-use terms; raw files stay gitignored.'],
 ['arena/unarmed_clips.glb','33e75a1991e07ee72f7bdde26461c6987df49f1ae29414dfb5cc88b0ee3fa2b3','Existing Motifect/UE unarmed gameplay motion; raw files stay gitignored.'],
];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),receipt=[];
for(const [relative,expected,provenance] of required){
 const target=join(out,relative);
 if(existsSync(target)&&hash(target)!==expected)throw Error(`${relative} differs from the audited motion. Original retained; review its provenance before updating the expected hash.`);
 let source=target;
 if(!existsSync(target)){
  source=sources.map(base=>join(base,relative)).find(p=>existsSync(p)&&hash(p)===expected);
  if(!source)throw Error(`Missing audited ${relative}. Supply the existing licensed local assets with TV_REALMS_ASSETS or rebuild from your downloads; see docs/COMBAT_ARENA.md. Current build cannot use silent stand-ins.`);
  mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
 }
 if(hash(target)!==expected)throw Error(`${relative}: staged hash mismatch`);
 receipt.push({relative,sha256:expected,provenance,source});
 console.log(`verified local dependency ${relative} ${expected}`);
}
for(const file of ['models/kit_m.glb','models/kit_f.glb','models/kit_c.glb'])if(!existsSync(join(out,file)))throw Error(`Missing ${file}; run npm run web:assets to build the local fallback kit.`);
writeFileSync(join(out,'arena/runtime-dependencies.json'),JSON.stringify({kind:'audited-local-game-dependencies',files:receipt},null,2)+'\n');
