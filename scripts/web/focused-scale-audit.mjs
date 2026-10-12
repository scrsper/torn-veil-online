/** Read-only metre audit of the exact registered meshes; never rescales source art. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]??'.debug/motion-correction/scale-review/source-dimensions.json');
const bounds=positions=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let k=0;k<positions.length;k++) {const axis=k%3;min[axis]=Math.min(min[axis],positions[k]);max[axis]=Math.max(max[axis],positions[k]);}return {min,max,dimensions:max.map((v,i)=>v-min[i])};};
const cooked=JSON.parse(readFileSync(resolve(root,'web/public/focused/collision.json'))),catalog=JSON.parse(readFileSync(resolve(root,'src/sim/world/assets/focusedCatalog.json')));
const sources={};for(const [id,s]of Object.entries(cooked.sources)){
 if(!/timber_house|tavern|general_store|forest|city_street/.test(id))continue;
 sources[id]={sourceSha256:s.sha256,bounds:catalog.sources[id].bounds,nodes:s.nodes.map(n=>({name:n.name,support:n.support,...bounds(n.positions)}))};
}
const file=resolve(root,'web/public/arena/people/wren.glb'),bytes=readFileSync(file),len=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+len)),bin=bytes.subarray(28+len),parts=[];
function values(i){const a=g.accessors[i],v=g.bufferViews[a.bufferView],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];if(a.sparse||!read)throw Error('Unsupported accessor');return Array.from({length:a.count*count},(_,k)=>bin[read]((v.byteOffset??0)+(a.byteOffset??0)+Math.floor(k/count)*(v.byteStride??size*count)+(k%count)*size));}
function local(n){return n.matrix?Matrix.FromArray(n.matrix):Matrix.Compose(Vector3.FromArray(n.scale??[1,1,1]),Quaternion.FromArray(n.rotation??[0,0,0,1]),Vector3.FromArray(n.translation??[0,0,0]));}
function visit(i,parent){const n=g.nodes[i],world=local(n).multiply(parent);if(n.mesh!==undefined){for(const [pi,p]of g.meshes[n.mesh].primitives.entries()){const raw=values(p.attributes.POSITION),positions=[];for(let k=0;k<raw.length;k+=3)positions.push(...Vector3.TransformCoordinates(Vector3.FromArray(raw,k),world).asArray());parts.push({name:n.name,primitive:pi,skinned:n.skin!==undefined,...bounds(positions)});}}for(const c of n.children??[])visit(c,world);}
for(const i of g.scenes[g.scene??0].nodes)visit(i,Matrix.Identity());
const human={file:'arena/people/wren.glb',units:'metres after authored glTF node transforms',asset:g.asset,parts,sourceTransforms:g.nodes.filter(n=>n.mesh!==undefined||n.skin!==undefined||/root|armature/i.test(n.name??'')).map(n=>({name:n.name,translation:n.translation,rotation:n.rotation,scale:n.scale,matrix:n.matrix,skin:n.skin}))};
const house=JSON.parse(readFileSync(resolve(root,'web/public/focused/metadata/tv_26_05_timber_house.json')));
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({human,sources,houseContract:{horizontalScale:house.uniform_horizontal_scale,player:house.player_contract,vertical:house.vertical_adjustments,topologyFloors:house.floors.length},note:'Source bind-pose bounds; rendered skinned pose, appearance multiplier and capsule are separately measured in the browser.'},null,2));
console.log(JSON.stringify({out,human:parts,house:house.vertical_adjustments,sourceNodes:Object.fromEntries(Object.entries(sources).map(([id,s])=>[id,s.nodes.length]))}));
