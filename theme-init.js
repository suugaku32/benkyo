/*
 * Pose le thème enregistré avant que la page ne peigne quoi que ce soit.
 * Sans lui, un utilisateur ayant choisi « Bois » verrait clignoter le néon le
 * temps que React monte. Fichier séparé et non script inline : la CSP
 * n'autorise pas 'unsafe-inline' pour les scripts.
 */
(function () {
  try {
    var known = [
      'sobre',
      'bois',
      'catppuccin-mocha',
      'catppuccin-latte',
      'nord',
      'dracula',
      'gruvbox',
      'solarized',
    ];
    var t = localStorage.getItem('jaaa7up-theme');
    if (known.indexOf(t) !== -1) document.documentElement.dataset.theme = t;
  } catch (e) {
    /* stockage indisponible : thème par défaut */
  }
})();
