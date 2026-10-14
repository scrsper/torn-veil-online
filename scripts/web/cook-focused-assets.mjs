/** Derive canonical static triangles from verified GLBs. Never changes source art. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),base=resolve(root,'web/public/focused');
const manifest=JSON.parse(readFileSync(resolve(base,'runtime_manifest.json'))),lock=JSON.parse(readFileSync(resolve(base,'pack.lock.json')));
if(lock.archiveSha256!=='f7b0869a795bb28551a31c7831fb6edbfb0716724fca733286e169c0d25926ce')throw Error('Unverified source');
const digest=b=>createHash('sha256').update(b).digest('hex');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const multiply=(a,b)=>Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);let v=0;for(let k=0;k<4;k++)v+=a[row+k*4]*b[k+col*4];return v;});
function matrix(n){if(n.matrix)return n.matrix;const [x,y,z,w]=n.rotation??[0,0,0,1],[sx,sy,sz]=n.scale??[1,1,1],[tx,ty,tz]=n.translation??[0,0,0];return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,(2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,(2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];}
const soft=['grass_tuft','landscape_cabbage','landscape_carrot_row','landscape_crop_row','landscape_wheat_clump','landscape_wheat_row','processional_rug','scale_guide','wall_ivy'];
function cook(file,expected){const bytes=readFileSync(resolve(base,file));if(digest(bytes)!==expected)throw Error('Source hash differs: '+file);const jsonLength=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),bin=bytes.subarray(28+jsonLength);
 if(g.buffers.some(b=>b.uri)||g.images?.some(i=>i.uri&&!i.uri.startsWith('data:')))throw Error('External GLB resource');
 function accessor(i){const a=g.accessors[i],v=g.bufferViews[a.bufferView],count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],method={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];if(!size||!count||a.sparse)throw Error('Unsupported static accessor');return Array.from({length:a.count*count},(_,k)=>bin[method]((v.byteOffset??0)+(a.byteOffset??0)+Math.floor(k/count)*(v.byteStride??count*size)+(k%count)*size));}
 const nodes=[];function visit(i,parent){const n=g.nodes[i],m=multiply(parent,matrix(n));if(n.mesh!==undefined&&!soft.some(s=>n.name?.includes(s))){for(const p of g.meshes[n.mesh].primitives){if(p.mode!==undefined&&p.mode!==4)throw Error('Nontriangle source');const raw=accessor(p.attributes.POSITION),positions=[];for(let k=0;k<raw.length;k+=3){const [x,y,z]=raw.slice(k,k+3);for(let row=0;row<3;row++)positions.push(Math.round((m[row]*x+m[row+4]*y+m[row+8]*z+m[row+12])*100000)/100000);}nodes.push({name:n.name??String(i),support:/floor_|continuous_ground|(?:^|_)stairs_/.test(n.name??''),positions,indices:p.indices===undefined?Array.from({length:positions.length/3},(_,k)=>k):accessor(p.indices)});}}for(const c of n.children??[])visit(c,m);}
 for(const i of g.scenes[g.scene??0].nodes)visit(i,identity);return {sha256:expected,nodes};}
const sources={};for(const a of manifest.assets)sources[a.id]=cook(a.glb,a.glb_sha256);
const components=JSON.parse(readFileSync(resolve(base,manifest.components_catalog)));for(const [id,c] of Object.entries(components))sources['module:'+id]=cook(c.glb,c.sha256);
const data={version:1,packSha256:lock.archiveSha256,precisionM:.00001,sources};
const target=resolve(root,'web/public/focused/collision.json');writeFileSync(target,JSON.stringify(data)+'\n');
const catalog={version:1,packSha256:lock.archiveSha256,geometrySha256:digest(readFileSync(target)),sources:{}};
for(const [id,s]of Object.entries(sources)){const a=manifest.assets.find(a=>a.id===id),component=components[id.slice(7)],positions=s.nodes.flatMap(n=>n.positions),axis=i=>positions.filter((_,k)=>k%3===i);
 catalog.sources[id]={id,role:a?.role??'module',sha256:s.sha256,glb:a?.glb??component.glb,connectors:a?.connectors.map(c=>({id:c.id,gltf_position_m:c.gltf_position_m,gltf_outward:c.gltf_outward}))??[],
  spawn:a?.safe_spawn_suggestion.gltf_feet_position_m??[0,0,0],bounds:{min:[0,1,2].map(i=>axis(i).reduce((a,b)=>Math.min(a,b),Infinity)),max:[0,1,2].map(i=>axis(i).reduce((a,b)=>Math.max(a,b),-Infinity))}};
}
writeFileSync(resolve(root,'src/sim/world/assets/focusedCatalog.json'),JSON.stringify(catalog)+'\n');
console.log(JSON.stringify({sources:Object.keys(sources).length,triangles:Object.values(sources).reduce((n,s)=>n+s.nodes.reduce((v,m)=>v+m.indices.length/3,0),0),bytes:readFileSync(target).length,sha256:digest(readFileSync(target))}));
