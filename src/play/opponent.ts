import type { AnalyzeLine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';

/**
 * Niveaux de l'adversaire. Le moteur est toujours le même, très fort : la
 * difficulté vient de ce qu'on lui laisse jouer.
 *
 * - `nodes` : combien de positions il examine par coup. Un nombre de nœuds, ni
 *   une durée ni une profondeur : un même niveau doit jouer pareil sur un
 *   ordinateur de bureau et sur un téléphone ancien, ce qu'une durée ne
 *   garantit pas, et une profondeur de plus coûte plusieurs fois le travail de
 *   la précédente — trop gros un pas pour graduer finement la difficulté.
 * - `pBest` : la part des coups où il joue vraiment son meilleur coup. Le reste
 *   du temps il choisit parmi les suivants.
 * - `maxLossCp` : de combien le coup choisi à la place peut être inférieur au
 *   meilleur, en centipions. Sans ce plafond, « un peu moins bon » deviendrait
 *   parfois une gaffe pure, et la faiblesse n'aurait plus rien d'humain.
 * - `multiPv` : combien de lignes il regarde pour trouver des alternatives.
 */
export interface Level {
  id: string;
  label: string;
  description: string;
  nodes: number;
  pBest: number;
  maxLossCp: number;
  multiPv: number;
}

/**
 * Plafond de temps par coup. Ce n'est pas un réglage de difficulté mais un
 * garde-fou : le nombre de nœuds choisi s'atteint largement en deçà sur une
 * machine ordinaire (mesuré : ~0,65 million de nœuds par seconde), et le
 * plafond ne sert qu'à ne pas laisser un appareil très lent, ou un nombre de
 * nœuds très élevé, chercher indéfiniment.
 */
export const MOVE_CAP_MS = 10000;

/*
 * Douze paliers, de 10 à 3 millions de nœuds — environ ×3 à chaque fois, soit
 * deux paliers par ordre de grandeur. Les trois paramètres de faiblesse
 * s'effacent à mesure que le niveau monte : au sommet il joue toujours son
 * meilleur coup, avec toute la recherche.
 *
 * Ces niveaux sont ordonnés, pas étalonnés : je ne les ai pas mesurés contre des
 * joueurs. Ajuster un palier, c'est changer une ligne ci-dessous.
 */
const PRESETS: readonly Omit<Level, 'id'>[] = [
  { label: 'Débutant complet', description: 'Joue presque au hasard parmi des coups parfois franchement mauvais.', nodes: 10, pBest: 0.1, maxLossCp: 700, multiPv: 8 },
  { label: 'Débutant', description: 'Connaît les règles, laisse souvent des pièces en prise.', nodes: 30, pBest: 0.15, maxLossCp: 550, multiPv: 8 },
  { label: 'Novice', description: 'Voit les prises immédiates, mais pas plus loin.', nodes: 100, pBest: 0.2, maxLossCp: 400, multiPv: 7 },
  { label: 'Apprenti', description: 'Évite les pièges les plus simples.', nodes: 300, pBest: 0.3, maxLossCp: 300, multiPv: 6 },
  { label: 'Initié', description: 'Joue des coups sensés, avec des faiblesses visibles.', nodes: 1_000, pBest: 0.4, maxLossCp: 220, multiPv: 6 },
  { label: 'Amateur', description: 'Joue le meilleur coup un coup sur deux, sinon un coup un peu moins bon.', nodes: 3_000, pBest: 0.5, maxLossCp: 160, multiPv: 5 },
  { label: 'Amateur confirmé', description: 'Solide dans les positions simples, se trompe dans les complications.', nodes: 10_000, pBest: 0.6, maxLossCp: 120, multiPv: 4 },
  { label: 'Joueur de club', description: 'Ses écarts sont légers et plus rares.', nodes: 30_000, pBest: 0.7, maxLossCp: 90, multiPv: 4 },
  { label: 'Club fort', description: 'Joue le meilleur coup trois fois sur quatre.', nodes: 100_000, pBest: 0.8, maxLossCp: 60, multiPv: 3 },
  { label: 'Expert', description: 'Presque toujours le meilleur coup, écarts minimes.', nodes: 300_000, pBest: 0.9, maxLossCp: 40, multiPv: 3 },
  { label: 'Maître', description: 'Toujours le meilleur coup, avec une recherche profonde.', nodes: 1_000_000, pBest: 1, maxLossCp: 0, multiPv: 1 },
  { label: 'Grand maître', description: 'Toujours le meilleur coup, avec la recherche la plus profonde.', nodes: 3_000_000, pBest: 1, maxLossCp: 0, multiPv: 1 },
];

export const LEVELS: readonly Level[] = PRESETS.map((l, i) => ({ id: `l${i + 1}`, ...l }));

export const DEFAULT_LEVEL_ID = 'l6';

/** Les niveaux de la première version (5 paliers), pour ne pas perdre un choix déjà enregistré. */
const LEGACY_IDS: Record<string, string> = {
  novice: 'l3',
  easy: 'l4',
  medium: 'l6',
  hard: 'l9',
  master: 'l11',
};

export function levelById(id: string): Level {
  const resolved = LEGACY_IDS[id] ?? id;
  return LEVELS.find((l) => l.id === resolved) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL_ID)!;
}

/** Le niveau libre : l'utilisateur règle lui-même ce que les paliers règlent d'avance. */
export const CUSTOM_LEVEL_ID = 'custom';

export interface CustomSettings {
  nodes: number;
  /** De 0 à 1. */
  pBest: number;
  maxLossCp: number;
}

export const NODE_CHOICES: readonly number[] = [
  10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000,
];

export const LOSS_CHOICES: readonly number[] = [30, 60, 100, 150, 250, 400, 600, 1000];

export const DEFAULT_CUSTOM: CustomSettings = { nodes: 10_000, pBest: 0.5, maxLossCp: 150 };

/** Une valeur lue du stockage, ramenée à ce que l'interface sait proposer. */
export function sanitizeCustom(raw: Partial<CustomSettings> | null | undefined): CustomSettings {
  const nodes = NODE_CHOICES.includes(raw?.nodes ?? -1) ? raw!.nodes! : DEFAULT_CUSTOM.nodes;
  const p = raw?.pBest;
  const pBest = typeof p === 'number' && Number.isFinite(p) ? Math.min(1, Math.max(0, Math.round(p * 20) / 20)) : DEFAULT_CUSTOM.pBest;
  const loss = LOSS_CHOICES.includes(raw?.maxLossCp ?? -1) ? raw!.maxLossCp! : DEFAULT_CUSTOM.maxLossCp;
  return { nodes, pBest, maxLossCp: loss };
}

/** Le palier qu'on joue : un préréglage, ou le niveau libre construit à partir des réglages. */
export function resolveLevel(levelId: string, custom: CustomSettings): Level {
  if (levelId !== CUSTOM_LEVEL_ID) return levelById(levelId);
  const c = sanitizeCustom(custom);
  return {
    id: CUSTOM_LEVEL_ID,
    label: 'Personnalisé',
    description: '',
    nodes: c.nodes,
    pBest: c.pBest,
    maxLossCp: c.maxLossCp,
    // Sans alternatives à regarder, l'écart ne sert à rien : une seule ligne suffit au meilleur coup.
    multiPv: c.pBest >= 1 ? 1 : 6,
  };
}

/** « 1 000 000 » — les espaces fines de `toLocaleString` se coupent mal sur mobile. */
export function formatNodes(n: number): string {
  return n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * Choisit le coup à jouer parmi les lignes du moteur (de la meilleure à la
 * moins bonne). `null` seulement s'il n'y en a aucune.
 *
 * Les alternatives retenues sont celles dont le score reste dans la fenêtre
 * `maxLossCp` du meilleur. Un coup qui laisserait mater l'adversaire ou se
 * faire mater sort de cette fenêtre de lui-même, puisqu'un mat vaut des
 * dizaines de milliers de centipions (voir `scoreToCp`) : il n'y a pas de règle
 * à part pour l'éviter. Parmi les survivantes, les plus proches du meilleur
 * coup sont les plus probables.
 */
export function chooseMove(
  lines: AnalyzeLine[],
  level: Level,
  rng: () => number = Math.random,
): string | null {
  if (lines.length === 0) return null;
  const best = lines[0];
  if (lines.length === 1 || level.multiPv <= 1 || rng() < level.pBest) return best.move;

  const bestScore = scoreToCp(best.scoreCp, best.scoreMate);
  const alternatives = lines
    .slice(1)
    .map((l) => ({ move: l.move, loss: bestScore - scoreToCp(l.scoreCp, l.scoreMate) }))
    .filter((a) => a.loss <= level.maxLossCp);
  if (alternatives.length === 0) return best.move;

  const weights = alternatives.map((a) => level.maxLossCp + 1 - Math.max(0, a.loss));
  let draw = rng() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < alternatives.length; i++) {
    draw -= weights[i];
    if (draw < 0) return alternatives[i].move;
  }
  return alternatives[alternatives.length - 1].move;
}
