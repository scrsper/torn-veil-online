/** Shared fixed world-space setup. Never normalize each subject to equal screen height. */
export const comparisonContract={version:1,units:'meters',pose:'rest',lighting:'catalog-neutral-v1',floorY:0,camera:{alpha:-Math.PI/2,beta:1.25,radius:8,targetY:1},spacingM:3,independentAutoFrame:false} as const;
export interface ComparisonRequest{entityIds:string[];appearanceSeeds:number[];artDirectionProfileId:string;}
