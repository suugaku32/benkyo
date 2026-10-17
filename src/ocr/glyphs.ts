import type { PieceType } from '../shogi/types';

/** Ce qu'on lit sur une pièce : son type, promue ou non. */
export interface Glyph {
  type: Exclude<PieceType, never>;
  promoted: boolean;
}

/**
 * Les caractères qu'on s'attend à lire sur une pièce, et la pièce qu'ils
 * désignent. Plusieurs graphies pour une même pièce : 王 ou 玉 pour le roi, 龍
 * ou 竜 pour le dragon, et les formes cursives des pièces promues (圭 杏 全),
 * que beaucoup d'applications préfèrent à 成桂 成香 成銀.
 */
export const GLYPHS: Record<string, Glyph> = {
  歩: { type: 'P', promoted: false },
  と: { type: 'P', promoted: true },
  香: { type: 'L', promoted: false },
  杏: { type: 'L', promoted: true },
  桂: { type: 'N', promoted: false },
  圭: { type: 'N', promoted: true },
  銀: { type: 'S', promoted: false },
  全: { type: 'S', promoted: true },
  金: { type: 'G', promoted: false },
  角: { type: 'B', promoted: false },
  馬: { type: 'B', promoted: true },
  飛: { type: 'R', promoted: false },
  龍: { type: 'R', promoted: true },
  竜: { type: 'R', promoted: true },
  王: { type: 'K', promoted: false },
  玉: { type: 'K', promoted: false },
};

/** Les seuls caractères que le moteur de lecture a le droit de proposer. */
export const GLYPH_WHITELIST = Object.keys(GLYPHS).join('');
