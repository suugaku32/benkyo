import type { PlyEval } from '../analysis/analyze';
import { QUALITY_COLOR, QUALITY_LABEL_FR } from '../analysis/classify';
import './MoveList.css';

interface MoveListProps {
  /** Les coups déjà classés : le début de la partie tant que l'analyse se poursuit. */
  plies: PlyEval[];
  /** Un libellé par coup de la partie, analysé ou non. */
  moveLabels: string[];
  /** Camp qui joue le premier coup — celui des coups pas encore analysés s'en déduit. */
  firstMover?: 'b' | 'w';
  currentPly: number;
  onSelectPly: (ply: number) => void;
  /** Estompe les coups de l'autre camp sans les retirer, pour garder le fil de la partie. */
  focusSide?: 'both' | 'b' | 'w';
}

const SHOWN_QUALITIES = new Set(['inaccuracy', 'mistake', 'blunder']);

export function MoveList({
  plies,
  moveLabels,
  firstMover = 'b',
  currentPly,
  onSelectPly,
  focusSide = 'both',
}: MoveListProps) {
  return (
    <ol className="move-list" aria-label="Liste des coups">
      <li
        className={`move-row move-row-start${currentPly === 0 ? ' active' : ''}`}
        onClick={() => onSelectPly(0)}
      >
        Position de départ
      </li>
      {moveLabels.map((label, i) => {
        const ply = i + 1;
        const p = plies[i];
        // Les camps alternent : inutile d'attendre l'analyse pour mettre ▲ ou △.
        const color = p?.color ?? (i % 2 === 0 ? firstMover : firstMover === 'b' ? 'w' : 'b');
        return (
          <li
            key={ply}
            className={`move-row${currentPly === ply ? ' active' : ''}${
              focusSide !== 'both' && color !== focusSide ? ' dimmed' : ''
            }`}
            onClick={() => onSelectPly(ply)}
          >
            <span className="move-num">{ply}.</span>
            <span className="move-side">{color === 'b' ? '▲' : '△'}</span>
            <span className="move-text">{label}</span>
            {p ? (
              <>
                <span className="move-score">{formatSigned(p.evalAfterCp, p.color)}</span>
                {SHOWN_QUALITIES.has(p.quality) && (
                  <span className="move-quality" style={{ color: QUALITY_COLOR[p.quality] }}>
                    {QUALITY_LABEL_FR[p.quality]}
                    {p.refined && (
                      <span className="move-refined" title="Réexaminé en profondeur">
                        {' '}
                        ✓
                      </span>
                    )}
                  </span>
                )}
              </>
            ) : (
              <span className="move-score move-pending" title="Analyse en cours">
                …
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Échelle brute du moteur, comme ShogiGUI — voir `EvalGraph.formatCp`. */
function formatSigned(cpForMover: number, color: 'b' | 'w'): string {
  const cpForBlack = color === 'b' ? cpForMover : -cpForMover;
  const sign = cpForBlack > 0 ? '+' : '';
  return `${sign}${Math.round(cpForBlack)}`;
}
