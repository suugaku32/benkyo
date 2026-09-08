import { Position } from './position';
import type { Color, Move, PieceType, Square } from './types';
import { otherColor, sameSquare, squareToUsi } from './types';

interface Step {
  df: number; // file delta
  dr: number; // rank delta, expressed for black (forward = -1); flipped for white
}

const STEP_MOVES: Partial<Record<PieceType, Step[]>> = {
  P: [{ df: 0, dr: -1 }],
  N: [
    { df: 1, dr: -2 },
    { df: -1, dr: -2 },
  ],
  S: [
    { df: 0, dr: -1 },
    { df: 1, dr: -1 },
    { df: -1, dr: -1 },
    { df: 1, dr: 1 },
    { df: -1, dr: 1 },
  ],
  G: [
    { df: 0, dr: -1 },
    { df: 1, dr: -1 },
    { df: -1, dr: -1 },
    { df: 1, dr: 0 },
    { df: -1, dr: 0 },
    { df: 0, dr: 1 },
  ],
  K: [
    { df: 0, dr: -1 },
    { df: 1, dr: -1 },
    { df: -1, dr: -1 },
    { df: 1, dr: 0 },
    { df: -1, dr: 0 },
    { df: 0, dr: 1 },
    { df: 1, dr: 1 },
    { df: -1, dr: 1 },
  ],
};

// Extra king-step directions added to sliding pieces when promoted.
const HORSE_EXTRA: Step[] = [
  { df: 0, dr: -1 },
  { df: 0, dr: 1 },
  { df: 1, dr: 0 },
  { df: -1, dr: 0 },
];
const DRAGON_EXTRA: Step[] = [
  { df: 1, dr: -1 },
  { df: -1, dr: -1 },
  { df: 1, dr: 1 },
  { df: -1, dr: 1 },
];

const SLIDE_DIRS: Partial<Record<PieceType, Step[]>> = {
  L: [{ df: 0, dr: -1 }],
  B: [
    { df: 1, dr: -1 },
    { df: -1, dr: -1 },
    { df: 1, dr: 1 },
    { df: -1, dr: 1 },
  ],
  R: [
    { df: 0, dr: -1 },
    { df: 0, dr: 1 },
    { df: 1, dr: 0 },
    { df: -1, dr: 0 },
  ],
};

function goldStepsFor(): Step[] {
  return STEP_MOVES.G!;
}

function stepsForPiece(type: PieceType, promoted: boolean): { steps: Step[]; slides: Step[] } {
  if (promoted && type !== 'K') {
    if (type === 'B') return { steps: HORSE_EXTRA, slides: SLIDE_DIRS.B! };
    if (type === 'R') return { steps: DRAGON_EXTRA, slides: SLIDE_DIRS.R! };
    // P, L, N, S promoted all move like gold
    return { steps: goldStepsFor(), slides: [] };
  }
  if (SLIDE_DIRS[type]) return { steps: [], slides: SLIDE_DIRS[type]! };
  return { steps: STEP_MOVES[type] ?? [], slides: [] };
}

function orient(step: Step, color: Color): Step {
  return color === 'b' ? step : { df: step.df, dr: -step.dr };
}

function inBounds(sq: Square): boolean {
  return sq.file >= 1 && sq.file <= 9 && sq.rank >= 1 && sq.rank <= 9;
}

function isPromotionZone(color: Color, rank: number): boolean {
  return color === 'b' ? rank <= 3 : rank >= 7;
}

function lastRank(color: Color): number {
  return color === 'b' ? 1 : 9;
}

/** Squares (of any piece belonging to `color`) attacking `target`, pseudo-legally. */
export function isSquareAttacked(pos: Position, target: Square, byColor: Color): boolean {
  for (let file = 1; file <= 9; file++) {
    for (let rank = 1; rank <= 9; rank++) {
      const piece = pos.pieceAt({ file, rank });
      if (!piece || piece.color !== byColor) continue;
      const { steps, slides } = stepsForPiece(piece.type, piece.promoted);
      for (const raw of steps) {
        const s = orient(raw, byColor);
        const to = { file: file + s.df, rank: rank + s.dr };
        if (inBounds(to) && sameSquare(to, target)) return true;
      }
      for (const raw of slides) {
        const s = orient(raw, byColor);
        let to = { file: file + s.df, rank: rank + s.dr };
        while (inBounds(to)) {
          if (sameSquare(to, target)) return true;
          if (pos.pieceAt(to)) break;
          to = { file: to.file + s.df, rank: to.rank + s.dr };
        }
      }
    }
  }
  return false;
}

function pseudoLegalBoardMoves(pos: Position, from: Square): Move[] {
  const piece = pos.pieceAt(from);
  if (!piece) return [];
  const moves: Move[] = [];
  const { steps, slides } = stepsForPiece(piece.type, piece.promoted);
  const addTarget = (to: Square) => {
    const occ = pos.pieceAt(to);
    if (occ && occ.color === piece.color) return false;
    const canPromote =
      !piece.promoted &&
      piece.type !== 'K' &&
      piece.type !== 'G' &&
      (isPromotionZone(piece.color, from.rank) || isPromotionZone(piece.color, to.rank));
    const forced =
      canPromote &&
      ((piece.type === 'P' && to.rank === lastRank(piece.color)) ||
        (piece.type === 'L' && to.rank === lastRank(piece.color)) ||
        (piece.type === 'N' &&
          (piece.color === 'b' ? to.rank <= 2 : to.rank >= 8)));
    if (!forced) {
      moves.push({
        from,
        to,
        piece: piece.type,
        promote: false,
        color: piece.color,
        capture: occ ? occ.type : null,
      });
    }
    if (canPromote) {
      moves.push({
        from,
        to,
        piece: piece.type,
        promote: true,
        color: piece.color,
        capture: occ ? occ.type : null,
      });
    }
    return !occ;
  };
  for (const raw of steps) {
    const s = orient(raw, piece.color);
    const to = { file: from.file + s.df, rank: from.rank + s.dr };
    if (inBounds(to)) addTarget(to);
  }
  for (const raw of slides) {
    const s = orient(raw, piece.color);
    let to = { file: from.file + s.df, rank: from.rank + s.dr };
    while (inBounds(to)) {
      const canContinue = addTarget(to);
      if (!canContinue) break;
      to = { file: to.file + s.df, rank: to.rank + s.dr };
    }
  }
  return moves;
}

function dropMoves(pos: Position, color: Color): Move[] {
  const moves: Move[] = [];
  const hand = pos.hands[color];
  (Object.keys(hand) as (keyof typeof hand)[]).forEach((type) => {
    if (hand[type] <= 0) return;
    for (let file = 1; file <= 9; file++) {
      // Nifu: can't drop pawn on a file that already has an unpromoted pawn of this color.
      if (type === 'P') {
        let hasPawn = false;
        for (let r = 1; r <= 9; r++) {
          const p = pos.pieceAt({ file, rank: r });
          if (p && p.color === color && p.type === 'P' && !p.promoted) hasPawn = true;
        }
        if (hasPawn) continue;
      }
      for (let rank = 1; rank <= 9; rank++) {
        if (pos.pieceAt({ file, rank })) continue;
        if (type === 'P' || type === 'L') {
          if (rank === lastRank(color)) continue;
        }
        if (type === 'N') {
          if (color === 'b' ? rank <= 2 : rank >= 8) continue;
        }
        moves.push({ from: null, to: { file, rank }, piece: type, promote: false, color });
      }
    }
  });
  return moves;
}

/** Fully legal moves (own king never left in check) for `color` in `pos`. */
export function generateLegalMoves(pos: Position, color: Color): Move[] {
  return legalMoves(pos, color, true);
}

/**
 * `enforceUchifuzume` n'est faux que pour l'appel récursif interne.
 *
 * 打ち歩詰め : on n'a pas le droit de mater en *droppant* un pion — le même mat
 * porté par un pion qui avance est parfaitement légal. Vérifier la règle demande
 * de savoir si l'adversaire serait mat, donc de générer ses coups ; sans ce
 * drapeau, cette génération revérifierait à son tour ses propres drops de pion
 * et la récursion ne s'arrêterait pas. Au second niveau, la question ne se pose
 * plus : on cherche seulement si une réponse existe.
 */
function legalMoves(pos: Position, color: Color, enforceUchifuzume: boolean): Move[] {
  const pseudo: Move[] = [];
  for (let file = 1; file <= 9; file++) {
    for (let rank = 1; rank <= 9; rank++) {
      const piece = pos.pieceAt({ file, rank });
      if (piece && piece.color === color) {
        pseudo.push(...pseudoLegalBoardMoves(pos, { file, rank }));
      }
    }
  }
  pseudo.push(...dropMoves(pos, color));

  const legal = pseudo.filter((m) => {
    // Capturing the enemy king is never a move we offer, and applying it would be
    // rejected outright — that shape only appears when the opponent already left
    // their king en prise, i.e. the position itself is illegal.
    if (m.capture === 'K') return false;
    const clone = pos.clone();
    clone.turn = color;
    try {
      clone.applyUsiMove(moveToUsi(m));
    } catch {
      return false;
    }
    const king = clone.findKing(color);
    if (!king) return true;
    return !isSquareAttacked(clone, king, otherColor(color));
  });

  if (!enforceUchifuzume) return legal;

  return legal.filter((m) => {
    if (m.from || m.piece !== 'P') return true;
    const after = pos.clone();
    after.turn = color;
    try {
      after.applyUsiMove(moveToUsi(m));
    } catch {
      return false;
    }
    const opponent = otherColor(color);
    // Un drop de pion qui ne donne pas échec ne peut pas mater : rien à vérifier.
    if (!isKingCapturable(after, opponent)) return true;
    // Échec : le coup n'est interdit que s'il est mat.
    return legalMoves(after, opponent, false).length > 0;
  });
}

/** True when `color` has left their king capturable — an illegal position. */
export function isKingCapturable(pos: Position, color: Color): boolean {
  const king = pos.findKing(color);
  if (!king) return false;
  return isSquareAttacked(pos, king, otherColor(color));
}

export function legalMovesFrom(pos: Position, from: Square): Move[] {
  const piece = pos.pieceAt(from);
  if (!piece) return [];
  return generateLegalMoves(pos, piece.color).filter((m) => m.from && sameSquare(m.from, from));
}

export function moveToUsi(m: Move): string {
  if (!m.from) {
    return `${m.piece}*${squareToUsi(m.to)}`;
  }
  return `${squareToUsi(m.from)}${squareToUsi(m.to)}${m.promote ? '+' : ''}`;
}
