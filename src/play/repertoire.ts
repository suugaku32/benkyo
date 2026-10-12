import type { Color } from '../shogi/types';
import { treeKey } from './tree';
import type { OpeningTree } from './tree';

/**
 * L'entraînement aux ouvertures : on joue ses coups, l'adversaire répond avec
 * ce que les humains jouent, et on vérifie à chaque coup qu'il appartient à la
 * théorie du livre (voir `tree.ts`).
 *
 * - `wide` : tout coup joué dans au moins 3 % des parties du livre.
 * - `standard` : au moins 10 %.
 * - `strict` : seulement le coup le plus joué.
 */
export type Strictness = 'wide' | 'standard' | 'strict';

export const STRICTNESS: Record<Strictness, { label: string; description: string; minShare: number }> = {
  wide: { label: 'Large', description: 'Tout coup joué dans au moins 3 % des parties.', minShare: 0.03 },
  standard: { label: 'Standard', description: 'Les coups joués dans au moins 10 % des parties.', minShare: 0.1 },
  strict: { label: 'Strict', description: 'Seulement le coup le plus joué.', minShare: 1 },
};

/** Un coup du livre à une position donnée, avec ce qu'on en sait. */
export interface BookMove {
  move: string;
  /** Part des parties du livre, à cette position, où il a été joué (0 à 1). */
  share: number;
  /** Parties où il a été joué. */
  count: number;
  /** Part de points obtenus par le camp qui le joue (victoire 1, nulle ½). */
  winRate: number;
}

/** Les coups connus à cette position, du plus joué au moins joué. */
export function bookMoves(tree: OpeningTree, moves: readonly string[], mover: Color): BookMove[] {
  const entries = tree.nodes[treeKey(moves)] ?? [];
  const total = entries.reduce((sum, e) => sum + e[1], 0);
  return entries.map(([move, count, senteWins, goteWins]) => {
    const wins = mover === 'b' ? senteWins : goteWins;
    const draws = count - senteWins - goteWins;
    return { move, share: total ? count / total : 0, count, winRate: count ? (wins + 0.5 * draws) / count : 0 };
  });
}

/**
 * Le verdict sur un coup du joueur.
 * - `book` : un coup de la théorie, accepté.
 * - `rare` : le livre le connaît, mais trop rarement pour l'exigence choisie.
 * - `unknown` : le livre ne le connaît pas ; c'est au moteur de dire s'il est sain.
 */
export type Judgement =
  | { kind: 'book'; move: BookMove }
  | { kind: 'rare'; move: BookMove }
  | { kind: 'unknown' };

export function judgeMove(
  tree: OpeningTree,
  moves: readonly string[],
  usi: string,
  mover: Color,
  strictness: Strictness,
): Judgement {
  const known = bookMoves(tree, moves, mover);
  const entry = known.find((m) => m.move === usi);
  if (!entry) return { kind: 'unknown' };
  const accepted =
    strictness === 'strict' ? entry.move === known[0].move : entry.share >= STRICTNESS[strictness].minShare;
  return accepted ? { kind: 'book', move: entry } : { kind: 'rare', move: entry };
}

/** Les coups à proposer en indice : ceux que l'exigence choisie accepte (au moins un), les plus joués d'abord. */
export function acceptedMoves(
  tree: OpeningTree,
  moves: readonly string[],
  mover: Color,
  strictness: Strictness,
): BookMove[] {
  const known = bookMoves(tree, moves, mover);
  const ok = known.filter((m) => judgeMove(tree, moves, m.move, mover, strictness).kind === 'book');
  return ok.length ? ok : known.slice(0, 1);
}

/**
 * La réponse de l'adversaire : un tirage selon la fréquence (« variété »), ou
 * toujours le plus joué (« ligne principale »). `null` si la position n'est
 * plus dans le livre.
 */
export function opponentReply(
  tree: OpeningTree,
  moves: readonly string[],
  mover: Color,
  mode: 'variety' | 'main',
  rng: () => number = Math.random,
): string | null {
  const known = bookMoves(tree, moves, mover);
  if (known.length === 0) return null;
  if (mode === 'main') return known[0].move;
  let draw = rng();
  for (const m of known) {
    draw -= m.share;
    if (draw < 0) return m.move;
  }
  return known[known.length - 1].move;
}
