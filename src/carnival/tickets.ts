import {
  bestScore,
  browserStorage,
  memoryStorage,
  recordBoardScore,
  type ScoreEntry,
  type ScoreStorage,
} from './scores';

/**
 * Tickets, prizes and the daily challenge. Every round played earns tickets,
 * and the prize counter on the midway swaps them for prizes. Like scores, they
 * live in the browser.
 */

export interface Prize {
  id: string;
  name: string;
  /** Tickets it costs. */
  cost: number;
}

/** What the prize counter sells, cheapest first. Each can be won once. */
export const PRIZES: readonly Prize[] = [
  { id: 'balloon', name: 'Balloon', cost: 3 },
  { id: 'pennant', name: 'Pennant', cost: 6 },
  { id: 'teddy', name: 'Teddy bear', cost: 12 },
  { id: 'crown', name: 'Golden crown', cost: 25 },
];

/** Tickets for finishing any round. */
export const TICKETS_PER_ROUND = 1;
/** Extra tickets for a game's first score, or for beating your best. */
export const NEW_BEST_BONUS = 3;
/** Extra tickets for meeting the daily challenge, once a day. */
export const CHALLENGE_BONUS = 5;

export interface Challenge {
  /** The local date it's for, as YYYY-MM-DD. */
  day: string;
  gameId: string;
  /** The score to reach. */
  target: number;
  done: boolean;
}

/** The tickets one round earned, and why. */
export interface Award {
  gameId: string;
  round: number;
  best: number;
  challenge: number;
  total: number;
}

interface Ledger {
  tickets: number;
  prizes: string[];
  challenge?: Challenge;
}

const STORAGE_KEY = 'tessl-carnival:tickets';

/** A timestamp's local date, as YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The day's challenge: one game, picked from the date so it stays put all
 * day, and a target just under your best there (any score, if you have none).
 */
export function pickChallenge(
  day: string,
  gameIds: readonly string[],
  best: (gameId: string) => number | undefined,
): Pick<Challenge, 'gameId' | 'target'> | undefined {
  if (gameIds.length === 0) return undefined;
  const ids = [...gameIds].sort();
  const gameId = ids[hash(day) % ids.length];
  const previous = best(gameId);
  return { gameId, target: previous === undefined ? 1 : Math.max(1, Math.ceil(previous * 0.9)) };
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Reads a stored ledger, keeping only the parts that make sense. */
function parseLedger(raw: string | null): Ledger {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '{}');
  } catch {
    return { tickets: 0, prizes: [] };
  }
  const value = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const known = new Set(PRIZES.map((p) => p.id));
  const prizes = Array.isArray(value.prizes)
    ? [...new Set(value.prizes.filter((p): p is string => typeof p === 'string' && known.has(p)))]
    : [];
  const c = value.challenge as Record<string, unknown> | undefined;
  const challenge =
    c &&
    typeof c.day === 'string' &&
    typeof c.gameId === 'string' &&
    isCount(c.target) &&
    typeof c.done === 'boolean'
      ? { day: c.day, gameId: c.gameId, target: c.target, done: c.done }
      : undefined;
  return { tickets: isCount(value.tickets) ? value.tickets : 0, prizes, challenge };
}

export type BuyResult = { ok: true } | { ok: false; reason: 'unknown' | 'owned' | 'short' };

export function createTicketBook(storage: ScoreStorage, now: () => number = Date.now) {
  let store = storage;
  let lastAward: Award | undefined;

  const load = () => parseLedger(store.getItem(STORAGE_KEY));
  const save = (ledger: Ledger) => {
    const value = JSON.stringify(ledger);
    try {
      store.setItem(STORAGE_KEY, value);
    } catch {
      // Storage refused the write: keep tickets for this page load only, so a
      // round still ends normally.
      store = memoryStorage();
      store.setItem(STORAGE_KEY, value);
    }
  };

  return {
    balance: (): number => load().tickets,
    /** The ids of the prizes won so far. */
    owned: (): string[] => load().prizes,

    buy(prizeId: string): BuyResult {
      const prize = PRIZES.find((p) => p.id === prizeId);
      if (!prize) return { ok: false, reason: 'unknown' };
      const ledger = load();
      if (ledger.prizes.includes(prizeId)) return { ok: false, reason: 'owned' };
      if (ledger.tickets < prize.cost) return { ok: false, reason: 'short' };
      save({
        ...ledger,
        tickets: ledger.tickets - prize.cost,
        prizes: [...ledger.prizes, prizeId],
      });
      return { ok: true };
    },

    /** Today's challenge among `gameIds`, set the first time it's asked for each day. */
    challenge(
      gameIds: readonly string[],
      best: (gameId: string) => number | undefined,
    ): Challenge | undefined {
      const ledger = load();
      const day = dayOf(now());
      const current = ledger.challenge;
      if (current && current.day === day && gameIds.includes(current.gameId)) return current;
      const picked = pickChallenge(day, gameIds, best);
      if (!picked) return undefined;
      const challenge = { day, ...picked, done: false };
      save({ ...ledger, challenge });
      return challenge;
    },

    /**
     * Pays out for a finished round. `previousBest` is the game's best before
     * this round, or undefined if it had none.
     */
    earn(gameId: string, score: number, previousBest: number | undefined): Award {
      const ledger = load();
      const best = previousBest === undefined || score > previousBest ? NEW_BEST_BONUS : 0;
      const c = ledger.challenge;
      const meets =
        c && !c.done && c.gameId === gameId && c.day === dayOf(now()) && score >= c.target;
      const award: Award = {
        gameId,
        round: TICKETS_PER_ROUND,
        best,
        challenge: meets ? CHALLENGE_BONUS : 0,
        total: TICKETS_PER_ROUND + best + (meets ? CHALLENGE_BONUS : 0),
      };
      save({
        ...ledger,
        tickets: ledger.tickets + award.total,
        challenge: meets && c ? { ...c, done: true } : c,
      });
      lastAward = award;
      return award;
    },

    /** The most recent round's award on this page load, if any. */
    lastAward: (): Award | undefined => lastAward,
  };
}

export const tickets = createTicketBook(browserStorage());

/**
 * Every game reports its final score through here, once, when a round ends.
 * It goes on the score board and pays out the round's tickets.
 */
export function recordScore(gameId: string, score: number): ScoreEntry {
  const previousBest = bestScore(gameId);
  const entry = recordBoardScore(gameId, score);
  tickets.earn(gameId, entry.score, previousBest);
  return entry;
}
