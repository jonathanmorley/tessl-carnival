import { describe, expect, it } from 'vitest';
import { transformPoint } from './mat4';
import { MeshBuilder, VERTEX_FLOATS } from './mesh';
import { startMidway3d } from './midway3d';
import { PLAYER_LOOK } from './render';
import {
  beam,
  boothPromptAt,
  boothYaw,
  buildScene,
  motionMatrix,
  personMeshes,
  type Motion,
} from './scene3d';
import { layoutMidway } from './world';

const games = ['water-cannon', 'ring-toss', 'hook-a-duck'];
const names = new Map([
  ['water-cannon', 'Water Cannon'],
  ['ring-toss', 'Ring Toss'],
]);
const map = layoutMidway(games);
const scene = buildScene(map, names);

describe('buildScene', () => {
  it('gives every booth a sign with its game name, or "Coming soon"', () => {
    const signs = scene.parts.filter((p) => p.booth);
    expect(signs).toHaveLength(map.booths.length);
    const text = (id?: string) =>
      signs.find((p) => p.booth?.gameId === id)?.texture?.kind === 'sign'
        ? (signs.find((p) => p.booth?.gameId === id)!.texture as { text: string }).text
        : undefined;
    expect(text('water-cannon')).toBe('Water Cannon');
    // A game without a name falls back to its id.
    expect(text('hook-a-duck')).toBe('hook-a-duck');
    expect(text(undefined)).toBe('Coming soon');
  });

  it('makes every part whole triangles of finite numbers', () => {
    for (const part of scene.parts) {
      expect(part.mesh.length % (VERTEX_FLOATS * 3)).toBe(0);
      expect(part.mesh.length).toBeGreaterThan(0);
      expect(part.mesh.every(Number.isFinite)).toBe(true);
    }
  });

  it('lets clicks land on every booth and on the billboard', () => {
    for (const booth of map.booths) {
      expect(scene.pickables.filter((p) => p.booth === booth)).toHaveLength(1);
    }
    expect(scene.pickables.filter((p) => p.billboard)).toHaveLength(1);
  });

  it('turns every booth to face the avenue, with its prompt out front', () => {
    for (const booth of map.booths) {
      const facing = Math.sin(boothYaw(map, booth));
      const centre = booth.x + booth.w / 2;
      expect(Math.sign(map.avenueX + 1 - centre)).toBe(Math.sign(facing));
      // Over the counter: in front of the booth's wall, on the avenue side.
      const [x, y, z] = boothPromptAt(map, booth);
      expect((x - centre) * Math.sign(facing)).toBeGreaterThan(0.85);
      expect(z).toBeCloseTo(booth.y + booth.h / 2);
      expect(y).toBeGreaterThan(1);
    }
  });
});

describe('motionMatrix', () => {
  const at = (motion: Motion, t: number) => transformPoint(motionMatrix(motion, t), [0, 0, 0]);

  it('keeps still things still', () => {
    expect(at({ kind: 'still' }, 99)).toEqual([0, 0, 0]);
  });

  it('spins round a fixed centre', () => {
    const spin: Motion = { kind: 'spin', center: [3, 1, 2], axis: 'y', speed: 1 };
    expect(at(spin, 0)).toEqual([3, 1, 2]);
    expect(at(spin, 5)).toEqual([3, 1, 2]);
    const rim = transformPoint(motionMatrix(spin, 1), [1, 0, 0]);
    expect(Math.hypot(rim[0] - 3, rim[2] - 2)).toBeCloseTo(1);
  });

  it('keeps ferris wheel cars on the rim', () => {
    const orbit: Motion = { kind: 'orbit', hub: [0, 5, 0], radius: 2, phase: 1, speed: 0.4 };
    for (const t of [0, 1.3, 40]) {
      const p = at(orbit, t);
      expect(Math.hypot(p[0], p[1] - 5)).toBeCloseTo(2);
      expect(p[2]).toBe(0);
    }
  });

  it('bobs within its amplitude', () => {
    const bob: Motion = { kind: 'bob', at: [1, 2, 3], amplitude: 0.1, speed: 2, phase: 0 };
    for (const t of [0, 0.4, 7]) expect(Math.abs(at(bob, t)[1] - 2)).toBeLessThanOrEqual(0.1);
  });

  it('drifts clouds round inside their span, forever', () => {
    const drift: Motion = { kind: 'drift', at: [5, 20, 0], speed: 3, from: -10, span: 40 };
    for (const t of [0, 4, 1000, 123456]) {
      const [x] = at(drift, t);
      expect(x).toBeGreaterThanOrEqual(-10);
      expect(x).toBeLessThan(30);
    }
  });
});

describe('shapes', () => {
  it('runs a beam from one point to the other', () => {
    const b = new MeshBuilder();
    beam(b, [1, 0, 1], [1, 2, 3], 0.1, [1, 1, 1]);
    const data = b.build();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i += VERTEX_FLOATS) {
      min = Math.min(min, data[i + 2]);
      max = Math.max(max, data[i + 2]);
    }
    expect(min).toBeCloseTo(1, 1);
    expect(max).toBeCloseTo(3, 1);
  });

  it('builds people facing -z, with a cap for the player', () => {
    const plain = personMeshes({ ...PLAYER_LOOK, cap: undefined });
    const capped = personMeshes(PLAYER_LOOK);
    expect(capped.body.length).toBeGreaterThan(plain.body.length);
    // The cap's peak sticks out in front.
    let front = 0;
    for (let i = 0; i < capped.body.length; i += VERTEX_FLOATS)
      front = Math.min(front, capped.body[i + 2]);
    expect(front).toBeLessThan(-0.2);
  });
});

describe('startMidway3d', () => {
  it('leaves the canvas alone and returns nothing without WebGL, so 2D can take over', () => {
    let asked = '';
    const canvas = {
      getContext: (kind: string) => {
        asked = kind;
        return null;
      },
    } as unknown as HTMLCanvasElement;
    const controls = startMidway3d(canvas, { games: [], onPlay: () => {}, onReach: () => {} });
    expect(controls).toBeUndefined();
    expect(asked).toBe('webgl');
  });
});
