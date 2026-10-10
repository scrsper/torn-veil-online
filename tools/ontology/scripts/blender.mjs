import {existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
export function findBlender(){
 if(process.env.BLENDER_PATH&&existsSync(process.env.BLENDER_PATH))return process.env.BLENDER_PATH;
 const root=join(process.env.ProgramFiles??'C:/Program Files','Blender Foundation');
 if(existsSync(root)){for(const dir of readdirSync(root).sort().reverse()){const path=join(root,dir,'blender.exe');if(existsSync(path))return path;}}
 return 'blender';
}
export function runBlender(args){const result=spawnSync(findBlender(),['--background','--factory-startup','--python-exit-code','1','--python',resolve('blender/scripts/pipeline.py'),'--',...args],{stdio:'inherit',env:process.env});if(result.error)throw result.error;if(result.status!==0)throw Error(`Blender failed (${result.status})`);}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))runBlender(process.argv.slice(2));
