import type { Color } from '../shogi/types';
import { mirror } from './book';

/**
 * Les stratégies (戦型) reconnues dans les parties du répertoire.
 *
 * Elles sont déduites des coups, par une heuristique volontairement simple
 * (voir `strategyOf`) : une partie peut être mal classée, notamment quand les
 * deux camps mélangent les plans. Le classement se fait dans l'application, à
 * partir des seuls coups : améliorer une règle ne demande pas de retélécharger
 * les parties.
 */
export interface Strategy {
  id: string;
  label: string;
  family: 'ibisha' | 'furibisha';
}

export const STRATEGIES: readonly Strategy[] = [
  { id: 'yagura', label: 'Yagura (矢倉)', family: 'ibisha' },
  { id: 'aigakari', label: 'Aigakari (相掛かり)', family: 'ibisha' },
  { id: 'kakugawari', label: 'Kakugawari (角換わり)', family: 'ibisha' },
  { id: 'bogin', label: 'Bōgin (棒銀)', family: 'ibisha' },
  { id: 'ibisha-other', label: 'Autre rook en place (居飛車)', family: 'ibisha' },
  { id: 'shikenbisha', label: 'Shikenbisha (四間飛車)', family: 'furibisha' },
  { id: 'sankenbisha', label: 'Sankenbisha (三間飛車)', family: 'furibisha' },
  { id: 'nakabisha', label: 'Nakabisha (中飛車)', family: 'furibisha' },
  { id: 'mukai', label: 'Mukai-bisha (向かい飛車)', family: 'furibisha' },
  { id: 'migishiken', label: 'Migi-shikenbisha (右四間飛車)', family: 'furibisha' },
];

export const strategyById = (id: string | null | undefined): Strategy | undefined =>
  STRATEGIES.find((s) => s.id === id);

/** Demi-coups regardés : assez pour voir où la tour s'installe et comment les pièces se placent. */
const SCAN_PLIES = 24;

/** Où la tour (en 2h dans le repère de Sente) s'installe : colonne atteinte → stratégie. */
const ROOK_FILE_TO_STRATEGY: Record<string, string> = {
  '6': 'shikenbisha',
  '7': 'sankenbisha',
  '5': 'nakabisha',
  '8': 'mukai',
  '4': 'migishiken',
};

/**
 * La stratégie jouée par `color` dans cette partie, ou `null` si aucune règle
 * ne reconnaît ses coups.
 *
 * On se place dans le repère de ce camp (une rotation d'un demi-tour de la partie
 * entière pour Gote), où sa tour est en 2h :
 * - tour qui quitte la 2e colonne sur sa rangée → rook mobile (la colonne dit lequel) ;
 * - sinon rook en place, classé par ordre de priorité : échange des fous
 *   (角換わり), or et argent du yagura, avance de l'argent (棒銀), pions de tour
 *   poussés des deux côtés (相掛かり), sinon « autre ».
 */
export function strategyOf(moves: readonly string[], color: Color): string | null {
  const plies = moves.slice(0, SCAN_PLIES);
  const framed = color === 'b' ? plies : plies.map(mirror);
  const mineParity = color === 'b' ? 0 : 1;
  const mine = framed.filter((_, i) => i % 2 === mineParity);
  const theirs = framed.filter((_, i) => i % 2 !== mineParity);

  // Où est allée ma tour : on suit la pièce, qui peut aussi être prise.
  let rookSquare: string | null = '2h';
  let firstRookMove: string | null = null;
  framed.forEach((usi, i) => {
    if (rookSquare === null) return;
    if (i % 2 === mineParity) {
      if (usi[1] !== '*' && usi.slice(0, 2) === rookSquare) {
        rookSquare = usi.slice(2, 4);
        firstRookMove ??= rookSquare;
      }
    } else if (usi.slice(2, 4) === rookSquare) {
      rookSquare = null;
    }
  });

  if (firstRookMove !== null) {
    const move: string = firstRookMove;
    if (move[1] === 'h' && move[0] !== '2') return ROOK_FILE_TO_STRATEGY[move[0]] ?? null;
  }

  // Rook en place. L'échange des fous se lit sur la partie d'origine : l'un ou l'autre camp le fait.
  if (plies.some((m) => m === '8h2b+' || m === '2b8h+')) return 'kakugawari';
  if (mine.includes('6i7h') && mine.includes('7i6h')) return 'yagura';
  if (mine.includes('3i3h') && mine.includes('3h2g')) return 'bogin';
  if (mine.includes('2g2f') && mine.includes('2f2e') && theirs.includes('8c8d')) return 'aigakari';
  return 'ibisha-other';
}
