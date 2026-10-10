import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import type { CharacterRig } from './characterRig';
import { sampleFoot, type Gait } from './locomotion';
import { setWorldRotation, solveTwoBone } from './twoBoneIK';

/** Two planted/swinging feet in model space, shared by every world person and body size. */
export class FootPlacement {
  private readonly rest = new Map<string, Vector3>();
  readonly stature: number;
  constructor(private readonly rig: CharacterRig) {
    rig.model.computeWorldMatrix(true);
    const inv = Matrix.Invert(rig.model.getWorldMatrix());
    for (const side of ['l', 'r']) {
      const foot = rig.bones.get(`foot_${side}`);
      if (foot) { foot.node.computeWorldMatrix(true); this.rest.set(side, Vector3.TransformCoordinates(foot.node.absolutePosition, inv)); }
    }
    const thigh = rig.bones.get('thigh_l')?.node, calf = rig.bones.get('calf_l')?.node, foot = rig.bones.get('foot_l')?.node;
    for (const node of [thigh, calf, foot]) node?.computeWorldMatrix(true);
    this.stature = thigh && calf && foot ? (Vector3.Distance(thigh.absolutePosition, calf.absolutePosition) + Vector3.Distance(calf.absolutePosition, foot.absolutePosition)) / .86 : 1;
  }
  apply(phase: number, gait: Gait, direction: { x: number; z: number }, weight: number): void {
    if (weight < .001) return;
    const rig = this.rig;
    rig.model.computeWorldMatrix(true);
    const matrix = rig.model.getWorldMatrix(), scale = new Vector3(); matrix.decompose(scale);
    const horizontal = Math.max(.1, Math.abs(scale.x)), vertical = Math.max(.1, Math.abs(scale.y));
    for (const [side, offset] of [['l', 0], ['r', .5]] as const) {
      const rest = this.rest.get(side), upper = rig.bones.get(`thigh_${side}`), lower = rig.bones.get(`calf_${side}`), foot = rig.bones.get(`foot_${side}`);
      if (!rest || !upper || !lower || !foot) continue;
      const step = sampleFoot(phase + offset, gait);
      const target = Vector3.TransformCoordinates(rest.add(new Vector3(direction.x * step.travel / horizontal, step.lift / vertical, direction.z * step.travel / horizontal)), matrix);
      const pole = Vector3.TransformCoordinates(new Vector3(rest.x, rest.y + .55, 1.5), matrix);
      solveTwoBone(upper.node, lower.node, foot.node, target, pole, weight, rig.model);
      const pitch = Quaternion.RotationAxis(new Vector3(1, 0, 0), step.pitch);
      const desired = rig.model.absoluteRotationQuaternion.multiply(pitch).multiply(foot.restWorld);
      setWorldRotation(foot.node, Quaternion.Slerp(foot.node.absoluteRotationQuaternion, desired, weight));
    }
  }
}
