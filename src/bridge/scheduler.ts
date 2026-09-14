/** Monotonic fixed clock, bounded catch-up per turn. Debt is retained and reported, never
 * silently skipped; overload closes input admission through queue expiry/backpressure. */
export class FixedScheduler {
  private due:number;
  overruns=0; maxDebtMs=0; steps=0;
  constructor(readonly intervalMs:number,now:number,readonly catchUpLimit=4) {this.due=now+intervalMs;}
  remaining(now:number):number {return Math.max(0,this.due-now);}
  run(now:number,step:()=>void):number {
    const debt=Math.max(0,now-this.due);this.maxDebtMs=Math.max(this.maxDebtMs,debt);if(debt>=this.intervalMs)this.overruns++;
    let count=0;
    while(now+1e-7>=this.due&&count<this.catchUpLimit){this.due+=this.intervalMs;step();count++;this.steps++;}
    return Math.max(0,this.due-now);
  }
}
