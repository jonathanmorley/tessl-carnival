import { canvasFont, theme } from '../carnival';
import bannerUrl from './aidevcon-banner.png';
import { compose, rotationX, rotationY, translation, type Mat4 } from './mat4';
import { MeshBuilder, QUAD_UVS, rgb, VERTEX_FLOATS } from './mesh';
import type { MidwayControls, MidwayOptions } from './midway';
import { palette } from './palette';
import { label, visitorLook } from './render';
import {
  balloon,
  boothPromptAt,
  buildScene,
  HIP_HEIGHT,
  motionMatrix,
  personMeshes,
  SHOULDER_HEIGHT,
  type Part,
  type TextureSpec,
} from './scene3d';
import {
  clampPitch,
  eyeOf,
  moveDirection,
  pick,
  projectionMatrix,
  screenRay,
  turnToward,
  TURN_SPEED,
  viewMatrix,
  yawToward,
  type Camera,
} from './view3d';
import {
  boothInReach,
  canStand,
  createVisitors,
  createWalker,
  findPath,
  followPath,
  layoutMidway,
  pathToBooth,
  strollTiles,
  updateVisitor,
  walk,
  type BoothSlot,
  type Point,
  type Visitor,
} from './world';

/**
 * The midway in 3D: walk round it in first person. Same map, booths and
 * visitors as the 2D midway, drawn with WebGL and no libraries.
 */

/** Forward (+) and right (+) for each movement key. */
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  KeyD: [0, 1],
};
const TURN_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const PLAY_KEYS = new Set(['KeyE', 'Enter', 'Space']);
const DEVCON_URL =
  'https://tessl.io/devcon?utm_source=carnival&utm_medium=midway-billboard&utm_campaign=tessl-carnival';
/** Radians of turn per CSS pixel dragged. */
const LOOK_SPEED = 0.005;
/** How far, in CSS pixels, a press can move and still count as a click. */
const CLICK_SLOP = 6;
const MIN_QUALITY = 0.5;
/**
 * How close, in tiles, the player must stand to a booth to play it. Wider
 * than on the 2D map, so standing on the avenue in front of a booth counts.
 */
const BOOTH_REACH_3D = 1.6;
const FOG = { near: 14, far: 62 };

/** Where the player stood, and which way they faced, when they last left the midway. */
let returnTo: Camera | undefined;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aUv;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform vec3 uEye;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vFromEye;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
  vColor = aColor;
  vUv = aUv;
  vFromEye = world.xyz - uEye;
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexture;
uniform vec3 uSun;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uLit;
uniform float uFogged;
uniform float uGlow;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUv;
// Per pixel, not per vertex: the ground is a few huge triangles.
varying vec3 vFromEye;
void main() {
  vec4 texel = texture2D(uTexture, vUv);
  if (texel.a < 0.02) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float light = mix(1.0, 0.62 + 0.42 * max(dot(n, uSun), 0.0) + 0.06 * n.y, uLit);
  vec3 color = vColor * texel.rgb * light + uGlow * vec3(0.3, 0.24, 0.06);
  float fog = uFogged * clamp((length(vFromEye) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(color, uFogColor, fog), texel.a);
}`;

interface Mesh {
  buffer: WebGLBuffer;
  count: number;
}

interface DrawnPart extends Part {
  gpu: Mesh;
  image?: WebGLTexture;
}

/** A canvas with a painted sign on it: the board, its edge and centred text. */
function paintSign(spec: Extract<TextureSpec, { kind: 'sign' }>): HTMLCanvasElement {
  const height = 128;
  const width = Math.round(height * spec.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = spec.edge;
  ctx.fillRect(0, 0, width, height);
  const border = height * 0.09;
  ctx.fillStyle = spec.board;
  ctx.beginPath();
  ctx.roundRect(border, border, width - border * 2, height - border * 2, theme.radius);
  ctx.fill();
  let size = height * 0.5;
  const font = () => `bold ${Math.round(size)}px ${theme.font.family}`;
  ctx.font = font();
  while (size > 12 && ctx.measureText(spec.text).width > width - border * 5) {
    size -= 2;
    ctx.font = font();
  }
  ctx.fillStyle = spec.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.text, width / 2, height / 2 + size * 0.05);
  return canvas;
}

/** The "Press E to play" callout, drawn with the 2D midway's own label. */
function paintPrompt(text: string): { canvas: HTMLCanvasElement; width: number; height: number } {
  const scale = 3;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = canvasFont('small', 'bold');
  const width = measure.measureText(text).width + 30;
  const height = theme.font.small + 14 + 12;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  label(ctx, text, width / 2, (theme.font.small + 14) / 2 + 2);
  return { canvas, width, height };
}

/**
 * Starts the 3D midway on a canvas. Returns undefined, and leaves the canvas
 * untouched, when the browser can't do WebGL; the caller falls back to 2D.
 * Throws if WebGL is there but the shaders won't build, before adding any
 * listeners; the canvas then holds a WebGL context, so 2D needs a new one.
 */
export function startMidway3d(
  canvas: HTMLCanvasElement,
  options: MidwayOptions,
): MidwayControls | undefined {
  const maybeGl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!maybeGl) return undefined;
  const gl: WebGLRenderingContext = maybeGl;

  const map = layoutMidway(options.games.map((g) => g.id));
  const names = new Map(options.games.map((g) => [g.id, g.name]));
  const scene = buildScene(map, names);
  const start: Camera = returnTo ?? { x: map.avenueX + 1, y: map.height - 2.5, yaw: 0, pitch: 0 };
  const player = createWalker(canStand(map, start.x, start.y) ? start : map.spawn);
  const camera: Camera = { ...start, x: player.x, y: player.y };
  const strolls = strollTiles(map);
  const visitors = createVisitors(map, 12, Math.random);
  const headings = visitors.map(() => Math.random() * Math.PI * 2);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const floaters: { x: number; y: number; z: number; age: number; color: number }[] = [];
  let nextFloater = 2;
  let inReach: BoothSlot | undefined;
  /** The booth to turn and face once the current walk ends. */
  let faceBooth: BoothSlot | undefined;

  // ── GPU resources, made again if the context is lost and comes back ────
  interface Gpu {
    program: WebGLProgram;
    locations: Record<string, WebGLUniformLocation | null>;
    attributes: Record<'aPosition' | 'aNormal' | 'aColor' | 'aUv', number>;
    white: WebGLTexture;
    parts: DrawnPart[];
    people: { body: Mesh; leg: Mesh; arm: Mesh }[];
    balloons: Mesh[];
    prompt: { mesh: Mesh; image: WebGLTexture };
    buffers: WebGLBuffer[];
    textures: WebGLTexture[];
  }

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`Midway shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };

  const createGpu = (): Gpu => {
    const program = gl.createProgram()!;
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Midway shaders failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms = [
      'uViewProjection',
      'uModel',
      'uEye',
      'uTexture',
      'uSun',
      'uFogColor',
      'uFog',
      'uLit',
      'uFogged',
      'uGlow',
    ];
    const locations = Object.fromEntries(
      uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    const attributes = {
      aPosition: gl.getAttribLocation(program, 'aPosition'),
      aNormal: gl.getAttribLocation(program, 'aNormal'),
      aColor: gl.getAttribLocation(program, 'aColor'),
      aUv: gl.getAttribLocation(program, 'aUv'),
    };

    const buffers: WebGLBuffer[] = [];
    const textures: WebGLTexture[] = [];
    const upload = (data: Float32Array): Mesh => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      buffers.push(buffer);
      return { buffer, count: data.length / VERTEX_FLOATS };
    };
    const texture = (source?: TexImageSource): WebGLTexture => {
      const image = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, image);
      // Works for any size of image: no mipmaps, no wrapping.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([255, 255, 255, 255]),
        );
      }
      textures.push(image);
      return image;
    };

    const white = texture();
    const parts = scene.parts.map((part): DrawnPart => {
      const drawn: DrawnPart = { ...part, gpu: upload(part.mesh) };
      if (part.texture?.kind === 'sign') drawn.image = texture(paintSign(part.texture));
      if (part.texture?.kind === 'banner') {
        // The board shows plain until the banner loads.
        const image = texture();
        drawn.image = image;
        const banner = new Image();
        banner.onload = () => {
          // The midway may have stopped, or lost its context, while it loaded.
          if (gl.isContextLost() || !gl.isTexture(image)) return;
          gl.bindTexture(gl.TEXTURE_2D, image);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, banner);
        };
        banner.src = bannerUrl;
      }
      return drawn;
    });
    const people = visitors.map((v) => {
      const meshes = personMeshes(visitorLook(v.look));
      return { body: upload(meshes.body), leg: upload(meshes.leg), arm: upload(meshes.arm) };
    });
    const balloons = palette.balloons.map((color) => {
      const b = new MeshBuilder();
      balloon(b, [0, 0, 0], rgb(color));
      return upload(b.build());
    });
    const callout = paintPrompt('Press E to play');
    const w = callout.width / 260;
    const h = callout.height / 260;
    const promptMesh = new MeshBuilder()
      .quad(
        [-w / 2, 0, 0],
        [w / 2, 0, 0],
        [w / 2, h, 0],
        [-w / 2, h, 0],
        rgb(palette.white),
        QUAD_UVS,
      )
      .build();
    const prompt = { mesh: upload(promptMesh), image: texture(callout.canvas) };

    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const sky = rgb(palette.sky);
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.uniform3fv(locations.uFogColor, sky);
    gl.uniform2f(locations.uFog, FOG.near, FOG.far);
    const sun = [0.45, 0.8, 0.4];
    const length = Math.hypot(...sun);
    gl.uniform3f(locations.uSun, sun[0] / length, sun[1] / length, sun[2] / length);
    gl.uniform1i(locations.uTexture, 0);
    return {
      program,
      locations,
      attributes,
      white,
      parts,
      people,
      balloons,
      prompt,
      buffers,
      textures,
    };
  };

  const disposeGpu = (gpu: Gpu) => {
    for (const buffer of gpu.buffers) gl.deleteBuffer(buffer);
    for (const image of gpu.textures) gl.deleteTexture(image);
    gl.deleteProgram(gpu.program);
  };

  let gpu: Gpu | undefined = createGpu();

  // ── Size ──────────────────────────────────────────────────────────────
  /** Drops below 1 on machines too slow to keep up, trading sharpness for speed. */
  let quality = 1;
  let slowFrames = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // ── Input ─────────────────────────────────────────────────────────────
  const play = (booth: BoothSlot | undefined) => {
    if (!booth?.gameId) return;
    returnTo = { x: player.x, y: player.y, yaw: camera.yaw, pitch: 0 };
    options.onPlay(booth.gameId);
  };

  const walkToBooth = (booth: BoothSlot) => {
    player.path = pathToBooth(map, player, booth) ?? [];
    faceBooth = player.path.length > 0 ? booth : undefined;
  };

  const keys = new Set<string>();
  const isControl = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest('a, button, input, textarea, select') !== null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code in MOVE_KEYS || event.code in TURN_KEYS) {
      keys.add(event.code);
      player.path = [];
      faceBooth = undefined;
      event.preventDefault();
    } else if (PLAY_KEYS.has(event.code) && !isControl(event.target) && inReach?.gameId) {
      event.preventDefault();
      play(inReach);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onBlur = () => keys.clear();

  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const pickAt = (
    event: PointerEvent,
  ): { booth?: BoothSlot; billboard?: boolean; point?: Point } | undefined => {
    const box = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - box.left) / box.width) * 2 - 1;
    const ndcY = 1 - ((event.clientY - box.top) / box.height) * 2;
    const hit = pick(
      eyeOf(camera),
      screenRay(camera, ndcX, ndcY, aspect()),
      scene.pickables.map((p) => p.box),
    );
    if (hit?.kind === 'box') return scene.pickables[hit.index];
    return hit ? { point: hit.point } : undefined;
  };

  /** The press being dragged to look around, if any. */
  let drag: { id: number; x: number; y: number; moved: number } | undefined;
  const onPointerDown = (event: PointerEvent) => {
    if (drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.id) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved += Math.hypot(dx, dy);
      if (drag.moved > CLICK_SLOP) {
        camera.yaw += dx * LOOK_SPEED;
        camera.pitch = clampPitch(camera.pitch - dy * LOOK_SPEED);
      }
      return;
    }
    const hit = pickAt(event);
    canvas.style.cursor = hit?.booth || hit?.billboard ? 'pointer' : 'grab';
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const click = drag.moved <= CLICK_SLOP;
    drag = undefined;
    canvas.style.cursor = 'grab';
    if (!click) return;
    const hit = pickAt(event);
    if (hit?.billboard) {
      window.open(DEVCON_URL, '_blank', 'noopener');
    } else if (hit?.booth) {
      if (hit.booth === inReach) play(hit.booth);
      else walkToBooth(hit.booth);
    } else if (hit?.point) {
      player.path = findPath(map, player, hit.point) ?? [];
      faceBooth = undefined;
    }
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) drag = undefined;
  };

  let frame = 0;
  const onContextLost = (event: Event) => {
    // Keep the context restorable, and stop drawing until it's back.
    event.preventDefault();
    cancelAnimationFrame(frame);
    gpu = undefined;
  };
  const onContextRestored = () => {
    gpu = createGpu();
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  canvas.style.cursor = 'grab';

  // ── Update ────────────────────────────────────────────────────────────
  const updatePlayer = (dt: number) => {
    let forward = 0;
    let strafe = 0;
    let turn = 0;
    for (const code of keys) {
      if (code in MOVE_KEYS) {
        forward += MOVE_KEYS[code][0];
        strafe += MOVE_KEYS[code][1];
      } else turn += TURN_KEYS[code] ?? 0;
    }
    camera.yaw += Math.sign(turn) * TURN_SPEED * dt;
    const direction = moveDirection(Math.sign(forward), Math.sign(strafe), camera.yaw);
    if (direction.x !== 0 || direction.y !== 0) walk(map, player, direction, dt);
    else if (player.path.length > 0) {
      // Look where we're going, then at the booth once we get there.
      camera.yaw = turnToward(camera.yaw, yawToward(player, player.path[0]), 5 * dt);
      if (followPath(player, dt) && faceBooth) {
        const booth = faceBooth;
        faceBooth = undefined;
        turnTarget = yawToward(player, { x: booth.x + booth.w / 2, y: booth.y + booth.h / 2 });
      }
    } else player.walking = false;
    if (turnTarget !== undefined) {
      camera.yaw = turnToward(camera.yaw, turnTarget, 5 * dt);
      if (camera.yaw === turnTarget || keys.size > 0 || drag) turnTarget = undefined;
    }
    camera.x = player.x;
    camera.y = player.y;
  };
  let turnTarget: number | undefined;

  const updateVisitors = (dt: number) => {
    visitors.forEach((visitor, i) => {
      const before: Point = { x: visitor.x, y: visitor.y };
      updateVisitor(map, visitor, dt, Math.random, strolls);
      if (Math.hypot(visitor.x - before.x, visitor.y - before.y) > 1e-4) {
        headings[i] = turnToward(headings[i], yawToward(before, visitor), 8 * dt);
      }
    });
  };

  const updateFloaters = (dt: number) => {
    if (calm) return;
    nextFloater -= dt;
    if (nextFloater <= 0) {
      nextFloater = 4 + Math.random() * 5;
      const from = strolls[Math.floor(Math.random() * strolls.length)];
      floaters.push({
        x: from.x + 0.5,
        y: 1.4,
        z: from.y + 0.5,
        age: 0,
        color: Math.floor(Math.random() * palette.balloons.length),
      });
    }
    for (const f of floaters) {
      f.age += dt;
      f.y += 0.9 * dt;
    }
    floaters.splice(0, floaters.length, ...floaters.filter((f) => f.age < 30));
  };

  // ── Draw ──────────────────────────────────────────────────────────────
  const draw = (g: Gpu, t: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const view = viewMatrix(camera);
    gl.uniformMatrix4fv(
      g.locations.uViewProjection,
      false,
      compose(projectionMatrix(aspect()), view),
    );
    const eye = eyeOf(camera);
    gl.uniform3fv(g.locations.uEye, eye);

    const stride = VERTEX_FLOATS * 4;
    const mesh = (m: Mesh, model: Mat4, image: WebGLTexture = g.white) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
      const { aPosition, aNormal, aColor, aUv } = g.attributes;
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 24);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 36);
      gl.uniformMatrix4fv(g.locations.uModel, false, model);
      gl.bindTexture(gl.TEXTURE_2D, image);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    };
    const style = (lit: boolean, fog: boolean, glow = 0) => {
      gl.uniform1f(g.locations.uLit, lit ? 1 : 0);
      gl.uniform1f(g.locations.uFogged, fog ? 1 : 0);
      gl.uniform1f(g.locations.uGlow, glow);
    };
    const motionTime = calm ? 0 : t;

    g.parts.forEach((part, i) => {
      // The sky follows the player, so it never comes any closer.
      const sky = i === 0;
      if (sky) gl.depthMask(false);
      const glow = part.booth && part.booth === inReach ? 0.6 + Math.sin(t * 5) * 0.3 : 0;
      style(part.lit, part.fog, glow);
      const model = sky ? translation(eye[0], 0, eye[2]) : motionMatrix(part.motion, motionTime);
      mesh(part.gpu, model, part.image);
      if (sky) gl.depthMask(true);
    });

    style(true, true);
    visitors.forEach((visitor: Visitor, i) => {
      const person = g.people[i];
      const base = compose(translation(visitor.x, 0, visitor.y), rotationY(-headings[i]));
      const swing = visitor.walking ? Math.sin(visitor.stride * Math.PI * 2.2) * 0.5 : 0;
      mesh(person.body, base);
      for (const side of [-1, 1]) {
        mesh(
          person.leg,
          compose(base, translation(side * 0.1, HIP_HEIGHT, 0), rotationX(swing * side)),
        );
        mesh(
          person.arm,
          compose(
            base,
            translation(side * 0.26, SHOULDER_HEIGHT, 0),
            rotationX(-swing * side * 0.8),
          ),
        );
      }
    });
    for (const f of floaters) {
      const sway = Math.sin(f.age * 2) * 0.15;
      mesh(g.balloons[f.color], translation(f.x + sway, f.y, f.z));
    }

    // The prompt over the booth in reach, always on top, facing the player.
    if (inReach?.gameId) {
      const [x, y, z] = boothPromptAt(map, inReach);
      gl.disable(gl.DEPTH_TEST);
      style(false, false);
      mesh(
        g.prompt.mesh,
        compose(translation(x, y + Math.sin(t * 3) * 0.05, z), rotationY(-camera.yaw)),
        g.prompt.image,
      );
      gl.enable(gl.DEPTH_TEST);
    }
  };

  let last = performance.now();
  const loop = (time: number) => {
    // Cap the step so a background tab doesn't teleport everyone.
    const elapsed = (time - last) / 1000;
    const dt = Math.min(elapsed, 0.05);
    last = time;

    // If frames keep taking longer than 1/40 s, draw fewer pixels. Long gaps
    // (a background tab, a resize) don't count.
    if (elapsed < 0.25)
      slowFrames = elapsed > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality * 0.75);
      slowFrames = 0;
      resize();
    }

    updatePlayer(dt);
    updateVisitors(dt);
    const reach = boothInReach(map, player, BOOTH_REACH_3D);
    if (reach !== inReach) {
      inReach = reach;
      options.onReach(reach);
    }
    updateFloaters(dt);
    if (gpu) draw(gpu, time / 1000);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    walkTo(gameId) {
      const booth = map.booths.find((b) => b.gameId === gameId);
      if (booth) walkToBooth(booth);
    },
    stop() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (gpu && !gl.isContextLost()) disposeGpu(gpu);
      gpu = undefined;
    },
  };
}
