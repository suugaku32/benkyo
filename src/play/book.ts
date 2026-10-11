import type { Color } from '../shogi/types';

/**
 * Ouvertures que l'ordinateur peut chercher à jouer.
 *
 * Le moteur n'a aucune notion de style : il joue le coup que son évaluation
 * préfère, et c'est presque toujours une ouverture à rook en place. Pour qu'il
 * joue autre chose, on lui fait suivre un plan — la suite de ses propres coups
 * qui dresse la position caractéristique — tant que c'est possible et sans
 * danger. Ce ne sont pas des variantes de théorie complètes, seulement la mise
 * en place : où va le rook, quels pions avancent.
 *
 * Les plans sont écrits du point de vue de Sente ; pour Gote ils sont retournés
 * d'un demi-tour (voir `mirror`).
 */
export interface Opening {
  id: string;
  label: string;
  description: string;
  /** Les coups de l'ordinateur, dans l'ordre, en coordonnées de Sente. Vide : jeu libre. */
  plan: readonly string[];
}

export const OPENINGS: readonly Opening[] = [
  {
    id: 'free',
    label: 'Libre',
    description: 'Le moteur choisit son ouverture.',
    plan: [],
  },
  {
    id: 'aigakari',
    label: 'Aigakari (相掛かり)',
    description: 'Rook en place : le pion de rook avance vite, les deux camps s’affrontent sur le bord.',
    plan: ['2g2f', '2f2e', '6i7h'],
  },
  {
    id: 'mukai',
    label: 'Mukai-bisha (向かい飛車)',
    description: 'Le rook face à celui de l’adversaire, en huitième colonne ; le fou lui laisse la place.',
    plan: ['7g7f', '8h7g', '2h8h', '6g6f'],
  },
  {
    id: 'sanken',
    label: 'Sanken-bisha (三間飛車)',
    description: 'Le rook en septième colonne, derrière le pion de 7ᵉ avancé.',
    plan: ['7g7f', '6g6f', '2h7h', '7i6h'],
  },
  {
    id: 'shiken',
    label: 'Shiken-bisha (四間飛車)',
    description: 'Le rook en sixième colonne, la plus courante des ouvertures à rook mobile.',
    plan: ['7g7f', '6g6f', '2h6h'],
  },
  {
    id: 'naka',
    label: 'Naka-bisha (中飛車)',
    description: 'Le rook au centre, en cinquième colonne, derrière un pion de 5ᵉ qui avance.',
    plan: ['5g5f', '2h5h', '7g7f'],
  },
  {
    id: 'ishida',
    label: 'Ishida-ryu (石田流)',
    description: 'Sanken-bisha dont le rook monte en 7ᵉ rangée derrière le pion de 7ᵉ poussé en avant.',
    plan: ['7g7f', '6g6f', '2h7h', '7f7e', '7h7f'],
  },
  {
    id: 'hayaishida',
    label: 'Haya-Ishida (早石田)',
    description: 'Ishida « rapide » : le pion de 7ᵉ est poussé avant même que le rook ne bouge.',
    plan: ['7g7f', '7f7e', '2h7h', '6g6f'],
  },
];

export const DEFAULT_OPENING_ID = 'free';

export function openingById(id: string): Opening {
  return OPENINGS.find((o) => o.id === id) ?? OPENINGS[0];
}

/**
 * Le même coup vu de l'autre camp : le plateau tourné d'un demi-tour, donc la
 * colonne n devient 10 − n et la rangée a..i devient i..a.
 */
export function mirror(usi: string): string {
  const flipFile = (c: string) => String(10 - Number(c));
  const flipRank = (c: string) => String.fromCharCode('a'.charCodeAt(0) + 'i'.charCodeAt(0) - c.charCodeAt(0));
  if (usi[1] === '*') return `${usi[0]}*${flipFile(usi[2])}${flipRank(usi[3])}`;
  return `${flipFile(usi[0])}${flipRank(usi[1])}${flipFile(usi[2])}${flipRank(usi[3])}${usi.slice(4)}`;
}

/**
 * Le prochain coup du plan, ou `null` s'il n'y en a plus.
 *
 * L'avancement se déduit des coups déjà joués par ce camp : chaque coup qui est
 * le suivant du plan le fait avancer, les autres sont ignorés. Rien n'est
 * mémorisé à part — reprendre un coup, ou voir le moteur jouer autre chose un
 * tour, remet naturellement le plan là où il en est.
 */
export function nextBookMove(opening: Opening, color: Color, moves: readonly string[]): string | null {
  if (opening.plan.length === 0) return null;
  const plan = color === 'b' ? opening.plan : opening.plan.map(mirror);
  const mine = moves.filter((_, i) => (i % 2 === 0) === (color === 'b'));
  let done = 0;
  for (const usi of mine) {
    if (usi === plan[done]) done++;
  }
  return done < plan.length ? plan[done] : null;
}

/**
 * Écart toléré, en centipions, entre un coup du plan et le meilleur coup du
 * moteur.
 *
 * Mesuré : le moteur juge les ouvertures à rook mobile de 15 à 160 centipions
 * moins bonnes que le rook en place dans les premiers coups (7五歩 : −161,
 * 向かい飛車 : −116). C'est un parti pris de son évaluation, pas une faute — à
 * 120 la tolérance refusait de bons coups d'ouverture. À 200 elle les laisse
 * passer, et reste bien en deçà d'une vraie gaffe : une pièce laissée en prise
 * coûte plusieurs centaines.
 */
export const BOOK_TOLERANCE_CP = 200;

/**
 * Le coup du plan est-il acceptable ici ? Il l'est s'il ne perd pas plus que la
 * tolérance par rapport au meilleur coup, les deux scores étant ceux du camp qui
 * joue. Un plan suivi à l'aveugle jouerait un coup qui laisse une pièce en prise
 * dès que l'adversaire s'écarte de ce qu'il attendait ; le plan est alors
 * abandonné pour ce coup-là, et repris au suivant s'il redevient possible.
 *
 * On mesure le coup lui-même plutôt que de le chercher parmi les meilleures
 * lignes : en début de partie des dizaines de coups se valent à quelques
 * centipions, et un coup raisonnable peut se classer dixième.
 */
export function isBookMoveSafe(bestCp: number, plannedCp: number): boolean {
  return bestCp - plannedCp <= BOOK_TOLERANCE_CP;
}
