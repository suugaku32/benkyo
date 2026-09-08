import type { Color, Hand, Piece, PieceType, Square } from './types';
import { emptyHand, otherColor, squareToUsi, usiToSquare } from './types';

export const HIRATE_SFEN =
  'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

const SFEN_TYPE_LETTERS = 'PLNSGBRK';

/** Coordinate move ("7g7f", "7g7f+") or drop ("P*5e"). Anchored on purpose. */
const USI_MOVE_RE = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

function sfenLetterToType(letter: string): PieceType {
  return letter.toUpperCase() as PieceType;
}

/**
 * Board is stored as board[file-1][rank-1], file 1..9, rank 1..9 (a..i).
 */
export class Position {
  board: (Piece | null)[][];
  hands: Record<Color, Hand>;
  turn: Color;
  moveNumber: number;

  constructor() {
    this.board = Array.from({ length: 9 }, () => Array<Piece | null>(9).fill(null));
    this.hands = { b: emptyHand(), w: emptyHand() };
    this.turn = 'b';
    this.moveNumber = 1;
  }

  /**
   * Parses an SFEN. Rejects malformed input with a clear message rather than
   * letting it through — callers feed the result straight to the engine and to
   * React render, so a half-built Position must never escape from here.
   */
  static fromSfen(sfen: string): Position {
    const pos = new Position();
    const parts = sfen.trim().split(/\s+/);
    const [boardPart, turnPart, handPart, moveNumPart] = parts;

    if (!boardPart) {
      throw new Error('SFEN invalide : chaîne vide');
    }

    const rows = boardPart.split('/');
    if (rows.length !== 9) {
      throw new Error(`SFEN invalide : 9 rangées attendues, ${rows.length} trouvées`);
    }
    rows.forEach((row, rankIdx) => {
      const rank = rankIdx + 1;
      let file = 9;
      let i = 0;
      while (i < row.length) {
        const ch = row[i];
        if (/\d/.test(ch)) {
          let numStr = ch;
          if (i + 1 < row.length && /\d/.test(row[i + 1])) {
            numStr += row[i + 1];
            i++;
          }
          file -= parseInt(numStr, 10);
          i++;
          continue;
        }
        let promoted = false;
        let letter = ch;
        if (ch === '+') {
          promoted = true;
          i++;
          letter = row[i];
          if (letter === undefined) {
            throw new Error(`SFEN invalide : '+' en fin de rangée ${rank}`);
          }
        }
        if (!SFEN_TYPE_LETTERS.includes(letter.toUpperCase())) {
          throw new Error(`SFEN invalide : pièce inconnue '${letter}' rangée ${rank}`);
        }
        if (file < 1 || file > 9) {
          throw new Error(`SFEN invalide : rangée ${rank} déborde de l'échiquier`);
        }
        const color: Color = letter === letter.toUpperCase() ? 'b' : 'w';
        const type = sfenLetterToType(letter);
        pos.setPiece({ file, rank }, { color, type, promoted });
        file -= 1;
        i++;
      }
    });

    if (turnPart !== undefined && turnPart !== 'b' && turnPart !== 'w') {
      throw new Error(`SFEN invalide : trait '${turnPart}' (attendu 'b' ou 'w')`);
    }
    pos.turn = turnPart === 'w' ? 'w' : 'b';

    pos.hands = { b: emptyHand(), w: emptyHand() };
    if (handPart && handPart !== '-') {
      let i = 0;
      while (i < handPart.length) {
        let numStr = '';
        while (i < handPart.length && /\d/.test(handPart[i])) {
          numStr += handPart[i];
          i++;
        }
        const letter = handPart[i];
        if (letter === undefined) {
          throw new Error("SFEN invalide : nombre sans pièce dans les pièces en main");
        }
        i++;
        const upper = letter.toUpperCase();
        if (upper === 'K' || !SFEN_TYPE_LETTERS.includes(upper)) {
          throw new Error(`SFEN invalide : pièce en main inconnue '${letter}'`);
        }
        const count = numStr ? parseInt(numStr, 10) : 1;
        if (count > 18) {
          throw new Error(`SFEN invalide : ${count} exemplaires de '${letter}' en main`);
        }
        const color: Color = letter === upper ? 'b' : 'w';
        pos.hands[color][upper as Exclude<PieceType, 'K'>] = count;
      }
    }

    const moveNumber = moveNumPart ? parseInt(moveNumPart, 10) : 1;
    pos.moveNumber = Number.isFinite(moveNumber) && moveNumber > 0 ? moveNumber : 1;
    return pos;
  }

  clone(): Position {
    const p = new Position();
    p.board = this.board.map((col) => col.map((cell) => (cell ? { ...cell } : null)));
    p.hands = {
      b: { ...this.hands.b },
      w: { ...this.hands.w },
    };
    p.turn = this.turn;
    p.moveNumber = this.moveNumber;
    return p;
  }

  pieceAt(sq: Square): Piece | null {
    if (sq.file < 1 || sq.file > 9 || sq.rank < 1 || sq.rank > 9) return null;
    return this.board[sq.file - 1][sq.rank - 1];
  }

  setPiece(sq: Square, piece: Piece | null): void {
    this.board[sq.file - 1][sq.rank - 1] = piece;
  }

  toSfen(): string {
    const rows: string[] = [];
    for (let rank = 1; rank <= 9; rank++) {
      let row = '';
      let empties = 0;
      for (let file = 9; file >= 1; file--) {
        const piece = this.pieceAt({ file, rank });
        if (!piece) {
          empties++;
          continue;
        }
        if (empties > 0) {
          row += String(empties);
          empties = 0;
        }
        const letter = piece.color === 'b' ? piece.type : piece.type.toLowerCase();
        row += (piece.promoted ? '+' : '') + letter;
      }
      if (empties > 0) row += String(empties);
      rows.push(row);
    }
    const boardPart = rows.join('/');

    let handPart = '';
    for (const color of ['b', 'w'] as Color[]) {
      for (const letter of SFEN_TYPE_LETTERS) {
        if (letter === 'K') continue;
        const type = letter as Exclude<PieceType, 'K'>;
        const count = this.hands[color][type];
        if (count > 0) {
          if (count > 1) handPart += String(count);
          handPart += color === 'b' ? letter : letter.toLowerCase();
        }
      }
    }
    if (!handPart) handPart = '-';

    return `${boardPart} ${this.turn} ${handPart} ${this.moveNumber}`;
  }

  /** Apply a move given in USI coordinate form: "7g7f", "7g7f+", "P*5e". Mutates in place. */
  applyUsiMove(usi: string): { capture: PieceType | null } {
    if (!USI_MOVE_RE.test(usi)) {
      throw new Error(`Coup USI malformé : '${usi}'`);
    }
    let capture: PieceType | null = null;
    if (usi[1] === '*') {
      const type = usi[0] as Exclude<PieceType, 'K'>;
      const to = usiToSquare(usi.slice(2, 4));
      if (this.pieceAt(to)) {
        throw new Error(`Parachutage sur une case occupée : ${usi}`);
      }
      if (this.hands[this.turn][type] <= 0) {
        throw new Error(`Parachutage sans la pièce en main : ${usi}`);
      }
      this.setPiece(to, { color: this.turn, type, promoted: false });
      this.hands[this.turn][type] -= 1;
    } else {
      const from = usiToSquare(usi.slice(0, 2));
      const to = usiToSquare(usi.slice(2, 4));
      const promote = usi.endsWith('+');
      const piece = this.pieceAt(from);
      if (!piece) {
        throw new Error(`Aucune pièce en ${usi.slice(0, 2)} pour le coup ${usi}`);
      }
      if (piece.color !== this.turn) {
        throw new Error(`Le coup ${usi} déplace une pièce adverse`);
      }
      const captured = this.pieceAt(to);
      if (captured) {
        if (captured.color === this.turn) {
          throw new Error(`Le coup ${usi} capture une pièce alliée`);
        }
        if (captured.type === 'K') {
          throw new Error(`Le coup ${usi} capture le roi`);
        }
        capture = captured.type;
        this.hands[this.turn][captured.type as Exclude<PieceType, 'K'>] += 1;
      }
      this.setPiece(from, null);
      this.setPiece(to, {
        color: piece.color,
        type: piece.type,
        promoted: piece.promoted || promote,
      });
    }
    if (this.turn === 'w') this.moveNumber += 1;
    this.turn = otherColor(this.turn);
    return { capture };
  }

  findKing(color: Color): Square | null {
    for (let file = 1; file <= 9; file++) {
      for (let rank = 1; rank <= 9; rank++) {
        const p = this.pieceAt({ file, rank });
        if (p && p.type === 'K' && p.color === color) return { file, rank };
      }
    }
    return null;
  }
}

export { squareToUsi, usiToSquare };
