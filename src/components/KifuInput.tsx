import { useMemo, useRef, useState } from 'react';
import { parseKifu } from '../shogi/parser';
import { MovetimeSlider } from './MovetimeSlider';
import './KifuInput.css';

interface KifuInputProps {
  value: string;
  onChange: (text: string) => void;
  onAnalyze: () => void;
  movetimeMs: number;
  onMovetimeChange: (ms: number) => void;
  disabled?: boolean;
  /** Une image à lire (collée, déposée ou choisie) : une capture d'écran de plateau. */
  onImage?: (file: File) => void;
}

export function KifuInput({
  value,
  onChange,
  onAnalyze,
  movetimeMs,
  onMovetimeChange,
  disabled,
  onImage,
}: KifuInputProps) {
  const [showHelp, setShowHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /*
   * Combien de temps ça va prendre. La question se pose depuis que le balayage
   * monte à 2 s : sur une partie de 120 coups, c'est quatre minutes d'attente
   * qu'on peut lancer sans le savoir. Le calcul est exact — une recherche par
   * position, positions = coups + 1 — donc autant l'annoncer.
   *
   * Le kifu est relu à chaque frappe. C'est sans conséquence : quelques
   * centaines de coups s'analysent en une fraction de milliseconde, et le
   * résultat n'est de toute façon utilisé que pour ce chiffre.
   */
  const positions = useMemo(() => {
    try {
      return parseKifu(value).moves.length + 1;
    } catch {
      return null;
    }
  }, [value]);

  return (
    <div className="kifu-input">
      <textarea
        className="kifu-textarea"
        placeholder="Collez ici un kifu au format KIF, KI2, CSA ou une liste de coups USI (position startpos moves ...)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        disabled={disabled}
      />
      <div className="kifu-controls">
        <button type="button" className="btn btn-primary" onClick={onAnalyze} disabled={disabled || !value.trim()}>
          Analyser la partie
        </button>
        <MovetimeSlider
          label="Balayage"
          value={movetimeMs}
          onChange={onMovetimeChange}
          positions={positions}
          disabled={disabled}
        />
        {onImage && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => fileInput.current?.click()}
              disabled={disabled}
              title="Lire une position sur une capture d'écran (vous pouvez aussi coller l'image avec Ctrl+V)"
            >
              📷 Position depuis une image
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onImage(file);
              }}
            />
          </>
        )}
        <button type="button" className="btn btn-link" onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? 'Masquer les formats' : 'Formats acceptés ?'}
        </button>
      </div>
      {showHelp && (
        <div className="kifu-help">
          <p><strong>KIF</strong> : format numéroté japonais, ex. <code>1 ７六歩(77)</code>.</p>
          <p><strong>KI2</strong> : format avec ▲/△, ex. <code>▲７六歩 △３四歩</code> (désambiguïsation automatique la plupart du temps).</p>
          <p><strong>CSA</strong> : lignes <code>+7776FU</code> / <code>-3334FU</code>.</p>
          <p><strong>USI</strong> : <code>position startpos moves 7g7f 3c3d ...</code> ou une simple liste de coups.</p>
          <p className="kifu-help-note">
            Chaque position de la partie est analysée pendant le temps réglé par le curseur
            de <strong>balayage</strong>. Plus il est long, plus le coup recommandé et le
            classement des coups sont fiables — au prix d'une analyse plus lente sur une
            longue partie. Une position qui paraît douteuse peut ensuite être approfondie à
            la demande, en entraînement ou sur un tsume.
          </p>
        </div>
      )}
    </div>
  );
}
