import { useState } from 'react';
import './DeepenControl.css';

/** Bornes du curseur, en millisecondes. */
const MIN_MS = 500;
const MAX_MS = 60000;
const STEP_MS = 100;

interface DeepenControlProps {
  /**
   * Nombre de recherches que l'approfondissement va lancer. Deux pour une gaffe
   * — la position d'avant et celle d'après le coup joué —, une seule pour un
   * tsume. C'est ce facteur qui sépare la durée choisie de la durée subie.
   */
  searches: number;
  /** Position déjà reprise à une cadence longue. */
  refined?: boolean;
  onRun: (movetimeMs: number) => Promise<void>;
}

/** `12300` → `12,3 s`. Une décimale suffit : le curseur avance par dixièmes. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Choix de la durée de réflexion, et lancement.
 *
 * Le curseur remplace une liste de valeurs toutes faites : entre 5 et 10
 * secondes il n'y a pas de raison de ne pas pouvoir demander 7. Surtout, la
 * durée annoncée est celle de l'attente réelle, pas celle d'une recherche —
 * confondre les deux fait paraître l'app deux fois plus lente que prévu.
 */
export function DeepenControl({ searches, refined, onRun }: DeepenControlProps) {
  const [movetimeMs, setMovetimeMs] = useState(5000);
  const [running, setRunning] = useState(false);

  const total = movetimeMs * searches;

  return (
    <div className="deepen">
      <button
        className="btn btn-ghost"
        disabled={running}
        onClick={async () => {
          setRunning(true);
          try {
            await onRun(movetimeMs);
          } finally {
            setRunning(false);
          }
        }}
      >
        {running ? 'Analyse en cours…' : '⌛ Approfondir'}
      </button>

      <label className="deepen-time">
        <span className="deepen-label">Réflexion</span>
        <input
          type="range"
          min={MIN_MS}
          max={MAX_MS}
          step={STEP_MS}
          value={movetimeMs}
          disabled={running}
          onChange={(e) => setMovetimeMs(Number(e.target.value))}
          aria-label="Temps de réflexion par position"
        />
        <output className="deepen-value">{seconds(movetimeMs)}</output>
      </label>

      <span className="deepen-estimate">
        {searches > 1
          ? `${searches} recherches — environ ${seconds(total)} d’attente`
          : `environ ${seconds(total)} d’attente`}
      </span>

      {refined && <span className="deepen-done">position approfondie</span>}
    </div>
  );
}
