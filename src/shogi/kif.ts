import { generateLegalMoves } from './moveGen';
import { HIRATE_SFEN, Position } from './position';
import { CSA_PIECE_CODES, FULLWIDTH_DIGITS, KANJI_DIGITS, PIECE_KANJI } from './notation';
import type { Color, Move, PieceType, Square } from './types';
import { squareToUsi } from './types';
import type { ParsedGame } from './parser';

interface MoveToken {
  isSame: boolean;
  file: number | null;
  rank: number | null;
  type: PieceType;
  promotedPiece: boolean;
  promote: boolean;
  declinePromotion: boolean;
  isDrop: boolean;
  origin: Square | null;
  disambig: string;
}

function parseDestDigit(str: string, i: number): { value: number; next: number } | null {
  const ch = str[i];
  if (ch in FULLWIDTH_DIGITS) return { value: FULLWIDTH_DIGITS[ch], next: i + 1 };
  if (/[1-9]/.test(ch)) return { value: parseInt(ch, 10), next: i + 1 };
  return null;
}

function parseRankDigit(str: string, i: number): { value: number; next: number } | null {
  const ch = str[i];
  if (ch in KANJI_DIGITS) return { value: KANJI_DIGITS[ch], next: i + 1 };
  if (/[1-9]/.test(ch)) return { value: parseInt(ch, 10), next: i + 1 };
  return null;
}

function stripAnnotations(line: string): string {
  // Remove trailing elapsed-time annotations like "( 0:03/00:00:03)" but keep
  // a leading origin marker like "(77)".
  return line.replace(/\(\s*\d+:\d+[^)]*\)/g, '').trim();
}

/** Parses a single move's textual token (without leading move number / trailing comment). */
function parseMoveToken(raw: string): MoveToken | null {
  let s = raw.trim();
  if (!s) return null;

  let origin: Square | null = null;
  const originMatch = s.match(/\((\d)(\d)\)/);
  if (originMatch) {
    origin = { file: parseInt(originMatch[1], 10), rank: parseInt(originMatch[2], 10) };
    s = s.slice(0, originMatch.index).trim();
  }

  s = s.replace(/[\s　]+/g, '');

  let isSame = false;
  if (s.startsWith('同')) {
    isSame = true;
    s = s.slice(1);
  }

  let file: number | null = null;
  let rank: number | null = null;
  if (!isSame) {
    const d1 = parseDestDigit(s, 0);
    if (!d1) return null;
    const d2 = parseRankDigit(s, d1.next);
    if (!d2) return null;
    file = d1.value;
    rank = d2.value;
    s = s.slice(d2.next);
  }

  const pieceEntry = PIECE_KANJI.find((p) => s.startsWith(p.token));
  if (!pieceEntry) return null;
  s = s.slice(pieceEntry.token.length);

  let declinePromotion = false;
  let promote = false;
  let isDrop = false;
  let disambig = '';

  if (s.startsWith('不成')) {
    declinePromotion = true;
    s = s.slice(2);
  } else if (s.startsWith('成')) {
    promote = true;
    s = s.slice(1);
  }
  if (s.startsWith('打')) {
    isDrop = true;
    s = s.slice(1);
  }
  for (const ch of s) {
    if ('左右上下寄引直'.includes(ch)) disambig += ch;
  }

  return {
    isSame,
    file,
    rank,
    type: pieceEntry.type,
    promotedPiece: pieceEntry.promoted,
    promote,
    declinePromotion,
    isDrop,
    origin,
    disambig,
  };
}

function disambiguate(candidates: Move[], color: Color, disambig: string): Move[] {
  let result = candidates;
  const narrow = (pred: (m: Move) => boolean) => {
    const next = result.filter(pred);
    if (next.length > 0) result = next;
  };
  if (disambig.includes('右')) {
    narrow((m) => (color === 'b' ? m.from!.file < m.to.file || m.from!.file <= m.to.file : true));
  }
  if (result.length > 1 && (disambig.includes('左') || disambig.includes('右'))) {
    const wantSmallerFile =
      (disambig.includes('右') && color === 'b') || (disambig.includes('左') && color === 'w');
    const files = result.map((m) => m.from!.file);
    const target = wantSmallerFile ? Math.min(...files) : Math.max(...files);
    result = result.filter((m) => m.from!.file === target);
  }
  if (result.length > 1 && disambig.includes('直')) {
    narrow((m) => m.from!.file === m.to.file);
  }
  if (result.length > 1 && disambig.includes('上')) {
    narrow((m) => (color === 'b' ? m.to.rank < m.from!.rank : m.to.rank > m.from!.rank));
  }
  if (result.length > 1 && disambig.includes('寄')) {
    narrow((m) => m.to.rank === m.from!.rank);
  }
  if (result.length > 1 && disambig.includes('引')) {
    narrow((m) => (color === 'b' ? m.to.rank > m.from!.rank : m.to.rank < m.from!.rank));
  }
  return result;
}

function resolveToken(pos: Position, token: MoveToken, lastDest: Square | null): string {
  const color = pos.turn;
  const dest: Square = token.isSame
    ? lastDest ?? { file: 5, rank: 5 }
    : { file: token.file!, rank: token.rank! };

  if (token.isDrop) {
    return `${token.type}*${squareToUsi(dest)}`;
  }
  if (token.origin) {
    const promote = token.promote && !token.declinePromotion;
    return `${squareToUsi(token.origin)}${squareToUsi(dest)}${promote ? '+' : ''}`;
  }
  // KI2-style: no explicit origin, disambiguate using legal move generation.
  const legal = generateLegalMoves(pos, color).filter(
    (m) => m.from && m.piece === token.type && m.to.file === dest.file && m.to.rank === dest.rank,
  );
  let promoteWanted = token.promote && !token.declinePromotion;
  let candidates = legal.filter((m) => m.promote === promoteWanted);
  if (candidates.length === 0) candidates = legal;
  if (candidates.length === 0) {
    throw new Error(`Coup illégal ou non reconnu : impossible de résoudre le coup vers ${dest.file}${dest.rank}`);
  }
  const narrowed = disambiguate(candidates, color, token.disambig);
  const chosen = narrowed[0] ?? candidates[0];
  return `${squareToUsi(chosen.from!)}${squareToUsi(chosen.to)}${chosen.promote ? '+' : ''}`;
}

const HANDICAP_SFEN: Record<string, string> = {
  平手: HIRATE_SFEN,
  香落ち: 'lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  角落ち: 'lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  飛車落ち: 'lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  飛香落ち: 'lnsgkgsn1/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  二枚落ち: 'lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  四枚落ち: '1nsgkgsn1/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  六枚落ち: '2sgkgs2/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  八枚落ち: '3gkg3/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
};

export function isKifLike(text: string): boolean {
  return (
    /手数|手合割|先手|後手|下手|上手/.test(text) ||
    /^\s*\d+\s+[^\s]/m.test(text) ||
    text.includes('▲') ||
    text.includes('△')
  );
}

export function parseKif(text: string): ParsedGame {
  const lines = text.split(/\r?\n/);
  let startSfen = HIRATE_SFEN;
  let black = '';
  let white = '';

  const bodyLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*') || line.startsWith("'")) continue;
    const handicapMatch = line.match(/^手合割[：:]\s*(.+)$/);
    if (handicapMatch) {
      const name = handicapMatch[1].trim();
      if (HANDICAP_SFEN[name]) startSfen = HANDICAP_SFEN[name];
      continue;
    }
    const blackMatch = line.match(/^(先手|下手)[：:]\s*(.+)$/);
    if (blackMatch) {
      black = blackMatch[2].trim();
      continue;
    }
    const whiteMatch = line.match(/^(後手|上手)[：:]\s*(.+)$/);
    if (whiteMatch) {
      white = whiteMatch[2].trim();
      continue;
    }
    if (/^[^\s：:]+[：:]/.test(line) && !/^\d/.test(line) && !line.includes('▲') && !line.includes('△')) {
      // Other header line (event, date, etc.) — ignore.
      continue;
    }
    bodyLines.push(line);
  }

  const moveTexts: string[] = [];
  for (const line of bodyLines) {
    if (line.includes('▲') || line.includes('△')) {
      const parts = line.split(/[▲△]/).filter((p) => p.trim());
      moveTexts.push(...parts);
      continue;
    }
    const numbered = line.match(/^(\d+)\s+(.+)$/);
    if (numbered) {
      const rest = stripAnnotations(numbered[2]);
      if (/投了|中断|反則|千日手|持将棋|入玉|切れ負け|不戦勝|不戦敗|詰み/.test(rest)) continue;
      moveTexts.push(rest);
    }
  }

  const pos = Position.fromSfen(startSfen);
  const moves: string[] = [];
  let lastDest: Square | null = null;

  for (const text of moveTexts) {
    const token = parseMoveToken(text);
    if (!token) continue;
    const usi = resolveToken(pos, token, lastDest);
    moves.push(usi);
    pos.applyUsiMove(usi);
    lastDest = token.isSame ? lastDest : { file: token.file!, rank: token.rank! };
  }

  return { format: 'kif', startSfen, moves, black, white };
}

export function isCsaLike(text: string): boolean {
  return /^[+-]\d{4}[A-Z]{2}\s*$/m.test(text) || /^PI\b/m.test(text) || /^V2/m.test(text);
}

export function parseCsa(text: string): ParsedGame {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const startSfen = HIRATE_SFEN;
  let black = '';
  let white = '';
  const moves: string[] = [];
  const pos = Position.fromSfen(startSfen);

  for (const line of lines) {
    if (line.startsWith('N+')) black = line.slice(2).trim();
    else if (line.startsWith('N-')) white = line.slice(2).trim();
    const moveMatch = line.match(/^[+-](\d{2})(\d{2})([A-Z]{2})/);
    if (!moveMatch) continue;
    const [, fromStr, toStr, code] = moveMatch;
    const piece = CSA_PIECE_CODES[code];
    if (!piece) continue;
    const dest = squareToUsi({ file: parseInt(toStr[0], 10), rank: parseInt(toStr[1], 10) });
    let usi: string;
    if (fromStr === '00') {
      usi = `${piece.type}*${dest}`;
    } else {
      const fromSquare: Square = { file: parseInt(fromStr[0], 10), rank: parseInt(fromStr[1], 10) };
      const before = pos.pieceAt(fromSquare);
      const needsPromote = piece.promoted && !(before && before.promoted);
      usi = `${squareToUsi(fromSquare)}${dest}${needsPromote ? '+' : ''}`;
    }
    moves.push(usi);
    pos.applyUsiMove(usi);
  }

  return { format: 'csa', startSfen, moves, black, white };
}
