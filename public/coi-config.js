/*
 * Configuration de coi-serviceworker, chargée avant lui.
 *
 * Fichier séparé et non script inline : la CSP de index.html n'autorise pas
 * 'unsafe-inline' pour les scripts.
 *
 * ── Garde anti-boucle ────────────────────────────────────────────────────────
 * coi-serviceworker recharge la page lui-même : quand le service worker est actif
 * sans contrôler la page, et quand une mise à jour est détectée. Si le navigateur
 * n'accorde jamais l'isolation — Safari/WebKit reçoit `COEP: credentialless`,
 * valeur qu'il ne reconnaît pas — la condition reste vraie à chaque chargement et
 * la page se recharge indéfiniment : écran blanc permanent, que vider les données
 * du site ne répare pas puisque la boucle redémarre aussitôt.
 *
 * On plafonne donc les rechargements par onglet. Passé la limite, la page
 * s'affiche telle quelle ; l'app détecte l'absence de SharedArrayBuffer et
 * l'explique au lieu de disparaître.
 *
 * ── Mode COEP ────────────────────────────────────────────────────────────────
 * La bibliothèque choisit `credentialless` pour tout ce qui n'est ni Chrome ni
 * Firefox — son test est `!(window.chrome || window.netscape)`, vrai sur Safari.
 * Or Safari ne reconnaît pas cette valeur : l'en-tête est ignoré, la page n'est
 * pas isolée, SharedArrayBuffer reste absent et le moteur ne démarre pas.
 *
 * Tout étant servi depuis la même origine, `require-corp` convient partout, et
 * c'est déjà ce que reçoivent Chrome et Firefox. Le service worker pose alors
 * aussi `Cross-Origin-Resource-Policy: cross-origin` sur ce qu'il sert.
 *
 * Ce forçage avait été tenté puis annulé, la page ne s'ouvrant plus sur iOS. Ce
 * signal était faux à deux titres : le réglage vivait dans un script inline que
 * la CSP bloquait, donc il ne s'exécutait pas, et GitHub Pages servait alors le
 * dépôt brut au lieu du build. Il n'avait donc jamais été mis à l'épreuve.
 *
 * ── Porte de secours ─────────────────────────────────────────────────────────
 * Ouvrir la page avec `?reset-sw` désinstalle le service worker sans en
 * réenregistrer un. À garder à portée : si `require-corp` devait casser un
 * navigateur, c'est le moyen de s'en sortir.
 */
(function () {
  var RELOAD_KEY = 'coi-reload-count';
  var MAX_RELOADS = 2;
  var reset = /[?&]reset-sw\b/.test(window.location.search);

  function count() {
    try {
      return parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0;
    } catch (e) {
      // sessionStorage peut lever en navigation privée : sans compteur fiable,
      // on interdit tout rechargement plutôt que risquer la boucle.
      return MAX_RELOADS;
    }
  }

  // Isolation obtenue : la séquence a abouti, on repart de zéro.
  if (window.crossOriginIsolated === true) {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch (e) {
      /* sans importance */
    }
  }

  window.coi = {
    coepCredentialless: function () {
      return false;
    },
    shouldRegister: function () {
      return !reset && count() < MAX_RELOADS;
    },
    shouldDeregister: function () {
      return reset;
    },
    doReload: function () {
      var n = count();
      if (n >= MAX_RELOADS) {
        console.warn(
          "coi-serviceworker : rechargement ignoré (" + n + " déjà effectués). " +
            "Ce navigateur n'accorde pas l'isolation cross-origin.",
        );
        return;
      }
      try {
        sessionStorage.setItem(RELOAD_KEY, String(n + 1));
      } catch (e) {
        return; // pas de compteur, pas de rechargement
      }
      window.location.reload();
    },
  };

  // Un service worker déjà en place a pu servir ce document sous l'ancien mode
  // COEP : le changement demandé ci-dessus ne vaut que pour les requêtes
  // suivantes. Un rechargement unique remet la page dans le bon mode, sans quoi
  // il faudrait actualiser à la main. Le garde ci-dessus le plafonne, donc pas
  // de boucle si le navigateur refuse l'isolation pour une autre raison.
  window.addEventListener('load', function () {
    if (reset) return;
    if (window.crossOriginIsolated !== false) return;
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    window.coi.doReload();
  });

  if (reset) {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch (e) {
      /* sans importance */
    }
    // Repartir sur l'URL nue ne suffirait pas : c'est justement son HTML qui est
    // périmé en cache. Un paramètre unique force une clé de cache neuve, donc un
    // index.html à jour référençant un bundle qui existe.
    var done = function () {
      window.location.replace('./?fresh=' + Date.now());
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then(function (regs) {
          return Promise.all(
            regs.map(function (r) {
              return r.unregister();
            }),
          );
        })
        .then(done, done);
    } else {
      done();
    }
  }
})();
