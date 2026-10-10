import {spawnSync} from 'node:child_process';
import {findBlender} from './blender.mjs';
const r=spawnSync(findBlender(),['--background','--factory-startup','--python-exit-code','1','--python','blender/scripts/omni_family.py','--','male'],{stdio:'inherit'});if(r.error)throw r.error;if(r.status)process.exit(r.status);
await import('./register-omni.mjs');
