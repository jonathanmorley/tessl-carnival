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
  /** Distance along the track, in pixels. */
  x: number;
  /** Pixels per second along the track. */
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

function draw(ctx: CanvasRenderingContext2D, state: RollercoasterState) {
  const { colors } = theme;
  const offset = state.x - CAR_SCREEN_X;
  const screenY = (x: number) => GROUND_Y - trackHeight(x);

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Supports under the track, every 40 px of track.
  ctx.strokeStyle = colors.surface;
  ctx.lineWidth = 4;
  const firstSupport = Math.ceil(offset / 40) * 40;
  for (let x = firstSupport; x < offset + WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x - offset, screenY(x));
    ctx.lineTo(x - offset, GROUND_Y + 20);
    ctx.stroke();
  }

  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, GROUND_Y + 20, WIDTH, HEIGHT - GROUND_Y - 20);

  // The finish line.
  const finishX = TRACK_LENGTH - offset;
  if (finishX < WIDTH) {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? colors.stripeA : colors.stripeB;
      ctx.fillRect(finishX - 4, GROUND_Y - 120 + i * 15, 8, 15);
    }
  }

  // The rails.
  ctx.strokeStyle = colors.wood;
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let sx = 0; sx <= WIDTH; sx += 4) {
    const y = screenY(sx + offset);
    if (sx === 0) ctx.moveTo(sx, y);
    else ctx.lineTo(sx, y);
  }
  ctx.stroke();

  // The car, tilted with the track.
  const carY = screenY(state.x);
  ctx.save();
  ctx.translate(CAR_SCREEN_X, carY);
  ctx.rotate(-Math.atan(trackSlope(state.x)));
  ctx.fillStyle = colors.stripeA;
  ctx.fillRect(-26, -28, 52, 22);
  ctx.fillStyle = colors.stripeB;
  ctx.fillRect(-26, -20, 52, 4);
  ctx.fillStyle = colors.text;
  for (const wheel of [-16, 16]) {
    ctx.beginPath();
    ctx.arc(wheel, -5, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (state.boosting) {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(-26, -24);
    ctx.lineTo(-44, -17);
    ctx.lineTo(-26, -10);
    ctx.fill();
  }
  ctx.restore();

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
    ctx.globalAlpha = 0.8;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = canvasFont('title', 'bold');
    ctx.fillText(headline, WIDTH / 2, HEIGHT / 2);
    ctx.fillStyle = colors.text;
    ctx.font = canvasFont('body');
    ctx.fillText('Click to ride again', WIDTH / 2, HEIGHT / 2 + 40);
  }
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
      } else {
        setBoost(state, true);
      }
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
      draw(ctx, state);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  },
};

export default rollercoaster;
