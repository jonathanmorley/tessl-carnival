import { describe, expect, it } from 'vitest';
import { theme } from '../../carnival';
import {
  ARMS_UP_SLOPE,
  ARMS_UP_SPEED,
  CAR_COUNT,
  CAR_GAP,
  FINISH_BONUS,
  HILL_LENGTH,
  HILLS,
  MAX_CREST_SPEED,
  START_SPEED,
  TRACK_LENGTH,
  armsUp,
  createState,
  parallaxShift,
  scoreForCrest,
  setBoost,
  starField,
  step,
  trackHeight,
  trackPoint,
  trackSlope,
  trailingX,
  trainPositions,
} from './game';

describe('rollercoaster', () => {
  it('starts at the bottom of the first hill with no score', () => {
    const state = createState();
    expect(state.x).toBe(0);
    expect(state.speed).toBe(START_SPEED);
    expect(state.score).toBe(0);
    expect(state.phase).toBe('riding');
  });

  it('peaks at each hill height halfway along the hill', () => {
    expect(trackHeight(0)).toBe(0);
    expect(trackHeight(HILL_LENGTH / 2)).toBeCloseTo(HILLS[0]);
    expect(trackHeight(HILL_LENGTH * 1.5)).toBeCloseTo(HILLS[1]);
    expect(trackSlope(HILL_LENGTH / 2)).toBeCloseTo(0);
    expect(trackHeight(TRACK_LENGTH + 10)).toBe(0);
  });

  it('scores 1 point per 10 px/s of crest speed', () => {
    expect(scoreForCrest(250)).toBe(25);
    expect(scoreForCrest(124)).toBe(12);
  });

  it('scores a crest taken at a safe speed', () => {
    const state = createState();
    state.x = HILL_LENGTH / 2 - 1;
    state.speed = 200;
    step(state, 0.01);
    expect(state.crests).toBe(1);
    expect(state.score).toBe(scoreForCrest(state.speed));
    expect(state.phase).toBe('riding');
  });

  it('derails when a crest is taken too fast, keeping the score so far', () => {
    const state = createState();
    state.x = HILL_LENGTH / 2 - 1;
    state.speed = MAX_CREST_SPEED + 50;
    state.score = 40;
    step(state, 0.01);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('derailed');
    expect(state.score).toBe(40);
  });

  it('stalls on the first hill without the launch motor', () => {
    const state = createState();
    step(state, 30);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('stalled');
    expect(state.score).toBe(0);
  });

  it('goes faster with the launch motor on', () => {
    const coasting = createState();
    const boosted = createState();
    setBoost(boosted, true);
    step(coasting, 0.2);
    step(boosted, 0.2);
    expect(boosted.speed).toBeGreaterThan(coasting.speed);
  });

  it('adds the finish bonus when the car reaches the end of the track', () => {
    const state = createState();
    state.x = TRACK_LENGTH - 1;
    state.crests = HILLS.length;
    state.speed = 100;
    step(state, 0.05);
    expect(state.phase).toBe('over');
    expect(state.outcome).toBe('finished');
    expect(state.score).toBe(FINISH_BONUS);
  });

  it('stops moving and ignores the motor once the ride is over', () => {
    const state = createState();
    state.phase = 'over';
    setBoost(state, true);
    step(state, 1);
    expect(state.boosting).toBe(false);
    expect(state.x).toBe(0);
  });
});

/** Length of track between `from` and `to`, measured along the curve. */
function arcLength(from: number, to: number): number {
  let length = 0;
  for (let x = from; x < to; x += 0.01) {
    length += Math.hypot(0.01, trackHeight(x + 0.01) - trackHeight(x));
  }
  return length;
}

describe('rollercoaster drawing maths', () => {
  it('puts depth 0 on the running rail and goes straight down on flat track', () => {
    const crest = trackPoint(HILL_LENGTH / 2);
    const flat = trackPoint(-100, 12);
    expect(crest.x).toBeCloseTo(HILL_LENGTH / 2);
    expect(trackPoint(-100).y - flat.y).toBeCloseTo(-12);
    expect(flat.x).toBeCloseTo(-100);
    // At the crest the track is level, so depth only moves the point down.
    expect(trackPoint(HILL_LENGTH / 2, 12).y - crest.y).toBeCloseTo(12);
  });

  it('measures depth square to the track on a slope', () => {
    const x = HILL_LENGTH / 4;
    const rail = trackPoint(x);
    const below = trackPoint(x, 10);
    expect(Math.hypot(below.x - rail.x, below.y - rail.y)).toBeCloseTo(10);
    // The offset is perpendicular to the track's direction (1, -slope) on screen.
    const along = below.x - rail.x - trackSlope(x) * (below.y - rail.y);
    expect(along).toBeCloseTo(0);
  });

  it('trails a car by the same distance along flat track', () => {
    expect(trailingX(-100, CAR_GAP)).toBeCloseTo(-100 - CAR_GAP);
    expect(trailingX(-100, 0)).toBe(-100);
  });

  it('trails a car by track distance, not horizontal distance, on a hill', () => {
    const lead = HILL_LENGTH * 4.25;
    const trail = trailingX(lead, CAR_GAP);
    expect(lead - trail).toBeLessThan(CAR_GAP);
    expect(arcLength(trail, lead)).toBeCloseTo(CAR_GAP, 0);
  });

  it('lines up the whole train behind the lead car', () => {
    const lead = HILL_LENGTH * 1.3;
    const cars = trainPositions(lead);
    expect(cars).toHaveLength(CAR_COUNT);
    expect(cars[0]).toBe(lead);
    for (let i = 1; i < cars.length; i++) {
      expect(cars[i]).toBeLessThan(cars[i - 1]);
      expect(cars[i]).toBeCloseTo(trailingX(cars[i - 1], CAR_GAP));
    }
  });

  it('puts the riders arms up on steep downhills and at high speed only', () => {
    expect(armsUp(ARMS_UP_SLOPE - 0.1, 100)).toBe(true);
    expect(armsUp(0, ARMS_UP_SPEED + 1)).toBe(true);
    expect(armsUp(0, ARMS_UP_SPEED)).toBe(false);
    expect(armsUp(ARMS_UP_SLOPE, 100)).toBe(false);
    expect(armsUp(1, 100)).toBe(false);
  });

  it('wraps the parallax shift into one period, going either way', () => {
    expect(parallaxShift(0, 0.25, 900)).toBe(0);
    expect(parallaxShift(400, 0.25, 900)).toBe(100);
    expect(parallaxShift(4000, 0.25, 900)).toBe(100);
    expect(parallaxShift(-400, 0.25, 900)).toBe(800);
  });

  it('scatters the same stars in the upper sky every time', () => {
    const stars = starField(30);
    expect(stars).toHaveLength(30);
    expect(starField(30)).toEqual(stars);
    for (const star of stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(theme.canvas.width);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(theme.canvas.height * 0.55);
    }
    expect(new Set(stars.map((star) => star.x)).size).toBe(30);
  });
});
