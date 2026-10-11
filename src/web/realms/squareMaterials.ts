import { Color3, DynamicTexture, PBRMaterial, Texture, type Scene } from '@babylonjs/core';
import { mulberry } from '../render/noise';
import type { RealmId } from '../../sim/world/realms/layout';

export type SquareFinish = 'ceramic' | 'limestone' | 'basalt' | 'bronze' | 'zinc' | 'paving' | 'glass' | 'lit-glass';
/** Small reusable, locally authored material kit. Texture UVs are metres, not building-sized decals.
 * Glazing suggests interior depth without claiming additional canonical rooms or apertures. */
export class SquareMaterials {
  private readonly cache = new Map<string, PBRMaterial>();
  private readonly textures: DynamicTexture[] = [];
  constructor(private readonly scene: Scene) {}
  get(realm: RealmId, finish: SquareFinish): PBRMaterial {
    const key = `square:${realm}:${finish}`, prior = this.cache.get(key); if (prior) return prior;
    const sci = realm === 'aether', metal = finish === 'bronze' || finish === 'zinc', glass = finish.includes('glass');
    const colors: Record<SquareFinish,string> = { ceramic:'#78919d', limestone:'#baa991', basalt:'#535f66', bronze:'#a07b48', zinc:'#617c84', paving:sci?'#859095':'#b0a58c', glass:sci?'#304c5e':'#45555b', 'lit-glass':sci?'#7399a4':'#aa966c' };
    const m = new PBRMaterial(key, this.scene);
    m.albedoColor = Color3.White(); m.metallic = metal ? .65 : glass ? .25 : .04;
    m.roughness = metal ? .43 : glass ? .27 : finish === 'ceramic' ? .55 : .87;
    m.environmentIntensity = .85; m.specularIntensity = .7; m.maxSimultaneousLights = 4;
    const t = new DynamicTexture(`${key}:albedo`, {width:256,height:256}, this.scene, true);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8;
    const c = t.getContext() as CanvasRenderingContext2D, random = mulberry(117 + finish.length * 13);
    c.fillStyle = colors[finish]; c.fillRect(0,0,256,256);
    for (let n=0;n<4500;n++) {
      c.fillStyle = random()>.5 ? `rgba(255,249,227,${random()*.06})` : `rgba(8,20,26,${random()*.07})`;
      c.fillRect(random()*256,random()*256,1+random()*2,1+random()*3);
    }
    if (!glass && !metal) {
      // One tile spans two metres: joints stay the same width on wall, sill and paving.
      c.strokeStyle = 'rgba(15,27,33,.35)'; c.lineWidth = 1.3;
      const rows = finish === 'limestone' ? 4 : 2;
      for(let y=0;y<256;y+=256/rows) {
        c.beginPath(); c.moveTo(0,y); c.lineTo(256,y); c.stroke();
        const x = finish === 'limestone' && y%(512/rows) ? 128 : 0;
        c.beginPath(); c.moveTo(x,y); c.lineTo(x,y+256/rows); c.stroke();
      }
      c.strokeStyle='rgba(255,251,226,.16)'; c.lineWidth=1; c.strokeRect(1.5,1.5,253,253);
    } else if (glass) {
      const g = c.createLinearGradient(0,0,210,256);
      g.addColorStop(0,'rgba(141,183,205,.35)'); g.addColorStop(.43,'rgba(28,55,66,.04)'); g.addColorStop(1,'rgba(5,18,26,.55)');
      c.fillStyle=g; c.fillRect(0,0,256,256);
      c.fillStyle='rgba(10,23,31,.42)'; c.fillRect(18,24,220,27); c.fillRect(18,51,17,185);
      c.fillStyle=finish==='lit-glass'?'rgba(250,213,146,.6)':'rgba(187,213,220,.12)';
      c.fillRect(47,182,164,8); c.fillRect(201,54,4,142);
      for(let y=60;y<170;y+=18) {c.fillStyle='rgba(4,19,30,.15)';c.fillRect(41,y,156,2);}
      if(finish==='lit-glass') { m.emissiveColor = new Color3(.22,.17,.09); m.emissiveTexture = t; }
    } else {
      c.strokeStyle='rgba(227,238,228,.08)'; c.lineWidth=.7;
      for(let y=0;y<256;y+=3) {c.beginPath();c.moveTo(0,y);c.lineTo(256,y);c.stroke();}
    }
    t.update(); m.albedoTexture=t; this.textures.push(t); this.cache.set(key,m); return m;
  }
  dispose():void { for(const m of this.cache.values())m.dispose(); for(const t of this.textures)t.dispose(); this.cache.clear(); }
}
