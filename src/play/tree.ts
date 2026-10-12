import type { Color } from '../shogi/types';
import { strategyOf } from './strategy';

/**
 * Le répertoire « parties humaines » : les premiers coups de parties classées
 * des meilleurs joueurs de Lishogi, téléchargées par
 * `scripts/build-opening-games.ts` et chargées à la demande (le fichier peut
 * peser plusieurs mégaoctets, inutile de l'embarquer dans la page).
 *
 * L'application en tire des arbres de coups : pour chaque suite de coups depuis
 * la position initiale, les coups suivants réellement joués, combien de fois, et
 * avec quels résultats. On peut ne garder que les parties où un camp a joué une
 * stratégie donnée (voir `strategy.ts`).
 */
export interface OpeningTree {
  meta: { source: string; games: number; players: number; minRating: number; depth: number; minCount: number; builtAt: string };
  /** Préfixe (coups USI séparés par des espaces) → [coup, parties, victoires Sente, victoires Gote][], du plus joué au moins joué. */
  nodes: Record<string, [string, number, number, number][]>;
}

type Outcome = 'b' | 'w' | 'd';

/** Le fichier de parties tel que le script l'écrit. */
export interface GamesFile {
  meta: { source: string; games: number; players: number; minRating: number; plies: number; builtAt: string };
  games: [string, Outcome][];
}

interface ClassifiedGame {
  moves: string[];
  outcome: Outcome;
  /** Stratégie jouée par Sente et par Gote (voir `strategyOf`), ou `null`. */
  sente: string | null;
  gote: string | null;
}

/** Combien de demi-coups gardent les arbres : au-delà, trop peu de parties se ressemblent encore. */
const TREE_PLIES = 24;

/**
 * Parties minimales pour garder un coup : plus le lot est gros, plus on peut
 * être exigeant sans perdre de lignes utiles ; au minimum 2, un seul passage
 * n'est pas une habitude.
 */
const minCountFor = (games: number): number => Math.max(2, Math.round(games / 700));

export function buildTree(games: readonly ClassifiedGame[], source: GamesFile['meta']): OpeningTree {
  const minCount = minCountFor(games.length);
  const counts = new Map<string, Map<string, [number, number, number]>>();
  for (const g of games) {
    const upto = Math.min(TREE_PLIES, g.moves.length);
    for (let i = 0; i < upto; i++) {
      const key = g.moves.slice(0, i).join(' ');
      let children = counts.get(key);
      if (!children) counts.set(key, (children = new Map()));
      let stat = children.get(g.moves[i]);
      if (!stat) children.set(g.moves[i], (stat = [0, 0, 0]));
      stat[0]++;
      if (g.outcome === 'b') stat[1]++;
      else if (g.outcome === 'w') stat[2]++;
    }
  }
  const nodes: OpeningTree['nodes'] = {};
  for (const [key, children] of counts) {
    const list = [...children].filter(([, s]) => s[0] >= minCount).sort((a, b) => b[1][0] - a[1][0]);
    if (list.length) nodes[key] = list.map(([m, s]) => [m, s[0], s[1], s[2]]);
  }
  return {
    meta: { source: source.source, games: games.length, players: source.players, minRating: source.minRating, depth: TREE_PLIES, minCount, builtAt: source.builtAt },
    nodes,
  };
}

/** Le répertoire chargé : les parties classées, et les arbres qu'on en tire. */
export interface Book {
  meta: GamesFile['meta'];
  /** Combien de parties jouent chaque stratégie (une partie compte pour chacun de ses deux camps). */
  strategyCounts: Map<string, number>;
  /**
   * L'arbre des parties où `color` a joué la stratégie `strategyId`. Sans
   * stratégie, toutes les parties.
   */
  tree(color: Color | null, strategyId: string | null): OpeningTree;
}

export function buildBook(file: GamesFile): Book {
  const games: ClassifiedGame[] = file.games.map(([line, outcome]) => {
    const moves = line.split(' ');
    return { moves, outcome, sente: strategyOf(moves, 'b'), gote: strategyOf(moves, 'w') };
  });
  const strategyCounts = new Map<string, number>();
  for (const g of games) {
    for (const s of [g.sente, g.gote]) if (s) strategyCounts.set(s, (strategyCounts.get(s) ?? 0) + 1);
  }
  const cache = new Map<string, OpeningTree>();
  return {
    meta: file.meta,
    strategyCounts,
    tree(color, strategyId) {
      const key = strategyId && color ? `${color}:${strategyId}` : '*';
      let tree = cache.get(key);
      if (!tree) {
        const subset =
          strategyId && color ? games.filter((g) => (color === 'b' ? g.sente : g.gote) === strategyId) : games;
        tree = buildTree(subset, file.meta);
        cache.set(key, tree);
      }
      return tree;
    },
  };
}

let cached: Promise<Book> | null = null;

export function loadBook(): Promise<Book> {
  cached ??= import('./openingGames.json').then((m) => buildBook(m.default as unknown as GamesFile));
  return cached;
}

/** L'arbre de toutes les parties. */
export function loadTree(): Promise<OpeningTree> {
  return loadBook().then((b) => b.tree(null, null));
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
