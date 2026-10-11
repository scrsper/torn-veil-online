/** Controlled actual-rig render fixture. No canonical world or live preview connection. */
import { Engine, Scene, SceneLoader, TransformNode, Vector3, Matrix, Color3, HemisphericLight, DirectionalLight, UniversalCamera, MeshBuilder, PBRMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { Retargeter, MIXAMO, UE, type ClipTemplate } from '../../src/web/arena/retarget';

const local = new URL('../../.debug/input-posture-repair/', import.meta.url).pathname.replace(/\/?$/, '/');
const before = await import(/* @vite-ignore */ local + 'baseline-retarget.ts');
const canvas = document.getElementById('fixture') as HTMLCanvasElement;
const engine = new Engine(canvas, true), scene = new Scene(engine); scene.useRightHandedSystem = true;
scene.clearColor.set(.80, .83, .87, 1);
const sky = new HemisphericLight('studio fill', new Vector3(0, 1, 0), scene); sky.intensity = .9; sky.groundColor = new Color3(.38, .39, .43);
const sun = new DirectionalLight('studio key', new Vector3(-1, -2, -1), scene); sun.intensity = 1.2;
const camera = new UniversalCamera('matched side view', new Vector3(3.8, 1.03, .04), scene); camera.setTarget(new Vector3(0, .98, .04)); camera.fov = .63; camera.minZ = .05;
const floor = MeshBuilder.CreateGround('reference floor', { width: 6, height: 6 }, scene);
const floorMaterial = new PBRMaterial('studio floor', scene); floorMaterial.albedoColor = new Color3(.48, .51, .56); floorMaterial.metallic = 0; floorMaterial.roughness = .95; floor.material = floorMaterial;
engine.runRenderLoop(() => scene.render(false));
let serial = 0;
async function load(path: string) {
  console.log('POSE LOAD', path);
  const c = await SceneLoader.LoadAssetContainerAsync(local + 'assets/', path, scene);
  const tag = 'pose' + serial++, e = c.instantiateModelsToScene(n => `${tag}.${n}`, false, { doNotInstantiate: true });
  const space = new TransformNode(tag, scene); for (const n of e.rootNodes) n.parent = space; for (const g of e.animationGroups) g.stop();
  const nodes = new Map(space.getChildTransformNodes(false).map(n => [n.name.slice(tag.length + 1), n]));
  return { space, nodes, groups: e.animationGroups, hip: nodes.get('pelvis')?.position.length() ?? 1 };
}
function posture(r: Awaited<ReturnType<typeof load>>) {
  r.space.computeWorldMatrix(true); for (const n of r.space.getChildTransformNodes(false)) n.computeWorldMatrix(true);
  const inv = Matrix.Invert(r.space.getWorldMatrix()), p = (name: string) => Vector3.TransformCoordinates(r.nodes.get(name)!.getAbsolutePosition(), inv);
  const lean = (a: Vector3, b: Vector3) => Math.atan2(Math.hypot(b.x - a.x, b.z - a.z), b.y - a.y) * 180 / Math.PI;
  return { torso: lean(p('pelvis'), p('neck_01')), upper: lean(p('spine_03'), p('head')), root: r.space.position.asArray() };
}
const rigs = new Map<string, Awaited<ReturnType<typeof load>>>(), templates = new Map<string, Map<string, ClipTemplate>>();
for (const variant of ['before', 'after']) for (const look of ['hero', 'wren', 'brann', 'mystic']) { const rig = await load(`people/${look}.glb`); rig.space.setEnabled(false); rigs.set(`${variant}:${look}`, rig); }
for (const [pack, map] of [['mixamo_clips.glb', MIXAMO], ['unarmed_clips.glb', UE]] as const) {
  const source = await load(pack); source.space.setEnabled(false);
  for (const variant of ['before', 'after']) {
    const ref = rigs.get(`${variant}:hero`)!, rt = new (variant === 'before' ? before.Retargeter : Retargeter)(source, ref, map);
    const clips = templates.get(variant) ?? new Map(); templates.set(variant, clips);
    for (const g of source.groups) {
      const name = g.name.slice(g.name.indexOf('.') + 1);
      if (['locomotion/idle', 'locomotion/walking', 'locomotion/running', 'jab_left'].includes(name)) clips.set(name, rt.bake(name, g));
    }
  }
}
const poses = { neutral: ['locomotion/idle', 0], walk: ['locomotion/walking', .25], run: ['locomotion/running', .25], combat: ['jab_left', .35] } as const;
const select = (variant: string, look: string, pose: keyof typeof poses) => {
  for (const r of rigs.values()) r.space.setEnabled(false);
  const r = rigs.get(`${variant}:${look}`)!, ref = rigs.get(`${variant}:hero`)!, [name, phase] = poses[pose], clip = templates.get(variant)!.get(name)!;
  if (!clip) throw new Error(`Missing actual clip ${name}`);
  for (const t of clip.tracks) {
    const n = r.nodes.get(t.bone); if (!n) continue; const v = t.anim.evaluate(phase * (clip.frames - 1));
    if (t.anim.targetProperty === 'rotationQuaternion') n.rotationQuaternion = v.clone();
    else if (t.anim.targetProperty === 'position') n.position.copyFrom(t.bone === 'pelvis' ? v.scale(r.hip / ref.hip) : v);
  }
  r.space.setEnabled(true); scene.render(false);
  const measurement = posture(r);
  document.getElementById('label')!.innerHTML = `${variant.toUpperCase()} · ${look} · ${pose}<small>Actual imported model / authored clip · fixed side camera · pose fixture</small>`;
  return { variant, look, pose, clip: name, phase, measurement };
};
Object.assign(window, { tvPosture: { ready: true, select, camera: camera.position.asArray(), clips: [...templates.get('after')!.keys()] } });
select('after', 'hero', 'neutral');
window.addEventListener('resize', () => engine.resize());
