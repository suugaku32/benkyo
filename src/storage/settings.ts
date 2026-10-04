/**
 * Préférences d'affichage et d'analyse, conservées entre les sessions.
 *
 * Le thème vit à part (`src/theme.ts`) parce qu'il doit être posé avant le
 * premier rendu, par un script d'amorçage qui ne peut rien importer.
 */
export interface Settings {
  /** Plateau vu depuis Gote. */
  flipped: boolean;
  /**
   * Flèche du coup recommandé sur le plateau d'analyse, par camp : elle ne
   * s'affiche que sur les tours du ou des camps cochés, plutôt que sur les
   * deux à la fois ou pas du tout.
   */
  showArrowB: boolean;
  showArrowW: boolean;
  /** Joueur(s) suivi(s) par les compteurs et les listes. */
  focusSide: 'both' | 'b' | 'w';
  /** Temps par position, première passe. */
  movetimeMs: number;
}

/*
 * Le balayage est passé de 200 à 800 ms et la seconde passe a été retirée.
 *
 * Mesuré sur une partie de 80 coups aux anciennes valeurs : 136 s au total,
 * dont l'essentiel dans une « seconde passe ciblée » qui rouvrait 44 des 80
 * coups. Allonger le balayage ne réduit pas ce nombre — 43 coups signalés à
 * 200 ms, 46 à 2 s : dans une partie d'amateurs, la moitié des coups perdent
 * réellement assez de pourcentage de victoire pour être marqués. Le coût de
 * cette passe était donc structurel.
 *
 * Chercher correctement une fois, puis approfondir la position qu'on regarde,
 * coûte moins cher et rend un verdict plus stable.
 */
export const DEFAULT_SETTINGS: Settings = {
  flipped: false,
  showArrowB: true,
  showArrowW: true,
  focusSide: 'both',
  movetimeMs: 800,
};

const KEY = 'jaaa7up-settings-v1';

/** Bornes larges : on se protège d'un stockage corrompu, pas de l'utilisateur. */
const MIN_MS = 20;
const MAX_MS = 60000;

function clampMs(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.min(MAX_MS, v === 0 ? 0 : Math.max(MIN_MS, Math.round(v)))
    : fallback;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      flipped: typeof p.flipped === 'boolean' ? p.flipped : DEFAULT_SETTINGS.flipped,
      showArrowB:
        typeof p.showArrowB === 'boolean' ? p.showArrowB : DEFAULT_SETTINGS.showArrowB,
      showArrowW:
        typeof p.showArrowW === 'boolean' ? p.showArrowW : DEFAULT_SETTINGS.showArrowW,
      focusSide:
        p.focusSide === 'b' || p.focusSide === 'w' || p.focusSide === 'both'
          ? p.focusSide
          : DEFAULT_SETTINGS.focusSide,
      movetimeMs: clampMs(p.movetimeMs, DEFAULT_SETTINGS.movetimeMs),
    };
  } catch {
    // Stockage indisponible ou contenu illisible : on repart des valeurs par
    // défaut plutôt que d'empêcher l'app de démarrer.
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(patch: Partial<Settings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    // Le réglage ne survivra pas au rechargement, mais la session fonctionne.
  }
}
