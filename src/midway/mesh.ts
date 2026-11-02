import { identity, multiply, transformPoint, type Mat4, type Vec3 } from './mat4';

/**
 * Builds flat-shaded, low-poly meshes for the 3D midway as one interleaved
 * vertex array: position, normal, colour and texture coordinate. Plain
 * arrays, no WebGL, so Vitest can check them.
 */

export type Color = readonly [number, number, number];

/** Floats per vertex: position (3), normal (3), colour (3), texture coordinate (2). */
export const VERTEX_FLOATS = 11;

/** '#rrggbb' to linear-ish 0–1 channels, the form the shader takes. */
export function rgb(hex: string): Color {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type UV = readonly [number, number];
const NO_UV: UV = [0, 0];
/** Texture coordinates for a quad given bottom-left, bottom-right, top-right, top-left. */
export const QUAD_UVS: readonly [UV, UV, UV, UV] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

export class MeshBuilder {
  private readonly data: number[] = [];
  private matrix: Mat4 = identity();

  get vertexCount(): number {
    return this.data.length / VERTEX_FLOATS;
  }

  /** Runs `draw` with `m` applied to everything it adds, on top of any outer transform. */
  transformed(m: Mat4, draw: () => void): this {
    const outer = this.matrix;
    this.matrix = multiply(outer, m);
    try {
      draw();
    } finally {
      this.matrix = outer;
    }
    return this;
  }

  /** A triangle, front face counter-clockwise. Triangles with no area are skipped. */
  triangle(a: Vec3, b: Vec3, c: Vec3, color: Color, uvs: readonly UV[] = []): this {
    const pa = transformPoint(this.matrix, a);
    const pb = transformPoint(this.matrix, b);
    const pc = transformPoint(this.matrix, c);
    const ux = pb[0] - pa[0];
    const uy = pb[1] - pa[1];
    const uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0];
    const vy = pc[1] - pa[1];
    const vz = pc[2] - pa[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return this;
    const points = [pa, pb, pc];
    for (let i = 0; i < 3; i++) {
      const uv = uvs[i] ?? NO_UV;
      this.data.push(
        ...points[i],
        nx / length,
        ny / length,
        nz / length,
        color[0],
        color[1],
        color[2],
        uv[0],
        uv[1],
      );
    }
    return this;
  }

  /** A quad from four corners in counter-clockwise order, seen from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Color, uvs?: readonly [UV, UV, UV, UV]): this {
    this.triangle(a, b, c, color, uvs ? [uvs[0], uvs[1], uvs[2]] : []);
    return this.triangle(a, c, d, color, uvs ? [uvs[0], uvs[2], uvs[3]] : []);
  }

  /** An axis-aligned box from its low corner and size, with an optional different top. */
  box(min: Vec3, size: Vec3, color: Color, top: Color = color): this {
    const [x0, y0, z0] = min;
    const x1 = x0 + size[0];
    const y1 = y0 + size[1];
    const z1 = z0 + size[2];
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color);
    return this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
  }

  /**
   * An upright cylinder, cone or frustum standing on `base`, with radius r0 at
   * the bottom and r1 at the top. Side segments cycle through `colors`, which
   * gives tents their stripes.
   */
  cylinder(
    base: Vec3,
    r0: number,
    r1: number,
    height: number,
    segments: number,
    colors: readonly Color[],
    caps: { top?: Color; bottom?: Color } = {},
  ): this {
    const [cx, y0, cz] = base;
    const y1 = y0 + height;
    const at = (i: number, r: number, y: number): Vec3 => {
      const a = (i / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    };
    for (let i = 0; i < segments; i++) {
      const color = colors[i % colors.length];
      if (r1 === 0) {
        this.triangle(at(i + 1, r0, y0), at(i, r0, y0), [cx, y1, cz], color);
      } else {
        this.quad(at(i + 1, r0, y0), at(i, r0, y0), at(i, r1, y1), at(i + 1, r1, y1), color);
      }
      if (caps.top && r1 > 0)
        this.triangle([cx, y1, cz], at(i + 1, r1, y1), at(i, r1, y1), caps.top);
      if (caps.bottom) this.triangle([cx, y0, cz], at(i, r0, y0), at(i + 1, r0, y0), caps.bottom);
    }
    return this;
  }

  /** A faceted sphere. */
  sphere(center: Vec3, radius: number, color: Color, segments = 8, rings = 5): this {
    const at = (i: number, j: number): Vec3 => {
      const theta = (i / segments) * Math.PI * 2;
      const phi = (j / rings) * Math.PI;
      return [
        center[0] + Math.cos(theta) * Math.sin(phi) * radius,
        center[1] + Math.cos(phi) * radius,
        center[2] + Math.sin(theta) * Math.sin(phi) * radius,
      ];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        this.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), color);
      }
    }
    return this;
  }

  build(): Float32Array {
    return new Float32Array(this.data);
  }
}
