// Scratch (ignored): read-only GLB JSON inspection, run through vitest because bare node scripts need approval here.
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
const S = 'C:/Users/green/Documents/Codex/2026-10-22/task/source-current/public/assets/';
const files = ['Veil_Male_BaseBody.glb', 'Veil_Male_Head_005.glb', 'Veil_Male_BaseBoots.glb', 'Veil_Male_BasePants.glb', 'hair/Veil_Male_Hair_001.glb', 'Veil_Female_BaseBody.glb', 'Veil_Female_Head_039.glb', 'hair/Veil_Female_Hair_001.glb'];
for (const mode of ['tree', 'mat']) test('inspect ' + mode, () => {
  const out: string[] = [];
  for (const file of files) {
    const b = readFileSync(S + file), len = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
    out.push('== ' + file);
    if (mode === 'tree') {
      const joints = new Set((j.skins ?? []).flatMap((s: any) => s.joints));
      const walk = (i: number, d: number) => {
        const n = j.nodes[i];
        const detail = /Twist|_Pivot|^S_0|Muscle|Breast|Cape|Skirt/i.test(n.name) ? '' : ` t=${JSON.stringify(n.translation?.map((v: number) => +v.toFixed(3)))} r=${JSON.stringify(n.rotation?.map((v: number) => +v.toFixed(3)))} s=${JSON.stringify(n.scale)}`;
        out.push(' '.repeat(d) + n.name + (joints.has(i) ? '' : ' [nonjoint]') + (n.mesh != null ? ` [mesh skin=${n.skin}]` : '') + detail);
        (n.children ?? []).forEach((c: number) => walk(c, d + 1));
      };
      j.scenes[0].nodes.forEach((r: number) => walk(r, 0));
      out.push('skins: ' + JSON.stringify((j.skins ?? []).map((s: any) => ({ n: s.joints.length, skeleton: s.skeleton != null ? j.nodes[s.skeleton].name : null }))));
      out.push('meshes: ' + JSON.stringify(j.meshes.map((m: any) => ({ name: m.name, prims: m.primitives.map((p: any) => ({ attrs: Object.keys(p.attributes), material: j.materials?.[p.material]?.name, targets: p.targets?.length ?? 0 })) }))));
    } else {
      out.push(JSON.stringify({ materials: j.materials, textures: j.textures, images: j.images, ext: j.extensionsUsed, extReq: j.extensionsRequired }, null, 1));
    }
  }
  writeFileSync('.debug/character-base-scratch/out-' + mode + '.txt', out.join('\n'));
});
