import { useMemo } from 'react';
import { Position } from '../shogi/position';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Square } from '../shogi/types';
import { usiToSquare } from '../shogi/types';
import './VariationBar.css';

export interface VariationBarProps {
  label: string;
  tone: 'best' | 'played';
  /** Position d'où part la variante. */
  baseSfen: string;
  moves: string[];
  /** Nombre de coups actuellement rejoués, 0 = position de départ de la variante. */
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
  maxMoves?: number;
}

/**
 * Une évaluation seule ne dit pas *pourquoi* un coup est mauvais. La variante du
 * moteur le montre — encore faut-il pouvoir la rejouer sur le plateau plutôt que
 * de lire des coordonnées.
 */
export function VariationBar({
  label,
  tone,
  baseSfen,
  moves,
  activeIndex,
  onSelect,
  maxMoves = 8,
}: VariationBarProps) {
  const shownKey = moves.slice(0, maxMoves).join(' ');

  // Les coups arrivent en notation USI ; on les repasse en kanji, ce qui suppose
  // de rejouer la ligne pour connaître la pièce déplacée à chaque étape.
  const labels = useMemo(() => {
    const out: string[] = [];
    try {
      const pos = Position.fromSfen(baseSfen);
      let previousTo: Square | null = null;
      for (const usi of shownKey.split(' ').filter(Boolean)) {
        out.push(formatUsiMoveAsKif(pos, usi, previousTo));
        previousTo = usiToSquare(usi.slice(2, 4));
        pos.applyUsiMove(usi);
      }
    } catch {
      // Une variante du moteur peut être tronquée ; on garde ce qui a pu être lu.
    }
    return out;
  }, [baseSfen, shownKey]);

  if (labels.length === 0) return null;

  return (
    <div className={`variation variation-${tone}`}>
      <span className="variation-label">{label}</span>
      <div className="variation-moves">
        <button
          type="button"
          className={`variation-move${activeIndex === null ? ' active' : ''}`}
          onClick={() => onSelect(null)}
          title="Revenir à la partie"
        >
          ⟲
        </button>
        {labels.map((text, i) => (
          <button
            key={i}
            type="button"
            className={`variation-move${activeIndex === i + 1 ? ' active' : ''}`}
            onClick={() => onSelect(i + 1)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
