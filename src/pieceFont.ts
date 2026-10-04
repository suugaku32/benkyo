/**
 * Police des kanji du plateau.
 *
 * Comme le thème, elle vit hors des réglages ordinaires : elle doit être posée
 * avant le premier rendu, sinon toutes les pièces changent de dessin sous l'œil
 * une fois React monté. Le script d'amorçage `public/theme-init.js` s'en charge
 * et ne peut rien importer, d'où ce module minuscule et sans dépendance.
 *
 * Aucune police n'est téléchargée : l'app doit rester autonome et sa CSP est
 * stricte. Les trois choix reposent sur ce qu'un appareil possède déjà, avec
 * repli sur la famille générique correspondante.
 */
export const PIECE_FONTS = ['mincho', 'gothique', 'arrondie'] as const;
export type PieceFont = (typeof PIECE_FONTS)[number];

export const PIECE_FONT_LABEL_FR: Record<PieceFont, string> = {
  mincho: 'Mincho (明朝)',
  gothique: 'Gothique (ゴシック)',
  arrondie: 'Arrondie (丸ゴシック)',
};

const KEY = 'jaaa7up-piece-font';

function isPieceFont(v: unknown): v is PieceFont {
  return typeof v === 'string' && (PIECE_FONTS as readonly string[]).includes(v);
}

export function loadPieceFont(): PieceFont {
  try {
    const raw = localStorage.getItem(KEY);
    return isPieceFont(raw) ? raw : 'mincho';
  } catch {
    // Navigation privée : on retombe sur la police par défaut.
    return 'mincho';
  }
}

export function applyPieceFont(font: PieceFont): void {
  // `mincho` est la valeur par défaut de `:root`, donc rien à poser pour elle.
  if (font === 'mincho') delete document.documentElement.dataset.pieceFont;
  else document.documentElement.dataset.pieceFont = font;
  try {
    localStorage.setItem(KEY, font);
  } catch {
    // Le choix ne survivra pas au rechargement, mais l'app fonctionne.
  }
}
