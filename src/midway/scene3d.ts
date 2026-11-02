import {
  compose,
  cross,
  identity,
  normalize,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  translation,
  type Mat4,
  type Vec3,
} from './mat4';
import { MeshBuilder, QUAD_UVS, rgb, type Color } from './mesh';
import { palette } from './palette';
import {
  BLUE,
  BOOTH_SCHEMES,
  CLOSED_SCHEME,
  GATE_SIGN,
  GOLD,
  RED,
  TENT_COLORS,
  type Look,
  type Stripes,
} from './render';
import type { Box3 } from './view3d';
import { seededRandom, type BoothSlot, type MidwayMap, type Point, type Prop } from './world';

/**
 * The 3D midway's geometry, built from the same map the 2D midway draws:
 * tile (x, y) sits at 3D (x, 0, y), with +y up and one tile to a unit.
 * Plain data, no WebGL, so Vitest can check it.
 */

/** How a part moves over time. */
export type Motion =
  | { kind: 'still' }
  | { kind: 'spin'; center: Vec3; axis: 'y' | 'z'; speed: number }
  /** Hangs from a point on a wheel spinning about z, staying upright. */
  | { kind: 'orbit'; hub: Vec3; radius: number; phase: number; speed: number }
  | { kind: 'bob'; at: Vec3; amplitude: number; speed: number; phase: number }
  /** Drifts along x, wrapping round inside [from, from + span). */
  | { kind: 'drift'; at: Vec3; speed: number; from: number; span: number };

export type TextureSpec =
  /** A painted board; `aspect` is its width over its height. */
  | { kind: 'sign'; text: string; board: string; edge: string; ink: string; aspect: number }
  | { kind: 'banner' };

export interface Part {
  mesh: Float32Array;
  motion: Motion;
  texture?: TextureSpec;
  /** The booth whose sign this is, so it can light up when the player is near. */
  booth?: BoothSlot;
  /** Lit by the sun; false for the sky. */
  lit: boolean;
  /** Fades into the sky with distance; false for the sky and clouds. */
  fog: boolean;
}

export interface Pickable {
  box: Box3;
  booth?: BoothSlot;
  billboard?: boolean;
}

export interface Scene {
  parts: Part[];
  /** Boxes a click can land on: booths, the billboard, and everything else that blocks the view. */
  pickables: Pickable[];
}

const c = (hex: string) => rgb(hex);
const stripes = (s: Stripes): Color[] => [c(s.a), c(s.b)];

const BOOTH_WALL = 2.4;
const POLE_HEIGHT = 2.6;
const ARCH_HEIGHT = 3.2;
export const BILLBOARD_BOARD = { bottom: 2.45, height: 0.8, width: 2.7 };

/** Rotates +y onto `direction`. */
function alignY(direction: Vec3): Mat4 {
  const y = normalize(direction);
  const helper: Vec3 = Math.abs(y[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = normalize(cross(helper, y));
  const z = cross(x, y);
  const m = identity();
  m.set([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0], 0);
  return m;
}

/** A square beam from one point to another. */
export function beam(b: MeshBuilder, from: Vec3, to: Vec3, thickness: number, color: Color) {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  if (length === 0) return;
  const h = thickness / 2;
  b.transformed(compose(translation(...from), alignY(d)), () =>
    b.box([-h, 0, -h], [thickness, length, thickness], color),
  );
}

/** A wheel or disc facing along z, centred on `center`. */
function disc(
  b: MeshBuilder,
  center: Vec3,
  radius: number,
  depth: number,
  color: Color,
  rim = color,
) {
  b.transformed(compose(translation(...center), rotationX(Math.PI / 2)), () =>
    b.cylinder([0, -depth / 2, 0], radius, radius, depth, 10, [rim], { top: color, bottom: color }),
  );
}

/** A wall of vertical stripes from a to b along the ground, facing to the right of a→b. */
function stripedWall(
  b: MeshBuilder,
  a: Point,
  to: Point,
  y: number,
  height: number,
  count: number,
  colors: readonly Color[],
) {
  for (let i = 0; i < count; i++) {
    const s0 = i / count;
    const s1 = (i + 1) / count;
    const x0 = a.x + (to.x - a.x) * s0;
    const z0 = a.y + (to.y - a.y) * s0;
    const x1 = a.x + (to.x - a.x) * s1;
    const z1 = a.y + (to.y - a.y) * s1;
    b.quad(
      [x0, y, z0],
      [x1, y, z1],
      [x1, y + height, z1],
      [x0, y + height, z0],
      colors[i % colors.length],
    );
  }
}

function flag(b: MeshBuilder, top: Vec3, color: Color) {
  const [x, y, z] = top;
  beam(b, [x, y - 0.5, z], [x, y + 0.05, z], 0.04, c(palette.woodDark));
  b.triangle([x, y, z], [x, y - 0.25, z], [x + 0.4, y - 0.12, z], color);
}

function finish(
  b: MeshBuilder,
  motion: Motion = { kind: 'still' },
  extra: Partial<Part> = {},
): Part {
  return { mesh: b.build(), motion, lit: true, fog: true, ...extra };
}

// ── Ground, hedge and trees ───────────────────────────────────────────────

function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function ground(b: MeshBuilder, map: MidwayMap) {
  const far = 70;
  const field = c(palette.grass);
  b.quad(
    [-far, 0, map.height + far],
    [map.width + far, 0, map.height + far],
    [map.width + far, 0, -far],
    [-far, 0, -far],
    field,
  );

  const lawn = [c(palette.grassLight), c(palette.grass)];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.ground[y * map.width + x] !== 'grass') continue;
      const color = lawn[hash(x, y, 3) > 0.8 ? 1 : 0];
      b.quad([x, 0.01, y + 1], [x + 1, 0.01, y + 1], [x + 1, 0.01, y], [x, 0.01, y], color);
      // Tufts of grass.
      if (hash(x, y) > 0.5) continue;
      const tx = x + hash(x, y, 1);
      const tz = y + hash(x, y, 2);
      const blade = c(palette.grassDark);
      for (const dx of [-0.05, 0.03]) {
        b.triangle(
          [tx + dx - 0.03, 0.01, tz],
          [tx + dx + 0.03, 0.01, tz],
          [tx + dx * 2, 0.14, tz],
          blade,
        );
      }
    }
  }
  const path = c(palette.path);
  const edge = c(palette.pathShade);
  for (const p of map.paths) {
    b.quad(
      [p.x, 0.02, p.y + p.h],
      [p.x + p.w, 0.02, p.y + p.h],
      [p.x + p.w, 0.02, p.y],
      [p.x, 0.02, p.y],
      path,
    );
  }
  // Paving joints, every other tile, so the paths read as paths up close.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.ground[y * map.width + x] !== 'path' || (x + y) % 2 !== 0) continue;
      b.quad(
        [x + 0.08, 0.025, y + 0.92],
        [x + 0.92, 0.025, y + 0.92],
        [x + 0.92, 0.025, y + 0.08],
        [x + 0.08, 0.025, y + 0.08],
        edge,
      );
    }
  }
}

function hedge(b: MeshBuilder, map: MidwayMap) {
  const side = c(palette.hedge);
  const top = c(palette.hedgeLight);
  const run = (x: number, y: number, w: number, h: number) =>
    b.box([x + 0.1, 0, y + 0.1], [w - 0.2, 0.9, h - 0.2], side, top);
  run(0, 0, map.width, 1);
  run(0, 1, 1, map.height - 1);
  run(map.width - 1, 1, 1, map.height - 1);
  // The front hedge leaves a gap under the arch.
  run(1, map.height - 1, map.avenueX - 1, 1);
  run(map.avenueX + 2, map.height - 1, map.width - map.avenueX - 3, 1);
}

function tree(b: MeshBuilder, x: number, z: number, size: number) {
  b.cylinder([x, 0, z], 0.12 * size, 0.09 * size, 1.1 * size, 6, [c(palette.woodDark)]);
  b.sphere([x, 1.5 * size, z], 0.75 * size, c(palette.hedgeDark), 7, 4);
  b.sphere([x - 0.2 * size, 1.85 * size, z + 0.15 * size], 0.5 * size, c(palette.hedge), 7, 4);
}

function trees(b: MeshBuilder, map: MidwayMap) {
  const random = seededRandom(map.width * 31 + map.height);
  for (let i = 0; i < 160; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 3 + random() * 30;
    // Scatter them round the hedge, out in the field.
    const cx = map.width / 2 + Math.cos(angle) * (map.width / 2 + distance);
    const cz = map.height / 2 + Math.sin(angle) * (map.height / 2 + distance);
    tree(b, cx, cz, 0.9 + random() * 0.9);
  }
}

// ── Tents and rides ───────────────────────────────────────────────────────

function roundTent(
  b: MeshBuilder,
  x: number,
  z: number,
  r: number,
  wall: number,
  roof: number,
  colors: Stripes,
  flagColor: Color,
) {
  b.cylinder([x, 0, z], r, r, wall, 16, stripes(colors));
  b.cylinder([x, wall, z], r + 0.2, 0, roof, 16, stripes(colors));
  // The door, facing the avenue's side of the map.
  b.quad(
    [x - 0.35, 0, z + r + 0.01],
    [x + 0.35, 0, z + r + 0.01],
    [x + 0.35, wall * 0.75, z + r + 0.01],
    [x - 0.35, wall * 0.75, z + r + 0.01],
    c(palette.opening),
  );
  flag(b, [x, wall + roof + 0.45, z], flagColor);
}

function peakedTent(b: MeshBuilder, prop: Prop) {
  const colors = stripes(prop.variant % 2 === 0 ? BLUE : RED);
  const x0 = prop.x + 0.25;
  const x1 = prop.x + prop.w - 0.25;
  const z0 = prop.y + 0.3;
  const z1 = prop.y + prop.h - 0.3;
  const zm = (z0 + z1) / 2;
  const wall = 1.3;
  const ridge = wall + 1.1;
  const eave = 0.2;
  stripedWall(b, { x: x0, y: z1 }, { x: x1, y: z1 }, 0, wall, 10, colors);
  stripedWall(b, { x: x1, y: z0 }, { x: x0, y: z0 }, 0, wall, 10, colors);
  stripedWall(b, { x: x1, y: z1 }, { x: x1, y: z0 }, 0, wall, 6, colors);
  stripedWall(b, { x: x0, y: z0 }, { x: x0, y: z1 }, 0, wall, 6, colors);
  // Gable ends.
  b.triangle([x1, wall, z1], [x1, wall, z0], [x1, ridge, zm], colors[1]);
  b.triangle([x0, wall, z0], [x0, wall, z1], [x0, ridge, zm], colors[1]);
  // The roof, striped across.
  const strips = 10;
  for (let i = 0; i < strips; i++) {
    const a = x0 - eave + ((x1 - x0 + eave * 2) * i) / strips;
    const d = x0 - eave + ((x1 - x0 + eave * 2) * (i + 1)) / strips;
    const color = colors[i % 2];
    b.quad(
      [a, wall - 0.1, z1 + eave],
      [d, wall - 0.1, z1 + eave],
      [d, ridge, zm],
      [a, ridge, zm],
      color,
    );
    b.quad(
      [d, wall - 0.1, z0 - eave],
      [a, wall - 0.1, z0 - eave],
      [a, ridge, zm],
      [d, ridge, zm],
      color,
    );
  }
  b.quad(
    [(x0 + x1) / 2 - 0.4, 0, z1 + 0.01],
    [(x0 + x1) / 2 + 0.4, 0, z1 + 0.01],
    [(x0 + x1) / 2 + 0.4, 1.0, z1 + 0.01],
    [(x0 + x1) / 2 - 0.4, 1.0, z1 + 0.01],
    c(palette.opening),
  );
  flag(b, [x0, ridge + 0.45, zm], c(palette.gold));
  flag(b, [x1, ridge + 0.45, zm], c(palette.gold));
}

const WHEEL_RADIUS = 2.2;
const WHEEL_SPOKES = 8;
const WHEEL_SPEED = 0.35;

function ferrisWheel(b: MeshBuilder, prop: Prop, parts: Part[]) {
  const hub: Vec3 = [prop.x + prop.w / 2, WHEEL_RADIUS + 0.95, prop.y + prop.h / 2];
  const frame = c(palette.metalShade);
  // An A-frame on each side of the wheel, on a low platform.
  b.box(
    [prop.x + 0.3, 0, prop.y + 0.6],
    [prop.w - 0.6, 0.15, prop.h - 1.2],
    c(palette.woodDark),
    c(palette.wood),
  );
  for (const side of [-0.45, 0.45]) {
    const top: Vec3 = [hub[0], hub[1], hub[2] + side];
    beam(b, [hub[0] - 1.4, 0, hub[2] + side], top, 0.12, frame);
    beam(b, [hub[0] + 1.4, 0, hub[2] + side], top, 0.12, frame);
  }

  const rotor = new MeshBuilder();
  const rim = c(palette.metal);
  const spoke = c(palette.red);
  for (const z of [-0.35, 0.35]) {
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      beam(
        rotor,
        [Math.cos(a0) * WHEEL_RADIUS, Math.sin(a0) * WHEEL_RADIUS, z],
        [Math.cos(a1) * WHEEL_RADIUS, Math.sin(a1) * WHEEL_RADIUS, z],
        0.08,
        rim,
      );
    }
    for (let i = 0; i < WHEEL_SPOKES; i++) {
      const a = (i / WHEEL_SPOKES) * Math.PI * 2;
      beam(
        rotor,
        [0, 0, z],
        [Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, z],
        0.06,
        spoke,
      );
    }
  }
  for (let i = 0; i < WHEEL_SPOKES; i++) {
    const a = (i / WHEEL_SPOKES) * Math.PI * 2;
    beam(
      rotor,
      [Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, -0.35],
      [Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, 0.35],
      0.05,
      rim,
    );
  }
  disc(rotor, [0, 0, 0], 0.25, 0.9, c(palette.gold));
  parts.push(finish(rotor, { kind: 'spin', center: hub, axis: 'z', speed: WHEEL_SPEED }));

  // Each car hangs from the rim and stays upright as the wheel turns.
  for (let i = 0; i < WHEEL_SPOKES; i++) {
    const car = new MeshBuilder();
    const color = c(palette.balloons[i % palette.balloons.length]);
    beam(car, [0, -0.3, 0], [0, 0, 0], 0.04, c(palette.metalShade));
    car.box([-0.25, -0.7, -0.25], [0.5, 0.4, 0.5], color);
    car.box([-0.28, -0.32, -0.28], [0.56, 0.06, 0.56], c(palette.cream));
    parts.push(
      finish(car, {
        kind: 'orbit',
        hub,
        radius: WHEEL_RADIUS,
        phase: (i / WHEEL_SPOKES) * Math.PI * 2,
        speed: WHEEL_SPEED,
      }),
    );
  }
}

function carousel(b: MeshBuilder, prop: Prop, parts: Part[]) {
  const center: Vec3 = [prop.x + prop.w / 2, 0, prop.y + prop.h / 2];
  b.cylinder(center, 1.9, 1.9, 0.25, 20, [c(palette.gold), c(palette.goldShade)], {
    top: c(palette.wood),
  });

  const rotor = new MeshBuilder();
  rotor.cylinder([0, 0.25, 0], 1.75, 1.75, 0.08, 20, [c(palette.cream)], {
    top: c(palette.creamShade),
  });
  rotor.cylinder([0, 0.25, 0], 0.3, 0.3, 2.0, 10, [c(palette.red), c(palette.cream)]);
  rotor.cylinder([0, 2.15, 0], 2.0, 2.0, 0.25, 20, stripes(RED));
  rotor.cylinder([0, 2.4, 0], 2.05, 0, 0.9, 20, stripes(GOLD));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 1.3;
    const z = Math.sin(a) * 1.3;
    rotor.cylinder([x, 0.33, z], 0.035, 0.035, 1.82, 5, [c(palette.gold)]);
    // A horse: body, neck and head, facing round the ring.
    const color = c(i % 2 === 0 ? palette.cream : palette.pink);
    const height = 0.75 + (i % 2) * 0.2;
    rotor.transformed(compose(translation(x, height, z), rotationY(-a)), () => {
      rotor.box([-0.1, 0, -0.32], [0.2, 0.22, 0.64], color);
      rotor.box([-0.07, 0.15, -0.42], [0.14, 0.3, 0.14], color);
      rotor.box([-0.07, 0.35, -0.58], [0.14, 0.12, 0.24], color);
      rotor.box([-0.11, 0.22, -0.06], [0.22, 0.05, 0.2], c(palette.red));
      for (const [lx, lz] of [
        [-0.06, -0.25],
        [0.04, -0.25],
        [-0.06, 0.2],
        [0.04, 0.2],
      ] as const) {
        rotor.box([lx, -0.3, lz], [0.04, 0.3, 0.05], color);
      }
    });
  }
  parts.push(finish(rotor, { kind: 'spin', center, axis: 'y', speed: 0.6 }));
  flag(b, [center[0], 3.85, center[2]], c(palette.red));
}

function bigTop(b: MeshBuilder, prop: Prop) {
  const x = prop.x + prop.w / 2;
  const z = prop.y + prop.h / 2;
  b.cylinder([x, 0, z], 1.85, 1.85, 2.0, 20, stripes(RED));
  b.cylinder([x, 2.0, z], 2.1, 0, 2.4, 20, stripes(RED));
  b.cylinder([x, 2.0, z], 2.1, 2.1, 0.18, 20, [c(palette.gold), c(palette.goldShade)]);
  b.quad(
    [x - 0.45, 0, z + 1.86],
    [x + 0.45, 0, z + 1.86],
    [x + 0.45, 1.4, z + 1.86],
    [x - 0.45, 1.4, z + 1.86],
    c(palette.opening),
  );
  flag(b, [x, 4.9, z], c(palette.gold));
  flag(b, [x - 1.85, 2.6, z], c(palette.blue));
  flag(b, [x + 1.85, 2.6, z], c(palette.blue));
}

// ── Small things ──────────────────────────────────────────────────────────

function wheel(b: MeshBuilder, x: number, y: number, z: number, r: number) {
  disc(b, [x, y, z], r, 0.06, c(palette.woodDark), c(palette.wood));
}

function wagon(b: MeshBuilder, prop: Prop) {
  const body =
    prop.variant % 2 === 0
      ? { main: palette.red, shade: palette.redShade }
      : { main: palette.blue, shade: palette.blueShade };
  const x0 = prop.x + 0.12;
  const x1 = prop.x + prop.w - 0.12;
  const z0 = prop.y + 0.12;
  const z1 = prop.y + prop.h - 0.12;
  b.box([x0, 0.35, z0], [x1 - x0, 1.0, z1 - z0], c(body.main), c(body.shade));
  // A curved roof, as three flat slopes.
  const zm = (z0 + z1) / 2;
  const roof = c(palette.cream);
  b.quad(
    [x0 - 0.05, 1.35, z1 + 0.05],
    [x1 + 0.05, 1.35, z1 + 0.05],
    [x1 + 0.05, 1.55, zm + 0.2],
    [x0 - 0.05, 1.55, zm + 0.2],
    roof,
  );
  b.quad(
    [x0 - 0.05, 1.55, zm + 0.2],
    [x1 + 0.05, 1.55, zm + 0.2],
    [x1 + 0.05, 1.55, zm - 0.2],
    [x0 - 0.05, 1.55, zm - 0.2],
    roof,
  );
  b.quad(
    [x1 + 0.05, 1.35, z0 - 0.05],
    [x0 - 0.05, 1.35, z0 - 0.05],
    [x0 - 0.05, 1.55, zm - 0.2],
    [x1 + 0.05, 1.55, zm - 0.2],
    roof,
  );
  b.quad(
    [x0 + 0.4, 0.6, z1 + 0.01],
    [x1 - 0.4, 0.6, z1 + 0.01],
    [x1 - 0.4, 1.15, z1 + 0.01],
    [x0 + 0.4, 1.15, z1 + 0.01],
    c(palette.opening),
  );
  b.box([x0 + 0.35, 0.55, z1], [x1 - x0 - 0.7, 0.06, 0.12], c(palette.woodLight));
  for (const x of [x0 + 0.4, x1 - 0.4]) {
    wheel(b, x, 0.32, z1 + 0.04, 0.3);
    wheel(b, x, 0.32, z0 - 0.04, 0.3);
  }
}

const CART_COLORS = [palette.red, palette.pink, palette.blue, palette.gold];

function cart(b: MeshBuilder, prop: Prop) {
  const color = c(CART_COLORS[prop.variant % CART_COLORS.length]);
  const x = prop.x + 0.5;
  const z = prop.y + 0.5;
  b.box([x - 0.35, 0.25, z - 0.25], [0.7, 0.6, 0.5], color, c(palette.cream));
  stripedWall(b, { x: x - 0.35, y: z + 0.251 }, { x: x + 0.35, y: z + 0.251 }, 0.7, 0.12, 6, [
    c(palette.cream),
    color,
  ]);
  wheel(b, x - 0.2, 0.2, z + 0.28, 0.2);
  wheel(b, x + 0.2, 0.2, z + 0.28, 0.2);
  wheel(b, x - 0.2, 0.2, z - 0.28, 0.2);
  wheel(b, x + 0.2, 0.2, z - 0.28, 0.2);
  beam(b, [x, 0.85, z], [x, 1.75, z], 0.04, c(palette.metalShade));
  b.cylinder([x, 1.55, z], 0.65, 0, 0.3, 12, [color, c(palette.cream)]);
  // Whatever it sells, piled on top.
  b.sphere([x - 0.15, 0.95, z], 0.11, c(palette.cream), 6, 3);
  b.sphere([x + 0.12, 0.95, z + 0.05], 0.1, color, 6, 3);
}

function ticketBooth(b: MeshBuilder, prop: Prop) {
  const x = prop.x + 0.5;
  const z = prop.y + 0.5;
  stripedWall(b, { x: x - 0.4, y: z + 0.4 }, { x: x + 0.4, y: z + 0.4 }, 0, 1.4, 4, stripes(RED));
  stripedWall(b, { x: x + 0.4, y: z - 0.4 }, { x: x - 0.4, y: z - 0.4 }, 0, 1.4, 4, stripes(RED));
  stripedWall(b, { x: x + 0.4, y: z + 0.4 }, { x: x + 0.4, y: z - 0.4 }, 0, 1.4, 4, stripes(RED));
  stripedWall(b, { x: x - 0.4, y: z - 0.4 }, { x: x - 0.4, y: z + 0.4 }, 0, 1.4, 4, stripes(RED));
  b.quad(
    [x - 0.25, 0.7, z + 0.41],
    [x + 0.25, 0.7, z + 0.41],
    [x + 0.25, 1.15, z + 0.41],
    [x - 0.25, 1.15, z + 0.41],
    c(palette.opening),
  );
  b.box([x - 0.3, 0.65, z + 0.4], [0.6, 0.05, 0.12], c(palette.woodLight));
  b.transformed(compose(translation(x, 1.4, z), rotationY(Math.PI / 4)), () =>
    b.cylinder([0, 0, 0], 0.7, 0, 0.6, 4, [c(palette.gold), c(palette.goldShade)]),
  );
  b.sphere([x, 2.05, z], 0.07, c(palette.red), 6, 3);
}

function bench(b: MeshBuilder, prop: Prop) {
  const x = prop.x + 0.1;
  const z = prop.y + 0.35;
  b.box([x, 0.4, z], [0.8, 0.06, 0.3], c(palette.woodLight));
  b.box([x, 0.55, z + 0.27], [0.8, 0.25, 0.05], c(palette.woodLight));
  for (const lx of [x + 0.05, x + 0.7]) {
    b.box([lx, 0, z + 0.03], [0.05, 0.4, 0.05], c(palette.woodDark));
    b.box([lx, 0, z + 0.25], [0.05, 0.8, 0.05], c(palette.woodDark));
  }
}

function planter(b: MeshBuilder, prop: Prop) {
  const x = prop.x + 0.5;
  const z = prop.y + 0.5;
  b.box([x - 0.35, 0, z - 0.35], [0.7, 0.4, 0.7], c(palette.wood), c(palette.woodDark));
  b.sphere([x, 0.6, z], 0.36, c(palette.hedge), 8, 4);
  const random = seededRandom(prop.x * 97 + prop.y);
  for (let i = 0; i < 6; i++) {
    const a = random() * Math.PI * 2;
    const color = c(i % 2 ? palette.pink : palette.gold);
    b.sphere(
      [x + Math.cos(a) * 0.28, 0.6 + random() * 0.25, z + Math.sin(a) * 0.28],
      0.06,
      color,
      5,
      3,
    );
  }
}

/** One balloon on its string, with the knot at `at`. */
export function balloon(b: MeshBuilder, at: Vec3, color: Color, string = 0.5) {
  const [x, y, z] = at;
  beam(b, [x, y - string, z], [x, y, z], 0.015, c(palette.metalShade));
  b.transformed(compose(translation(x, y + 0.17, z), scaling(1, 1.2, 1)), () =>
    b.sphere([0, 0, 0], 0.14, color, 8, 5),
  );
}

function balloons(b: MeshBuilder, prop: Prop, parts: Part[]) {
  const x = prop.x + 0.5;
  const z = prop.y + 0.5;
  b.box([x - 0.08, 0, z - 0.08], [0.16, 0.12, 0.16], c(palette.metalShade));
  const bunch = new MeshBuilder();
  const spots: Vec3[] = [
    [0, 1.9, 0],
    [0.22, 1.75, 0.05],
    [-0.2, 1.7, 0.1],
    [0.05, 1.65, -0.22],
    [-0.08, 2.05, -0.1],
  ];
  spots.forEach(([bx, by, bz], i) => {
    beam(bunch, [0, 0.12, 0], [bx, by, bz], 0.012, c(palette.metalShade));
    balloon(bunch, [bx, by, bz], c(palette.balloons[(i + prop.x) % palette.balloons.length]), 0);
  });
  parts.push(
    finish(bunch, {
      kind: 'bob',
      at: [x, 0, z],
      amplitude: 0.04,
      speed: 2,
      phase: prop.x + prop.y,
    }),
  );
}

function poleTop(prop: Prop): Vec3 {
  return [prop.x + 0.5, POLE_HEIGHT, prop.y + 0.5];
}

function buntingPole(b: MeshBuilder, prop: Prop) {
  const [x, , z] = poleTop(prop);
  b.cylinder([x, 0, z], 0.06, 0.06, POLE_HEIGHT, 6, [c(palette.cream)]);
  for (let y = 0.3; y < POLE_HEIGHT - 0.2; y += 0.5)
    b.cylinder([x, y, z], 0.065, 0.065, 0.15, 6, [c(palette.red)]);
  b.sphere([x, POLE_HEIGHT + 0.05, z], 0.1, c(palette.gold), 6, 4);
}

function bunting(b: MeshBuilder, map: MidwayMap) {
  const colors = palette.bunting.map(c);
  for (const [from, to] of map.bunting) {
    const a: Vec3 = [from.x + 0.5, POLE_HEIGHT - 0.05, from.y + 0.5];
    const d: Vec3 = [to.x + 0.5, POLE_HEIGHT - 0.05, to.y + 0.5];
    const length = Math.hypot(d[0] - a[0], d[2] - a[2]);
    const sag = 0.08 * length;
    const pointAt = (s: number): Vec3 => [
      a[0] + (d[0] - a[0]) * s,
      a[1] - Math.sin(s * Math.PI) * sag,
      a[2] + (d[2] - a[2]) * s,
    ];
    const segments = 12;
    for (let i = 0; i < segments; i++)
      beam(b, pointAt(i / segments), pointAt((i + 1) / segments), 0.015, c(palette.cream));
    const flags = Math.max(2, Math.round(length / 0.4));
    for (let i = 0; i < flags; i++) {
      const p0 = pointAt((i + 0.15) / flags);
      const p1 = pointAt((i + 0.85) / flags);
      const mid = pointAt((i + 0.5) / flags);
      b.triangle(p0, p1, [mid[0], mid[1] - 0.28, mid[2]], colors[i % colors.length]);
    }
  }
}

function billboard(b: MeshBuilder, prop: Prop, parts: Part[], pickables: Pickable[]) {
  const z = prop.y + 0.5;
  const cx = prop.x + prop.w / 2;
  const { bottom, height, width } = BILLBOARD_BOARD;
  for (const x of [cx - width / 2 + 0.3, cx + width / 2 - 0.3]) {
    b.box([x - 0.07, 0, z - 0.07], [0.14, bottom + height, 0.14], c(palette.wood));
  }
  const frame = 0.08;
  b.box(
    [cx - width / 2 - frame, bottom - frame, z - 0.09],
    [width + frame * 2, height + frame * 2, 0.1],
    c(palette.gold),
  );
  b.quad(
    [cx + width / 2, bottom, z - 0.091],
    [cx - width / 2, bottom, z - 0.091],
    [cx - width / 2, bottom + height, z - 0.091],
    [cx + width / 2, bottom + height, z - 0.091],
    c(palette.ink),
  );
  for (let i = 0; i < 12; i++)
    b.sphere(
      [cx - width / 2 + 0.1 + i * ((width - 0.2) / 11), bottom + height + frame, z - 0.04],
      0.035,
      c(palette.cream),
      5,
      3,
    );
  const banner = new MeshBuilder();
  const white = c(palette.white);
  banner.quad(
    [cx - width / 2, bottom, z + 0.011],
    [cx + width / 2, bottom, z + 0.011],
    [cx + width / 2, bottom + height, z + 0.011],
    [cx - width / 2, bottom + height, z + 0.011],
    white,
    QUAD_UVS,
  );
  parts.push(finish(banner, { kind: 'still' }, { texture: { kind: 'banner' } }));
  pickables.push({
    billboard: true,
    box: {
      min: [cx - width / 2 - frame, bottom - frame, z - 0.1],
      max: [cx + width / 2 + frame, bottom + height + frame, z + 0.1],
    },
  });
}

/** Roughly how tall each kind of prop stands, for clicks. */
const PROP_HEIGHTS: Record<Prop['kind'], number> = {
  'big-top': 4.5,
  'round-tent': 3.2,
  'peaked-tent': 2.4,
  'ferris-wheel': 5,
  carousel: 3.3,
  wagon: 1.6,
  cart: 1.7,
  'ticket-booth': 2,
  bench: 0.8,
  planter: 1,
  balloons: 2.2,
  'bunting-pole': POLE_HEIGHT,
  billboard: 0,
};

function prop(b: MeshBuilder, p: Prop, parts: Part[], pickables: Pickable[]) {
  switch (p.kind) {
    case 'big-top':
      bigTop(b, p);
      break;
    case 'round-tent': {
      const colors = TENT_COLORS[p.variant % TENT_COLORS.length];
      roundTent(
        b,
        p.x + p.w / 2,
        p.y + p.h / 2,
        1.55,
        1.5,
        1.6,
        colors,
        c(p.variant % 2 ? palette.blue : palette.gold),
      );
      break;
    }
    case 'peaked-tent':
      peakedTent(b, p);
      break;
    case 'ferris-wheel':
      ferrisWheel(b, p, parts);
      break;
    case 'carousel':
      carousel(b, p, parts);
      break;
    case 'wagon':
      wagon(b, p);
      break;
    case 'cart':
      cart(b, p);
      break;
    case 'ticket-booth':
      ticketBooth(b, p);
      break;
    case 'bench':
      bench(b, p);
      break;
    case 'planter':
      planter(b, p);
      break;
    case 'balloons':
      balloons(b, p, parts);
      break;
    case 'bunting-pole':
      buntingPole(b, p);
      break;
    case 'billboard':
      billboard(b, p, parts, pickables);
      return;
  }
  pickables.push({
    box: { min: [p.x, 0, p.y], max: [p.x + p.w, PROP_HEIGHTS[p.kind], p.y + p.h] },
  });
}

// ── Booths ────────────────────────────────────────────────────────────────

/** The way a booth's window faces: towards the avenue. */
export function boothYaw(map: MidwayMap, booth: BoothSlot): number {
  return booth.x + booth.w / 2 < map.avenueX + 1 ? Math.PI / 2 : -Math.PI / 2;
}

/** Where the "Press E to play" prompt floats: over the counter, at eye height. */
export function boothPromptAt(map: MidwayMap, booth: BoothSlot): Vec3 {
  const yaw = boothYaw(map, booth);
  return [
    booth.x + booth.w / 2 + Math.sin(yaw) * 1.0,
    1.7,
    booth.y + booth.h / 2 + Math.cos(yaw) * 1.0,
  ];
}

export const SIGN_SIZE = { width: 1.6, height: 0.45, bottom: BOOTH_WALL + 0.45 };

function booth(map: MidwayMap, b: MeshBuilder, slot: BoothSlot, name: string, parts: Part[]) {
  const open = slot.gameId !== undefined;
  const scheme = open ? BOOTH_SCHEMES[slot.index % BOOTH_SCHEMES.length] : CLOSED_SCHEME;
  const place = compose(
    translation(slot.x + slot.w / 2, 0, slot.y + slot.h / 2),
    rotationY(boothYaw(map, slot)),
  );
  const s = 0.85;
  const wall = BOOTH_WALL;
  const sign = new MeshBuilder();

  // Built facing +z, then turned to face the avenue.
  b.transformed(place, () => {
    b.box([-s, 0, -s], [s * 2, wall, s * 2], c(scheme.wall));
    b.quad(
      [-0.65, 0.75, s + 0.005],
      [0.65, 0.75, s + 0.005],
      [0.65, 1.95, s + 0.005],
      [-0.65, 1.95, s + 0.005],
      c(palette.opening),
    );
    b.box([-0.72, 0, s], [1.44, 0.75, 0.12], c(scheme.wallShade));
    b.box([-0.75, 0.75, s - 0.02], [1.5, 0.06, 0.3], c(palette.woodLight));
    if (open) {
      // Prizes on the counter, and targets on the back wall.
      for (let i = 0; i < 5; i++) {
        const color = c(palette.balloons[(i + slot.index) % palette.balloons.length]);
        b.sphere([-0.5 + i * 0.25, 0.92, s + 0.14], 0.09, color, 6, 4);
      }
      for (const x of [-0.4, 0, 0.4]) {
        [palette.red, palette.cream, palette.red].forEach((ring, i) =>
          disc(b, [x, 1.45, s + 0.01 + i * 0.01], 0.16 * (1 - i / 3), 0.01, c(ring)),
        );
      }
    } else {
      // Shutters down.
      for (let i = 0; i < 6; i++) {
        const y = 0.8 + i * 0.19;
        b.quad(
          [-0.65, y, s + 0.01],
          [0.65, y, s + 0.01],
          [0.65, y + 0.12, s + 0.01],
          [-0.65, y + 0.12, s + 0.01],
          c(palette.metalShade),
        );
      }
    }
    b.box([-s - 0.06, wall, -s - 0.06], [s * 2 + 0.12, 0.14, s * 2 + 0.12], c(scheme.wallShade));

    // A striped awning over the window, with scallops along its edge.
    const reach = open ? 0.55 : 0.18;
    const strips = 8;
    for (let i = 0; i < strips; i++) {
      const x0 = -s - 0.06 + ((s * 2 + 0.12) * i) / strips;
      const x1 = -s - 0.06 + ((s * 2 + 0.12) * (i + 1)) / strips;
      const color = c(scheme.awning[i % 2]);
      b.quad(
        [x0, wall - 0.3, s + reach],
        [x1, wall - 0.3, s + reach],
        [x1, wall, s + 0.06],
        [x0, wall, s + 0.06],
        color,
      );
      b.triangle(
        [x0, wall - 0.35, s + reach],
        [x1, wall - 0.35, s + reach],
        [(x0 + x1) / 2, wall - 0.42, s + reach],
        c(scheme.awningShade[i % 2]),
      );
    }

    // The sign on the roof, with the game's name on both faces.
    const { width, height, bottom } = SIGN_SIZE;
    const edge = c(open ? palette.red : palette.closedShade);
    for (const x of [-width / 2 + 0.15, width / 2 - 0.15])
      b.box([x - 0.04, wall, -0.04], [0.08, bottom - wall, 0.08], c(palette.woodDark));
    b.box([-width / 2 - 0.05, bottom - 0.05, -0.04], [width + 0.1, height + 0.1, 0.08], edge);
    if (open) {
      const rings = [palette.red, palette.cream, palette.red, palette.cream];
      rings.forEach((ring, i) =>
        disc(b, [0, bottom + height + 0.35, 0.01 * i], 0.3 * (1 - i / rings.length), 0.04, c(ring)),
      );
      for (let i = 0; i < 8; i++)
        b.sphere([-0.7 + i * 0.2, bottom + height + 0.09, 0.02], 0.035, c(palette.gold), 5, 3);
    }
  });
  sign.transformed(place, () => {
    const { width, height, bottom } = SIGN_SIZE;
    const white = c(palette.white);
    sign.quad(
      [-width / 2, bottom, 0.041],
      [width / 2, bottom, 0.041],
      [width / 2, bottom + height, 0.041],
      [-width / 2, bottom + height, 0.041],
      white,
      QUAD_UVS,
    );
    sign.quad(
      [width / 2, bottom, -0.041],
      [-width / 2, bottom, -0.041],
      [-width / 2, bottom + height, -0.041],
      [width / 2, bottom + height, -0.041],
      white,
      QUAD_UVS,
    );
  });
  const signAspect = { aspect: SIGN_SIZE.width / SIGN_SIZE.height };
  parts.push(
    finish(
      sign,
      { kind: 'still' },
      {
        booth: slot,
        texture: open
          ? {
              ...signAspect,
              kind: 'sign',
              text: name,
              board: palette.cream,
              edge: palette.red,
              ink: palette.red,
            }
          : {
              ...signAspect,
              kind: 'sign',
              text: name,
              board: palette.metal,
              edge: palette.closedShade,
              ink: palette.closedShade,
            },
      },
    ),
  );
}

// ── The gate ──────────────────────────────────────────────────────────────

function arch(b: MeshBuilder, map: MidwayMap, parts: Part[]) {
  const z = map.height - 0.75;
  const left = map.avenueX - 0.45;
  const right = map.avenueX + 2.2;
  for (const x of [left, right]) {
    b.box([x, 0, z - 0.13], [0.26, ARCH_HEIGHT, 0.26], c(palette.wood), c(palette.woodLight));
    flag(b, [x + 0.13, ARCH_HEIGHT + 0.5, z], c(palette.red));
  }
  const cx = (left + right + 0.26) / 2;
  const width = right - left + 0.6;
  const height = 0.6;
  const bottom = ARCH_HEIGHT - 0.35;
  b.box(
    [cx - width / 2 - 0.06, bottom - 0.06, z - 0.06],
    [width + 0.12, height + 0.12, 0.12],
    c(palette.woodDark),
  );
  disc(b, [cx, bottom + height, z], 0.6, 0.08, c(palette.gold));
  disc(b, [cx, bottom + height, z], 0.4, 0.1, c(palette.red));
  for (let i = 0; i < 14; i++)
    b.sphere(
      [cx - width / 2 + 0.1 + i * ((width - 0.2) / 13), bottom - 0.08, z + 0.07],
      0.035,
      c(palette.cream),
      5,
      3,
    );

  const sign = new MeshBuilder();
  const white = c(palette.white);
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  sign.quad(
    [x0, bottom, z + 0.061],
    [x1, bottom, z + 0.061],
    [x1, bottom + height, z + 0.061],
    [x0, bottom + height, z + 0.061],
    white,
    QUAD_UVS,
  );
  sign.quad(
    [x1, bottom, z - 0.061],
    [x0, bottom, z - 0.061],
    [x0, bottom + height, z - 0.061],
    [x1, bottom + height, z - 0.061],
    white,
    QUAD_UVS,
  );
  parts.push(
    finish(
      sign,
      { kind: 'still' },
      {
        texture: {
          kind: 'sign',
          text: GATE_SIGN,
          board: palette.wood,
          edge: palette.woodDark,
          ink: palette.gold,
          aspect: width / height,
        },
      },
    ),
  );
}

// ── The sky ───────────────────────────────────────────────────────────────

function sky(): Part {
  const b = new MeshBuilder();
  const low = c(palette.sky);
  const high = c(palette.skyHigh);
  const bands = 18;
  const radius = 120;
  for (let i = 0; i < bands; i++) {
    const p0 = (i / bands) * (Math.PI / 2);
    const p1 = ((i + 1) / bands) * (Math.PI / 2);
    const s = i / (bands - 1);
    const color: Color = [
      low[0] + (high[0] - low[0]) * s,
      low[1] + (high[1] - low[1]) * s,
      low[2] + (high[2] - low[2]) * s,
    ];
    b.cylinder(
      [0, Math.sin(p0) * radius - 10, 0],
      Math.cos(p0) * radius,
      Math.cos(p1) * radius,
      (Math.sin(p1) - Math.sin(p0)) * radius,
      24,
      [color],
    );
  }
  // Below the horizon, so no gap shows past the field.
  b.cylinder([0, -40, 0], radius, radius, 30, 24, [low]);
  return { mesh: b.build(), motion: { kind: 'still' }, lit: false, fog: false };
}

function clouds(map: MidwayMap): Part[] {
  const random = seededRandom(7);
  const span = 160;
  const from = map.width / 2 - span / 2;
  return Array.from({ length: 12 }, () => {
    const b = new MeshBuilder();
    const size = 2 + random() * 2.5;
    const puffs = 3 + Math.floor(random() * 3);
    for (let i = 0; i < puffs; i++) {
      b.transformed(
        compose(
          translation((i - puffs / 2) * size * 0.8, random() * size * 0.3, random() * size * 0.5),
          scaling(1, 0.55, 1),
        ),
        () =>
          b.sphere(
            [0, 0, 0],
            size * (0.7 + random() * 0.4),
            c(i % 2 ? palette.cloud : palette.cloudShade),
            8,
            4,
          ),
      );
    }
    const at: Vec3 = [
      from + random() * span,
      22 + random() * 12,
      map.height / 2 + (random() - 0.5) * 120,
    ];
    return {
      mesh: b.build(),
      motion: { kind: 'drift', at, speed: 0.4 + random() * 0.6, from, span },
      lit: false,
      fog: false,
    };
  });
}

/** Builds every part of the 3D midway. `names` gives each booth's sign. */
export function buildScene(map: MidwayMap, names: ReadonlyMap<string, string>): Scene {
  const parts: Part[] = [sky(), ...clouds(map)];
  const pickables: Pickable[] = [];
  const b = new MeshBuilder();
  ground(b, map);
  hedge(b, map);
  trees(b, map);
  for (const p of map.props) prop(b, p, parts, pickables);
  bunting(b, map);
  arch(b, map, parts);
  for (const slot of map.booths) {
    const name = slot.gameId ? (names.get(slot.gameId) ?? slot.gameId) : 'Coming soon';
    booth(map, b, slot, name, parts);
    pickables.push({
      booth: slot,
      box: {
        min: [slot.x, 0, slot.y],
        max: [slot.x + slot.w, SIGN_SIZE.bottom + SIGN_SIZE.height + 0.7, slot.y + slot.h],
      },
    });
  }
  parts.splice(1, 0, finish(b));
  return { parts, pickables };
}

/** Where a part is at time `t` seconds. */
export function motionMatrix(motion: Motion, t: number): Mat4 {
  switch (motion.kind) {
    case 'still':
      return identity();
    case 'spin':
      return compose(
        translation(...motion.center),
        (motion.axis === 'y' ? rotationY : rotationZ)(motion.speed * t),
      );
    case 'orbit': {
      const a = motion.phase + motion.speed * t;
      return translation(
        motion.hub[0] + Math.cos(a) * motion.radius,
        motion.hub[1] + Math.sin(a) * motion.radius,
        motion.hub[2],
      );
    }
    case 'bob':
      return translation(
        motion.at[0],
        motion.at[1] + Math.sin(t * motion.speed + motion.phase) * motion.amplitude,
        motion.at[2],
      );
    case 'drift': {
      const x =
        motion.from +
        ((((motion.at[0] - motion.from + motion.speed * t) % motion.span) + motion.span) %
          motion.span);
      return translation(x, motion.at[1], motion.at[2]);
    }
  }
}

// ── People ────────────────────────────────────────────────────────────────

export interface PersonMeshes {
  body: Float32Array;
  leg: Float32Array;
  arm: Float32Array;
}

export const HIP_HEIGHT = 0.62;
export const SHOULDER_HEIGHT = 1.1;

/** A person facing -z, standing on the origin. Legs and arms hang from their joint so they can swing. */
export function personMeshes(look: Look): PersonMeshes {
  const skin = c(look.skin);
  const body = new MeshBuilder();
  body.box([-0.2, HIP_HEIGHT, -0.11], [0.4, 0.5, 0.22], c(look.shirt));
  body.box([-0.13, 1.14, -0.13], [0.26, 0.28, 0.26], skin);
  body.box([-0.14, 1.36, -0.06], [0.28, 0.1, 0.21], c(look.hair));
  body.box([-0.14, 1.2, 0.08], [0.28, 0.2, 0.07], c(look.hair));
  for (const x of [-0.07, 0.04]) body.box([x, 1.27, -0.135], [0.03, 0.04, 0.01], c(palette.ink));
  if (look.cap) {
    body.box([-0.15, 1.4, -0.15], [0.3, 0.07, 0.3], c(look.cap));
    body.box([-0.13, 1.4, -0.28], [0.26, 0.03, 0.14], c(look.cap));
  }
  const leg = new MeshBuilder().box(
    [-0.07, -HIP_HEIGHT, -0.07],
    [0.14, HIP_HEIGHT, 0.14],
    c(look.pants),
  );
  const arm = new MeshBuilder().box([-0.05, -0.45, -0.05], [0.1, 0.45, 0.1], c(look.shirt));
  arm.box([-0.05, -0.53, -0.05], [0.1, 0.08, 0.1], skin);
  return { body: body.build(), leg: leg.build(), arm: arm.build() };
}
