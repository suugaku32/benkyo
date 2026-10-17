import type { Hand, PieceType } from '../shogi/types';
import { emptyHand } from '../shogi/types';

/*
 * Les pièces en main, lues sur une image. Elles se présentent de deux façons :
 * - dans les jeux, en rangée horizontale (en haut et en bas du plateau), chaque
 *   pièce avec, parfois, un petit chiffre à son coin ;
 * - dans les livres, en colonne verticale (à gauche et à droite du plateau),
 *   le nom de la pièce suivi d'un chiffre en kanji : 飛 角 金二 歩三.
 * Ce fichier ne contient que la partie sans pixels de la lecture : trouver les
 * boîtes, les ranger dans l'ordre de lecture, transformer la suite de signes en
 * pièces et en nombres.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number; // inclus
  y1: number; // inclus
}

export const boxW = (b: Box) => b.x1 - b.x0 + 1;
export const boxH = (b: Box) => b.y1 - b.y0 + 1;

/** Les composantes connexes (8 voisins) d'un masque d'encre, avec leur boîte et leur nombre de pixels. */
export function components(mask: Uint8Array, w: number, h: number): (Box & { area: number })[] {
  const seen = new Uint8Array(mask.length);
  const out: (Box & { area: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const box = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      box.area++;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    out.push(box);
  }
  return out;
}

/**
 * Retire les cadres : le contour d'une pièce dessinée (un pentagone) entoure son
 * caractère. Une composante dont la boîte en contient une autre et couvre
 * presque tout l'ensemble est un cadre, pas un caractère.
 */
export function withoutFrames(mask: Uint8Array, w: number, h: number): Uint8Array {
  const comps = components(mask, w, h);
  const out = Uint8Array.from(mask);
  for (const c of comps) {
    const inner = comps.filter(
      (o) => o !== c && o.area > 3 && o.x0 >= c.x0 && o.x1 <= c.x1 && o.y0 >= c.y0 && o.y1 <= c.y1,
    );
    if (inner.length === 0) continue;
    // Un cadre est creux : son encre occupe une petite part de sa boîte.
    if (c.area >= 0.35 * boxW(c) * boxH(c)) continue;
    // … et plus grand que ce qu'il entoure : un caractère en forme de boîte (日) n'est pas un cadre.
    const iw = Math.max(...inner.map((o) => o.x1)) - Math.min(...inner.map((o) => o.x0)) + 1;
    const ih = Math.max(...inner.map((o) => o.y1)) - Math.min(...inner.map((o) => o.y0)) + 1;
    if (boxW(c) < 1.2 * iw && boxH(c) < 1.2 * ih) continue;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) out[y * w + x] = 0;
    // Les caractères entourés ont été effacés avec la boîte : on les remet.
    for (const o of inner) {
      for (let y = o.y0; y <= o.y1; y++) for (let x = o.x0; x <= o.x1; x++) out[y * w + x] = mask[y * w + x];
    }
  }
  return out;
}

export interface Glyph {
  box: Box;
  /** Petits signes attachés au caractère (un chiffre posé à son coin) : leurs boîtes. */
  badges: Box[];
}

/**
 * Découpe une zone de pièces en main en caractères, dans l'ordre de lecture.
 *
 * La zone est une rangée (jeux) ou une colonne (livres) : on regarde de quel
 * côté l'encre s'étend le plus, on prend pour taille d'un caractère l'étendue de
 * l'autre côté — un caractère est à peu près carré — et on coupe la projection
 * sur l'axe de lecture là où une nouvelle taille de caractère commence.
 * Dans chaque tranche, les petites taches (un chiffre en coin de pièce) sont
 * mises à part.
 */
export function segmentHand(mask: Uint8Array, w: number, h: number): { axis: 'x' | 'y'; glyphs: Glyph[] } {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { axis: 'x', glyphs: [] };
  const ex = x1 - x0 + 1;
  const ey = y1 - y0 + 1;
  const axis: 'x' | 'y' = ey > ex * 1.2 ? 'y' : 'x';
  const size = axis === 'x' ? ey : ex;

  // Projection sur l'axe de lecture, en tranches d'encre.
  const length = axis === 'x' ? w : h;
  const ink = new Uint8Array(length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) ink[axis === 'x' ? x : y] = 1;
    }
  }
  const runs: [number, number][] = [];
  for (let i = 0; i < length; i++) {
    if (!ink[i]) continue;
    let j = i;
    while (j + 1 < length && ink[j + 1]) j++;
    runs.push([i, j]);
    i = j;
  }
  // Un nouveau caractère commence quand la tranche débute au moins 0,9 taille après le début du précédent.
  const groups: [number, number][] = [];
  for (const [a, b] of runs) {
    const last = groups[groups.length - 1];
    if (last && a < last[0] + 0.9 * size) last[1] = Math.max(last[1], b);
    else groups.push([a, b]);
  }

  const glyphs: Glyph[] = [];
  for (const [a, b] of groups) {
    const sub = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = axis === 'x' ? x : y;
        if (v >= a && v <= b && mask[y * w + x]) sub[y * w + x] = 1;
      }
    }
    const comps = components(sub, w, h);
    const gx0 = Math.min(...comps.map((c) => c.x0));
    const gx1 = Math.max(...comps.map((c) => c.x1));
    const gy0 = Math.min(...comps.map((c) => c.y0));
    const gy1 = Math.max(...comps.map((c) => c.y1));
    const gw = gx1 - gx0 + 1;
    const gh = gy1 - gy0 + 1;
    // Un chiffre de coin est petit devant un caractère et posé dans un coin du côté droit de la tranche
    // (en haut ou en bas) ; seulement dans une rangée : dans une colonne, le chiffre est un kanji de même taille.
    const isBadge = (c: Box & { area: number }): boolean => {
      if (axis !== 'x') return false;
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      const small = Math.max(boxW(c), boxH(c)) < 0.5 * size;
      // Du côté droit, ou du côté gauche quand la zone est lue retournée (le chiffre reste en haut à droite de l'image).
      const right = cx >= gx0 + 0.7 * gw || cx <= gx0 + 0.3 * gw;
      const corner = cy <= gy0 + 0.38 * gh || cy >= gy0 + 0.62 * gh;
      return small && right && corner;
    };
    const small = comps.filter(isBadge);
    const body = comps.filter((c) => !small.includes(c));
    if (body.length === 0) continue;
    const box: Box = {
      x0: Math.min(...body.map((c) => c.x0)),
      y0: Math.min(...body.map((c) => c.y0)),
      x1: Math.max(...body.map((c) => c.x1)),
      y1: Math.max(...body.map((c) => c.y1)),
    };
    // Les taches proches les unes des autres forment un seul chiffre.
    const badges: Box[] = [];
    for (const c of small) {
      const near = badges.find(
        (bd) => c.x0 <= bd.x1 + 0.12 * size && c.x1 >= bd.x0 - 0.12 * size && c.y0 <= bd.y1 + 0.12 * size && c.y1 >= bd.y0 - 0.12 * size,
      );
      if (near) {
        near.x0 = Math.min(near.x0, c.x0);
        near.y0 = Math.min(near.y0, c.y0);
        near.x1 = Math.max(near.x1, c.x1);
        near.y1 = Math.max(near.y1, c.y1);
      } else badges.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    }
    glyphs.push({ box, badges: badges.filter((bd) => boxW(bd) * boxH(bd) >= 0.01 * size * size) });
  }
  // Une étiquette (« ▲ Sente ») est écrite bien plus petit que les pièces : on l'écarte.
  const dim = (g: Glyph) => Math.max(boxW(g.box), boxH(g.box));
  const largest = Math.max(0, ...glyphs.map(dim));
  return { axis, glyphs: glyphs.filter((g) => dim(g) >= 0.55 * largest) };
}

export type HandType = Exclude<PieceType, 'K'>;

/** Ce qu'on lit dans une zone : une pièce, ou un nombre. */
export type Token = { kind: 'piece'; type: HandType; confidence: number } | { kind: 'number'; value: number; confidence: number };

const NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0,
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9,
};

/** Les caractères qu'on accepte de lire dans une zone de pièces en main. */
export const HAND_CHARS = '歩香桂銀金角飛と杏圭全馬龍竜' + Object.keys(NUMERALS).join('');

/** Pièce qu'un caractère désigne en main : une pièce en main n'est jamais promue, une forme promue est une mauvaise lecture de sa base. */
const HAND_PIECE: Record<string, HandType> = {
  歩: 'P', と: 'P', 香: 'L', 杏: 'L', 桂: 'N', 圭: 'N', 銀: 'S', 全: 'S', 金: 'G', 角: 'B', 馬: 'B', 飛: 'R', 龍: 'R', 竜: 'R',
};

export function tokenOf(char: string, confidence: number): Token | null {
  if (char in HAND_PIECE) return { kind: 'piece', type: HAND_PIECE[char], confidence };
  if (char in NUMERALS) return { kind: 'number', value: NUMERALS[char], confidence };
  return null;
}

/**
 * La suite de signes devient des pièces. Une pièce vaut 1 sans nombre ; un
 * nombre qui la suit la remplace (二 → 2) ; 十 puis un chiffre s'additionnent
 * (十 八 → 18) ; une même pièce répétée s'additionne (歩 歩 歩 → 3).
 */
export function parseTokens(tokens: Token[]): Hand {
  const hand = emptyHand();
  let current: HandType | null = null;
  let count: number | null = null;
  const flush = () => {
    if (current) hand[current] += count ?? 1;
    current = null;
    count = null;
  };
  for (const t of tokens) {
    if (t.kind === 'piece') {
      // Même pièce deux fois de suite, sans nombre entre les deux : un doublon, pas une pièce de plus.
      if (current === t.type && count === null) {
        count = 2;
        continue;
      }
      if (current === t.type && count !== null) {
        count += 1;
        continue;
      }
      flush();
      current = t.type;
    } else if (current) {
      if (count === null) count = t.value;
      // 十 suivi d'un chiffre (18 = 十八) : les unités s'ajoutent à la dizaine.
      else if (count === 10 && t.value < 10) count += t.value;
      else count = t.value;
    }
  }
  flush();
  return hand;
}

/**
 * 一, 二, 三 : des barres horizontales empilées, que le moteur de lecture rate
 * (二 en particulier). On les compte directement : une forme plate faite de 1 à 3
 * traits qui occupent presque toute la largeur.
 */
export function countBars(mask: Uint8Array, w: number, box: Box): number | null {
  const sub = new Uint8Array(mask.length);
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) sub[y * w + x] = mask[y * w + x];
  const comps = components(sub, w, mask.length / w);
  const bw = boxW(box);
  const bh = boxH(box);
  if (bh > 0.9 * bw) return null; // pas une forme plate
  const bars = comps.filter((c) => boxW(c) >= 0.6 * bw && boxH(c) <= 0.4 * bh + 2);
  if (bars.length < 1 || bars.length > 3) return null;
  // Tout le reste doit être du bruit : les barres couvrent l'essentiel de l'encre.
  const barInk = bars.reduce((sum, c) => sum + c.area, 0);
  const total = comps.reduce((sum, c) => sum + c.area, 0);
  return barInk >= 0.85 * total && bars.length === comps.length ? bars.length : null;
}
