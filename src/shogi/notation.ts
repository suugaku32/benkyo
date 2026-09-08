import type { Position } from './position';
import type { PieceType, Square } from './types';
import { usiToSquare } from './types';

export const FULLWIDTH_DIGITS: Record<string, number> = {
  '０': 0,
  '１': 1,
  '２': 2,
  '３': 3,
  '４': 4,
  '５': 5,
  '６': 6,
  '７': 7,
  '８': 8,
  '９': 9,
};

export const KANJI_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Piece kanji tokens as they appear in KIF/KI2, longest tokens first for greedy matching. */
export const PIECE_KANJI: { token: string; type: PieceType; promoted: boolean }[] = [
  { token: '成香', type: 'L', promoted: true },
  { token: '成桂', type: 'N', promoted: true },
  { token: '成銀', type: 'S', promoted: true },
  { token: '歩', type: 'P', promoted: false },
  { token: '香', type: 'L', promoted: false },
  { token: '桂', type: 'N', promoted: false },
  { token: '銀', type: 'S', promoted: false },
  { token: '金', type: 'G', promoted: false },
  { token: '角', type: 'B', promoted: false },
  { token: '飛', type: 'R', promoted: false },
  { token: '王', type: 'K', promoted: false },
  { token: '玉', type: 'K', promoted: false },
  { token: 'と', type: 'P', promoted: true },
  { token: '馬', type: 'B', promoted: true },
  { token: '龍', type: 'R', promoted: true },
  { token: '竜', type: 'R', promoted: true },
  // Compact promoted glyphs, used by some kifu files and by the board display.
  { token: '杏', type: 'L', promoted: true },
  { token: '圭', type: 'N', promoted: true },
  { token: '全', type: 'S', promoted: true },
];

/**
 * Compact single-glyph kanji for board display (杏/圭/全 for promoted
 * lance/knight/silver — same convention as the Tsume app).
 */
export function pieceGlyph(type: PieceType, promoted: boolean): string {
  if (promoted) {
    switch (type) {
      case 'L':
        return '杏';
      case 'N':
        return '圭';
      case 'S':
        return '全';
      default:
        break;
    }
  }
  return pieceKanji(type, promoted);
}

/** Kanji as written in KIF notation (成香/成桂/成銀 spelled out). */
export function pieceKanji(type: PieceType, promoted: boolean): string {
  if (promoted) {
    switch (type) {
      case 'P':
        return 'と';
      case 'L':
        return '成香';
      case 'N':
        return '成桂';
      case 'S':
        return '成銀';
      case 'B':
        return '馬';
      case 'R':
        return '龍';
      default:
        break;
    }
  }
  switch (type) {
    case 'P':
      return '歩';
    case 'L':
      return '香';
    case 'N':
      return '桂';
    case 'S':
      return '銀';
    case 'G':
      return '金';
    case 'B':
      return '角';
    case 'R':
      return '飛';
    case 'K':
      return '玉';
    default:
      return '?';
  }
}

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function squareToKanji(file: number, rank: number): string {
  return `${file}${RANK_KANJI[rank - 1]}`;
}

/** Formats a USI move as KIF-style Japanese notation, given the position *before* the move. */
export function formatUsiMoveAsKif(pos: Position, usi: string, previousTo: Square | null): string {
  const isDrop = usi[1] === '*';
  const toSq = usiToSquare(usi.slice(2, 4));
  const sameSquareText = previousTo && previousTo.file === toSq.file && previousTo.rank === toSq.rank;
  const destText = sameSquareText ? '同' : squareToKanji(toSq.file, toSq.rank);

  if (isDrop) {
    const type = usi[0] as PieceType;
    return `${destText}${pieceKanji(type, false)}打`;
  }

  const fromSq = usiToSquare(usi.slice(0, 2));
  const piece = pos.pieceAt(fromSq);
  const type = piece?.type ?? 'P';
  const promoted = piece?.promoted ?? false;
  const promotes = usi.endsWith('+');
  return `${destText}${pieceKanji(type, promoted)}${promotes ? '成' : ''}`;
}

export const CSA_PIECE_CODES: Record<string, { type: PieceType; promoted: boolean }> = {
  FU: { type: 'P', promoted: false },
  KY: { type: 'L', promoted: false },
  KE: { type: 'N', promoted: false },
  GI: { type: 'S', promoted: false },
  KI: { type: 'G', promoted: false },
  KA: { type: 'B', promoted: false },
  HI: { type: 'R', promoted: false },
  OU: { type: 'K', promoted: false },
  TO: { type: 'P', promoted: true },
  NY: { type: 'L', promoted: true },
  NK: { type: 'N', promoted: true },
  NG: { type: 'S', promoted: true },
  UM: { type: 'B', promoted: true },
  RY: { type: 'R', promoted: true },
};
