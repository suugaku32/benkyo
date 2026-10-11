import type { AnalyzeLine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';

/**
 * Niveaux de l'adversaire. Le moteur est toujours le même, très fort : la
 * difficulté vient de ce qu'on lui laisse jouer.
 *
 * - `pBest` : la part des coups où il joue vraiment son meilleur coup. Le reste
 *   du temps il choisit parmi les suivants.
 * - `maxLossCp` : de combien le coup choisi à la place peut être inférieur au
 *   meilleur, en centipions. Sans ce plafond, « un peu moins bon » deviendrait
 *   parfois une gaffe pure, et la faiblesse n'aurait plus rien d'humain.
 * - `multiPv` : combien de lignes il regarde pour trouver des alternatives.
 * - `depth` : jusqu'où il cherche. Une profondeur, pas une durée : un même
 *   niveau doit jouer pareil sur un ordinateur de bureau et sur un téléphone
 *   ancien, ce qu'une durée ne garantit pas — plus l'appareil est rapide,
 *   plus la même durée va profond.
 */
export interface Level {
  id: string;
  label: string;
  description: string;
  pBest: number;
  maxLossCp: number;
  multiPv: number;
  depth: number;
}

/**
 * Plafond de temps par coup. Ce n'est pas un réglage de difficulté mais un
 * garde-fou : la profondeur choisie s’atteint largement en deçà sur une
 * machine ordinaire, et le plafond ne sert qu'à ne pas laisser un appareil
 * très lent chercher indéfiniment.
 */
export const MOVE_CAP_MS = 10000;

export const LEVELS: readonly Level[] = [
  {
    id: 'novice',
    label: 'Débutant',
    description: 'Joue le meilleur coup une fois sur cinq ; les autres peuvent être franchement faibles.',
    pBest: 0.2,
    maxLossCp: 400,
    multiPv: 6,
    depth: 1,
  },
  {
    id: 'easy',
    label: 'Facile',
    description: 'Joue le meilleur coup environ un coup sur trois, sinon un coup nettement moins bon.',
    pBest: 0.35,
    maxLossCp: 250,
    multiPv: 5,
    depth: 2,
  },
  {
    id: 'medium',
    label: 'Moyen',
    description: 'Joue le meilleur coup un coup sur deux, sinon un coup un peu moins bon.',
    pBest: 0.5,
    maxLossCp: 150,
    multiPv: 4,
    depth: 4,
  },
  {
    id: 'hard',
    label: 'Difficile',
    description: 'Joue le meilleur coup trois fois sur quatre ; ses écarts restent légers.',
    pBest: 0.75,
    maxLossCp: 80,
    multiPv: 3,
    depth: 7,
  },
  {
    id: 'master',
    label: 'Maître',
    description: 'Toujours le meilleur coup, avec la recherche la plus profonde.',
    pBest: 1,
    maxLossCp: 0,
    multiPv: 1,
    depth: 18,
  },
];

export const DEFAULT_LEVEL_ID = 'medium';

export function levelById(id: string): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL_ID)!;
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
