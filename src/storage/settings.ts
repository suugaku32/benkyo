/**
 * Préférences d'affichage et d'analyse, conservées entre les sessions.
 *
 * Le thème vit à part (`src/theme.ts`) parce qu'il doit être posé avant le
 * premier rendu, par un script d'amorçage qui ne peut rien importer.
 */
export interface Settings {
  /** Plateau vu depuis Gote. */
  flipped: boolean;
  /** Flèche du coup recommandé sur le plateau d'analyse. */
  showBestArrow: boolean;
  /** Joueur(s) suivi(s) par les compteurs et les listes. */
  focusSide: 'both' | 'b' | 'w';
  /** Temps par position, première passe. */
  movetimeMs: number;
  /** Temps par position, seconde passe. 0 = pas de seconde passe. */
  deepMovetimeMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  flipped: false,
  showBestArrow: true,
  focusSide: 'both',
  movetimeMs: 200,
  deepMovetimeMs: 2000,
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
      showBestArrow:
        typeof p.showBestArrow === 'boolean' ? p.showBestArrow : DEFAULT_SETTINGS.showBestArrow,
      focusSide:
        p.focusSide === 'b' || p.focusSide === 'w' || p.focusSide === 'both'
          ? p.focusSide
          : DEFAULT_SETTINGS.focusSide,
      movetimeMs: clampMs(p.movetimeMs, DEFAULT_SETTINGS.movetimeMs),
      deepMovetimeMs: clampMs(p.deepMovetimeMs, DEFAULT_SETTINGS.deepMovetimeMs),
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
