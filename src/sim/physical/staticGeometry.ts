import type {Vec3} from '../core/types';
export interface StaticTriangle {p:number[];support:boolean;node?:string;}
export interface GeometryWindow {bounds:{x0:number;z0:number;x1:number;z1:number};triangles:StaticTriangle[];}
export interface MovementGeometry {
 supportAt(x:number,z:number,fromY:number,step?:number):number|null;
 fits(x:number,y:number,z:number,radius:number,height:number):boolean;
 window(x:number,z:number,size:number):GeometryWindow;
 blocked(x:number,y:number,z:number):boolean;
 lineClear(a:Vec3,b:Vec3):boolean;
 findPath(a:Vec3,b:Vec3,maxIter?:number):Vec3[]|null;
}
type V=[number,number,number];
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a:V,b:V):V=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a:V,s:number):V=>[a[0]*s,a[1]*s,a[2]*s],dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],clamp=(v:number)=>Math.max(0,Math.min(1,v));
function pointTriangle(p:V,a:V,b:V,c:V):number{
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return dot(ap,ap);
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return dot(bp,bp);
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const d=sub(p,add(a,mul(ab,d1/(d1-d3))));return dot(d,d);}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return dot(cp,cp);
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const d=sub(p,add(a,mul(ac,d2/(d2-d6))));return dot(d,d);}
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const d=sub(p,add(b,mul(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6)))));return dot(d,d);}
 const sum=va+vb+vc;if(Math.abs(sum)<1e-15)return Math.min(dot(ap,ap),dot(bp,bp),dot(cp,cp));const closest=add(a,add(mul(ab,vb/sum),mul(ac,vc/sum))),d=sub(p,closest);return dot(d,d);
}
function segmentDistance(p:V,q:V,a:V,b:V):number{
 const d1=sub(q,p),d2=sub(b,a),r=sub(p,a),aa=dot(d1,d1),ee=dot(d2,d2),f=dot(d2,r);let s=0,t=0;
 if(aa<1e-12&&ee<1e-12)return dot(r,r);
 if(aa<1e-12)t=clamp(f/ee);else{const c=dot(d1,r);if(ee<1e-12)s=clamp(-c/aa);else{const bb=dot(d1,d2),den=aa*ee-bb*bb;s=den?clamp((bb*f-c*ee)/den):0;t=(bb*s+f)/ee;if(t<0){t=0;s=clamp(-c/aa);}else if(t>1){t=1;s=clamp((bb-c)/aa);}}}
 const d=sub(add(p,mul(d1,s)),add(a,mul(d2,t)));return dot(d,d);
}
function intersects(p:V,q:V,a:V,b:V,c:V):boolean{
 const dir=sub(q,p),ab=sub(b,a),ac=sub(c,a),h=cross(dir,ac),det=dot(ab,h);if(Math.abs(det)<1e-10)return false;
 const inv=1/det,s=sub(p,a),u=dot(s,h)*inv;if(u<0||u>1)return false;const k=cross(s,ab),v=dot(dir,k)*inv;if(v<0||u+v>1)return false;const t=dot(ac,k)*inv;return t>=0&&t<=1;
}
export function capsuleTriangleDistance(x:number,y:number,z:number,r:number,h:number,p:readonly number[]):number{
 const a=p.slice(0,3) as V,b=p.slice(3,6) as V,c=p.slice(6,9) as V,lo:V=[x,y+r,z],hi:V=[x,y+Math.max(r,h-r),z];
 if(intersects(lo,hi,a,b,c))return 0;return Math.sqrt(Math.min(pointTriangle(lo,a,b,c),pointTriangle(hi,a,b,c),segmentDistance(lo,hi,a,b),segmentDistance(lo,hi,b,c),segmentDistance(lo,hi,c,a)));
}
/** A bounded spatial index of actual source triangles. This is canonical collision
 * support for asset areas, shared by movement/prediction/navigation, not renderer picking. */
export class StaticGeometry implements MovementGeometry {
 private cells=new Map<string,number[]>();private readonly box:GeometryWindow['bounds'];
 private navSamples=new Map<string,number|null>();
 private supportPlanes=new Map<StaticTriangle,{den:number;minX:number;maxX:number;minZ:number;maxZ:number;maxY:number}>();
 constructor(readonly triangles:StaticTriangle[],bounds:GeometryWindow['bounds']){this.box=bounds;
  for(const [i,t]of triangles.entries()){if(t.p.length!==9||!t.p.every(Number.isFinite))throw Error('Invalid static triangle');const xs=[t.p[0],t.p[3],t.p[6]],zs=[t.p[2],t.p[5],t.p[8]];
   if(t.support){const p=t.p,n=cross(sub(p.slice(3,6) as V,p.slice(0,3) as V),sub(p.slice(6,9) as V,p.slice(0,3) as V)),den=(p[5]-p[8])*(p[0]-p[6])+(p[6]-p[3])*(p[2]-p[8]);if(Math.abs(den)>1e-10&&n[1]/Math.hypot(...n)>=.65)this.supportPlanes.set(t,{den,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),maxY:Math.max(p[1],p[4],p[7])});}
   for(let x=Math.floor(Math.min(...xs)/2);x<=Math.floor(Math.max(...xs)/2);x++)for(let z=Math.floor(Math.min(...zs)/2);z<=Math.floor(Math.max(...zs)/2);z++){const key=x+','+z;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key)!.push(i);}}
 }
 contains(x:number,z:number){return x>=this.box.x0&&x<=this.box.x1&&z>=this.box.z0&&z<=this.box.z1;}
 get bounds(){return {...this.box};}
 sampleGroundAt(x:number,z:number,fromY=1){return this.supportSample(x,z,fromY,1.05);}
 private candidates(x:number,z:number,r=0):StaticTriangle[]{const ids=new Set<number>();for(let ix=Math.floor((x-r)/2);ix<=Math.floor((x+r)/2);ix++)for(let iz=Math.floor((z-r)/2);iz<=Math.floor((z+r)/2);iz++)for(const i of this.cells.get(ix+','+iz)??[])ids.add(i);return [...ids].map(i=>this.triangles[i]);}
 private supportSample(x:number,z:number,fromY:number,step:number):number|null{let best:number|null=null;
  for(const t of this.candidates(x,z)){const plane=this.supportPlanes.get(t);if(!plane||x<plane.minX-1e-6||x>plane.maxX+1e-6||z<plane.minZ-1e-6||z>plane.maxZ+1e-6)continue;const p=t.p,ax=p[0],az=p[2],bx=p[3],bz=p[5],cx=p[6],cz=p[8],den=plane.den;
   const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;if(Math.min(u,v,w)<-1e-6)continue;
   const y=u*p[1]+v*p[4]+w*p[7];if(Math.abs(y-fromY)<=step&&(best===null||y>best))best=y;
  }return best;
 }
 supportAt(x:number,z:number,fromY:number,step=1.05):number|null{
  const direct=this.supportSample(x,z,fromY,step);if(direct!==null){
   // A capsule rests on the supported footprint, not in the mortar between
   // 6.25 cm raised paving stones. All heights still come from actual triangles.
   const ring=[[.24,0],[-.24,0],[0,.24],[0,-.24],[.17,.17],[-.17,.17],[-.17,-.17],[.17,-.17]].map(([dx,dz])=>this.supportSample(x+dx,z+dz,fromY,step)).filter((v):v is number=>v!==null);
   // Include exact nearby support edges. Eight rays alone miss a stone corner
   // inside the capsule footprint and can drop the feet into its bevel/mortar.
   const supported=Math.max(direct,...ring.filter(y=>Math.abs(y-direct)<=.225)),edges:number[]=[];for(const t of this.candidates(x,z,.3)){const plane=this.supportPlanes.get(t);if(!plane||plane.maxY<=supported+1e-6)continue;const p=t.p;let nearest=Infinity,y=direct;
    for(let k=0;k<3;k++){const a=k*3,b=((k+1)%3)*3,dx=p[b]-p[a],dz=p[b+2]-p[a+2],u=clamp(((x-p[a])*dx+(z-p[a+2])*dz)/(dx*dx+dz*dz||1)),qx=p[a]+dx*u,qz=p[a+2]+dz*u,d=(x-qx)**2+(z-qz)**2;if(d<nearest){nearest=d;y=p[a+1]+(p[b+1]-p[a+1])*u;}}
    if(nearest<=.3*.3&&Math.abs(y-direct)<=.225)edges.push(y);
   }
   return Math.max(supported,...edges);
  }
  // Bridge only the source's <=5 cm bevel seams; never invent floor across a gap.
  const ring=[[-.025,0],[.025,0],[0,-.025],[0,.025]].map(([dx,dz])=>this.supportSample(x+dx,z+dz,fromY,step));
  if(ring.every(h=>h!==null)&&Math.max(...ring as number[])-Math.min(...ring as number[])<.1)return Math.max(...ring as number[]);return null;
 }
 fits(x:number,y:number,z:number,r:number,h:number):boolean{
  const feet=[[-r*.7,0],[r*.7,0],[0,-r*.7],[0,r*.7]].map(([dx,dz])=>this.supportAt(x+dx,z+dz,y,.24));if(feet.some(v=>v===null)||Math.max(...feet as number[])-Math.min(...feet as number[])>.225)return false;
  for(const t of this.candidates(x,z,r)){const p=t.p;if(Math.max(p[1],p[4],p[7])<=y+.012||Math.min(p[1],p[4],p[7])>y+h+.01)continue;
   if(capsuleTriangleDistance(x,y+.012,z,r,h-.012,p)<r-.012)return false;}return true;
 }
 blocked(x:number,y:number,z:number):boolean{return this.candidates(x,z,.025).some(t=>pointTriangle([x,y,z],t.p.slice(0,3) as V,t.p.slice(3,6) as V,t.p.slice(6,9) as V)<.025*.025);}
 lineClear(a:Vec3,b:Vec3):boolean{const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z))),seen=new Set<StaticTriangle>();for(let i=0;i<=count;i++){const f=i/count;for(const t of this.candidates(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f,1.1))seen.add(t);}return ![...seen].some(t=>intersects([a.x,a.y,a.z],[b.x,b.y,b.z],t.p.slice(0,3) as V,t.p.slice(3,6) as V,t.p.slice(6,9) as V));}
 private certifyRoute(a:Vec3,points:Vec3[]):number|null{let previous={...a};for(let i=0;i<points.length;i++){const target=points[i],start={...previous},steps=Math.max(1,Math.ceil(Math.hypot(target.x-start.x,target.z-start.z)/.04));for(let n=1;n<=steps;n++){const x=start.x+(target.x-start.x)*n/steps,z=start.z+(target.z-start.z)*n/steps,y=this.supportAt(x,z,previous.y);if(y===null||!this.fits(x,y,z,.3,1.8))return i;previous={x,y,z};}}return null;}
 findPath(a:Vec3,b:Vec3,maxIter=32000):Vec3[]|null{
  const step=.25,width=Math.ceil((this.box.x1-this.box.x0)/step)+1,depth=Math.ceil((this.box.z1-this.box.z0)/step)+1,base=a.y;
  if(!this.contains(a.x,a.z)||!this.contains(b.x,b.z)||Math.abs(a.y-b.y)>1)return null;
  const xy=(id:number)=>({x:this.box.x0+(id%width)*step,z:this.box.z0+Math.floor(id/width)*step});
  const sample=(id:number):number|null=>{const key=id+':'+base;if(this.navSamples.has(key))return this.navSamples.get(key)!;const p=xy(id);let y=this.supportAt(p.x,p.z,base);if(y!==null&&!this.fits(p.x,y,p.z,.3,1.75))y=null;if(this.navSamples.size>120000)this.navSamples.clear();this.navSamples.set(key,y);return y;};
  const nearest=(p:Vec3)=>{const ix=Math.round((p.x-this.box.x0)/step),iz=Math.round((p.z-this.box.z0)/step);for(let r=0;r<5;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const x=ix+dx,z=iz+dz,id=z*width+x;if(x>=0&&z>=0&&x<width&&z<depth&&sample(id)!==null)return id;}return -1;};
  const start=nearest(a),goal=nearest(b);if(start<0||goal<0)return null;
  const heap:{id:number;f:number}[]=[],push=(id:number,f:number)=>{heap.push({id,f});let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].f<=heap[i].f)break;[heap[i],heap[p]]=[heap[p],heap[i]];i=p;}},pop=()=>{const result=heap[0].id,last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let k=i;if(l<heap.length&&heap[l].f<heap[k].f)k=l;if(r<heap.length&&heap[r].f<heap[k].f)k=r;if(k===i)break;[heap[i],heap[k]]=[heap[k],heap[i]];i=k;}}return result;};
  const costs=new Map<number,number>([[start,0]]),previous=new Map<number,number>(),closed=new Set<number>(),banned=new Set<string>(),gxy=xy(goal),heuristic=(id:number)=>{const p=xy(id);return Math.hypot(p.x-gxy.x,p.z-gxy.z);};push(start,heuristic(start));let attempts=0;
  const directions=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]];
  for(let n=0;heap.length&&n<maxIter;n++){const id=pop();if(closed.has(id))continue;if(id===goal){const path:number[]=[id];while(previous.has(path[0]))path.unshift(previous.get(path[0])!);const points=path.slice(1).map(k=>({...xy(k),y:sample(k)!})),bad=this.certifyRoute(a,points);if(bad===null)return points;if(++attempts>8)return null;const from=path[bad],to=path[bad+1];banned.add(from+':'+to);banned.add(to+':'+from);heap.length=0;costs.clear();costs.set(start,0);previous.clear();closed.clear();push(start,heuristic(start));n=-1;continue;}closed.add(id);
   const ix=id%width,iz=Math.floor(id/width),y=sample(id)!;
   for(const [dx,dz]of directions){const x=ix+dx,z=iz+dz;if(x<0||z<0||x>=width||z>=depth)continue;const next=z*width+x;if(banned.has(id+':'+next))continue;const ny=sample(next);if(ny===null||Math.abs(ny-y)>.225||closed.has(next))continue;
    if(dx&&dz&&(sample(iz*width+x)===null||sample(z*width+ix)===null))continue;
    const cost=costs.get(id)!+Math.hypot(dx,dz)*step;if(cost>=(costs.get(next)??Infinity))continue;costs.set(next,cost);previous.set(next,id);push(next,cost+heuristic(next));}
  }return null;
 }
 window(x:number,z:number,size:number):GeometryWindow{const set=new Set<StaticTriangle>();for(let ix=x;ix<=x+size;ix+=1)for(let iz=z;iz<=z+size;iz+=1)for(const t of this.candidates(ix,iz,1))set.add(t);return {bounds:{x0:Math.max(x,this.box.x0),z0:Math.max(z,this.box.z0),x1:Math.min(x+size,this.box.x1),z1:Math.min(z+size,this.box.z1)},triangles:[...set]};}
}
