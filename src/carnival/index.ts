export { createRegistry, type CarnivalGame } from './registry';
export { bestScore, topScores, createScoreBoard, type ScoreEntry } from './scores';
export {
  recordScore,
  tickets,
  createTicketBook,
  pickChallenge,
  dayOf,
  PRIZES,
  type Prize,
  type Challenge,
  type Award,
  type BuyResult,
} from './tickets';
export { prizeFor, type PrizeTier } from './prizes';
export { theme, canvasFont, applyTheme } from './theme';
