/*
 * Sonde de démarrage.
 *
 * Quand le bundle ne s'exécute pas — syntaxe que le navigateur ne sait pas
 * analyser, fichier absent, requête bloquée — la page reste sur le contenu de
 * repli sans rien dire de la cause. Depuis un téléphone il n'y a pas de console
 * accessible, donc le diagnostic est impossible.
 *
 * Cette sonde écoute les erreurs de chargement, et si l'application n'est pas
 * montée au bout de quelques secondes, affiche ce qu'elle a capté dans le repli.
 *
 * Volontairement écrite en ES5 : elle doit tourner là même où le bundle échoue.
 */
(function () {
  var captured = [];

  window.addEventListener(
    'error',
    function (e) {
      if (e && e.target && e.target !== window && e.target.src) {
        captured.push('Ressource non chargée : ' + String(e.target.src).split('/').pop());
      } else if (e && e.message) {
        captured.push(e.message);
      }
    },
    true,
  );

  window.addEventListener('unhandledrejection', function (e) {
    captured.push('Promesse rejetée : ' + (e && e.reason ? String(e.reason) : 'inconnue'));
  });

  setTimeout(function () {
    // L'app remplace le repli à son montage : si le marqueur a disparu, tout va bien.
    var slot = document.getElementById('boot-diagnostic');
    if (!slot) return;

    var parts = [];
    parts.push('Navigateur : ' + navigator.userAgent);
    if (captured.length) {
      parts.push('Erreurs : ' + captured.join(' | '));
    } else {
      parts.push("Aucune erreur captée — le script n'a probablement pas pu être analysé.");
    }
    slot.textContent = parts.join('\n');
    slot.style.display = 'block';
  }, 5000);
})();
