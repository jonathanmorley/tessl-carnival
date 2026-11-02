import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_BONUS,
  createTicketBook,
  dayOf,
  NEW_BEST_BONUS,
  pickChallenge,
  PRIZES,
  TICKETS_PER_ROUND,
} from './tickets';

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('tessl-carnival:tickets', initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const NOON = new Date(2026, 10, 2, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('earning tickets', () => {
  it('pays for every round, more for a first score or a new best', () => {
    const book = createTicketBook(memoryStorage(), () => NOON);
    expect(book.earn('water-cannon', 50, undefined).total).toBe(TICKETS_PER_ROUND + NEW_BEST_BONUS);
    expect(book.earn('water-cannon', 40, 50).total).toBe(TICKETS_PER_ROUND);
    // Matching your best isn't beating it.
    expect(book.earn('water-cannon', 50, 50).best).toBe(0);
    expect(book.earn('water-cannon', 51, 50).best).toBe(NEW_BEST_BONUS);
    expect(book.balance()).toBe(4 * TICKETS_PER_ROUND + 2 * NEW_BEST_BONUS);
    expect(book.lastAward()?.total).toBe(TICKETS_PER_ROUND + NEW_BEST_BONUS);
  });

  it('keeps tickets across page loads', () => {
    const storage = memoryStorage();
    createTicketBook(storage, () => NOON).earn('water-cannon', 10, 20);
    expect(createTicketBook(storage, () => NOON).balance()).toBe(TICKETS_PER_ROUND);
  });

  it('still ends a round when storage refuses to save', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const book = createTicketBook(storage, () => NOON);
    expect(() => book.earn('water-cannon', 10, undefined)).not.toThrow();
    expect(book.balance()).toBe(TICKETS_PER_ROUND + NEW_BEST_BONUS);
  });
});

describe('the prize counter', () => {
  const cheapest = PRIZES[0];

  it('swaps tickets for a prize, once each', () => {
    const book = createTicketBook(memoryStorage(JSON.stringify({ tickets: cheapest.cost * 2 })));
    expect(book.buy(cheapest.id)).toEqual({ ok: true });
    expect(book.balance()).toBe(cheapest.cost);
    expect(book.owned()).toEqual([cheapest.id]);
    expect(book.buy(cheapest.id)).toEqual({ ok: false, reason: 'owned' });
    expect(book.balance()).toBe(cheapest.cost);
  });

  it("won't sell what you can't afford, or what isn't on the shelf", () => {
    const book = createTicketBook(memoryStorage(JSON.stringify({ tickets: cheapest.cost - 1 })));
    expect(book.buy(cheapest.id)).toEqual({ ok: false, reason: 'short' });
    expect(book.buy('pony')).toEqual({ ok: false, reason: 'unknown' });
    expect(book.balance()).toBe(cheapest.cost - 1);
    expect(book.owned()).toEqual([]);
  });

  it('ignores stored nonsense rather than trusting it', () => {
    for (const raw of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ tickets: -5, prizes: 'teddy' }),
      JSON.stringify({ tickets: 2.5, prizes: ['teddy', 'teddy', 'pony', 7] }),
      JSON.stringify({ tickets: 3, challenge: { day: 1, gameId: 'x', target: 'big' } }),
    ]) {
      const book = createTicketBook(memoryStorage(raw));
      expect(Number.isInteger(book.balance()) && book.balance() >= 0).toBe(true);
      expect(book.owned().every((id) => PRIZES.some((p) => p.id === id))).toBe(true);
      expect(new Set(book.owned()).size).toBe(book.owned().length);
    }
    expect(
      createTicketBook(memoryStorage(JSON.stringify({ prizes: ['teddy', 'teddy'] }))).owned(),
    ).toEqual(['teddy']);
  });
});

describe('the daily challenge', () => {
  const games = ['water-cannon', 'rollercoaster', 'ring-toss'];

  it('picks the same game all day, whatever order the games come in', () => {
    const a = pickChallenge('2026-11-02', games, () => undefined);
    const b = pickChallenge('2026-11-02', [...games].reverse(), () => undefined);
    expect(a).toEqual(b);
    expect(games).toContain(a?.gameId);
    expect(pickChallenge('2026-11-02', [], () => undefined)).toBeUndefined();
  });

  it('sets a target just under your best, or any score without one', () => {
    expect(pickChallenge('2026-11-02', ['a'], () => 100)?.target).toBe(90);
    expect(pickChallenge('2026-11-02', ['a'], () => undefined)?.target).toBe(1);
    expect(pickChallenge('2026-11-02', ['a'], () => 0)?.target).toBe(1);
  });

  it("keeps the day's target even after your best moves", () => {
    let best = 100;
    const book = createTicketBook(memoryStorage(), () => NOON);
    const first = book.challenge(['a'], () => best);
    best = 500;
    expect(book.challenge(['a'], () => best)).toEqual(first);
  });

  it('pays the bonus once, only for its game, on its day', () => {
    let clock = NOON;
    const book = createTicketBook(memoryStorage(), () => clock);
    const challenge = book.challenge(['a'], () => 100)!;
    expect(book.earn('b', 1000, 2000).challenge).toBe(0);
    expect(book.earn('a', challenge.target - 1, 100).challenge).toBe(0);
    expect(book.earn('a', challenge.target, 100).challenge).toBe(CHALLENGE_BONUS);
    expect(book.challenge(['a'], () => 100)?.done).toBe(true);
    expect(book.earn('a', challenge.target, 100).challenge).toBe(0);

    // Tomorrow brings a fresh challenge, and yesterday's no longer pays.
    clock = NOON + DAY;
    expect(book.earn('a', 1000, 100).challenge).toBe(0);
    const next = book.challenge(['a'], () => 1000)!;
    expect(next.day).toBe(dayOf(clock));
    expect(next.done).toBe(false);
  });

  it('picks again when the challenge game leaves the midway', () => {
    const book = createTicketBook(memoryStorage(), () => NOON);
    expect(book.challenge(['gone'], () => undefined)?.gameId).toBe('gone');
    expect(book.challenge(['a'], () => undefined)?.gameId).toBe('a');
  });
});

describe('recordScore', () => {
  it('puts the score on the board and pays the round out', async () => {
    const { recordScore, tickets } = await import('./tickets');
    const { bestScore } = await import('./scores');
    const before = tickets.balance();
    recordScore('tickets-test-game', 42);
    expect(bestScore('tickets-test-game')).toBe(42);
    expect(tickets.balance()).toBe(before + TICKETS_PER_ROUND + NEW_BEST_BONUS);
    expect(tickets.lastAward()?.gameId).toBe('tickets-test-game');
    expect(() => recordScore('tickets-test-game', -1)).toThrow();
    expect(tickets.balance()).toBe(before + TICKETS_PER_ROUND + NEW_BEST_BONUS);
  });
});
