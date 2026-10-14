import { mulberry } from '../render/noise';

/**
 * Paints a character's head skin texture: base tone, soft variation, cheek colour, brows, lids and
 * lashes, lips, age lines and stubble. The head mesh is planar-projected from the front (u = 0.5 +
 * x/2, v = 0.5 + z/2 in the skull's unit sphere), so features are placed at the same unit
 * coordinates the modelled face uses in art/tools/web_characters/head.py. Everything is
 * deterministic from the appearance signature: the same person always has the same face paint.
 */
export interface FaceSpec {
  skin: [number, number, number];          // 0..255
  hair: [number, number, number];
  eyeColor: [number, number, number];
  lipTint: [number, number, number];
  presentation: 'feminine' | 'masculine' | 'androgynous';
  age: 'child' | 'adolescent' | 'young_adult' | 'adult' | 'middle_aged' | 'elder';
  grooming: number; wear: number; beard: number; seed: number;
  makeup?: 'none' | 'court' | 'festival' | 'kitsune';
}

const clamp = (v: number) => Math.max(0, Math.min(255, v));
const rgb = (c: [number, number, number], a = 1) => `rgba(${clamp(c[0]) | 0},${clamp(c[1]) | 0},${clamp(c[2]) | 0},${a})`;
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Paired iris layout for the imported beta base face; colour is always canonical appearance. */
export function paintPairedIris(g: CanvasRenderingContext2D, color: [number, number, number]): void {
  g.clearRect(0,0,1024,512);
  for (const cx of [256,768]) {
    g.save(); g.translate(cx,256); g.scale(1,1.13);
    g.beginPath(); g.arc(0,0,118,0,Math.PI*2); g.clip();
    const iris=g.createRadialGradient(0,34,18,0,0,119);
    iris.addColorStop(0,rgb(mixc(color,[210,232,245],.55))); iris.addColorStop(.55,rgb(color)); iris.addColorStop(.9,rgb(mixc(color,[12,18,30],.65))); iris.addColorStop(1,'#09111e');
    g.fillStyle=iris; g.fillRect(-120,-120,240,240);
    const rnd=mulberry(432);
    for(let i=0;i<140;i++) { const a=i/140*Math.PI*2, r=43+rnd()*17; g.strokeStyle=rgb(mixc(color,[10,20,32],.5),.3+rnd()*.3); g.lineWidth=.8+rnd()*1.3; g.beginPath(); g.moveTo(Math.cos(a)*r,Math.sin(a)*r); g.lineTo(Math.cos(a+.01)*112,Math.sin(a+.01)*112); g.stroke(); }
    const shade=g.createLinearGradient(0,-100,0,95); shade.addColorStop(0,'rgba(4,8,22,.86)'); shade.addColorStop(.65,'rgba(4,8,22,.05)'); shade.addColorStop(1,'rgba(4,8,22,0)'); g.fillStyle=shade; g.fillRect(-120,-120,240,240);
    g.fillStyle='#070d18';g.beginPath();g.ellipse(0,-3,36,49,0,0,Math.PI*2);g.fill();
    g.fillStyle='rgba(237,248,255,.9)';g.beginPath();g.ellipse(-31,-48,14,19,-.3,0,Math.PI*2);g.fill();
    g.fillStyle='rgba(237,248,255,.65)';g.beginPath();g.arc(39,34,6,0,Math.PI*2);g.fill();g.restore();
  }
}

export function paintFace(ctx: CanvasRenderingContext2D, size: number, f: FaceSpec): void {
  const S = size, X = (u: number) => u * S, Y = (v: number) => (1 - v) * S;   // unit-face coords -> canvas
  const nx = (x: number) => X(0.5 + x * 0.5), nz = (z: number) => Y(0.5 + z * 0.5);
  const rnd = mulberry(f.seed || 1);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = rgb(f.skin); ctx.fillRect(0, 0, S, S);
  // Broad tonal variation: warmer centre, cooler edges, a touch lighter forehead.
  const warm = mixc(f.skin, [f.skin[0] + 14, f.skin[1] - 2, f.skin[2] - 6], 1);
  let g = ctx.createRadialGradient(nx(0), nz(-0.1), S * 0.02, nx(0), nz(-0.1), S * 0.5);
  g.addColorStop(0, rgb(warm, 0.35)); g.addColorStop(1, rgb(warm, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  g = ctx.createLinearGradient(0, nz(0.7), 0, nz(0.3)); g.addColorStop(0, rgb([f.skin[0] + 8, f.skin[1] + 8, f.skin[2] + 8], 0.25)); g.addColorStop(1, rgb(f.skin, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // Cool shadow toward the sides and under the jaw.
  g = ctx.createLinearGradient(0, nz(-0.6), 0, nz(-1)); g.addColorStop(0, rgb([f.skin[0] - 24, f.skin[1] - 26, f.skin[2] - 22], 0)); g.addColorStop(1, rgb([f.skin[0] - 24, f.skin[1] - 26, f.skin[2] - 22], 0.5)); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * S, y = rnd() * S, r = (0.5 + rnd() * 2.2) * S / 256, a = 0.02 + rnd() * 0.035;
    ctx.fillStyle = rnd() > 0.5 ? rgb([f.skin[0] + 18, f.skin[1] + 12, f.skin[2] + 8], a) : rgb([f.skin[0] - 20, f.skin[1] - 20, f.skin[2] - 14], a);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const fem = f.presentation === 'feminine', child = f.age === 'child';
  const blush: [number, number, number] = [Math.min(255, f.skin[0] + 26), f.skin[1] - 18, f.skin[2] - 14];
  for (const sg of [-1, 1]) {
    const g2 = ctx.createRadialGradient(nx(0.52 * sg), nz(-0.16), 1, nx(0.52 * sg), nz(-0.16), S * (child ? 0.115 : 0.09));
    g2.addColorStop(0, rgb(blush, (child ? 0.32 : fem ? 0.26 : 0.16) * (0.6 + 0.4 * f.grooming))); g2.addColorStop(1, rgb(blush, 0)); ctx.fillStyle = g2; ctx.fillRect(0, 0, S, S);
  }
  // Nose: shadow at the sides and a soft tip highlight.
  for (const sg of [-1, 1]) {
    const gn = ctx.createRadialGradient(nx(0.115 * sg), nz(-0.12), 1, nx(0.115 * sg), nz(-0.12), S * 0.035);
    gn.addColorStop(0, rgb([f.skin[0] - 30, f.skin[1] - 32, f.skin[2] - 26], 0.28)); gn.addColorStop(1, rgb(f.skin, 0)); ctx.fillStyle = gn; ctx.fillRect(0, 0, S, S);
  }
  // Eyes: socket shadow, lid crease, lash line.
  const ex = 0.355, ez = 0.055, ew = S * 0.052, eh = S * 0.021;
  for (const sg of [-1, 1]) {
    const cx = nx(ex * sg), cy = nz(ez);
    const gs = ctx.createRadialGradient(cx, cy, 1, cx, cy, S * 0.075);
    gs.addColorStop(0, rgb([f.skin[0] - 40, f.skin[1] - 42, f.skin[2] - 30], 0.32)); gs.addColorStop(1, rgb(f.skin, 0)); ctx.fillStyle = gs; ctx.fillRect(0, 0, S, S);
    // upper lid line with a wing, lower lid line lighter
    const lash = mixc(f.hair, [20, 16, 16], 0.7);
    ctx.strokeStyle = rgb(lash, fem ? 0.95 : 0.7); ctx.lineWidth = S * (fem ? 0.0075 : 0.0055); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - sg * ew * 0.92, cy - eh * 0.1); ctx.quadraticCurveTo(cx, cy - eh * 1.95, cx + sg * ew * 1.02, cy - eh * 0.25); ctx.stroke();
    if (fem && !child) { ctx.lineWidth = S * 0.006; ctx.beginPath(); ctx.moveTo(cx + sg * ew * 1.0, cy - eh * 0.25); ctx.lineTo(cx + sg * ew * 1.32, cy - eh * 0.85); ctx.stroke(); }
    ctx.strokeStyle = rgb(mixc(f.skin, lash, 0.45), 0.5); ctx.lineWidth = S * 0.0035;
    ctx.beginPath(); ctx.moveTo(cx - sg * ew * 0.8, cy + eh * 0.55); ctx.quadraticCurveTo(cx, cy + eh * 1.5, cx + sg * ew * 0.85, cy + eh * 0.5); ctx.stroke();
    ctx.strokeStyle = rgb(mixc(f.skin, [60, 40, 40], 0.4), 0.35); ctx.lineWidth = S * 0.0035;
    ctx.beginPath(); ctx.moveTo(cx - sg * ew * 0.75, cy - eh * 2.7); ctx.quadraticCurveTo(cx, cy - eh * 3.6, cx + sg * ew * 0.85, cy - eh * 2.6); ctx.stroke();
    if (f.makeup && f.makeup !== 'none') {
      const col = f.makeup === 'kitsune' ? [190, 60, 70] : f.makeup === 'court' ? [200, 90, 110] : [210, 120, 90];
      ctx.strokeStyle = rgb(col as [number, number, number], 0.7); ctx.lineWidth = S * 0.0055;
      ctx.beginPath(); ctx.moveTo(cx - sg * ew * 0.6, cy - eh * 1.5); ctx.quadraticCurveTo(cx + sg * ew * 0.4, cy - eh * 2.3, cx + sg * ew * 1.5, cy - eh * 1.4); ctx.stroke();
    }
  }
  const brow = mixc(f.hair, [30, 22, 18], 0.35);
  const thick = f.presentation === 'masculine' ? 1.35 : fem ? 0.75 : 1;
  for (const sg of [-1, 1]) {
    ctx.strokeStyle = rgb(brow, 0.86); ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.lineWidth = S * 0.0065 * thick * (1 - k * 0.22);
      const oy = k * S * 0.0035 * thick;
      ctx.beginPath(); ctx.moveTo(nx(0.16 * sg), nz(0.235) + oy + S * 0.006); ctx.quadraticCurveTo(nx(0.36 * sg), nz(0.235) - S * 0.024 + oy, nx(0.58 * sg), nz(0.235) + S * 0.012 + oy); ctx.stroke();
    }
  }
  const lipY = nz(-0.365);
  const lip = f.lipTint;
  const lw = S * (fem ? 0.066 : 0.060);
  ctx.fillStyle = rgb(lip, 0.92);
  ctx.beginPath(); ctx.moveTo(nx(0) - lw, lipY); ctx.quadraticCurveTo(nx(-0.05), lipY - S * 0.022, nx(0), lipY - S * 0.012); ctx.quadraticCurveTo(nx(0.05), lipY - S * 0.022, nx(0) + lw, lipY);
  ctx.quadraticCurveTo(nx(0), lipY + S * 0.006, nx(0) - lw, lipY); ctx.fill();
  ctx.fillStyle = rgb(mixc(lip, [90, 30, 40], 0.25), 0.95);
  ctx.beginPath(); ctx.moveTo(nx(0) - lw * 0.92, lipY + S * 0.001); ctx.quadraticCurveTo(nx(0), lipY + S * (fem ? 0.030 : 0.024), nx(0) + lw * 0.92, lipY + S * 0.001); ctx.quadraticCurveTo(nx(0), lipY + S * 0.007, nx(0) - lw * 0.92, lipY + S * 0.001); ctx.fill();
  ctx.strokeStyle = rgb([70, 28, 32], 0.75); ctx.lineWidth = S * 0.0032; ctx.beginPath(); ctx.moveTo(nx(0) - lw, lipY + S * 0.001); ctx.quadraticCurveTo(nx(0), lipY + S * 0.006, nx(0) + lw, lipY + S * 0.001); ctx.stroke();
  if (f.makeup === 'court' || f.makeup === 'kitsune') { ctx.fillStyle = rgb([176, 40, 56], 0.55); ctx.beginPath(); ctx.ellipse(nx(0), lipY + S * 0.006, lw * 0.9, S * 0.012, 0, 0, Math.PI * 2); ctx.fill(); }
  if (f.age === 'elder' || f.age === 'middle_aged') {
    const a = f.age === 'elder' ? 0.28 : 0.13;
    ctx.strokeStyle = rgb([f.skin[0] - 50, f.skin[1] - 52, f.skin[2] - 40], a); ctx.lineWidth = S * 0.0028;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(nx(-0.42), nz(0.42 + i * 0.045)); ctx.quadraticCurveTo(nx(0), nz(0.44 + i * 0.045), nx(0.42), nz(0.42 + i * 0.045)); ctx.stroke(); }
    for (const sg of [-1, 1]) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(nx(0.62 * sg), nz(0.05 + i * 0.03)); ctx.lineTo(nx(0.74 * sg), nz(0.08 + i * 0.05)); ctx.stroke(); }
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(nx(0.16 * sg), nz(-0.2)); ctx.quadraticCurveTo(nx(0.26 * sg), nz(-0.32), nx(0.24 * sg), nz(-0.44)); ctx.stroke(); }
  }
  if (f.beard > 0.02 && f.presentation !== 'feminine' && f.age !== 'child') {
    const bc = mixc(f.hair, [20, 18, 16], 0.3), dens = Math.min(1, f.beard);
    const n = Math.floor(2600 * dens * (S / 512) ** 2);
    for (let i = 0; i < n; i++) {
      const x = 0.5 + (rnd() * 2 - 1) * 0.62 * 0.5, z = -0.85 + rnd() * 0.62;                  // jaw and chin, unit coords
      const inJaw = Math.abs(x - 0.5) * 2 < 0.62 - Math.max(0, (z + 0.3) * 0.2) && z < -0.38 - Math.abs(x - 0.5) * 0.4 || z < -0.26 && Math.abs(x - 0.5) * 2 > 0.4;
      if (!inJaw) continue;
      ctx.fillStyle = rgb(bc, 0.22 + rnd() * 0.3); ctx.fillRect(X(x), nz(z), S * 0.0035, S * 0.0035);
    }
  }
  // Grooming: unkempt faces get a little dirt.
  if (f.grooming < 0.4) { for (let i = 0; i < 40; i++) { ctx.fillStyle = rgb([70, 55, 40], 0.04 + rnd() * 0.06); ctx.beginPath(); ctx.arc(rnd() * S, S * (0.2 + rnd() * 0.7), S * (0.006 + rnd() * 0.02), 0, 6.3); ctx.fill(); } }
}

/** Iris texture for the eyeball's planar front UV (iris at the centre of the square). */
export function paintEye(ctx: CanvasRenderingContext2D, size: number, iris: [number, number, number], pupilScale = 1): void {
  const S = size, c = S / 2;
  ctx.fillStyle = 'rgb(236,234,230)'; ctx.fillRect(0, 0, S, S);
  const g0 = ctx.createRadialGradient(c, c, S * 0.2, c, c, S * 0.5); g0.addColorStop(0, 'rgba(236,234,230,0)'); g0.addColorStop(1, 'rgba(180,170,168,0.55)'); ctx.fillStyle = g0; ctx.fillRect(0, 0, S, S);
  const R = S * 0.235;
  let g = ctx.createRadialGradient(c, c, R * 0.15, c, c, R);
  g.addColorStop(0, rgb([iris[0] * 0.55, iris[1] * 0.55, iris[2] * 0.55])); g.addColorStop(0.55, rgb(iris)); g.addColorStop(0.9, rgb([iris[0] * 0.72, iris[1] * 0.72, iris[2] * 0.72])); g.addColorStop(1, 'rgba(15,12,12,1)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgb([Math.min(255, iris[0] * 1.35 + 20), Math.min(255, iris[1] * 1.35 + 20), Math.min(255, iris[2] * 1.35 + 20)], 0.25); ctx.lineWidth = S * 0.004;
  for (let i = 0; i < 44; i++) { const a = (i / 44) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * R * 0.32, c + Math.sin(a) * R * 0.32); ctx.lineTo(c + Math.cos(a) * R * 0.92, c + Math.sin(a) * R * 0.92); ctx.stroke(); }
  ctx.fillStyle = 'rgb(8,6,6)'; ctx.beginPath(); ctx.arc(c, c, R * 0.36 * pupilScale, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(c - R * 0.34, c - R * 0.36, R * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(c + R * 0.30, c + R * 0.34, R * 0.08, 0, Math.PI * 2); ctx.fill();
}
