import { describe, expect, it } from 'vitest';
import {
  FINISH_BONUS,
  HILL_LENGTH,
  HILLS,
  MAX_CREST_SPEED,
  START_SPEED,
  TRACK_LENGTH,
  createState,
  scoreForCrest,
  setBoost,
  step,
  trackHeight,
  trackSlope,
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
