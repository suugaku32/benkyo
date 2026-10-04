import './MovetimeSlider.css';

/**
 * Bornes du balayage. Le plafond est monté de 2 à 5 s : sur une position
 * fermée, deux secondes ne suffisent pas à départager, et c'est justement là
 * qu'un classement approximatif se remarque.
 */
export const SCAN_MIN_MS = 100;
export const SCAN_MAX_MS = 5000;
export const SCAN_STEP_MS = 100;

interface MovetimeSliderProps {
  label: string;
  value: number;
  onChange: (ms: number) => void;
  /**
   * Nombre de positions à analyser, si on le connaît. C'est lui qui transforme
   * une cadence en durée d'attente — la seule forme sous laquelle le réglage
   * veut dire quelque chose.
   */
  positions?: number | null;
  disabled?: boolean;
}

/** `1500` → `1,5 s`, `800` → `800 ms`. */
export function cadence(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** `95000` → `1 min 35 s`. Au-delà de la minute, les secondes seules ne parlent plus. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const r = total % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/**
 * Réglage de la cadence du balayage, avec la durée qu'il coûtera.
 *
 * Le même contrôle sert sur l'écran de saisie et dans le panneau des réglages :
 * les deux commandent la même chose, et l'un des deux plafonnait plus bas que
 * l'autre — un réglage à 2 s n'avait alors pas de valeur correspondante dans la
 * liste du panneau.
 */
export function MovetimeSlider({
  label,
  value,
  onChange,
  positions,
  disabled,
}: MovetimeSliderProps) {
  return (
    <div className="movetime-slider">
      <label>
        <span className="movetime-slider-label">{label}</span>
        <input
          type="range"
          min={SCAN_MIN_MS}
          max={SCAN_MAX_MS}
          step={SCAN_STEP_MS}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-label={`${label} — temps par position`}
        />
        <output className="movetime-slider-value">{cadence(value)}</output>
      </label>
      {positions != null && positions > 1 && (
        <span className="movetime-slider-estimate">
          {positions} positions — environ {duration(positions * value)}
        </span>
      )}
    </div>
  );
}
