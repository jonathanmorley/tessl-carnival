import { describe, expect, it } from 'vitest';
import {
  compose,
  identity,
  multiply,
  perspective,
  rotationY,
  transformPoint,
  translation,
} from './mat4';
import { MeshBuilder, rgb, VERTEX_FLOATS } from './mesh';

type V3 = [number, number, number];

/** Each triangle's centroid and the normal stored on its first vertex. */
function triangles(data: Float32Array) {
  const out: { centroid: V3; normal: V3 }[] = [];
  for (let i = 0; i < data.length; i += VERTEX_FLOATS * 3) {
    const at = (k: number, o: number) => data[i + k * VERTEX_FLOATS + o];
    out.push({
      centroid: [0, 1, 2].map((o) => (at(0, o) + at(1, o) + at(2, o)) / 3) as V3,
      normal: [at(0, 3), at(0, 4), at(0, 5)],
    });
  }
  return out;
}

/** Every face of a convex solid round `center` should face away from it. */
function facesOutward(data: Float32Array, center: V3) {
  return triangles(data).every(({ centroid, normal }) => {
    const out = centroid.map((v, k) => v - center[k]);
    return out[0] * normal[0] + out[1] * normal[1] + out[2] * normal[2] > 0;
  });
}

describe('mat4', () => {
  it('composes right to left, so the last matrix applies first', () => {
    const m = compose(translation(5, 0, 0), rotationY(Math.PI / 2));
    const p = transformPoint(m, [0, 0, 1]);
    expect(p[0]).toBeCloseTo(6);
    expect(p[2]).toBeCloseTo(0);
  });

  it('leaves points alone when multiplied by the identity', () => {
    const m = multiply(identity(), translation(1, 2, 3));
    expect(transformPoint(m, [0, 0, 0])).toEqual([1, 2, 3]);
  });

  it('maps the near and far planes to the ends of clip depth', () => {
    const m = perspective(1, 1, 0.5, 100);
    expect(transformPoint(m, [0, 0, -0.5])[2]).toBeCloseTo(-1);
    expect(transformPoint(m, [0, 0, -100])[2]).toBeCloseTo(1);
  });
});

describe('rgb', () => {
  it('reads #rrggbb into 0–1 channels', () => {
    expect(rgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('rejects anything else, rather than drawing black', () => {
    expect(() => rgb('red')).toThrow();
    expect(() => rgb('#fff')).toThrow();
    expect(() => rgb('rgba(0,0,0,0.5)')).toThrow();
  });
});

describe('MeshBuilder', () => {
  it('builds a box from twelve outward-facing triangles', () => {
    const data = new MeshBuilder().box([1, 0, 1], [2, 3, 4], [1, 0, 0]).build();
    expect(data.length).toBe(36 * VERTEX_FLOATS);
    expect(facesOutward(data, [2, 1.5, 3])).toBe(true);
  });

  it('faces cylinders, cones and their caps outward', () => {
    const cylinder = new MeshBuilder()
      .cylinder([0, 0, 0], 1, 1, 2, 8, [[1, 1, 1]], { top: [1, 1, 1], bottom: [1, 1, 1] })
      .build();
    expect(facesOutward(cylinder, [0, 1, 0])).toBe(true);
    const cone = new MeshBuilder().cylinder([0, 0, 0], 1, 0, 2, 8, [[1, 1, 1]]).build();
    expect(cone.length).toBe(8 * 3 * VERTEX_FLOATS);
    expect(facesOutward(cone, [0, 0.5, 0])).toBe(true);
  });

  it('faces a sphere outward, without slivers at the poles', () => {
    const data = new MeshBuilder().sphere([1, 2, 3], 1, [1, 1, 1], 8, 4).build();
    // Two triangles a facet, less one at each pole.
    expect(data.length / VERTEX_FLOATS / 3).toBe(8 * 4 * 2 - 16);
    expect(facesOutward(data, [1, 2, 3])).toBe(true);
  });

  it('stripes a cylinder through its colours', () => {
    const red = [1, 0, 0] as const;
    const white = [1, 1, 1] as const;
    const data = new MeshBuilder().cylinder([0, 0, 0], 1, 1, 1, 4, [red, white]).build();
    const colors = [];
    for (let i = 0; i < data.length; i += VERTEX_FLOATS * 6) colors.push(data[i + 7]);
    expect(colors).toEqual([0, 1, 0, 1]);
  });

  it('skips triangles with no area', () => {
    const b = new MeshBuilder().triangle([0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 1]);
    expect(b.vertexCount).toBe(0);
  });

  it('applies a transform only inside transformed(), even if drawing throws', () => {
    const b = new MeshBuilder();
    expect(() =>
      b.transformed(translation(10, 0, 0), () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const data = b.triangle([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]).build();
    expect(data[0]).toBe(0);
  });

  it('turns normals with the transform', () => {
    const turned = new MeshBuilder();
    turned.transformed(rotationY(Math.PI / 2), () =>
      turned.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [1, 1, 1]),
    );
    const [{ normal }] = triangles(turned.build());
    expect(normal[0]).toBeCloseTo(1);
    expect(normal[2]).toBeCloseTo(0);
  });
});
