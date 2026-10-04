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
      'tokyo-night',
    ];
    var t = localStorage.getItem('jaaa7up-theme');
    if (known.indexOf(t) !== -1) document.documentElement.dataset.theme = t;

    // Même raison pour la police des pièces : posée après le montage, tous les
    // kanji du plateau changeraient de dessin sous l'œil.
    var fonts = ['gothique', 'arrondie'];
    var f = localStorage.getItem('jaaa7up-piece-font');
    if (fonts.indexOf(f) !== -1) document.documentElement.dataset.pieceFont = f;
  } catch (e) {
    /* stockage indisponible : thème par défaut */
  }
})();
