import {readFileSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';import {resolve} from 'node:path';
import {registerFocusedGeometry,focusedGeometryReady} from '../sim/world/assets/focusedRuntime';
/** Both canonical writer and replay replica require the identical verified kit. */
export function loadFocusedGeometry(){if(focusedGeometryReady())return;const path=resolve('web/public/focused/collision.json');if(!existsSync(path))return;const bytes=readFileSync(path);registerFocusedGeometry(JSON.parse(bytes.toString('utf8')),createHash('sha256').update(bytes).digest('hex'));}
