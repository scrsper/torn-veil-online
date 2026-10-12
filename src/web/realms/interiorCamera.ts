import type { CameraPose, V3 } from '../game/adaptiveCamera';
import { boxObstruction, type SolidBox } from './cameraSolids';

const gap = .35;
const distance = (a: V3, b: V3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
export const cameraBoxBlocked = (p: V3, solids: readonly SolidBox[]) => solids.some(s =>
  p.x > s.x-gap && p.x < s.x+s.w+gap && p.y > s.y-gap && p.y < s.y+s.h+gap && p.z > s.z-gap && p.z < s.z+s.d+gap);

/** Only geometry along the local camera sweep can raise framing. A distant tall
 * landmark must not lift the camera over an entire floor. */
export function cameraLocalTop(from: V3, to: V3, solids: readonly SolidBox[]): number {
 const x0=Math.min(from.x,to.x)-gap,x1=Math.max(from.x,to.x)+gap,z0=Math.min(from.z,to.z)-gap,z1=Math.max(from.z,to.z)+gap;
 return Math.max(from.y,...solids.filter(s=>s.x<x1&&s.x+s.w>x0&&s.z<z1&&s.z+s.d>z0).map(s=>s.y+s.h))+.6;
}

/** The current received Tower floors have open tops. When a nearby wall collapses
 * the sight-line cast, frame above that physical wall and cut away its occluding
 * presentation. The lens stays outside solids; gameplay geometry is untouched.
 * Yaw and preferred zoom remain input-owned, including while elevated. */
export class InteriorCameraFraming {
  private elevated = false;
  private clearFor = 0;
  private radius = 0;
  private lift = 0;
  private previous: V3 | null = null;
  readonly debug = { framing: 'orbit', rawDistance: 0, dist: 0, elevatedBy: 0, nearPlaneBlocked: false };

  reset() { this.elevated=false; this.clearFor=0; this.radius=0; this.lift=0; this.previous=null; }

  update(raw: CameraPose, pivot: V3, solids: readonly SolidBox[], orbit: { yaw: number; pitch: number; want: number; limit: number }, dt: number): CameraPose {
    const t = Math.min(.1, Math.max(0, dt)), rawDistance=distance(raw.position,pivot);
    const need = orbit.limit < 3.3 || rawDistance < 3 || cameraBoxBlocked(raw.position,solids);
    if (need) { this.elevated=true; this.clearFor=0; }
    else if (this.elevated) {
      this.clearFor = rawDistance >= Math.min(4.5,orbit.want)-.1 ? this.clearFor+t : 0;
      if(this.clearFor>.35)this.elevated=false;
    }
    const recovering = this.lift>.02 || this.previous !== null && Math.abs(this.radius-rawDistance)>.08;
    let position={...raw.position}, target={...raw.target};
    const candidate={x:pivot.x+Math.sin(orbit.yaw)*Math.cos(orbit.pitch)*orbit.want,y:pivot.y,z:pivot.z+Math.cos(orbit.yaw)*Math.cos(orbit.pitch)*orbit.want};
    let top=cameraLocalTop(pivot,candidate,solids);
    if(this.elevated || recovering) {
      const want=this.elevated?Math.max(3.4,orbit.want):rawDistance;
      if(!this.radius)this.radius=Math.max(3.4,rawDistance);
      this.radius += (want-this.radius)*(1-Math.exp(-5*t));
      this.radius=Math.max(3,this.radius);
      const horizontal=Math.cos(orbit.pitch)*this.radius;
      position={x:pivot.x+Math.sin(orbit.yaw)*horizontal,y:pivot.y+.1+Math.sin(orbit.pitch)*this.radius,z:pivot.z+Math.cos(orbit.yaw)*horizontal};
      this.lift=this.elevated?Math.max(this.lift,top-position.y):this.lift*Math.exp(-4*t);
      position.y+=Math.max(0,this.lift);
      target={x:pivot.x,y:pivot.y,z:pivot.z};
    } else this.radius=rawDistance;

    // Across a corner, first lift vertically in the old free column. Subsequent
    // frames can move above the walls. Never interpolate the lens through them.
    if(this.previous) {
      const length=distance(this.previous,position);
      if(length>1e-5) {
        const direction={x:(position.x-this.previous.x)/length,y:(position.y-this.previous.y)/length,z:(position.z-this.previous.z)/length};
        if(boxObstruction(()=>solids,gap)(this.previous,direction,length)<length-.001) {
          top=Math.max(top,cameraLocalTop(this.previous,position,solids));
          position={x:this.previous.x,y:Math.max(top,this.previous.y),z:this.previous.z};
          this.lift=Math.max(this.lift,top-(pivot.y+.1+Math.sin(orbit.pitch)*this.radius));
          this.elevated=true; this.clearFor=0; target={x:pivot.x,y:pivot.y,z:pivot.z};
        }
      }
    }
    if(cameraBoxBlocked(position,solids) || distance(position,pivot)<3) {
      const horizontal=Math.cos(orbit.pitch)*Math.max(3.4,this.radius);
      position={x:pivot.x+Math.sin(orbit.yaw)*horizontal,y:Math.max(top,pivot.y+.1+Math.sin(orbit.pitch)*Math.max(3.4,this.radius)),z:pivot.z+Math.cos(orbit.yaw)*horizontal};
      this.elevated=true;this.clearFor=0;this.lift=Math.max(0,position.y-(pivot.y+.1+Math.sin(orbit.pitch)*this.radius));target={x:pivot.x,y:pivot.y,z:pivot.z};
    }
    this.previous={...position};
    Object.assign(this.debug,{framing:this.elevated?'wall clearance':this.lift>.02?'recovering':'orbit',rawDistance:+rawDistance.toFixed(3),dist:+distance(position,pivot).toFixed(3),elevatedBy:+Math.max(0,this.lift).toFixed(3),nearPlaneBlocked:cameraBoxBlocked(position,solids)});
    return {position,target,fov:raw.fov};
  }
}
