export type Color = 'b' | 'w';

// Unpromoted piece letters as used in SFEN (uppercase = black/sente, but we
// keep type letters uppercase here and track color separately).
export type PieceType = 'P' | 'L' | 'N' | 'S' | 'G' | 'B' | 'R' | 'K';

export interface Piece {
  color: Color;
  type: PieceType;
  promoted: boolean;
}

export interface Square {
  file: number; // 1..9
  rank: number; // 1..9 (a=1 .. i=9)
}

export interface Move {
  from: Square | null; // null = drop
  to: Square;
  piece: PieceType;
  promote: boolean;
  color: Color;
  capture?: PieceType | null;
}

export type Hand = Record<Exclude<PieceType, 'K'>, number>;

export const HAND_PIECE_ORDER: Exclude<PieceType, 'K'>[] = [
  'R',
  'B',
  'G',
  'S',
  'N',
  'L',
  'P',
];

export const PROMOTABLE: PieceType[] = ['P', 'L', 'N', 'S', 'B', 'R'];

export function emptyHand(): Hand {
  return { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 };
}

export function otherColor(c: Color): Color {
  return c === 'b' ? 'w' : 'b';
}

export function squareToUsi(sq: Square): string {
  return `${sq.file}${'abcdefghi'[sq.rank - 1]}`;
}

export function usiToSquare(s: string): Square {
  const file = parseInt(s[0], 10);
  const rank = 'abcdefghi'.indexOf(s[1]) + 1;
  return { file, rank };
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}
