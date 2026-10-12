import catalogData from './focusedCatalog.json';
import {StaticGeometry,type StaticTriangle} from '../../physical/staticGeometry';
import {placedPoint,type AssetPlacement,type AssetScenePlan,type FocusedConnector} from './focused';
export interface CatalogSource {id:string;role:string;sha256:string;glb:string;connectors:FocusedConnector[];spawn:[number,number,number];bounds:{min:number[];max:number[]};}
export const FOCUSED_CATALOG=catalogData as unknown as {version:1;packSha256:string;geometrySha256:string;sources:Record<string,CatalogSource>};
export type CookedSource={sha256:string;nodes:{name:string;support:boolean;positions:number[];indices:number[]}[]};
let sources:Record<string,CookedSource>|null=null;
/** The host verifies the file digest before registering the immutable source catalog.
 * Save/load fails closed if its required physical kit is missing or differs. */
export function registerFocusedGeometry(value:unknown,digest:string){const data=value as {version:number;packSha256:string;sources:Record<string,CookedSource>};
 if(digest!==FOCUSED_CATALOG.geometrySha256||data.version!==1||data.packSha256!==FOCUSED_CATALOG.packSha256)throw Error('Focused physical catalog differs');
 for(const [id,s]of Object.entries(FOCUSED_CATALOG.sources))if(data.sources[id]?.sha256!==s.sha256)throw Error('Focused physical source differs: '+id);
 sources=data.sources;
}
export const focusedGeometryReady=()=>sources!==null;
/** One transform derives rendering and mechanical geometry from the same source. */
export function sceneGeometry(plan:AssetScenePlan):StaticGeometry{
 if(!sources||plan.packSha256!==FOCUSED_CATALOG.packSha256)throw Error('Verified focused geometry is unavailable');
 const triangles:StaticTriangle[]=[],bounds={x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity};
 for(const placement of plan.placements){const source=sources[placement.assetId];if(!source)throw Error('Unknown physical asset');
  for(const node of source.nodes){const points:number[]=[];for(let i=0;i<node.positions.length;i+=3){const p=placedPoint(node.positions.slice(i,i+3) as [number,number,number],placement);points.push(...p);bounds.x0=Math.min(bounds.x0,p[0]);bounds.x1=Math.max(bounds.x1,p[0]);bounds.z0=Math.min(bounds.z0,p[2]);bounds.z1=Math.max(bounds.z1,p[2]);}
   for(let i=0;i<node.indices.length;i+=3){const p=node.indices.slice(i,i+3).flatMap(index=>points.slice(index*3,index*3+3));triangles.push({p,support:node.support});}}
 }return new StaticGeometry(triangles,bounds);
}
export function placementBounds(p:AssetPlacement){const b=FOCUSED_CATALOG.sources[p.assetId].bounds,corners=[];for(const x of [b.min[0],b.max[0]])for(const z of [b.min[2],b.max[2]])corners.push(placedPoint([x,0,z],p));return {x0:Math.min(...corners.map(c=>c[0])),z0:Math.min(...corners.map(c=>c[2])),x1:Math.max(...corners.map(c=>c[0])),z1:Math.max(...corners.map(c=>c[2]))};}
