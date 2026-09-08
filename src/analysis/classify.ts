export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const QUALITY_LABEL_FR: Record<MoveQuality, string> = {
  best: 'Meilleur coup',
  good: 'Bon coup',
  inaccuracy: 'Imprécision',
  mistake: 'Erreur',
  blunder: 'Gaffe',
};

export const QUALITY_COLOR: Record<MoveQuality, string> = {
  best: 'var(--status-good)',
  good: 'var(--status-good)',
  inaccuracy: 'var(--status-inaccuracy)',
  mistake: 'var(--status-mistake)',
  blunder: 'var(--status-blunder)',
};

const MATE_BASE_CP = 100000;

/** Converts an engine score (either cp or mate-in-N) into a single cp-like scale. */
export function scoreToCp(scoreCp: number | null, scoreMate: number | null): number {
  if (scoreMate !== null) {
    return scoreMate > 0 ? MATE_BASE_CP - scoreMate * 100 : -MATE_BASE_CP - scoreMate * 100;
  }
  return scoreCp ?? 0;
}

/** Lichess-style cp -> win% conversion, used to make loss thresholds robust across the whole game. */
export function cpToWinPercent(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

export function classifyLoss(winPercentDrop: number): MoveQuality {
  if (winPercentDrop >= 20) return 'blunder';
  if (winPercentDrop >= 10) return 'mistake';
  if (winPercentDrop >= 5) return 'inaccuracy';
  if (winPercentDrop >= 2) return 'good';
  return 'best';
}
