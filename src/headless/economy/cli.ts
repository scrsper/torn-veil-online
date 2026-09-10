import { mkdirSync, writeFileSync } from 'node:fs';
import { runEconomyTrace } from './trace';
const args=process.argv.slice(2);
const value=(key:string,fallback:number)=>args.includes(key)?Number(args[args.indexOf(key)+1]):fallback;
const report=runEconomyTrace({seed:value('--seed',918271),days:value('--days',30),
  proceduralSite:args.includes('--site')?value('--site',0):undefined,
  onProgress:day=>console.log(`Completed ${day} world days`),
});
mkdirSync('.debug/economy',{recursive:true});
const path=`.debug/economy/${report.scenario}-${report.seed}-${report.days}d.json`;
writeFileSync(path,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:path,hash:report.hash,samples:report.samples.map(s=>({day:s.day,population:s.population,
  zeroEnergy:s.zeroEnergy,medianEnergy:s.medianEnergy,currency:s.currency,food:s.food,mealFailures:s.mealFailures}))},null,2));
