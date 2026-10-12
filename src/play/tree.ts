import type { Color } from '../shogi/types';

/**
 * Le livre « parties humaines » : pour chaque suite de coups depuis la position
 * initiale, les coups suivants réellement joués, avec combien de fois et avec
 * quels résultats. Il est construit par `scripts/build-opening-tree.ts` à partir
 * des parties des meilleurs joueurs de Lishogi, et chargé à la demande : le
 * fichier peut peser plusieurs mégaoctets, inutile de l'embarquer dans la page.
 */
export interface OpeningTree {
  meta: { source: string; games: number; players: number; minRating: number; depth: number; minCount: number; builtAt: string };
  /** Préfixe (coups USI séparés par des espaces) → [coup, parties, victoires Sente, victoires Gote][], du plus joué au moins joué. */
  nodes: Record<string, [string, number, number, number][]>;
}

let cached: Promise<OpeningTree> | null = null;

export function loadTree(): Promise<OpeningTree> {
  cached ??= import('./openingTree.json').then((m) => m.default as unknown as OpeningTree);
  return cached;
}

export const treeKey = (moves: readonly string[]): string => moves.join(' ');

export const isEmptyTree = (tree: OpeningTree): boolean => tree.meta.games === 0;

/** La suite de coups est-elle connue du livre ? */
export function inTree(tree: OpeningTree, moves: readonly string[]): boolean {
  return treeKey(moves) in tree.nodes;
}

/**
 * Le poids d'un coup : sa popularité, un peu relevée s'il gagne plus qu'il ne
 * perd pour le camp qui le joue. Un coup très joué reste très probable, mais
 * une ligne qui perd presque toujours l'est moins.
 */
export function weightOf(entry: [string, number, number, number], mover: Color): number {
  const [, n, senteWins, goteWins] = entry;
  const draws = n - senteWins - goteWins;
  const wins = mover === 'b' ? senteWins : goteWins;
  const rate = (wins + 0.5 * draws) / n;
  return n * (0.5 + rate);
}

/**
 * Jusqu'à `count` coups du livre, tirés au sort selon leur poids et sans
 * répétition, dans l'ordre où on les essaie : le premier est le tirage, les
 * suivants servent de recours si le moteur refuse le premier.
 */
export function pickTreeMoves(
  tree: OpeningTree,
  moves: readonly string[],
  mover: Color,
  rng: () => number = Math.random,
  count = 3,
): string[] {
  const entries = [...(tree.nodes[treeKey(moves)] ?? [])];
  const out: string[] = [];
  while (entries.length > 0 && out.length < count) {
    const weights = entries.map((e) => weightOf(e, mover));
    let draw = rng() * weights.reduce((s, w) => s + w, 0);
    let index = entries.length - 1;
    for (let i = 0; i < entries.length; i++) {
      draw -= weights[i];
      if (draw < 0) {
        index = i;
        break;
      }
    }
    out.push(entries[index][0]);
    entries.splice(index, 1);
  }
  return out;
}
