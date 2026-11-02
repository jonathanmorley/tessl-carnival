/**
 * Just enough 4×4 matrix maths for the 3D midway. Matrices are column-major
 * Float32Arrays, the layout WebGL expects.
 */

export type Mat4 = Float32Array;
export type Vec3 = readonly [number, number, number];

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a × b: applies b first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Multiplies left to right: compose(a, b, c) is a × b × c, so c applies first. */
export function compose(...matrices: Mat4[]): Mat4 {
  return matrices.reduce((acc, m) => multiply(acc, m), identity());
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaling(x: number, y = x, z = x): Mat4 {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

export function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/** A perspective projection. `fov` is the vertical field of view in radians. */
export function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function transformPoint(m: Mat4, p: Vec3): [number, number, number] {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** Transforms a direction: ignores translation. */
export function transformDirection(m: Mat4, d: Vec3): [number, number, number] {
  const [x, y, z] = d;
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

export function normalize(v: Vec3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
