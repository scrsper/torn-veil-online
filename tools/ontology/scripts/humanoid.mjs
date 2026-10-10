import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {findBlender} from './blender.mjs';
const args=process.argv.slice(2);
if(args.some(x=>!['male','female'].includes(x)))throw Error('Supported Human body studies: male female');
const r=spawnSync(findBlender(),['--background','--factory-startup','--python-exit-code','1','--python',resolve('blender/scripts/humanoid_family.py'),'--',...args],{stdio:'inherit'});
if(r.error)throw r.error;if(r.status)process.exit(r.status);
await import('./register-humanoids.mjs');
await import('./public-provenance.mjs');
