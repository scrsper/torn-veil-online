import motion from './combatMotion.json';
/** Versioned authored physical paths, in metres relative to feet origin. The baked
 * visual clips use the same samples/timing; authority never queries a renderer. */
function sample(rows:number[][],t:number):number[]{
  if(t<=rows[0][0])return rows[0].slice(1);
  for(let i=1;i<rows.length;i++)if(t<=rows[i][0]){
    const a=rows[i-1],b=rows[i],f=(t-a[0])/(b[0]-a[0]);
    return a.slice(1).map((v,j)=>v+(b[j+1]-v)*f);
  }
  return rows[rows.length-1].slice(1);
}
export const sampledStrike=(variant:keyof typeof motion.attacks,progress:number):number[]=>sample(motion.attacks[variant].samples,progress*.15);
export const sampledPosture=(age:number):number=>age<0||age>motion.duck[motion.duck.length-1][0]?0:sample(motion.duck,age)[0];
