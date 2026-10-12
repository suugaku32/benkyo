import type { AnalyzeLine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';
import type { Position } from '../shogi/position';
import { isKingCapturable } from '../shogi/moveGen';
import type { Color, PieceType, Square } from '../shogi/types';
import { otherColor, usiToSquare } from '../shogi/types';

/**
 * Le style de jeu de l'adversaire. Le moteur joue le coup le plus sûr, ce qui
 * donne des parties prudentes : il se renferme, consolide, refuse les échanges
 * qui ne lui rapportent rien. Un style offensif ne le rend pas plus faible
 * — il le laisse choisir, parmi les coups à peu près aussi bons que le
 * meilleur, celui qui attaque le plus : prise, échec, promotion, pièce lancée
 * vers le roi adverse.
 *
 * - `windowCp` : de combien un coup peut être inférieur au meilleur pour être
 *   pris en compte. Plus la fenêtre est large, plus il prend de risques.
 * - `multiPv` : combien de coups il regarde pour en trouver d'aussi bons.
 */
export interface Style {
  id: string;
  label: string;
  description: string;
  windowCp: number;
  multiPv: number;
}

export const STYLES: readonly Style[] = [
  {
    id: 'balanced',
    label: 'Équilibré',
    description: "Le moteur joue le coup qu'il juge le meilleur, sans préférence de style.",
    windowCp: 0,
    multiPv: 1,
  },
  {
    id: 'offensive',
    label: 'Offensif',
    description: "Parmi les coups presque aussi bons, il préfère celui qui attaque : échecs, prises, promotions, pièces lancées vers votre roi.",
    windowCp: 60,
    multiPv: 8,
  },
  {
    id: 'aggressive',
    label: 'Très offensif',
    description: 'Il attaque dès que possible, quitte à lâcher du terrain : la partie devient tendue.',
    windowCp: 150,
    multiPv: 10,
  },
  {
    id: 'berserk',
    label: 'Kamikaze',
    description: "Il fonce sur votre roi en acceptant de lourds sacrifices. Une défense solide peut le punir.",
    windowCp: 300,
    multiPv: 12,
  },
];

export const DEFAULT_STYLE_ID = 'balanced';

export function styleById(id: string | undefined): Style {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

/** Valeur approximative d'une pièce prise, en « points d'agressivité » (pas en centipions). */
const CAPTURE_VALUE: Record<PieceType, number> = { P: 1, L: 1, N: 1.5, S: 2, G: 2, B: 3, R: 3, K: 0 };

const chebyshev = (a: Square, b: Square) => Math.max(Math.abs(a.file - b.file), Math.abs(a.rank - b.rank));

/**
 * À quel point un coup attaque, sur une échelle libre (de −3 à +9 environ).
 * Mesure du caractère, pas de la valeur : c'est le moteur, pas cette fonction,
 * qui dit si le coup est bon.
 */
export function sharpness(position: Position, usi: string): number {
  const mover: Color = position.turn;
  const enemy = otherColor(mover);
  const enemyKing = position.findKing(enemy);
  const ownKing = position.findKing(mover);
  const isDrop = usi[1] === '*';
  const to = usiToSquare(usi.slice(2, 4));
  const from = isDrop ? null : usiToSquare(usi.slice(0, 2));
  const moving = from ? position.pieceAt(from) : null;
  const target = position.pieceAt(to);
  const forward = mover === 'b' ? -1 : 1; // les rangs décroissent vers le camp adverse pour Sente

  let score = 0;
  if (target && target.color === enemy) score += 1.5 + 0.5 * (CAPTURE_VALUE[target.type] + (target.promoted ? 1 : 0));
  if (usi.endsWith('+')) score += 1.5;
  if (isDrop) score += 0.5;

  if (enemyKing) {
    const d = chebyshev(to, enemyKing);
    score += d <= 1 ? 1.5 : d === 2 ? 1 : d === 3 ? 0.5 : 0;
  }

  if (from && moving) {
    if (moving.type === 'K') score -= 1.5;
    else {
      const progress = Math.max(-3, Math.min(3, (to.rank - from.rank) * forward));
      score += 0.4 * progress;
      if (moving.type === 'G' && progress <= 0 && !target) score -= 0.5;
    }
  }
  // Un coup qui ne fait que ranger une pièce près de son propre roi est une consolidation.
  if (ownKing && !target && chebyshev(to, ownKing) <= 2 && !usi.endsWith('+')) score -= 0.5;

  // Échec : on joue le coup sur une copie et on regarde si le roi adverse est attaqué.
  try {
    const after = position.clone();
    after.applyUsiMove(usi);
    if (isKingCapturable(after, enemy)) score += 2;
  } catch {
    // Coup inapplicable : il n'aura pas de bonus, et sera écarté plus loin comme illégal.
  }
  return score;
}

/**
 * Le coup que le style préfère, parmi ceux de la fenêtre. `null` si le style
 * n'a pas d'avis : style équilibré, un seul coup, ou un mat forcé à jouer.
 */
export function preferredMove(
  position: Position,
  lines: AnalyzeLine[],
  style: Style,
  rng: () => number = Math.random,
): string | null {
  if (style.windowCp <= 0 || lines.length < 2) return null;
  const best = lines[0];
  // Un mat en vue se joue : le style ne vaut pas de laisser filer la victoire.
  if (best.scoreMate !== null && best.scoreMate > 0) return null;
  const bestScore = scoreToCp(best.scoreCp, best.scoreMate);
  const inWindow = lines.filter((l) => bestScore - scoreToCp(l.scoreCp, l.scoreMate) <= style.windowCp);
  if (inWindow.length < 2) return null;
  let pick = inWindow[0].move;
  let top = -Infinity;
  for (const l of inWindow) {
    const loss = bestScore - scoreToCp(l.scoreCp, l.scoreMate);
    // Le goût d'attaquer, tempéré par ce que le coup coûte, plus un peu de hasard pour ne pas jouer toujours pareil.
    const value = sharpness(position, l.move) - (2 * loss) / style.windowCp + rng() * 0.8;
    if (value > top) {
      top = value;
      pick = l.move;
    }
  }
  return pick;
}
