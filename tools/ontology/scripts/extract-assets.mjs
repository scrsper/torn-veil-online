import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const bundled=join(process.env.USERPROFILE??process.env.HOME??'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python=process.env.PYTHON_PATH??(existsSync(bundled)?bundled:'python');
const result=spawnSync(python,['scripts/extract-assets.py'],{stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status??1;
