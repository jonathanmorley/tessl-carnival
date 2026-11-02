import {
  compose,
  normalize,
  perspective,
  rotationX,
  rotationY,
  transformDirection,
  translation,
  type Mat4,
  type Vec3,
} from './mat4';
import type { Point } from './world';

/**
 * The first-person view of the 3D midway: where the camera looks, how input
 * turns into walking, and what a click lands on. Plain functions with no
 * canvas or DOM, so Vitest can run them.
 *
 * World space puts tile (x, y) at 3D (x, 0, y), with +y up. A yaw of 0 looks
 * north, towards the big top (-z); turning right increases it.
 */

/** How high the player's eyes are, in tiles. */
export const EYE_HEIGHT = 1.35;
export const FIELD_OF_VIEW = (65 * Math.PI) / 180;
export const MAX_PITCH = (75 * Math.PI) / 180;
/** Radians per second the arrow keys turn the view. */
export const TURN_SPEED = 2.2;

export interface Camera {
  x: number;
  /** The camera's tile y, which is world z. */
  y: number;
  yaw: number;
  pitch: number;
}

/** The unit tile direction the camera faces along the ground. */
export function forwardOf(yaw: number): Point {
  return { x: Math.sin(yaw), y: -Math.cos(yaw) };
}

/** The yaw that faces from one tile position to another. */
export function yawToward(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const wrapped = ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Turns `yaw` towards `target` the short way round, by at most `step` radians. */
export function turnToward(yaw: number, target: number, step: number): number {
  const delta = wrapAngle(target - yaw);
  if (Math.abs(delta) <= step) return target;
  return yaw + Math.sign(delta) * step;
}

export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

/**
 * Turns first-person input (each of -1, 0 or 1: forward is positive, right
 * is positive) into a unit tile direction for the walker.
 */
export function moveDirection(forward: number, strafe: number, yaw: number): Point {
  const f = forwardOf(yaw);
  const x = f.x * forward - f.y * strafe;
  const y = f.y * forward + f.x * strafe;
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

export function eyeOf(camera: Camera): Vec3 {
  return [camera.x, EYE_HEIGHT, camera.y];
}

/** World to camera space. */
export function viewMatrix(camera: Camera): Mat4 {
  const [x, y, z] = eyeOf(camera);
  return compose(rotationX(-camera.pitch), rotationY(camera.yaw), translation(-x, -y, -z));
}

export function projectionMatrix(aspect: number): Mat4 {
  return perspective(FIELD_OF_VIEW, aspect, 0.05, 160);
}

/**
 * The world direction through a point on screen, given in normalised device
 * coordinates: (-1, -1) is the bottom left, (1, 1) the top right.
 */
export function screenRay(camera: Camera, ndcX: number, ndcY: number, aspect: number): Vec3 {
  const t = Math.tan(FIELD_OF_VIEW / 2);
  const inCamera: Vec3 = [ndcX * t * aspect, ndcY * t, -1];
  const toWorld = compose(rotationY(-camera.yaw), rotationX(camera.pitch));
  return normalize(transformDirection(toWorld, inCamera));
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** How far along a ray it first enters a box, or undefined if it misses. */
export function rayBox(origin: Vec3, direction: Vec3, box: Box3): number | undefined {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis];
    const d = direction[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return undefined;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return undefined;
  }
  return near;
}

/** Where a ray meets the ground, or undefined if it never comes down. */
export function rayGround(
  origin: Vec3,
  direction: Vec3,
): { point: Point; distance: number } | undefined {
  if (direction[1] >= -1e-9) return undefined;
  const distance = -origin[1] / direction[1];
  return {
    point: { x: origin[0] + direction[0] * distance, y: origin[2] + direction[2] * distance },
    distance,
  };
}

/** The nearest thing a ray hits: the index into `boxes`, or the ground. */
export function pick(
  origin: Vec3,
  direction: Vec3,
  boxes: readonly Box3[],
): { kind: 'box'; index: number } | { kind: 'ground'; point: Point } | undefined {
  let best: { index: number; distance: number } | undefined;
  boxes.forEach((box, index) => {
    const distance = rayBox(origin, direction, box);
    if (distance !== undefined && (!best || distance < best.distance)) best = { index, distance };
  });
  const ground = rayGround(origin, direction);
  if (best && (!ground || best.distance <= ground.distance))
    return { kind: 'box', index: best.index };
  return ground ? { kind: 'ground', point: ground.point } : undefined;
}
