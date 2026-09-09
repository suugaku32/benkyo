import { useEffect } from 'react';

/**
 * Garde l'écran allumé pendant qu'on étudie une partie : sans ça, l'iPhone
 * l'éteint après quelques dizaines de secondes sans toucher l'écran, ce qui
 * arrive constamment en entraînement ou devant un tsume à réfléchir.
 *
 * Un onglet caché relâche automatiquement le verrou (changement d'app,
 * verrouillage du téléphone) : on le redemande donc à chaque retour de
 * visibilité plutôt qu'une seule fois au montage.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Refusé (économie de batterie, permissions) : tant pis, l'écran s'éteindra normalement.
      }
    };

    if (document.visibilityState === 'visible') void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
    };
  }, []);
}
