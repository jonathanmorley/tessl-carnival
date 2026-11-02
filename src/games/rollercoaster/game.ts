import { canvasFont, recordScore, theme, type CarnivalGame } from '../../carnival';

const { width: WIDTH, height: HEIGHT } = theme.canvas;

/** Horizontal length of one hill, in pixels. */
export const HILL_LENGTH = 400;
/** The height of each hill in turn, in pixels. */
export const HILLS = [120, 160, 200, 140, 220, 180, 240, 160];
export const TRACK_LENGTH = HILL_LENGTH * HILLS.length;
export const GRAVITY = 600;
/** How hard the launch motor pushes while you hold it, in px/s². */
export const BOOST = 450;
/** Speed lost to friction each second, as a share of the speed. */
export const DRAG = 0.15;
export const START_SPEED = 260;
/** Go over a crest faster than this and the car leaves the track. */
export const MAX_CREST_SPEED = 320;
export const FINISH_BONUS = 50;
const SUBSTEP = 1 / 240;
const GROUND_Y = HEIGHT - 60;
/** Where the car sits on screen; the track scrolls past it. */
const CAR_SCREEN_X = 220;

export interface RollercoasterState {
  /** Horizontal position on the track, in pixels. */
  x: number;
  /** Horizontal speed, in pixels per second. */
  speed: number;
  /** Whether the launch motor is on. */
  boosting: boolean;
  /** How many crests the car has gone over. */
  crests: number;
  score: number;
  phase: 'riding' | 'over';
  outcome?: 'finished' | 'derailed' | 'stalled';
}

export function createState(): RollercoasterState {
  return { x: 0, speed: START_SPEED, boosting: false, crests: 0, score: 0, phase: 'riding' };
}

function hillAt(x: number): number {
  return HILLS[Math.min(Math.max(Math.floor(x / HILL_LENGTH), 0), HILLS.length - 1)];
}

/** Height of the track above the ground at distance `x`. Flat past either end. */
export function trackHeight(x: number): number {
  if (x <= 0 || x >= TRACK_LENGTH) return 0;
  return (hillAt(x) * (1 - Math.cos((2 * Math.PI * x) / HILL_LENGTH))) / 2;
}

/** Rise over run of the track at distance `x`. */
export function trackSlope(x: number): number {
  if (x <= 0 || x >= TRACK_LENGTH) return 0;
  return ((hillAt(x) * Math.PI) / HILL_LENGTH) * Math.sin((2 * Math.PI * x) / HILL_LENGTH);
}

/** Thrill points for going over a crest: 1 point per 10 px/s, rounded. */
export function scoreForCrest(speed: number): number {
  return Math.round(speed / 10);
}

export function setBoost(state: RollercoasterState, on: boolean): void {
  state.boosting = on && state.phase === 'riding';
}

function end(state: RollercoasterState, outcome: NonNullable<RollercoasterState['outcome']>) {
  state.phase = 'over';
  state.outcome = outcome;
  state.boosting = false;
}

function substep(state: RollercoasterState, dt: number): void {
  const accel = (state.boosting ? BOOST : 0) - GRAVITY * trackSlope(state.x) - DRAG * state.speed;
  state.speed += accel * dt;
  if (state.speed <= 0) {
    state.speed = 0;
    end(state, 'stalled');
    return;
  }

  const crestsBefore = Math.floor(state.x / HILL_LENGTH + 0.5);
  state.x += state.speed * dt;
  const crestsAfter = Math.min(Math.floor(state.x / HILL_LENGTH + 0.5), HILLS.length);
  if (crestsAfter > crestsBefore) {
    state.crests = crestsAfter;
    if (state.speed > MAX_CREST_SPEED) {
      end(state, 'derailed');
      return;
    }
    state.score += scoreForCrest(state.speed);
  }

  if (state.x >= TRACK_LENGTH) {
    state.score += FINISH_BONUS;
    end(state, 'finished');
  }
}

/** Advances the ride by `dt` seconds. */
export function step(state: RollercoasterState, dt: number): void {
  let left = dt;
  while (left > 0 && state.phase === 'riding') {
    const slice = Math.min(left, SUBSTEP);
    substep(state, slice);
    left -= slice;
  }
}

// Drawing. Everything below is looks only: none of it changes the ride.

/** How many cars the train has. */
export const CAR_COUNT = 3;
/** Distance along the track between the centres of neighbouring cars, in pixels. */
export const CAR_GAP = 50;
/** Distance between the running rail and the lower rail, in pixels. */
export const RAIL_DEPTH = 12;
/** Riders put their arms up on a downhill steeper than this slope... */
export const ARMS_UP_SLOPE = -0.6;
/** ...or when the train goes faster than this, in px/s. */
export const ARMS_UP_SPEED = 300;
const TIE_SPACING = 14;
const POST_SPACING = 40;
const BRACE_HEIGHT = 45;
const BULB_SPACING = 28;
const BASE_Y = GROUND_Y + 20;
/** The far-off fairground repeats every this many pixels. */
const SKYLINE_PERIOD = 900;
const SKYLINE_PARALLAX = 0.25;

/**
 * A point on the track at distance `x`, `depth` pixels below the running rail
 * (measured square to the track). `y` is in screen pixels; `x` is along the
 * track, before scrolling.
 */
export function trackPoint(x: number, depth = 0): { x: number; y: number } {
  const slope = trackSlope(x);
  const length = Math.hypot(slope, 1);
  return { x: x + (slope / length) * depth, y: GROUND_Y - trackHeight(x) + depth / length };
}

/**
 * Where a car `distance` pixels of track behind `leadX` sits, measured along
 * the curve rather than across, so the cars keep their spacing on steep hills.
 */
export function trailingX(leadX: number, distance: number): number {
  const dx = 0.5;
  let x = leadX;
  let left = distance;
  while (left > 0) {
    const ds = Math.hypot(1, trackSlope(x - dx / 2)) * dx;
    if (ds >= left) return x - (dx * left) / ds;
    left -= ds;
    x -= dx;
  }
  return x;
}

/** Track positions of every car in the train, lead car first. */
export function trainPositions(leadX: number): number[] {
  const cars = [leadX];
  for (let i = 1; i < CAR_COUNT; i++) cars.push(trailingX(cars[i - 1], CAR_GAP));
  return cars;
}

/** Whether a rider at this slope and speed throws their arms up. */
export function armsUp(slope: number, speed: number): boolean {
  return slope < ARMS_UP_SLOPE || speed > ARMS_UP_SPEED;
}

/** How far a layer that scrolls at `factor` of the track speed has moved, wrapped to `period`. */
export function parallaxShift(offset: number, factor: number, period: number): number {
  return (((offset * factor) % period) + period) % period;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  /** Where the star is in its twinkle, in radians. */
  phase: number;
}

/** A fixed, scattered field of stars in the upper sky. The same every time. */
export function starField(count: number): Star[] {
  const stars: Star[] = [];
  // A small linear congruential generator, so the sky doesn't change between rides.
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < count; i++) {
    stars.push({
      x: next() * WIDTH,
      y: next() * HEIGHT * 0.55,
      size: next() < 0.2 ? 2 : 1,
      phase: next() * Math.PI * 2,
    });
  }
  return stars;
}

const STARS = starField(45);

/** Runs `paint` at `alpha` times the current opacity, then puts the opacity back. */
function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, paint: () => void) {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * alpha;
  paint();
  ctx.globalAlpha = before;
}

function drawSky(ctx: CanvasRenderingContext2D, offset: number, time: number) {
  const { colors } = theme;
  const sky = ctx.createLinearGradient(0, 0, 0, BASE_Y);
  sky.addColorStop(0, colors.background);
  sky.addColorStop(0.3, colors.background);
  sky.addColorStop(0.8, colors.surface);
  sky.addColorStop(1, colors.surface);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = colors.text;
  for (const star of STARS) {
    withAlpha(ctx, 0.35 + 0.65 * Math.abs(Math.sin(time * 1.3 + star.phase)), () => {
      ctx.fillRect(star.x, star.y, star.size, star.size);
    });
  }

  // The moon, with a bite out of it.
  ctx.fillStyle = colors.text;
  withAlpha(ctx, 0.85, () => {
    ctx.beginPath();
    ctx.arc(WIDTH - 140, 90, 22, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = colors.background;
  ctx.beginPath();
  ctx.arc(WIDTH - 130, 84, 20, 0, Math.PI * 2);
  ctx.fill();

  // The rest of the fairground, far off, scrolling slower than the track.
  const shift = parallaxShift(offset, SKYLINE_PARALLAX, SKYLINE_PERIOD);
  for (let base = -shift; base < WIDTH; base += SKYLINE_PERIOD) {
    drawSkyline(ctx, base, time);
  }
}

function drawTent(ctx: CanvasRenderingContext2D, x: number, width: number, height: number) {
  const top = BASE_Y - height;
  ctx.beginPath();
  ctx.moveTo(x, BASE_Y);
  ctx.lineTo(x, top + height * 0.45);
  ctx.quadraticCurveTo(x + width * 0.3, top + height * 0.35, x + width / 2, top);
  ctx.quadraticCurveTo(x + width * 0.7, top + height * 0.35, x + width, top + height * 0.45);
  ctx.lineTo(x + width, BASE_Y);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x + width / 2 - 1, top - 14, 2, 14);
  ctx.beginPath();
  ctx.moveTo(x + width / 2 + 1, top - 14);
  ctx.lineTo(x + width / 2 + 11, top - 10);
  ctx.lineTo(x + width / 2 + 1, top - 6);
  ctx.fill();
}

function drawSkyline(ctx: CanvasRenderingContext2D, base: number, time: number) {
  const { colors } = theme;
  ctx.fillStyle = colors.background;
  ctx.strokeStyle = colors.background;

  drawTent(ctx, base + 40, 120, 90);
  drawTent(ctx, base + 150, 80, 65);
  drawTent(ctx, base + 610, 140, 105);
  drawTent(ctx, base + 760, 90, 70);

  // The ferris wheel, turning slowly.
  const cx = base + 400;
  const cy = BASE_Y - 150;
  const radius = 110;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 60, BASE_Y);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + 60, BASE_Y);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  const spokes = 12;
  const turn = time * 0.15;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  for (let i = 0; i < spokes; i++) {
    const angle = turn + (i / spokes) * Math.PI * 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  ctx.stroke();
  for (let i = 0; i < spokes; i++) {
    const angle = turn + (i / spokes) * Math.PI * 2;
    const gx = cx + Math.cos(angle) * radius;
    const gy = cy + Math.sin(angle) * radius;
    ctx.fillStyle = colors.background;
    ctx.fillRect(gx - 7, gy + 2, 14, 11);
    ctx.fillStyle = colors.accent;
    withAlpha(ctx, 0.25 + 0.35 * Math.abs(Math.sin(time * 2 + i)), () => {
      ctx.beginPath();
      ctx.arc(gx, gy, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.fillStyle = colors.background;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
}

/** The wooden lattice under the track: posts, ledgers and crossed braces. */
function drawLattice(
  ctx: CanvasRenderingContext2D,
  offset: number,
  shiftX: number,
  shiftY: number,
) {
  const first = Math.floor((offset - shiftX) / POST_SPACING) * POST_SPACING;
  const tops: { sx: number; y: number }[] = [];
  for (let x = first; x <= offset + WIDTH + POST_SPACING; x += POST_SPACING) {
    tops.push({ sx: x - offset + shiftX, y: trackPoint(x, RAIL_DEPTH).y + shiftY });
  }
  const ground = BASE_Y + shiftY;

  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const top of tops) {
    ctx.moveTo(top.sx, top.y);
    ctx.lineTo(top.sx, ground);
  }
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i + 1 < tops.length; i++) {
    const a = tops[i];
    const b = tops[i + 1];
    const highest = Math.max(a.y, b.y);
    for (let bottom = ground; bottom > highest + 4; bottom -= BRACE_HEIGHT) {
      const level = bottom - BRACE_HEIGHT;
      const aTop = Math.max(level, a.y);
      const bTop = Math.max(level, b.y);
      ctx.moveTo(a.sx, bottom);
      ctx.lineTo(b.sx, bTop);
      ctx.moveTo(b.sx, bottom);
      ctx.lineTo(a.sx, aTop);
      if (level > highest) {
        ctx.moveTo(a.sx, level);
        ctx.lineTo(b.sx, level);
      }
    }
  }
  ctx.stroke();
}

function drawStructure(ctx: CanvasRenderingContext2D, offset: number) {
  const { colors } = theme;
  ctx.strokeStyle = colors.wood;
  // The far side of the structure, dim and a little up and to the right.
  withAlpha(ctx, 0.3, () => drawLattice(ctx, offset, 10, -6));
  withAlpha(ctx, 0.75, () => drawLattice(ctx, offset, 0, 0));
}

function drawGround(ctx: CanvasRenderingContext2D, offset: number) {
  const { colors } = theme;
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, BASE_Y, WIDTH, HEIGHT - BASE_Y);
  ctx.fillStyle = colors.muted;
  withAlpha(ctx, 0.35, () => ctx.fillRect(0, BASE_Y, WIDTH, 2));
  // Footings under each post.
  ctx.fillStyle = colors.wood;
  const first = Math.floor(offset / POST_SPACING) * POST_SPACING;
  withAlpha(ctx, 0.6, () => {
    for (let x = first; x <= offset + WIDTH; x += POST_SPACING) {
      ctx.fillRect(x - offset - 5, BASE_Y, 10, 5);
    }
  });
}

/** Traces the curve `depth` pixels below the running rail across the screen. */
function traceRail(ctx: CanvasRenderingContext2D, offset: number, depth: number, reverse = false) {
  const points: { x: number; y: number }[] = [];
  for (let sx = -8; sx <= WIDTH + 8; sx += 4) {
    const point = trackPoint(sx + offset, depth);
    points.push({ x: point.x - offset, y: point.y });
  }
  if (reverse) points.reverse();
  for (const [i, point] of points.entries()) {
    if (i === 0 && !reverse) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, offset: number, time: number) {
  const { colors } = theme;

  // The far rail, behind everything else on the track.
  ctx.strokeStyle = colors.wood;
  ctx.lineWidth = 3;
  withAlpha(ctx, 0.45, () => {
    ctx.save();
    ctx.translate(10, -6);
    ctx.beginPath();
    traceRail(ctx, offset, 0);
    ctx.stroke();
    ctx.restore();
  });

  // The solid band of timber between the two rails.
  ctx.fillStyle = colors.wood;
  withAlpha(ctx, 0.55, () => {
    ctx.beginPath();
    traceRail(ctx, offset, 0);
    traceRail(ctx, offset, RAIL_DEPTH, true);
    ctx.closePath();
    ctx.fill();
  });

  // Cross-ties, square to the track.
  ctx.strokeStyle = colors.wood;
  ctx.lineWidth = 4;
  const firstTie = Math.floor(offset / TIE_SPACING) * TIE_SPACING;
  ctx.beginPath();
  for (let x = firstTie; x <= offset + WIDTH + TIE_SPACING; x += TIE_SPACING) {
    const top = trackPoint(x, -3);
    const bottom = trackPoint(x, RAIL_DEPTH + 2);
    ctx.moveTo(top.x - offset, top.y);
    ctx.lineTo(bottom.x - offset, bottom.y);
  }
  ctx.stroke();

  // The lower rail, then the running rail with a highlight along its top.
  ctx.lineWidth = 3;
  ctx.beginPath();
  traceRail(ctx, offset, RAIL_DEPTH);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  traceRail(ctx, offset, 0);
  ctx.stroke();
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 1.5;
  withAlpha(ctx, 0.35, () => {
    ctx.beginPath();
    traceRail(ctx, offset, -1.5);
    ctx.stroke();
  });

  // Bulbs along the lower edge, chasing forwards.
  ctx.fillStyle = colors.accent;
  const chase = Math.floor(time * 8);
  const firstBulb = Math.floor(offset / BULB_SPACING);
  for (let i = firstBulb; i * BULB_SPACING <= offset + WIDTH; i++) {
    const bulb = trackPoint(i * BULB_SPACING, RAIL_DEPTH + 4);
    const lit = (((i - chase) % 3) + 3) % 3 === 0;
    const bx = bulb.x - offset;
    if (lit) {
      withAlpha(ctx, 0.3, () => {
        ctx.beginPath();
        ctx.arc(bx, bulb.y, 6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    withAlpha(ctx, lit ? 1 : 0.35, () => {
      ctx.beginPath();
      ctx.arc(bx, bulb.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawFinish(ctx: CanvasRenderingContext2D, offset: number) {
  const { colors } = theme;
  const finishX = TRACK_LENGTH - offset;
  if (finishX > WIDTH + 40 || finishX < -40) return;
  ctx.fillStyle = colors.muted;
  ctx.fillRect(finishX - 2, GROUND_Y - 130, 4, BASE_Y - GROUND_Y + 130);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      ctx.fillStyle = (row + column) % 2 === 0 ? colors.stripeA : colors.stripeB;
      ctx.fillRect(finishX + 2 + column * 9, GROUND_Y - 130 + row * 9, 9, 9);
    }
  }
}

function drawRider(ctx: CanvasRenderingContext2D, x: number, cheering: boolean) {
  const { colors } = theme;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (cheering) {
    ctx.moveTo(x - 3, -30);
    ctx.lineTo(x - 8, -46);
    ctx.moveTo(x + 3, -30);
    ctx.lineTo(x + 8, -46);
  } else {
    ctx.moveTo(x - 3, -30);
    ctx.lineTo(x + 7, -25);
    ctx.moveTo(x + 3, -30);
    ctx.lineTo(x + 9, -27);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = colors.muted;
  ctx.fillRect(x - 4, -32, 8, 10);
  ctx.fillStyle = colors.text;
  ctx.beginPath();
  ctx.arc(x, -37, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  offset: number,
  x: number,
  speed: number,
  lead: boolean,
) {
  const { colors } = theme;
  const slope = trackSlope(x);
  const point = trackPoint(x);
  ctx.save();
  ctx.translate(point.x - offset, point.y);
  ctx.rotate(-Math.atan(slope));

  drawRider(ctx, -6, armsUp(slope, speed));

  // The body: a tub with a raised front on the lead car.
  ctx.fillStyle = colors.stripeA;
  ctx.beginPath();
  ctx.moveTo(-22, -8);
  ctx.lineTo(-22, -26);
  ctx.lineTo(10, -26);
  ctx.lineTo(lead ? 18 : 14, lead ? -34 : -28);
  ctx.lineTo(22, lead ? -34 : -28);
  ctx.lineTo(22, -12);
  ctx.quadraticCurveTo(22, -8, 18, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.stripeB;
  ctx.fillRect(-22, -19, 44, 4);
  ctx.fillStyle = colors.background;
  withAlpha(ctx, 0.35, () => ctx.fillRect(-22, -12, 44, 4));
  if (lead) {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(19, -24, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wheels on the running rail.
  for (const wheel of [-13, 13]) {
    ctx.fillStyle = colors.background;
    ctx.beginPath();
    ctx.arc(wheel, -4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.muted;
    ctx.beginPath();
    ctx.arc(wheel, -4, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTrain(ctx: CanvasRenderingContext2D, state: RollercoasterState, offset: number) {
  const { colors } = theme;
  const cars = trainPositions(state.x);

  // Couplings between neighbouring cars.
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i + 1 < cars.length; i++) {
    const front = trackPoint(cars[i], -9);
    const back = trackPoint(cars[i + 1], -9);
    ctx.moveTo(front.x - offset, front.y);
    ctx.lineTo(back.x - offset, back.y);
  }
  ctx.stroke();

  if (state.boosting) {
    // The launch motor lights up the rails under the train...
    ctx.fillStyle = colors.accent;
    for (const x of cars) {
      const glow = trackPoint(x, RAIL_DEPTH / 2);
      withAlpha(ctx, 0.2, () => {
        ctx.beginPath();
        ctx.arc(glow.x - offset, glow.y, 18, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // ...and a flame pushes from the back of the last car.
    const last = cars[cars.length - 1];
    const tail = trackPoint(last);
    const flicker = 6 * Math.random();
    ctx.save();
    ctx.translate(tail.x - offset, tail.y);
    ctx.rotate(-Math.atan(trackSlope(last)));
    ctx.fillStyle = colors.danger;
    ctx.beginPath();
    ctx.moveTo(-22, -24);
    ctx.lineTo(-48 - flicker, -17);
    ctx.lineTo(-22, -10);
    ctx.fill();
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(-22, -21);
    ctx.lineTo(-38 - flicker / 2, -17);
    ctx.lineTo(-22, -13);
    ctx.fill();
    ctx.restore();
  }

  // Back to front, so each car overlaps the one behind it.
  for (let i = cars.length - 1; i >= 0; i--) {
    drawCar(ctx, offset, cars[i], state.speed, i === 0);
  }
}

function drawHud(ctx: CanvasRenderingContext2D, state: RollercoasterState) {
  const { colors } = theme;

  // A panel behind the score so the stars and skyline don't get in the way.
  ctx.fillStyle = colors.background;
  withAlpha(ctx, 0.7, () => {
    ctx.fillRect(8, 8, 150, 60);
    ctx.fillRect(WIDTH - 252, 8, 244, 56);
  });

  // Speed gauge: the bar turns red past the safe crest speed.
  const gaugeWidth = 220;
  const fill = Math.min(state.speed / (MAX_CREST_SPEED * 1.5), 1);
  ctx.fillStyle = colors.surface;
  ctx.fillRect(WIDTH - gaugeWidth - 16, 16, gaugeWidth, 18);
  ctx.fillStyle = state.speed > MAX_CREST_SPEED ? colors.danger : colors.accent;
  ctx.fillRect(WIDTH - gaugeWidth - 16, 16, gaugeWidth * fill, 18);
  ctx.fillStyle = colors.text;
  const safeX = WIDTH - gaugeWidth - 16 + gaugeWidth / 1.5;
  ctx.fillRect(safeX - 1, 12, 2, 26);

  ctx.fillStyle = colors.text;
  ctx.font = canvasFont('body', 'bold');
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 16, 32);
  ctx.fillText(`Hill ${Math.min(state.crests + 1, HILLS.length)}/${HILLS.length}`, 16, 58);
  ctx.textAlign = 'right';
  ctx.font = canvasFont('small');
  ctx.fillText(`${Math.round(state.speed)} px/s`, WIDTH - 16, 54);

  if (state.phase === 'over') {
    const headline = {
      finished: `You made it! You scored ${state.score}`,
      derailed: `Too fast! Off the rails with ${state.score}`,
      stalled: `Stalled! You scored ${state.score}`,
    }[state.outcome ?? 'finished'];
    ctx.fillStyle = colors.background;
    withAlpha(ctx, 0.8, () => ctx.fillRect(0, 0, WIDTH, HEIGHT));
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = canvasFont('title', 'bold');
    ctx.fillText(headline, WIDTH / 2, HEIGHT / 2);
    ctx.fillStyle = colors.text;
    ctx.font = canvasFont('body');
    ctx.fillText('Click to ride again', WIDTH / 2, HEIGHT / 2 + 40);
  }
}

/** Draws one frame. `time` is in seconds and only drives the twinkling and chasing lights. */
function draw(ctx: CanvasRenderingContext2D, state: RollercoasterState, time: number) {
  const offset = state.x - CAR_SCREEN_X;
  drawSky(ctx, offset, time);
  drawStructure(ctx, offset);
  drawGround(ctx, offset);
  drawFinish(ctx, offset);
  drawTrack(ctx, offset, time);
  drawTrain(ctx, state, offset);
  drawHud(ctx, state);
}

export const rollercoaster: CarnivalGame = {
  id: 'rollercoaster',
  name: 'Rollercoaster',
  description:
    'Hold to boost over the hills. Faster crests score more, but too fast and you fly off.',

  start(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    let state = createState();
    let scoreRecorded = false;

    const onDown = () => {
      if (state.phase === 'over') {
        state = createState();
        scoreRecorded = false;
      }
      setBoost(state, true);
    };
    const onUp = () => setBoost(state, false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (!event.repeat) onDown();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') onUp();
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // A release in another window never reaches this one, so let go on blur.
    window.addEventListener('blur', onUp);

    let frame = 0;
    let last = performance.now();
    const loop = (time: number) => {
      // Cap the step so a background tab doesn't teleport the car.
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      step(state, dt);
      if (state.phase === 'over' && !scoreRecorded) {
        recordScore(rollercoaster.id, state.score);
        scoreRecorded = true;
      }
      draw(ctx, state, time / 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onUp);
    };
  },
};

export default rollercoaster;
