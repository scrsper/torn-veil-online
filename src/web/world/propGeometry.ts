import { MeshBatch, type V, cross, sub, norm } from './meshBatch';
import { hash2 } from '../render/noise';

/**
 * Small hand-built props: furniture, tools, food, containers. Everything is authored here as code
 * (no third-party geometry), coloured per part through vertex colours so a single material renders
 * them all and they instance cheaply. Coordinates are metres; a prop's origin is the centre of its
 * footprint on the floor.
 */
export type Tint = [number, number, number];
const hex = (h: number): Tint => [Math.pow(((h >> 16) & 255) / 255, 2.2), Math.pow(((h >> 8) & 255) / 255, 2.2), Math.pow((h & 255) / 255, 2.2)];
export const COLORS = {
  oak: hex(0xa0764a), darkOak: hex(0x5f4330), pine: hex(0xc8a36a), iron: hex(0x3c3f47), steel: hex(0x9aa0aa), brass: hex(0xc9a24c), gold: hex(0xe0b94d),
  leather: hex(0x6b452d), linen: hex(0xd9d0b8), wool: hex(0xb8aa8c), red: hex(0x8c2f36), blue: hex(0x3d5b8f), green: hex(0x4f7a43), stone: hex(0x8d8b85),
  bread: hex(0xc8924e), crust: hex(0x9c6630), cheese: hex(0xe3c25a), meat: hex(0xa8474a), ale: hex(0x9a6a2a), glass: hex(0x9ab6c8), paper: hex(0xe6ddc4), herb: hex(0x5e8f4a), flour: hex(0xefe8d6), coal: hex(0x2a2320), ember: hex(0xff7a2a),
} as const;

export class PropBuilder {
  yawSin = 0; yawCos = 1;
  constructor(readonly batch: MeshBatch, private ox = 0, private oy = 0, private oz = 0, yaw = 0, private scale = 1) { this.yawSin = Math.sin(yaw); this.yawCos = Math.cos(yaw); }
  /** Local (x,y,z) -> batch coordinates. */
  p(x: number, y: number, z: number): V {
    const lx = x * this.scale, lz = z * this.scale;
    return [this.ox + lx * this.yawCos + lz * this.yawSin, this.oy + y * this.scale, this.oz - lx * this.yawSin + lz * this.yawCos];
  }
  private n(x: number, y: number, z: number): V { return [x * this.yawCos + z * this.yawSin, y, -x * this.yawSin + z * this.yawCos]; }
  /** An oriented box given by its minimum corner and size in local space. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, tint: Tint): void {
    const P = (a: number, b: number, c: number) => this.p(x + a * sx, y + b * sy, z + c * sz);
    const face = (pts: V[], n: V) => this.batch.quad(pts[0], pts[1], pts[2], pts[3], tint, 1, { normal: this.n(n[0], n[1], n[2]) });
    face([P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), P(0, 0, 0)], [-1, 0, 0]); face([P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], [1, 0, 0]);
    face([P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], [0, -1, 0]); face([P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)], [0, 1, 0]);
    face([P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)], [0, 0, -1]); face([P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], [0, 0, 1]);
  }
  /** Box centred on (cx, cz) on the floor. */
  cbox(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, tint: Tint): void { this.box(cx - sx / 2, y, cz - sz / 2, sx, sy, sz, tint); }
  /** Small chamfers catch light on furniture without changing its support or footprint. */
  bevelBox(x:number,y:number,z:number,sx:number,sy:number,sz:number,tint:Tint,bevel=.018):void {
    const e=Math.min(bevel,sx/4,sy/4,sz/4);
    const ring=(yy:number,inset:number):V[]=>[[x+inset,yy,z+inset],[x+inset,yy,z+sz-inset],[x+sx-inset,yy,z+sz-inset],[x+sx-inset,yy,z+inset]].map(p=>this.p(p[0],p[1],p[2]));
    const layers=[ring(y,e),ring(y+e,0),ring(y+sy-e,0),ring(y+sy,e)];
    for(let l=0;l<3;l++)for(let i=0;i<4;i++){const j=(i+1)%4;this.batch.quad(layers[l][i],layers[l][j],layers[l+1][j],layers[l+1][i],tint,1);}
    this.batch.polygon(layers[0].slice().reverse(),[0,-1,0],tint,1);this.batch.polygon(layers[3],[0,1,0],tint,1);
  }
  cyl(cx: number, y: number, cz: number, r: number, h: number, tint: Tint, sides = 12, r2 = r): void {
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2, m = (a0 + a1) / 2;
      const b0 = this.p(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r), b1 = this.p(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r);
      const t0 = this.p(cx + Math.cos(a0) * r2, y + h, cz + Math.sin(a0) * r2), t1 = this.p(cx + Math.cos(a1) * r2, y + h, cz + Math.sin(a1) * r2);
      this.batch.quad(b1, b0, t0, t1, tint, 1, { normal: this.n(Math.cos(m), 0, Math.sin(m)) });
    }
    const cap = (yy: number, rr: number, up: boolean) => {
      const pts: V[] = []; for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2; pts.push(this.p(cx + Math.cos(a) * rr, yy, cz + Math.sin(a) * rr)); }
      this.batch.polygon(up ? pts.slice().reverse() : pts, this.n(0, up ? 1 : -1, 0), tint, 1);
    };
    cap(y + h, r2, true); cap(y, r, false);
  }
  /** A squashed low-poly sphere (loaves, stones, coin purses, cheese wheels). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, tint: Tint, seg = 8, ring = 5, jitter = 0, seed = 0): void {
    const pt = (i: number, j: number): V => {
      const th = (i / seg) * Math.PI * 2, ph = (j / ring) * Math.PI, jit = 1 + (hash2(i, j, seed) - 0.5) * jitter;
      return this.p(cx + Math.cos(th) * Math.sin(ph) * rx * jit, cy + Math.cos(ph) * ry * jit, cz + Math.sin(th) * Math.sin(ph) * rz * jit);
    };
    for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      this.batch.quad(a, d, c, b, tint, 1);
    }
  }
}

const c = (v: Tint, k: number): Tint => [v[0] * k, v[1] * k, v[2] * k];
export type FurnishingRole = 'bed' | 'chair' | 'table' | 'counter' | 'bench' | 'anvil' | 'forge' | 'altar' | 'shelf' | 'barrel' | 'crate' | 'lantern' | 'sign';

export function furnishing(role: string, b: PropBuilder, seed: number, purpose?:string): { light?: { y: number; color: Tint; intensity: number; range: number } } {
  const k = 0.9 + hash2(seed, 3, 9) * 0.2;
  switch (role) {
    case 'bed': {
      const frame = c(COLORS.darkOak, k), cloth = hash2(seed, 1, 4) > 0.5 ? COLORS.red : COLORS.blue;
      b.box(-0.46, 0.0, -0.95, 0.92, 0.28, 1.9, frame); b.box(-0.42, 0.28, -0.9, 0.84, 0.16, 1.8, COLORS.linen);
      b.bevelBox(-0.42, 0.44, -0.4, 0.84, 0.05, 1.3, cloth); b.blob(0,.48,-.68,.32,.075,.16,COLORS.linen,10,6);
      for(const x of [-.47,.41])for(const z of [-.96,.89])b.cyl(x+.03,.02,z+.03,.045,.76,frame,8,.035);
      b.box(-.4,.487,.57,.8,.012,.06,c(cloth,.7));
      b.box(-0.48, 0.28, -1.0, 0.96, 0.5, 0.08, frame); b.box(-0.48, 0.28, 0.92, 0.96, 0.22, 0.08, frame);
      return {};
    }
    case 'chair': {
      const w = c(COLORS.oak, k);
      for(let i=0;i<3;i++)b.bevelBox(-.24+i*.16,.42,-.24,.155,.065,.48,c(w,.92+i*.06),.009);
      for(const x of [-.2,.2])for(const z of [-.2,.2])b.cyl(x,.02,z,.028,z>0?.84:.4,c(w,.8),7,.034);
      b.bevelBox(-.24,.84,.17,.48,.09,.065,w,.012);
      for(const x of [-.125,0,.125])b.bevelBox(x-.025,.48,.19,.05,.36,.04,c(w,1.08),.007);
      for(const x of [-.2,.2])b.box(x-.02,.19,-.2,.04,.045,.4,c(w,.75));
      return {};
    }
    case 'table': {
      const w = c(COLORS.oak, k);
      for(let i=0;i<5;i++)b.bevelBox(-.5+i*.2,.7,-.5,.196,.07,1,c(w,.9+hash2(i,seed,8)*.17),.012);
      b.box(-.46,.6,-.46,.92,.1,.08,c(w,.72));b.box(-.46,.6,.38,.92,.1,.08,c(w,.72));
      for(const x of [-.39,.39])for(const z of [-.39,.39]) {b.cyl(x,.03,z,.036,.63,c(w,.85),8,.055);b.cyl(x,.08,z,.047,.06,c(w,.7),8);}
      b.box(-.4,.25,-.035,.8,.07,.07,c(w,.8));
      if(purpose==='tavern'||hash2(seed,5,2)>.65){
        // Unfilled crockery communicates use, not a canonical meal or stock.
        b.cyl(.18,.77,.12,.12,.024,COLORS.stone,14,.115);
        b.cyl(-.17,.77,.12,.06,.095,c(COLORS.stone,.76),10,.067);b.cyl(-.17,.862,.12,.049,.009,COLORS.darkOak,10);
        b.bevelBox(-.32,.772,-.29,.35,.008,.24,COLORS.linen,.003);
      }
      return {};
    }
    case 'counter': {
      const w = c(COLORS.darkOak, k);
      b.box(-0.5, 0, -0.5, 1, 0.9, 1, w);b.bevelBox(-.54,.9,-.54,1.08,.075,1.08,c(COLORS.oak,k),.017);
      for(const z of [-.535,.505]) {
        for(const x of [-.46,.36])b.bevelBox(x,.06,z,.1,.78,.045,c(w,1.4));
        for(const y of [.08,.71])b.bevelBox(-.46,y,z,.92,.12,.05,c(w,1.25));
      }
      return {};
    }
    case 'bench': { const w = c(COLORS.oak, k); b.box(-0.5, 0.4, -0.22, 1, 0.07, 0.44, w); b.box(-0.44, 0, -0.18, 0.08, 0.4, 0.36, w); b.box(0.36, 0, -0.18, 0.08, 0.4, 0.36, w); return {}; }
    case 'anvil': { b.box(-0.22, 0, -0.16, 0.44, 0.3, 0.32, COLORS.darkOak); b.box(-0.3, 0.3, -0.13, 0.6, 0.12, 0.26, COLORS.iron); b.box(0.28, 0.34, -0.08, 0.28, 0.06, 0.16, COLORS.iron); b.box(-0.18, 0.28, -0.1, 0.36, 0.04, 0.2, c(COLORS.iron, 0.8)); return {}; }
    case 'forge': {
      const st = COLORS.stone; b.box(-0.5, 0, -0.5, 1, 0.75, 1, c(st, 0.9)); b.box(-0.38, 0.75, -0.38, 0.76, 0.14, 0.76, c(st, 0.7)); b.box(-0.3, 0.8, -0.3, 0.6, 0.06, 0.6, COLORS.coal);
      b.blob(0, 0.86, 0, 0.22, 0.09, 0.22, COLORS.ember, 7, 4, 0.4, seed); b.box(-0.2, 0.9, -0.5, 0.4, 0.5, 0.06, c(st, 0.6));
      return { light: { y: 1.0, color: [1, 0.55, 0.22], intensity: 1.6, range: 8 } };
    }
    case 'altar': { b.box(-0.55, 0, -0.35, 1.1, 0.8, 0.7, c(COLORS.stone, 1.1)); b.box(-0.6, 0.8, -0.4, 1.2, 0.08, 0.8, c(COLORS.stone, 1.25)); b.box(-0.45, 0.88, -0.25, 0.9, 0.02, 0.5, COLORS.linen); b.cyl(0, 0.9, 0, 0.05, 0.18, COLORS.gold, 8); return { light: { y: 1.15, color: [1, 0.85, 0.55], intensity: 0.5, range: 5 } }; }
    case 'shelf': {
      const w = c(COLORS.darkOak, k); b.box(-0.5, 0, -0.22, 1, 1.9, 0.44, w);
      for (let s = 0; s < 4; s++) { b.box(-0.46, 0.25 + s * 0.45, -0.2, 0.92, 0.04, 0.4, c(COLORS.oak, 1.1)); for (let i = 0; i < 7; i++) { const h = 0.22 + hash2(seed + i, s, 8) * 0.14; b.box(-0.42 + i * 0.12, 0.29 + s * 0.45, -0.14, 0.09, h, 0.28, [COLORS.red, COLORS.blue, COLORS.green, COLORS.leather, COLORS.paper][(i + s + seed) % 5]); } }
      return {};
    }
    case 'barrel': {
      const w=c(COLORS.oak,k);
      b.cyl(0,0,0,.28,.23,w,12,.34);b.cyl(0,.23,0,.34,.39,w,12,.34);b.cyl(0,.62,0,.34,.23,w,12,.28);
      for(const y of [.09,.26,.57,.73]) {const r=y<.23?.28+y/.23*.06:y>.62?.34-(y-.62)/.23*.06:.34;b.cyl(0,y,0,r+.008,.035,COLORS.iron,12);}
      for(let i=0;i<5;i++){const z=(i-2)*.104,span=2*Math.sqrt(Math.max(0,.27*.27-z*z));b.bevelBox(-span/2,.847,z-.048,span,.016,.096,c(w,.86+i*.055),.003);}
      return {};
    }
    case 'crate': { const w = c(COLORS.pine, k); b.box(-0.42, 0, -0.42, 0.84, 0.84, 0.84, w); for (const y of [0.02, 0.4, 0.74]) b.box(-0.44, y, -0.44, 0.88, 0.08, 0.88, c(w, 0.72)); return {}; }
    case 'lantern': { b.cyl(0, 0.05, 0, 0.11, 0.26, COLORS.glass, 8); b.cyl(0, 0.3, 0, 0.13, 0.04, COLORS.iron, 8); b.cyl(0, 0.03, 0, 0.12, 0.03, COLORS.iron, 8); b.cyl(0, 0.34, 0, 0.012, 0.3, COLORS.iron, 4); b.blob(0, 0.18, 0, 0.06, 0.08, 0.06, [1.4, 1.1, 0.6], 6, 4); return { light: { y: 0.2, color: [1, 0.72, 0.38], intensity: 1.0, range: 9 } }; }
    case 'sign': { b.box(-0.05, 0, -0.05, 0.1, 1.6, 0.1, COLORS.darkOak); b.box(-0.45, 1.1, -0.04, 0.9, 0.42, 0.06, COLORS.oak); b.box(-0.4, 1.14, 0.02, 0.8, 0.34, 0.02, c(COLORS.pine, 1.1)); return {}; }
    default: b.box(-0.3, 0, -0.3, 0.6, 0.6, 0.6, COLORS.oak); return {};
  }
}

/** Carried/lying items, at the origin, resting on y = 0. */
export function itemGeometry(type: string, b: PropBuilder): void {
  switch (type) {
    case 'bread': b.blob(0, 0.07, 0, 0.17, 0.08, 0.1, COLORS.bread, 8, 5, 0.1, 1); b.blob(0, 0.1, 0, 0.13, 0.04, 0.07, COLORS.crust, 8, 3, 0.1, 2); break;
    case 'pie': b.cyl(0, 0, 0, 0.16, 0.08, COLORS.crust, 12, 0.14); b.cyl(0, 0.08, 0, 0.13, 0.02, COLORS.bread, 12); break;
    case 'cheese': b.cyl(0, 0, 0, 0.14, 0.1, COLORS.cheese, 12); b.box(0.02, 0, 0.0, 0.12, 0.1, 0.14, c(COLORS.cheese, 1.1)); break;
    case 'meat': b.blob(0, 0.07, 0, 0.15, 0.07, 0.1, COLORS.meat, 8, 4, 0.25, 3); b.box(0.06, 0.05, -0.02, 0.16, 0.03, 0.04, COLORS.paper); break;
    case 'stew': b.cyl(0, 0, 0, 0.11, 0.09, COLORS.darkOak, 10, 0.09); b.cyl(0, 0.085, 0, 0.09, 0.012, [0.55, 0.3, 0.15], 10); break;
    case 'ale': b.cyl(0, 0, 0, 0.055, 0.15, COLORS.ale, 10); b.cyl(0, 0.15, 0, 0.055, 0.02, [0.95, 0.93, 0.85], 10); b.box(0.055, 0.04, -0.015, 0.05, 0.08, 0.03, COLORS.ale); break;
    case 'coins': for (let i = 0; i < 5; i++) b.cyl((i % 3) * 0.05 - 0.05, i > 2 ? 0.012 : 0, Math.floor(i / 3) * 0.05 - 0.02, 0.028, 0.012, COLORS.gold, 8); break;
    case 'ring': b.cyl(0, 0, 0, 0.022, 0.012, COLORS.gold, 10); break;
    case 'book': b.box(-0.09, 0, -0.12, 0.18, 0.04, 0.24, COLORS.leather); b.box(-0.08, 0.005, -0.11, 0.16, 0.03, 0.22, COLORS.paper); b.box(-0.09, 0, -0.12, 0.02, 0.04, 0.24, c(COLORS.leather, 0.8)); break;
    case 'herbs': case 'flowers': for (let i = 0; i < 6; i++) { const a = i * 1.05; b.box(Math.cos(a) * 0.05 - 0.005, 0, Math.sin(a) * 0.05 - 0.005, 0.012, 0.16 + (i % 3) * 0.03, 0.012, COLORS.herb); if (type === 'flowers') b.blob(Math.cos(a) * 0.05, 0.2 + (i % 3) * 0.03, Math.sin(a) * 0.05, 0.03, 0.02, 0.03, i % 2 ? COLORS.red : [0.9, 0.85, 0.5], 6, 3); } break;
    case 'wheat': case 'grain': for (let i = 0; i < 7; i++) { const a = i * 0.9; b.box(Math.cos(a) * 0.04 - 0.004, 0, Math.sin(a) * 0.04 - 0.004, 0.008, 0.32, 0.008, [0.82, 0.7, 0.32]); b.blob(Math.cos(a) * 0.04, 0.32, Math.sin(a) * 0.04, 0.012, 0.04, 0.012, [0.9, 0.76, 0.3], 5, 3); } break;
    case 'flour': b.blob(0, 0.1, 0, 0.14, 0.11, 0.1, COLORS.flour, 8, 5, 0.06, 4); b.box(-0.06, 0.16, -0.08, 0.12, 0.02, 0.16, COLORS.linen); break;
    case 'lantern': furnishing('lantern', b, 1); break;
    case 'key': b.cyl(0, 0, 0, 0.02, 0.008, COLORS.brass, 8); b.box(0.02, 0, -0.006, 0.12, 0.008, 0.012, COLORS.brass); b.box(0.12, 0, -0.02, 0.02, 0.008, 0.04, COLORS.brass); break;
    case 'log': b.cyl(0, 0.13, 0, 0.13, 0.7, c(COLORS.darkOak, 1.2), 10); break;
    case 'stick': b.box(-0.35, 0, -0.012, 0.7, 0.024, 0.024, c(COLORS.darkOak, 1.3)); break;
    case 'plank': b.box(-0.45, 0, -0.1, 0.9, 0.03, 0.2, COLORS.pine); break;
    case 'stone': b.blob(0, 0.09, 0, 0.14, 0.09, 0.12, COLORS.stone, 7, 4, 0.35, 6); break;
    case 'sword': case 'dagger': { const l = type === 'sword' ? 0.85 : 0.35; b.box(-0.015, 0, -0.03, 0.03, 0.015, l * 0.72, COLORS.steel); b.box(-0.06, 0.0, l * 0.72 - 0.03, 0.12, 0.02, 0.03, COLORS.brass); b.box(-0.015, 0.0, l * 0.72, 0.03, 0.02, 0.16, COLORS.leather); break; }
    case 'hammer': case 'axe': case 'stoneaxe': case 'pickaxe': case 'saw': {
      b.box(-0.015, 0, -0.35, 0.03, 0.025, 0.7, COLORS.pine);
      if (type === 'hammer') b.box(-0.05, 0.0, -0.4, 0.1, 0.06, 0.12, COLORS.iron);
      else if (type === 'pickaxe') { b.box(-0.22, 0.0, -0.4, 0.44, 0.03, 0.05, COLORS.iron); }
      else if (type === 'saw') { b.box(-0.03, 0, -0.35, 0.02, 0.01, 0.7, COLORS.steel); }
      else b.box(-0.09, 0.0, -0.4, 0.18, 0.03, 0.14, type === 'stoneaxe' ? COLORS.stone : COLORS.iron);
      break;
    }
    default: b.box(-0.09, 0, -0.09, 0.18, 0.12, 0.18, COLORS.leather); b.box(-0.09, 0.12, -0.09, 0.18, 0.02, 0.18, COLORS.linen);
  }
}

/** A lidded chest or sack for canonical containers. */
export function containerGeometry(b: PropBuilder, open: boolean): void {
  // Hollow case and hinged coopered lid retain the canonical open/closed state.
  b.bevelBox(-.42,0,-.28,.84,.06,.56,COLORS.darkOak);
  for(const z of [-.28,.23])b.bevelBox(-.42,.04,z,.84,.36,.05,COLORS.oak,.009);
  for(const x of [-.42,.37])b.bevelBox(x,.04,-.23,.05,.36,.46,COLORS.oak,.009);
  for(const x of [-.3,.25])for(const z of [-.288,.238])b.box(x,.025,z,.05,.375,.05,COLORS.iron);
  b.box(-.042,.27,.282,.084,.14,.025,COLORS.brass);
  const angle=open?1.35:0, cs=Math.cos(angle), sn=Math.sin(angle);
  const P=(x:number,dy:number,z:number):V=>b.p(x,.4+dy*cs+(z+.28)*sn,-.28-dy*sn+(z+.28)*cs);
  const ring=(x:number)=>Array.from({length:9},(_,i)=>P(x,Math.sin(i*Math.PI/8)*.16,Math.cos(i*Math.PI/8)*.28));
  const left=ring(-.425),right=ring(.425);
  for(let i=0;i<8;i++) {
    // Looking from above, X cross increasing theta gives the outward crown normal.
    b.batch.quad(left[i],right[i],right[i+1],left[i+1],c(COLORS.oak,.93+(i%3)*.06),1);
    for(const x of [-.29,.28])b.batch.quad(P(x-.025,Math.sin(i*Math.PI/8)*.165,Math.cos(i*Math.PI/8)*.286),P(x+.025,Math.sin(i*Math.PI/8)*.165,Math.cos(i*Math.PI/8)*.286),P(x+.025,Math.sin((i+1)*Math.PI/8)*.165,Math.cos((i+1)*Math.PI/8)*.286),P(x-.025,Math.sin((i+1)*Math.PI/8)*.165,Math.cos((i+1)*Math.PI/8)*.286),COLORS.iron,1);
  }
  for(const points of [left,right.slice().reverse()]) {
    const n=norm(cross(sub(points[1],points[0]),sub(points[2],points[0])));b.batch.polygon(points,n,COLORS.oak,1);
  }
  b.batch.quad(P(-.425,0,-.28),P(.425,0,-.28),P(.425,0,.28),P(-.425,0,.28),COLORS.darkOak,1);
}
