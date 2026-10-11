import { Matrix, Quaternion, Vector3, type TransformNode } from '@babylonjs/core';

function fromTo(a: Vector3, b: Vector3): Quaternion {
  if (a.lengthSquared() < 1e-12 || b.lengthSquared() < 1e-12) return Quaternion.Identity();
  const u = a.normalizeToNew(), v = b.normalizeToNew(), dot = Math.max(-1, Math.min(1, Vector3.Dot(u, v)));
  if (dot > .999999) return Quaternion.Identity();
  let axis = Vector3.Cross(u, v);
  if (axis.lengthSquared() < 1e-12) axis = Vector3.Cross(u, Math.abs(u.y) < .9 ? Vector3.Up() : Vector3.Right());
  return Quaternion.RotationAxis(axis.normalize(), Math.acos(dot));
}

export function setWorldRotation(node: TransformNode, rotation: Quaternion): void {
  const parent = node.parent as TransformNode | null;
  parent?.computeWorldMatrix(true);
  const q = parent ? Quaternion.Inverse(parent.absoluteRotationQuaternion).multiply(rotation) : rotation;
  node.rotationQuaternion ??= Quaternion.Identity();
  node.rotationQuaternion.copyFrom(q).normalize(); node.computeWorldMatrix(true);
}

/** Bounded analytic IK. Only rotates the visual bones; never moves a canonical body or stretches limbs. */
export function solveTwoBone(upper: TransformNode, lower: TransformNode, end: TransformNode, target: Vector3, pole: Vector3, weight = 1, space?: TransformNode): void {
  if (weight <= 0) return;
  // Solve inside the character's frame when it has a non-uniform build scale. World-space
  // quaternion rotations cannot cancel that scale and would leave broad characters' feet floating.
  space?.computeWorldMatrix(true);
  const inverse = space ? Matrix.Invert(space.getWorldMatrix()) : null;
  const point = (p: Vector3) => inverse ? Vector3.TransformCoordinates(p, inverse) : p.clone();
  const rotation = (n: TransformNode): Quaternion => {
    n.computeWorldMatrix(true);
    if (!inverse) return n.absoluteRotationQuaternion.clone();
    const q = new Quaternion(); n.getWorldMatrix().multiply(inverse).decompose(undefined, q); return q;
  };
  const turn = (n: TransformNode, q: Quaternion) => {
    const parent = n.parent as TransformNode | null;
    n.rotationQuaternion ??= Quaternion.Identity();
    n.rotationQuaternion.copyFrom(parent ? Quaternion.Inverse(rotation(parent)).multiply(q) : q).normalize();
    n.computeWorldMatrix(true);
  };
  upper.computeWorldMatrix(true); lower.computeWorldMatrix(true); end.computeWorldMatrix(true);
  const a = point(upper.getAbsolutePosition()), b = point(lower.getAbsolutePosition()), c = point(end.getAbsolutePosition());
  const l1 = Vector3.Distance(a, b), l2 = Vector3.Distance(b, c);
  if (Math.min(l1, l2) < 1e-5) return;
  const goal = Vector3.Lerp(c, point(target), Math.min(1, weight)), at = goal.subtract(a);
  if (at.lengthSquared() < 1e-12) return;
  const d = Math.max(Math.abs(l1 - l2) + 1e-5, Math.min(at.length(), l1 + l2 - 1e-5)), direction = at.normalize();
  let bend = point(pole).subtract(a); bend.subtractInPlace(direction.scale(Vector3.Dot(bend, direction)));
  if (bend.lengthSquared() < 1e-10) bend = Vector3.Cross(direction, Math.abs(direction.y) < .9 ? Vector3.Up() : Vector3.Right());
  bend.normalize();
  const cos = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const joint = a.add(direction.scale(cos * l1)).add(bend.scale(Math.sqrt(1 - cos * cos) * l1));
  turn(upper, fromTo(b.subtract(a), joint.subtract(a)).multiply(rotation(upper)));
  lower.computeWorldMatrix(true); end.computeWorldMatrix(true);
  const b2 = point(lower.getAbsolutePosition()), c2 = point(end.getAbsolutePosition());
  turn(lower, fromTo(c2.subtract(b2), a.add(direction.scale(d)).subtract(b2)).multiply(rotation(lower)));
  end.computeWorldMatrix(true);
}
