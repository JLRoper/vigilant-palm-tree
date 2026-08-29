import type { Mat4, Vec3 } from "./math";
import {
  ZERO,
  add,
  fromEuler,
  lerp,
  multiply,
  normalize,
  rotationZ,
  transformDirection,
  transformPoint,
  translation,
} from "./math";
import type { Animation, BoxPart, Keyframe, ModelDef } from "./types";

export interface Face {
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  color: string;
}

interface UnitFace {
  normal: Vec3;
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
}

const A = -0.5;
const B = 0.5;

const BOX_FACES: readonly UnitFace[] = [
  { normal: [1, 0, 0], corners: [[B, A, A], [B, B, A], [B, B, B], [B, A, B]] },
  { normal: [-1, 0, 0], corners: [[A, B, A], [A, A, A], [A, A, B], [A, B, B]] },
  { normal: [0, 1, 0], corners: [[B, B, A], [A, B, A], [A, B, B], [B, B, B]] },
  { normal: [0, -1, 0], corners: [[A, A, A], [B, A, A], [B, A, B], [A, A, B]] },
  { normal: [0, 0, 1], corners: [[A, A, B], [B, A, B], [B, B, B], [A, B, B]] },
  { normal: [0, 0, -1], corners: [[A, B, A], [B, B, A], [B, A, A], [A, A, A]] },
];

type Sample = { t: number; v: Vec3 };

function extract(keys: Keyframe[], field: "rotation" | "offset"): Sample[] {
  return keys
    .filter((k) => k[field] !== undefined)
    .map((k) => ({ t: k.t, v: k[field] as Vec3 }))
    .sort((a, b) => a.t - b.t);
}

function sample(list: Sample[], t: number, loop: boolean): Vec3 {
  if (list.length === 0) return ZERO;
  if (list.length === 1) return list[0].v;

  const first = list[0];
  const last = list[list.length - 1];

  if (t <= first.t) {
    if (!loop) return first.v;
    const from = last.t - 1;
    const span = first.t - from;
    return span <= 0 ? first.v : lerp(last.v, first.v, (t - from) / span);
  }

  if (t >= last.t) {
    if (!loop) return last.v;
    const to = first.t + 1;
    const span = to - last.t;
    return span <= 0 ? last.v : lerp(last.v, first.v, (t - last.t) / span);
  }

  for (let i = 0; i < list.length - 1; i += 1) {
    const a = list[i];
    const b = list[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return span <= 0 ? b.v : lerp(a.v, b.v, (t - a.t) / span);
    }
  }
  return last.v;
}

function emitBox(faces: Face[], world: Mat4, part: BoxPart): void {
  const [sx, sy, sz] = part.size;
  if (sx <= 0 || sy <= 0 || sz <= 0) return;

  const c = part.offset ?? ZERO;
  const color = part.color ?? "#ff00ff";

  const toWorld = (k: Vec3): Vec3 =>
    transformPoint(world, [c[0] + k[0] * sx, c[1] + k[1] * sy, c[2] + k[2] * sz]);

  for (const face of BOX_FACES) {
    faces.push({
      corners: [
        toWorld(face.corners[0]),
        toWorld(face.corners[1]),
        toWorld(face.corners[2]),
        toWorld(face.corners[3]),
      ],
      normal: normalize(transformDirection(world, face.normal)),
      color,
    });
  }
}

function walk(
  faces: Face[],
  part: BoxPart,
  parent: Mat4,
  anim: Animation | null,
  t: number,
): void {
  const keys = anim?.tracks[part.name];
  const loop = anim?.loop ?? false;

  const animRotation = keys ? sample(extract(keys, "rotation"), t, loop) : ZERO;
  const animOffset = keys ? sample(extract(keys, "offset"), t, loop) : ZERO;

  const rotation = add(part.rotation ?? ZERO, animRotation);
  const pivot = add(part.pivot ?? ZERO, animOffset);

  const world = multiply(parent, multiply(translation(pivot), fromEuler(rotation)));

  emitBox(faces, world, part);

  for (const child of part.children ?? []) {
    walk(faces, child, world, anim, t);
  }
}

export function frameTime(anim: Animation | null, frame: number): number {
  if (!anim || anim.frames <= 1) return 0;
  return anim.loop ? frame / anim.frames : frame / (anim.frames - 1);
}

export function buildFrame(
  model: ModelDef,
  anim: Animation | null,
  frame: number,
  yaw: number,
): Face[] {
  const faces: Face[] = [];
  walk(faces, model.root, rotationZ(yaw), anim, frameTime(anim, frame));
  return faces;
}

