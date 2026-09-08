import { useState } from 'react';
import './KifuInput.css';

const EXAMPLE_KIF = `手合割：平手
先手：Sente
後手：Gote
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２六歩(27)
   4 ８四歩(83)
   5 ２五歩(26)
   6 ８五歩(84)
   7 ７八金(69)
   8 ３二金(41)
`;

interface KifuInputProps {
  value: string;
  onChange: (text: string) => void;
  onAnalyze: () => void;
  movetimeMs: number;
  onMovetimeChange: (ms: number) => void;
  deepMovetimeMs: number;
  onDeepMovetimeChange: (ms: number) => void;
  disabled?: boolean;
}

export function KifuInput({
  value,
  onChange,
  onAnalyze,
  movetimeMs,
  onMovetimeChange,
  deepMovetimeMs,
  onDeepMovetimeChange,
  disabled,
}: KifuInputProps) {
  const [showHelp, setShowHelp] = useState(false);

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
        <button type="button" className="btn btn-ghost" onClick={() => onChange(EXAMPLE_KIF)} disabled={disabled}>
          Charger un exemple
        </button>
        <label className="movetime-control">
          Balayage :
          <select
            value={movetimeMs}
            onChange={(e) => onMovetimeChange(parseInt(e.target.value, 10))}
            disabled={disabled}
          >
            <option value={100}>100 ms</option>
            <option value={200}>200 ms</option>
            <option value={400}>400 ms</option>
            <option value={800}>800 ms</option>
          </select>
        </label>
        <label className="movetime-control">
          Étude des gaffes :
          <select
            value={deepMovetimeMs}
            onChange={(e) => onDeepMovetimeChange(parseInt(e.target.value, 10))}
            disabled={disabled}
          >
            <option value={0}>désactivée</option>
            <option value={1000}>1 s</option>
            <option value={2000}>2 s</option>
            <option value={4000}>4 s</option>
          </select>
        </label>
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
            L'analyse se fait en deux passes : un <strong>balayage</strong> rapide de toute la
            partie pour repérer les coups suspects, puis une <strong>étude</strong> plus longue
            de ces seules positions. C'est cette seconde passe qui fournit le meilleur coup
            servant de corrigé en mode entraînement.
          </p>
        </div>
      )}
    </div>
  );
}
