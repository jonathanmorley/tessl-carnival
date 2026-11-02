import { describe, expect, it } from 'vitest';
import { compose, transformPoint } from './mat4';
import {
  clampPitch,
  EYE_HEIGHT,
  eyeOf,
  forwardOf,
  MAX_PITCH,
  moveDirection,
  pick,
  projectionMatrix,
  rayBox,
  rayGround,
  screenRay,
  turnToward,
  viewMatrix,
  wrapAngle,
  yawToward,
  type Camera,
} from './view3d';

const camera = (yaw = 0, pitch = 0): Camera => ({ x: 5, y: 5, yaw, pitch });

describe('first-person movement', () => {
  it('faces north at yaw 0 and turns right as yaw grows', () => {
    expect(forwardOf(0).x).toBeCloseTo(0);
    expect(forwardOf(0).y).toBeCloseTo(-1);
    expect(forwardOf(Math.PI / 2).x).toBeCloseTo(1);
    expect(forwardOf(Math.PI / 2).y).toBeCloseTo(0);
  });

  it('walks forward, back and sideways relative to the view', () => {
    const forward = moveDirection(1, 0, 0);
    expect(forward.x).toBeCloseTo(0);
    expect(forward.y).toBeCloseTo(-1);
    const right = moveDirection(0, 1, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
    const back = moveDirection(-1, 0, Math.PI / 2);
    expect(back.x).toBeCloseTo(-1);
  });

  it('walks diagonals at the same speed, and stands still with no input', () => {
    const d = moveDirection(1, 1, 0.3);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(moveDirection(0, 0, 1)).toEqual({ x: 0, y: 0 });
  });

  it('finds the yaw that faces a point', () => {
    const from = { x: 2, y: 2 };
    for (const to of [
      { x: 2, y: 0 },
      { x: 5, y: 2 },
      { x: 0, y: 5 },
    ]) {
      const f = forwardOf(yawToward(from, to));
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      expect(f.x).toBeCloseTo((to.x - from.x) / d);
      expect(f.y).toBeCloseTo((to.y - from.y) / d);
    }
  });

  it('wraps angles and turns the short way round without overshooting', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 4 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    // From just left of south to just right of it: through south, not round.
    expect(turnToward(Math.PI - 0.1, -Math.PI + 0.1, 0.05)).toBeCloseTo(Math.PI - 0.05);
    expect(turnToward(0, 0.02, 0.05)).toBe(0.02);
  });

  it('stops the view tipping over', () => {
    expect(clampPitch(10)).toBe(MAX_PITCH);
    expect(clampPitch(-10)).toBe(-MAX_PITCH);
    expect(clampPitch(0.2)).toBe(0.2);
  });
});

describe('the camera', () => {
  it('puts what is straight ahead in the middle of the screen', () => {
    for (const yaw of [0, 1, -2.5]) {
      const f = forwardOf(yaw);
      const ahead = transformPoint(viewMatrix(camera(yaw)), [5 + f.x * 3, EYE_HEIGHT, 5 + f.y * 3]);
      expect(ahead[0]).toBeCloseTo(0);
      expect(ahead[1]).toBeCloseTo(0);
      expect(ahead[2]).toBeCloseTo(-3);
    }
  });

  it('looks up when pitch is positive', () => {
    const above = transformPoint(viewMatrix(camera(0, Math.PI / 4)), [5, EYE_HEIGHT + 2, 3]);
    expect(above[0]).toBeCloseTo(0);
    expect(above[1]).toBeCloseTo(0);
  });

  it('casts rays through the screen that land back on the same pixel', () => {
    const cam = camera(0.7, -0.3);
    const aspect = 16 / 9;
    const viewProjection = compose(projectionMatrix(aspect), viewMatrix(cam));
    for (const [nx, ny] of [
      [0, 0],
      [0.8, -0.5],
      [-0.9, 0.9],
    ]) {
      const ray = screenRay(cam, nx, ny, aspect);
      const eye = eyeOf(cam);
      const p = transformPoint(viewProjection, [
        eye[0] + ray[0] * 4,
        eye[1] + ray[1] * 4,
        eye[2] + ray[2] * 4,
      ]);
      expect(p[0]).toBeCloseTo(nx);
      expect(p[1]).toBeCloseTo(ny);
    }
  });
});

describe('clicking', () => {
  const box = { min: [0, 0, 0], max: [1, 1, 1] } as const;

  it('hits a box in front, and misses one beside or behind', () => {
    expect(rayBox([-2, 0.5, 0.5], [1, 0, 0], box)).toBeCloseTo(2);
    expect(rayBox([-2, 3, 0.5], [1, 0, 0], box)).toBeUndefined();
    expect(rayBox([3, 0.5, 0.5], [1, 0, 0], box)).toBeUndefined();
    expect(rayBox([0.5, 0.5, 0.5], [0, 1, 0], box)).toBe(0);
  });

  it('meets the ground only when looking down', () => {
    const hit = rayGround([0, 2, 0], [1, -1, 0.5]);
    expect(hit?.point).toEqual({ x: 2, y: 1 });
    expect(rayGround([0, 2, 0], [0, 0, 1])).toBeUndefined();
    expect(rayGround([0, 2, 0], [0, 0.1, 1])).toBeUndefined();
  });

  it('picks the nearest box, unless the ground is nearer', () => {
    const near = { min: [2, 0, -1], max: [3, 2, 1] } as const;
    const far = { min: [5, 0, -1], max: [6, 2, 1] } as const;
    expect(pick([0, 1, 0], [1, 0, 0], [far, near])).toEqual({ kind: 'box', index: 1 });
    // Looking down steeply: the ground comes before either box.
    const down = pick([0, 1, 0], [1, -2, 0], [far, near]);
    expect(down?.kind).toBe('ground');
    expect(pick([0, 1, 0], [0, 1, 0], [far])).toBeUndefined();
  });
});
