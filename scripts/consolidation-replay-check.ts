import {createLivingPressure,advanceLiving,livingSnapshot} from '../src/headless/kernel/living';
import {createHash} from 'node:crypto';
const started=performance.now();
const lab=createLivingPressure(17,undefined,{steadyWind:.6});
advanceLiving(lab.world,lab.sim,5*86400/60);
const snapshot=livingSnapshot(lab.world);
console.log(JSON.stringify({seconds:(performance.now()-started)/1000,sha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),snapshot}));
