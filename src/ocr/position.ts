import { Position } from '../shogi/position';
import type { Color, PieceType, Square } from '../shogi/types';
import type { CellReading } from './recognize';

/** En dessous de cette confiance (0 à 100), une lecture est à vérifier. */
export const DOUBTFUL_BELOW = 70;

export interface ReadPosition {
  position: Position;
  /** Les cases dont la lecture est peu sûre, à faire vérifier. */
  doubtful: Square[];
}

/**
 * Les cases lues, rangées de haut en bas et de gauche à droite comme sur
 * l'image, deviennent une position.
 *
 * Une pièce à l'endroit appartient au camp du bas, une pièce renversée à celui
 * du haut. Par défaut le camp du bas est Sente (plateau vu de Sente : la colonne
 * 9 à gauche, la rangée 1 en haut). `goteAtBottom` retourne le plateau d'un demi-tour.
 */
export function gridToPosition(
  grid: CellReading[][],
  options: { goteAtBottom: boolean; turn: Color },
): ReadPosition {
  const position = new Position();
  position.turn = options.turn;
  const doubtful: Square[] = [];
  const bottom: Color = options.goteAtBottom ? 'w' : 'b';
  const top: Color = options.goteAtBottom ? 'b' : 'w';
  grid.forEach((cells, row) => {
    cells.forEach((cell, col) => {
      if (cell.kind !== 'piece') return;
      const square: Square = options.goteAtBottom ? { file: col + 1, rank: 9 - row } : { file: 9 - col, rank: row + 1 };
      position.setPiece(square, { color: cell.upsideDown ? top : bottom, type: cell.glyph.type, promoted: cell.glyph.promoted });
      if (cell.confidence < DOUBTFUL_BELOW || cell.char === '?') doubtful.push(square);
    });
  });
  return { position, doubtful };
}

/** Les pièces d'un jeu complet, pour repérer une position impossible. */
const SET_SIZE: Record<PieceType, number> = { P: 18, L: 4, N: 4, S: 4, G: 4, B: 2, R: 2, K: 2 };

/** Ce qui cloche dans une position, en clair. Vide si elle est plausible. */
export function positionWarnings(position: Position): string[] {
  const out: string[] = [];
  const counts: Record<PieceType, number> = { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0, K: 0 };
  const kings: Record<Color, number> = { b: 0, w: 0 };
  const pawnFiles = new Set<string>();
  const doubledPawns = new Set<string>();
  for (let file = 1; file <= 9; file++) {
    for (let rank = 1; rank <= 9; rank++) {
      const piece = position.pieceAt({ file, rank });
      if (!piece) continue;
      counts[piece.type]++;
      if (piece.type === 'K') kings[piece.color]++;
      if (piece.type === 'P' && !piece.promoted) {
        const key = `${piece.color}${file}`;
        if (pawnFiles.has(key)) doubledPawns.add(`${file}`);
        pawnFiles.add(key);
      }
    }
  }
  for (const color of ['b', 'w'] as const) {
    for (const [type, n] of Object.entries(position.hands[color])) counts[type as PieceType] += n;
  }
  if (kings.b !== 1) out.push(kings.b === 0 ? 'Il manque le roi de Sente.' : 'Sente a plusieurs rois.');
  if (kings.w !== 1) out.push(kings.w === 0 ? 'Il manque le roi de Gote.' : 'Gote a plusieurs rois.');
  if (doubledPawns.size) out.push(`Deux pions du même camp dans la colonne ${[...doubledPawns].join(', ')} (nifu).`);
  for (const type of Object.keys(SET_SIZE) as PieceType[]) {
    if (counts[type] > SET_SIZE[type]) out.push(`Trop de pièces d'un même type : ${counts[type]} au lieu de ${SET_SIZE[type]} au plus.`);
  }
  return out;
}
