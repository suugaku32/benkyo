/**
 * Choix du thème. Volontairement minuscule et sans dépendance : le même code
 * doit pouvoir être appelé par le script d'amorçage comme par l'application.
 */
export const THEMES = [
  'neon',
  'sobre',
  'bois',
  'catppuccin-mocha',
  'catppuccin-latte',
  'nord',
  'dracula',
  'gruvbox',
  'solarized',
] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL_FR: Record<Theme, string> = {
  neon: 'Néon',
  sobre: 'Sobre',
  bois: 'Bois',
  'catppuccin-mocha': 'Catppuccin Mocha',
  'catppuccin-latte': 'Catppuccin Latte',
  nord: 'Nord',
  dracula: 'Dracula',
  gruvbox: 'Gruvbox',
  solarized: 'Solarized',
};

const KEY = 'jaaa7up-theme';

function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return isTheme(raw) ? raw : 'neon';
  } catch {
    // Navigation privée : on retombe sur le thème par défaut plutôt que d'échouer.
    return 'neon';
  }
}

export function applyTheme(theme: Theme): void {
  // `neon` est la valeur par défaut de `:root`, donc rien à poser pour lui.
  if (theme === 'neon') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Le thème ne survivra pas au rechargement, mais l'app fonctionne.
  }
}
