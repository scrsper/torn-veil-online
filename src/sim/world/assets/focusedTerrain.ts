import {StaticGeometry,type StaticTriangle} from '../../physical/staticGeometry';
export interface FocusedTerrain {id:string;positions:number[];indices:number[];bounds:{x0:number;z0:number;x1:number;z1:number};}
/** One canonical height field joins the authored spaces. Samples follow actual
 * imported support and remain below it; no imported floor is replaced or covered. */
export function focusedTerrain(id:string,source:StaticGeometry):FocusedTerrain{
 const b=source.bounds,step=2,x0=Math.floor((b.x0-20)/step)*step,z0=Math.floor((b.z0-20)/step)*step,w=Math.ceil((b.x1+20-x0)/step)+1,d=Math.ceil((b.z1+20-z0)/step)+1;
 const heights=Array<number>(w*d).fill(NaN),queue:number[]=[],positions:number[]=[],indices:number[]=[];
 for(let z=0;z<d;z++)for(let x=0;x<w;x++){const h=source.sampleGroundAt(x0+x*step,z0+z*step);if(h!==null){const i=z*w+x;heights[i]=h-.04;queue.push(i);}}
 for(let cursor=0;cursor<queue.length;cursor++){const i=queue[cursor],x=i%w,z=Math.floor(i/w);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=w||nz>=d)continue;const n=nz*w+nx;if(Number.isNaN(heights[n])){heights[n]=heights[i];queue.push(n);}}}
 for(let z=0;z<d;z++)for(let x=0;x<w;x++)positions.push(x0+x*step,Number.isFinite(heights[z*w+x])?heights[z*w+x]:.9,z0+z*step);
 for(let z=0;z<d-1;z++)for(let x=0;x<w-1;x++){const a=z*w+x,b=a+1,c=a+w,e=c+1;indices.push(a,c,b,b,c,e);}
 // Keep interpolation beneath source relief, including original forest slopes.
 for(let pass=0;pass<2;pass++)for(let i=0;i<indices.length;i+=3){const ids=indices.slice(i,i+3);let correction=0;
  for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){const p=[0,0,0];for(let k=0;k<3;k++)for(let axis=0;axis<3;axis++)p[axis]+=positions[ids[k]*3+axis]*weights[k];const h=source.sampleGroundAt(p[0],p[2]);if(h!==null)correction=Math.max(correction,p[1]-(h-.025));}
  if(correction>0)for(const v of ids)positions[v*3+1]-=correction;
 }
 return {id,positions,indices,bounds:{x0,z0,x1:x0+(w-1)*step,z1:z0+(d-1)*step}};
}
export function terrainTriangles(t:FocusedTerrain):StaticTriangle[]{const out:StaticTriangle[]=[];for(let i=0;i<t.indices.length;i+=3)out.push({p:t.indices.slice(i,i+3).flatMap(v=>t.positions.slice(v*3,v*3+3)),support:true,node:t.id});return out;}
