import { Color3, DynamicTexture, Material, Matrix, Mesh, MeshBuilder, PointLight, Quaternion, StandardMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { SquareMaterials, type SquareFinish } from './squareMaterials';
import type { RenderContext } from '../render/engine';
import type { Atmosphere } from '../world/atmosphere';
import { MaterialLibrary, type MatName } from '../render/materials';
import { MeshBatch } from '../world/meshBatch';
import type { Building, RealmChunk, RealmId } from '../../sim/world/realms/layout';

interface Batch { material: Material; shape: 'box' | 'cone' | 'cylinder' | 'gable'; transforms: number[] }
interface ResidentChunk { root: TransformNode; meshes: Mesh[]; signs: DynamicTexture[]; lights: PointLight[]; doors: { mesh: Mesh; index: number }[]; lod: number; chunk: RealmChunk }
export interface ChunkMessage { key: string; lod: number; chunk: RealmChunk }
const PALETTES = {
  aether: { wall: ['#253445', '#354354', '#425666', '#2e3d4c'], metal: '#142536', roof: '#263b46', stone: '#526377', street: '#172638', paving: '#394959', glow: '#64edff', warm: '#ffd69a', sky: '#283a55' },
  brass: { wall: ['#b8a183', '#bfad90', '#b69475', '#aa987e'], metal: '#654630', roof: '#507b72', stone: '#8c8279', street: '#5b5a59', paving: '#9c9080', glow: '#a9f6d0', warm: '#ffd394', sky: '#afa19b' },
};

/** Projection of canonical solids. Repeated kit parts become thin instances per
 * material and chunk; inactive chunks are disposed, including their sign textures. */
export class RealmRenderer {
  readonly loaded = new Map<string, ResidentChunk>();
  private queue: ChunkMessage[] = [];
  private materials = new Map<string, StandardMaterial>();
  private realm: RealmId = 'aether';
  private openDoors = new Set<number>();
  origin = { x: 3072, z: 3072 };
  uploads: number[] = [];
  private surfaces: MaterialLibrary;
  private square: SquareMaterials;
  constructor(private readonly ctx: RenderContext, private readonly atmosphere: Atmosphere) { this.surfaces = new MaterialLibrary(ctx.scene); this.square = new SquareMaterials(ctx.scene); }
  get pending(): number { return this.queue.length; }
  reconcile(wanted: string[], incoming: ChunkMessage[]): void {
    const keep = new Set(wanted);
    for (const [key, c] of this.loaded) if (!keep.has(key)) { this.disposeChunk(c); this.loaded.delete(key); }
    this.queue = this.queue.filter(c => keep.has(c.key));
    const queued = new Set(this.queue.map(c => c.key));
    this.queue.push(...incoming.filter(c => !this.loaded.has(c.key) && !queued.has(c.key)));
    if (incoming[0]) {
      this.realm = incoming[0].chunk.realm;
      this.origin.x = (this.realm === 'aether' ? 0 : 8192) + 3072;
    }
  }
  /** At most one heavy chunk upload per frame; no unbounded synchronous city build. */
  upload(): void {
    const next = this.queue.shift(); if (!next) return;
    const t = performance.now(); this.loaded.set(next.key, this.build(next.chunk, next.lod));
    this.uploads.push(performance.now() - t); if (this.uploads.length > 500) this.uploads.shift();
  }
  setDoors(doors: { index: number; open: boolean }[]): void {
    const open = new Set(doors.filter(d => d.open).map(d => d.index));
    this.openDoors = open;
    for (const c of this.loaded.values()) for (const d of c.doors) d.mesh.setEnabled(!open.has(d.index));
  }
  /** Camera-only point query from the received structural projection. No World,
   * generated territory or pawn collision is created in this presentation layer. */
  cameraBlocked(x: number, y: number, z: number): boolean {
    if (y < 1) return true;
    const gx = x + this.origin.x, gz = z + this.origin.z;
    const cx = Math.floor((gx - (this.realm === 'aether' ? 0 : 8192)) / 96), cz = Math.floor(gz / 96);
    const key = `${this.realm}:${cx},${cz}`;
    const c = this.loaded.get(`${key}:0`) ?? this.loaded.get(`${key}:1`) ?? this.loaded.get(`${key}:2`);
    if (!c) return true; // do not put the camera inside an unreceived shell
    for (const b of c.chunk.buildings) {
      if (gx < b.x || gx >= b.x + b.w || gz < b.z || gz >= b.z + b.d) continue;
      const width = b.use === 'tower' ? 5 : 3, height = b.use === 'tower' ? 8 : 4;
      if (gz >= b.door.z && gz < b.door.z + 1 && gx >= b.door.x - Math.floor(width / 2) && gx < b.door.x + Math.ceil(width / 2) && y < height)
        return !this.openDoors.has((b.door.x * 6144 + b.door.z) * 176 + 1);
      if (b.solids.some(s => gx >= s.x && gx < s.x + s.w && y >= s.y && y < s.y + s.h && gz >= s.z && gz < s.z + s.d)) return true;
    }
    return false;
  }
  private mat(key: string, color: string, glow = false, pattern = false): StandardMaterial {
    const full = `${this.realm}:${key}`; const prior = this.materials.get(full); if (prior) return prior;
    const m = new StandardMaterial(full, this.ctx.scene); m.diffuseColor = Color3.FromHexString(color);
    m.specularColor = new Color3(.12, .14, .16); m.specularPower = 48;
    if (glow) { m.emissiveColor = Color3.FromHexString(color).scale(1.2); m.diffuseColor.scaleInPlace(.5); }
    if (pattern) {
      const tex = new DynamicTexture(`${full}:surface`, { width: 256, height: 256 }, this.ctx.scene, true);
      const c = tex.getContext(); c.fillStyle = color; c.fillRect(0, 0, 256, 256);
      c.strokeStyle = this.realm === 'aether' ? '#142632' : '#726659'; c.lineWidth = 2;
      for (let y = 0; y < 256; y += this.realm === 'aether' ? 64 : 32) {
        c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke();
        for (let x = y % 64 ? 32 : 0; x < 256; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); }
      }
      tex.update(); m.diffuseTexture = tex; m.diffuseColor = Color3.White();
    }
    if (key.startsWith('far-wall')) {
      const texture = new DynamicTexture(`${full}:windows`, { width: 128, height: 256 }, this.ctx.scene, true), c = texture.getContext();
      c.fillStyle = '#020406'; c.fillRect(0,0,128,256);
      for (let y = 8; y < 256; y += 16) for (let x = 5; x < 128; x += 12) if ((x * 3 + y * 5 + key.length) % 9 > 3) {
        c.fillStyle = this.realm === 'aether' && x % 3 ? '#658e9b' : '#8c8262'; c.fillRect(x,y,4,7);
      }
      texture.update(); m.emissiveTexture = texture; m.emissiveColor = new Color3(.8,.8,.8);
    }
    this.materials.set(full, m); return m;
  }
  private build(chunk: RealmChunk, lod: number): ResidentChunk {
    const scene = this.ctx.scene, pal = PALETTES[chunk.realm], sci = chunk.realm === 'aether';
    this.realm = chunk.realm;
    const root = new TransformNode(chunk.id, scene), meshes: Mesh[] = [], signs: DynamicTexture[] = [], lights: PointLight[] = [], doors: ResidentChunk['doors'] = [];
    const batches = new Map<string, Batch>(), origin = this.origin;
    const surfaceBatches = new Map<MatName, MeshBatch>();
    const surface = (name: MatName, x: number, y: number, z: number, w: number, h: number, d: number, tint: [number, number, number] = [1,1,1]) => {
      let batch = surfaceBatches.get(name); if (!batch) { batch = new MeshBatch(); surfaceBatches.set(name, batch); }
      batch.box([x - w/2 - origin.x, y - h/2, z - d/2 - origin.z], [x + w/2 - origin.x, y + h/2, z + d/2 - origin.z], tint, this.surfaces.tilesPerMetre(name));
    };
    const box = (material: Material, x: number, y: number, z: number, w: number, h: number, d: number, shape: Batch['shape'] = 'box', yaw = 0) => {
      const key = `${material.name}:${shape}`; let b = batches.get(key);
      if (!b) { b = { material, shape, transforms: [] }; batches.set(key, b); }
      const matrix = Matrix.Compose(new Vector3(w, h, d), Quaternion.RotationYawPitchRoll(yaw, 0, 0), new Vector3(x - origin.x, y, z - origin.z));
      b.transforms.push(...matrix.asArray());
    };
    const squareBatches = new Map<SquareFinish, MeshBatch>();
    const coat = (finish: SquareFinish, x: number, y: number, z: number, w: number, h: number, d: number) => {
      let batch = squareBatches.get(finish); if (!batch) {batch = new MeshBatch();squareBatches.set(finish,batch);}
      batch.box([x-w/2-origin.x,y-h/2,z-d/2-origin.z],[x+w/2-origin.x,y+h/2,z+d/2-origin.z],[1,1,1],.5);
    };
    const featured = chunk.plaza && lod === 0;
    const wall = pal.wall.map((c, i) => this.mat(`${lod === 2 ? 'far-wall' : 'wall'}${i}`, c, false, lod === 0));
    const metal = this.mat('metal', pal.metal), stone = this.mat('stone', pal.stone, false, lod === 0), roof = this.mat('roof', pal.roof);
    const glow = this.mat('glow', pal.glow, true), warm = this.mat('warm', pal.warm, true), dark = this.mat('glass', sci ? '#111e2c' : '#3f3a35');
    const road = this.mat('road', pal.street, false, true), paving = this.mat('paving', pal.paving, false, true), line = this.mat('line', sci ? '#768b95' : '#c3ae83');
    if (lod < 2) surface('cobble', chunk.x + 48, .94, chunk.z + 48, 96, .1, 96, sci ? [.36,.45,.57] : [.72,.7,.65]);
    else box(road, chunk.x + 48, .94, chunk.z + 48, 96, .1, 96);
    // Shared road alignment is determined by world coordinates, not neighbour generation.
    if (!chunk.plaza) for (const [x, z] of [[10, 10], [53, 10], [10, 53], [53, 53]]) box(paving, chunk.x + x + 17.5, 1.02, chunk.z + z + 17.5, 35, .15, 35);
    else if (!featured) surface('cobble', chunk.x + 48, 1.02, chunk.z + 47, 78, .15, 76, sci ? [.62,.71,.82] : [1,.95,.85]);
    if (featured) {
      // Flush paving, drainage and guide inlays add a composed approach without introducing obstacles.
      coat('paving',chunk.x+48,1.016,chunk.z+47,78,.032,76);
      for(const x of [chunk.x+39,chunk.x+58]) {
        coat('basalt',x,1.04,chunk.z+28,1.1,.012,42);
        coat(sci?'zinc':'bronze',x,1.05,chunk.z+28,.075,.008,42);
      }
      for(const z of [chunk.z+13,chunk.z+38,chunk.z+48]) {
        coat('basalt',chunk.x+48.5,1.044,z,45,.016,.22);
        for(let x=chunk.x+27;x<chunk.x+70;x+=.55) coat('zinc',x,1.054,z,.045,.009,.18);
      }
      // A brass survey medallion lies flush with the route; no raised pedestal is implied.
      for(const radius of [2.4,2.7]) for(let i=0;i<48;i++) {
        const a=i*Math.PI/24;box(this.square.get(chunk.realm,'bronze'),chunk.x+48.5+Math.sin(a)*radius,1.06,chunk.z+32+Math.cos(a)*radius,.34,.014,.06,'box',a);
      }
    }
    if (lod < 2) for (let i = 2; i < 96; i += 12) {
      box(line, chunk.x + i, 1.035, chunk.z + 4, 5, .02, .22);
      box(line, chunk.x + 4, 1.035, chunk.z + i, .22, .02, 5);
    }
    for (const b of chunk.buildings) {
      const mats = { wall: wall[b.style], metal, stone, roof };
      for (const s of b.solids) {
        if (lod === 2 && s.y < 5 && s.h < 9) continue;
        if (featured) {
          const finish: SquareFinish = s.material === 'metal' ? (sci?'zinc':'bronze') : s.material === 'roof' ? 'basalt' : s.material === 'stone' ? 'limestone' : sci ? 'ceramic' : 'limestone';
          coat(finish,s.x+s.w/2,s.y+s.h/2,s.z+s.d/2,s.w,s.h,s.d);
        } else if (lod < 2) {
          const name: MatName = s.material === 'stone' ? 'stone' : s.material === 'metal' ? 'iron' : s.material === 'roof' ? 'roofSlate' : 'plaster';
          const shade = sci ? .48 + b.style * .11 : .85 + b.style * .06;
          surface(name, s.x + s.w / 2, s.y + s.h / 2, s.z + s.d / 2, s.w, s.h, s.d, sci ? [shade*.8,shade*.94,shade*1.1] : [shade,shade*.92,shade*.79]);
        } else box(mats[s.material], s.x + s.w / 2, s.y + s.h / 2, s.z + s.d / 2, s.w, s.h, s.d);
      }
      if (b.roof === 'gable') box(roof, b.x + b.w / 2, b.height + 4, b.z + b.d / 2, b.w + 2, 7, b.d + 2, 'gable');
      else if (b.roof === 'spire') {
        const h = b.use === 'tower' ? 32 : b.w * .8, base = b.height + (b.use === 'tower' ? 26 : 1);
        box(roof, b.x + b.w / 2, base + h / 2, b.z + b.d / 2, b.w * .5, h, b.w * .5, 'cone');
      }
      if (lod < 2) {
        for (const [i, p] of b.windows.entries()) {
          if (lod === 1 && i % 3) continue;
          const side = p.x < b.x || p.x > b.x + b.w - .1;
          const lit = (i * 13 + b.style * 7) % 11 > 3;
          if(featured) {
            const front=p.z<b.z, sign=side?(p.x<b.x?-1:1):(front?-1:1), h=sci?2.35:2.1, width=1.55;
            // The entry bay belongs to the real doorway, its sign and the astrolabe.
            // Omit cosmetic glazing here instead of letting a frame intersect the surround.
            if(front&&!side&&Math.abs(p.x-b.door.x-.5)<5&&p.y<18)continue;
            const pane=this.square.get(chunk.realm,lit&&i%3===0?'lit-glass':'glass');
            const frame=this.square.get(chunk.realm,sci?'zinc':'bronze');
            const place=(m:Material,u:number,v:number,depth:number,w:number,hh:number,d:number)=>box(m,p.x+(side?sign*depth:u),p.y+v,p.z+(side?u:sign*depth),side?d:w,hh,side?w:d);
            place(this.square.get(chunk.realm,'basalt'),0,0,.02,width+.25,h+.28,.15);
            place(pane,0,0,.105,width,h,.035);
            for(const u of [-width/2,width/2]) place(frame,u,0,.15,.075,h+.16,.15);
            for(const v of [-h/2,h/2]) place(frame,0,v,.19,width+.22,.12,.28);
            place(frame,0,0,.145,.05,h,.05);
            if(!sci) {
              place(frame,0,.38,.15,width,.055,.06);place(this.square.get(chunk.realm,'limestone'),0,h/2+.24,.08,width+.4,.19,.33);
              box(frame,p.x+(side?sign*.12:0),p.y+h/2+.47,p.z+(side?0:sign*.12),width+.42,.3,.36,'gable',side?Math.PI/2:0);
            }
            continue;
          }
          box(lit ? (i % 5 === 0 ? glow : warm) : dark, p.x, p.y, p.z, side ? .12 : 1.05, sci ? 1.7 : 1.5, side ? 1.05 : .12);
          if (lod === 0 && !sci) box(metal, p.x, p.y, p.z - (side ? 0 : .02), side ? .15 : 1.3, .13, side ? 1.3 : .15);
        }
        // Continuous cornices, service ribs, crown trim and shop-height details.
        for (let y = sci ? 6 : 4.8; y < b.height; y += sci ? 12 : 3.5) {
          if(featured) {
            if(y<8.3)continue;
            const finish=sci?'zinc':'bronze';
            coat(finish,b.x+b.w/2,y,b.z-.06,b.w+.18,.16,.18);
            coat(finish,b.x+b.w/2,y,b.z+b.d+.06,b.w+.18,.16,.18);
            continue;
          }
          if (!(b.use === 'tower' && y < 8.3)) box(sci ? metal : roof, b.x + b.w / 2, y, b.z - .18, b.w + .7, sci ? .55 : .25, .65);
          box(sci ? metal : roof, b.x + b.w / 2, y, b.z + b.d + .18, b.w + .7, sci ? .55 : .25, .65);
        }
        for (const x of [b.x + .3, b.x + b.w - .3]) box(featured?this.square.get(chunk.realm,sci?'zinc':'bronze'):metal, x, b.height / 2 + 1, b.z - .16, sci ? .7 : .35, b.height, .35);
        if (sci && !featured) {
          box(glow, b.x + .3, b.height * .6, b.z - .7, .12, b.height * .6, .14);
          box(glow, b.x + b.w / 2, b.height + 1.7, b.z - .2, b.w, .25, .4);
          for (const xx of [b.x + 5, b.x + b.w - 5]) {
            box(metal, xx, 4.9, b.z - .65, 4, 2.1, .9);
            box(glow, xx, 5.1, b.z - 1.12, 3.6, .1, .05);
            box(dark, xx, 3, b.z - .12, 3.5, 2.5, .25);
          }
        } else if(!featured) {
          for (const x of [b.x + 2, b.x + b.w - 3]) {
            box(metal, x, b.height + 3, b.z + b.d - 5, 1.2, 9, 1.2, 'cylinder');
            box(stone, x, b.height + 7.5, b.z + b.d - 5, 2, .8, 2, 'cylinder');
          }
          for (const xx of [b.x + 3, b.x + b.w - 3]) {
            box(metal, xx, 3, b.z - .35, .4, 4, .65);
            box(warm, xx, 5.6, b.z - .5, 1.2, 1.8, .3);
          }
        }
      }
      if (lod === 0) {
        const doorWidth = b.use === 'tower' ? 5 : 3, doorHeight = b.use === 'tower' ? 7 : 3;
        const d = MeshBuilder.CreateBox(`${b.id}:door`, { width: doorWidth, height: doorHeight, depth: .45 }, scene);
        d.position.set(b.door.x + .5 - origin.x, 1 + doorHeight / 2, b.z + .5 - origin.z); d.material = featured?this.square.get(chunk.realm,'basalt'):metal; d.parent = root; meshes.push(d);
        if(featured) {
          // Every embellishment is parented to the real door and disappears with its open state.
          const panels=new MeshBatch();
          for(const x of [-1.22,1.22]) panels.box([x-1,-2.9,-.27],[x+1,2.9,-.23],[1,1,1],.5);
          const skin=panels.build(`${b.id}:door-panels`,scene,this.square.get(chunk.realm,sci?'zinc':'bronze'));
          if(skin){skin.parent=d;meshes.push(skin);}
          const seams=new MeshBatch();
          for(const x of [-2.3,0,2.3])seams.box([x-.025,-3.25,-.3],[x+.025,3.25,-.27],[1,1,1],.5);
          for(const y of [-2.7,0,2.7])seams.box([-2.3,y-.025,-.3],[2.3,y+.025,-.27],[1,1,1],.5);
          const trim=seams.build(`${b.id}:door-inlay`,scene,this.square.get(chunk.realm,'bronze'));if(trim){trim.parent=d;meshes.push(trim);}
        }
        doors.push({ mesh: d, index: (b.door.x * 6144 + b.door.z) * 176 + 1 });
        if(featured)coat('limestone',b.door.x+.5,doorHeight+1.4,b.z-.25,doorWidth+1.6,.65,1.1);
        else box(stone, b.door.x + .5, doorHeight + 1.4, b.z - .25, doorWidth + 1.6, .65, 1.1);
        for (const x of [b.door.x - doorWidth / 2 - .35, b.door.x + doorWidth / 2 + 1.3]) {
          if(featured)coat('limestone',x,doorHeight/2+1,b.z-.25,.55,doorHeight,1.1);
          else box(stone, x, doorHeight / 2 + 1, b.z - .25, .55, doorHeight, 1.1);
          box(warm, x, 3.1, b.z - .95, .26, .55, .4);
        }
        const label = b.use === 'tower' ? 'CHRYSANTHUS' : b.name.toUpperCase();
        const texture = new DynamicTexture(`${b.id}:sign`, { width: 512, height: 128 }, scene, true), ctx = texture.getContext();
        ctx.fillStyle = sci ? '#243b49' : '#514337'; ctx.fillRect(0, 0, 512, 128); ctx.strokeStyle = pal.warm; ctx.lineWidth = 1.5; ctx.strokeRect(6, 6, 500, 116);
        ctx.font = `${b.use === 'tower' ? 37 : 35}px Georgia`; ctx.fillStyle = pal.warm; (ctx as CanvasRenderingContext2D).textAlign = 'center'; ctx.fillText(label, 256, featured?62:75);
        if(featured){ctx.font='12px sans-serif';ctx.fillStyle='#bbcac6';ctx.fillText(sci?'T H E   M E R I D I A N   G A T E':'T H E   B R A S S   C L O I S T E R',256,96);}texture.update();
        const signMat = new StandardMaterial(`${b.id}:label`, scene); signMat.diffuseTexture = texture; signMat.emissiveColor = new Color3(.6, .55, .4); signMat.backFaceCulling = false;
        const sign = MeshBuilder.CreatePlane(`${b.id}:label`, { width: b.use === 'tower' ? 10 : 7, height: 1.7 }, scene);
        sign.position.set(b.door.x + .5 - origin.x, doorHeight + 3, b.z - .85 - origin.z); sign.rotation.y = Math.PI; sign.material = signMat; sign.parent = root; meshes.push(sign); signs.push(texture);
        // Canopies occupy only space above the real entrance clearance.
        if (b.use !== 'tower') box(sci ? metal : roof, b.x + b.w / 2, 4.7, b.z - 1, b.w - 2, .22, 3);
        if (b.use === 'tower') {
          if(featured) {
            const trim=sci?'zinc':'bronze';
            // Layered portal head and pilasters sit outside the five-metre opening.
            for(const xx of [b.x+2,b.x+b.w-2]) {
              coat('basalt',xx,7,b.z-.12,2,12,.28);
              for(const dx of [-.65,0,.65])coat(trim,xx+dx,7,b.z-.32,.13,11.7,.17);
              coat('limestone',xx,13.1,b.z-.27,2.5,.35,.58);
            }
            for(const yy of [12.8,14.3])coat('basalt',b.x+b.w/2,yy,b.z-.28,b.w+.25,.45,.6);
            coat(trim,b.x+b.w/2,13.25,b.z-.57,b.w+.25,.08,.12);
            // Flush service housings and ventilation, attached to the facade rather than walkable space.
            for(const xx of [b.x+7,b.x+b.w-7]) {
              coat('basalt',xx,2.4,b.z-.015,3.3,2.5,.04);
              for(let yy=1.4;yy<3.5;yy+=.23)coat(trim,xx,yy,b.z-.05,3.1,.04,.06);
              coat(trim,xx,4,b.z-.07,3.5,.12,.13);
              const lamp=new PointLight(`${b.id}:entry-light:${xx}`,new Vector3(xx-origin.x,5.2,b.z-1.2-origin.z),scene);
              lamp.diffuse=new Color3(1,.66,.3);lamp.intensity=5;lamp.range=12;lights.push(lamp);
              box(warm,xx,5.2,b.z-.22,.18,1.1,.16);
            }
            // Thin vertical fins express the shaft; they do not alter the canonical mass or windows.
            for(const xx of [b.x+3.5,b.x+12.5,b.x+21.5,b.x+30.5])coat(trim,xx,65,b.z-.23,.18,97,.35);
            // A shared Tower emblem with realm-specific fabrication, above all entrance clearance.
            coat('basalt',b.door.x+.5,16.6,b.z-.035,5.1,4.6,.08);
            const seal=MeshBuilder.CreateTorus(`${b.id}:astrolabe`,{diameter:sci?3.1:3.4,thickness:sci?.075:.13,tessellation:48},scene);
            seal.rotation.x=Math.PI/2;seal.position.set(b.door.x+.5-origin.x,16.6,b.z-.22-origin.z);
            seal.material=this.square.get(chunk.realm,trim);seal.parent=root;meshes.push(seal);
            for(let i=0;i<(sci?4:12);i++) {
              const a=i*Math.PI*2/(sci?4:12),r=sci?1.95:1.25;
              box(this.square.get(chunk.realm,'bronze'),b.door.x+.5+Math.sin(a)*r,16.6+Math.cos(a)*r,b.z-.16,.12,.22,.08);
            }
            coat(trim,b.door.x+.5,16.6,b.z-.17,.07,2.2,.08);
            coat(trim,b.door.x+.5,16.6,b.z-.17,2.2,.07,.08);
            // Glazed notice cases and conduits are fixed within the facade skin, clear of movement.
            for(const xx of [b.door.x-4.6,b.door.x+5.6]) {
              coat(trim,xx,2.45,b.z-.035,.72,1.55,.08);
              coat('basalt',xx,2.45,b.z-.085,.6,1.4,.02);
              for(let y=2.1;y<2.9;y+=.16)coat(sci?'zinc':'limestone',xx,y,b.z-.101,.4,.025,.012);
            }
            // Decorated backs of the already-solid side-chapel furniture, not new street obstacles.
            for(const xx of [b.x+6,b.x+b.w-6]) {
              coat('bronze',xx,2.02,b.z+b.d-4,5.8,.025,1.8);
              for(let i=0;i<5;i++)coat(sci?'zinc':'basalt',xx-2+i,2.08,b.z+b.d-4,.7,.09,1.1);
            }
            for(const xx of [b.x+7,b.x+b.w-7])for(const zz of [b.z+9,b.z+20]) {
              coat(trim,xx,7,zz,.08,7,.08);box(warm,xx,7,zz,.12,1.3,.12);
            }
            coat('basalt',b.door.x+.5,1.055,b.z+17,4,.01,31);
            for(const dx of [-1.9,1.9])coat('bronze',b.door.x+.5+dx,1.065,b.z+17,.045,.008,31);
          } else {
          for (const xx of [b.x + 3, b.x + b.w - 3]) {
            surface('stone', xx, 7, b.z - .65, 2, 12, 2, [.9,.9,.85]);
            box(warm, xx, 13, b.z - .75, .3, 5, .3);
          }
          for (let yy = 16; yy < b.height; yy += 18) box(metal, b.x + b.w/2, yy, b.z - 1, b.w + 2, 1.1, 2);
          for (const x of [b.x + 6, b.x + b.w - 6]) for (const z of [b.z + 9, b.z + 20]) box(warm, x, 7, z, .3, 2.5, .3);
          box(glow, b.door.x + .5, 1.06, b.z + 18, 2, .05, 25);
          }
        }
      }
    }
    if (lod === 0) {
      for (const [x, z] of [[8, 20], [8, 70], [50, 8], [91, 50]]) {
        const px = chunk.x + x, pz = chunk.z + z;
        box(metal, px, 3.3, pz, .16, 4.6, .16, 'cylinder');
        box(metal, px + .6, 5.4, pz, 1.4, .12, .14);
        box(warm, px + 1.1, 5.1, pz, sci ? .8 : .5, sci ? .12 : .7, .5);
      }
    }
    if (chunk.plaza) {
      const px = chunk.x + 20.5, pz = chunk.z + 30.5;
      box(stone, px, 1.12, pz, 10, .22, 9);
      for (const dx of [-3.2, 3.2]) { box(metal, px + dx, 5.3, pz, 1.2, 8.6, 1.4); box(glow, px + dx * .88, 5.1, pz - .76, .14, 7.4, .1); }
      box(metal, px, 9.1, pz, 7.6, 1, 1.4); box(glow, px, 8.5, pz - .76, 5.8, .18, .1);
      const veil = MeshBuilder.CreatePlane(`${chunk.realm}:threshold`, { width: 5.4, height: 7 }, scene);
      const vm = new StandardMaterial(`${chunk.realm}:veil`, scene); vm.diffuseColor = Color3.FromHexString(pal.glow); vm.emissiveColor = vm.diffuseColor; vm.alpha = .2; vm.backFaceCulling = false;
      veil.position.set(px - origin.x, 4.9, pz - origin.z); veil.material = vm; veil.parent = root; meshes.push(veil);
      const ring = MeshBuilder.CreateTorus(`${chunk.realm}:threshold-ring`, { diameter: 6.7, thickness: .12, tessellation: 64 }, scene);
      ring.rotation.x = Math.PI/2; ring.position.set(px-origin.x,4.9,pz-origin.z-.2); ring.material = glow; ring.parent = root; meshes.push(ring);
      for (let i = 0; i < 12; i++) { const angle = i*Math.PI/6; box(warm, px + Math.sin(angle)*3.3, 4.9+Math.cos(angle)*3.3, pz-.3, .16,.35,.16); }
    }
    for (const [finish,batch] of squareBatches) {
      const m=batch.build(`${chunk.id}:square:${finish}`,scene,this.square.get(chunk.realm,finish),{receiveShadow:true});
      if(m){m.parent=root;this.atmosphere.addCaster(m);meshes.push(m);}
    }
    for (const [name, batch] of surfaceBatches) {
      const m = batch.build(`${chunk.id}:${name}`, scene, this.surfaces.get(name), { receiveShadow: false });
      if (m) { m.parent = root; if (lod === 0) this.atmosphere.addCaster(m); meshes.push(m); }
    }
    for (const [name, b] of batches) {
      let mesh: Mesh;
      if (b.shape === 'box') mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
      else if (b.shape === 'cone' || b.shape === 'cylinder') mesh = MeshBuilder.CreateCylinder(name, { height: 1, diameter: 1, diameterTop: b.shape === 'cone' ? 0 : 1, tessellation: b.shape === 'cone' ? 8 : 10 }, scene);
      else {
        mesh = new Mesh(name, scene); const v = new VertexData();
        v.positions = [-.5,-.5,-.5,.5,-.5,-.5,0,.5,-.5,-.5,-.5,.5,.5,-.5,.5,0,.5,.5];
        v.indices = [0,2,1,3,4,5,0,3,5,0,5,2,1,2,5,1,5,4,0,1,4,0,4,3];
        v.normals = []; VertexData.ComputeNormals(v.positions, v.indices, v.normals); v.applyToMesh(mesh); mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
      }
      mesh.material = b.material; mesh.parent = root; mesh.isPickable = false; mesh.receiveShadows = false;
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(b.transforms), 16, true); mesh.thinInstanceRefreshBoundingInfo();
      if (lod === 0 && !name.includes('glow') && !name.includes('warm')) this.atmosphere.addCaster(mesh);
      meshes.push(mesh);
    }
    return { root, meshes, signs, lights, doors, lod, chunk };
  }
  private disposeChunk(c: ResidentChunk): void {
    for (const m of c.meshes) { this.atmosphere.removeCaster(m); if (m.name.endsWith(':label') || m.name.endsWith(':threshold')) m.material?.dispose(); }
    for (const s of c.signs) s.dispose(); c.root.dispose();
    for (const light of c.lights) light.dispose();
  }
  dispose(): void { for (const c of this.loaded.values()) this.disposeChunk(c); this.loaded.clear(); for (const m of this.materials.values()) m.dispose(true, true); this.materials.clear(); this.surfaces.dispose(); this.square.dispose(); }
}
