import { useState } from 'react';
import type { EvalPoint, PlyEval } from '../analysis/analyze';
import { cpToWinPercent } from '../analysis/classify';
import type { MoveQuality } from '../analysis/classify';
import { QUALITY_LABEL_FR } from '../analysis/classify';
import './EvalGraph.css';

interface EvalGraphProps {
  evalCurve: EvalPoint[];
  plies: PlyEval[];
  moveLabels: string[]; // index i = label for ply i+1 (evalCurve index i+1)
  currentPly: number;
  onSelectPly: (ply: number) => void;
}

const WIDTH = 760;
const HEIGHT = 220;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

function displayValue(cpForBlack: number): number {
  return cpToWinPercent(cpForBlack) - 50; // -50..+50, positive = sente advantage
}

const MARKER_QUALITIES: MoveQuality[] = ['blunder', 'mistake', 'inaccuracy'];
const STATUS_VAR: Record<MoveQuality, string> = {
  blunder: 'var(--status-blunder)',
  mistake: 'var(--status-mistake)',
  inaccuracy: 'var(--status-inaccuracy)',
  good: 'var(--status-good)',
  best: 'var(--status-good)',
};

export function EvalGraph({ evalCurve, plies, moveLabels, currentPly, onSelectPly }: EvalGraphProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const midY = PAD_TOP + innerH / 2;
  const scaleY = innerH / 2 / 50;

  const n = evalCurve.length;
  const xAt = (i: number) => PAD_X + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const yAt = (i: number) => midY - displayValue(evalCurve[i].cpForBlack) * scaleY;

  let linePath = '';
  let areaPath = '';
  if (n > 0) {
    linePath = `M ${xAt(0)} ${yAt(0)}`;
    for (let i = 1; i < n; i++) linePath += ` L ${xAt(i)} ${yAt(i)}`;
    areaPath = `${linePath} L ${xAt(n - 1)} ${midY} L ${xAt(0)} ${midY} Z`;
  }

  const markers = plies
    .map((p, i) => ({ p, i: i + 1 }))
    .filter(({ p }) => MARKER_QUALITIES.includes(p.quality));

  const handleMove = (evt: React.MouseEvent<SVGSVGElement>) => {
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((evt.clientX - rect.left) / rect.width) * WIDTH;
    const idx = n <= 1 ? 0 : Math.round(((relX - PAD_X) / innerW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const activeIdx = hoverIdx ?? currentPly;
  const activePoint = evalCurve[activeIdx];
  const activePly = plies[activeIdx - 1];

  return (
    <div className="eval-graph">
      <div className="eval-graph-labels">
        <span className="eval-side-label top">▲ Sente</span>
        <span className="eval-side-label bottom">△ Gote</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="eval-graph-svg"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => onSelectPly(activeIdx)}
        role="img"
        aria-label="Courbe d'évaluation de la partie"
      >
        <defs>
          <clipPath id="clip-top">
            <rect x={0} y={0} width={WIDTH} height={midY} />
          </clipPath>
          <clipPath id="clip-bottom">
            <rect x={0} y={midY} width={WIDTH} height={HEIGHT - midY} />
          </clipPath>
        </defs>

        {/* L'opacité vient du thème : 18 % d'un bleu vif se voit sur fond sombre,
            mais se délave en gris sur un fond clair. */}
        <path
          d={areaPath}
          fill="var(--diverging-pos)"
          className="eval-area"
          clipPath="url(#clip-top)"
        />
        <path
          d={areaPath}
          fill="var(--diverging-neg)"
          className="eval-area"
          clipPath="url(#clip-bottom)"
        />
        <path d={linePath} fill="none" stroke="var(--diverging-pos)" strokeWidth={2} clipPath="url(#clip-top)" />
        <path d={linePath} fill="none" stroke="var(--diverging-neg)" strokeWidth={2} clipPath="url(#clip-bottom)" />

        <line x1={PAD_X} x2={WIDTH - PAD_X} y1={midY} y2={midY} className="eval-baseline" />

        {markers.map(({ p, i }) => (
          <MarkerShape key={i} x={xAt(i)} y={yAt(i)} quality={p.quality} />
        ))}

        {activePoint && (
          <line x1={xAt(activeIdx)} x2={xAt(activeIdx)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} className="eval-crosshair" />
        )}
        {activePoint && <circle cx={xAt(activeIdx)} cy={yAt(activeIdx)} r={4} className="eval-cursor-dot" />}
      </svg>

      {activePoint && (
        <div className="eval-tooltip">
          <span className="eval-tooltip-ply">
            {activeIdx === 0 ? 'Position initiale' : `Coup ${activeIdx}${moveLabels[activeIdx - 1] ? ` — ${moveLabels[activeIdx - 1]}` : ''}`}
          </span>
          <span className="eval-tooltip-score">
            {formatCp(activePoint.cpForBlack)}
          </span>
          {activePly && MARKER_QUALITIES.includes(activePly.quality) && (
            <span className="eval-tooltip-quality" style={{ color: STATUS_VAR[activePly.quality] }}>
              {QUALITY_LABEL_FR[activePly.quality]}
            </span>
          )}
        </div>
      )}

      {markers.length > 0 && (
        <div className="eval-legend">
          {MARKER_QUALITIES.filter((q) => markers.some((m) => m.p.quality === q)).map((q) => (
            <span key={q} className="eval-legend-item">
              <MarkerShapeIcon quality={q} /> {QUALITY_LABEL_FR[q]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Échelle brute, comme le shogi la lit — c'est ce que le moteur émet en USI
 * (`score cp 1234`) et ce qu'affichent ShogiGUI ou Shogidokoro. La division par
 * 100 des interfaces d'échecs était un emprunt malheureux : elle donnait
 * « +2.45 » là où tout le reste de l'écosystème dit « +245 ».
 */
function formatCp(cpForBlack: number): string {
  const abs = Math.abs(cpForBlack);
  if (abs >= 100000 - 2000) {
    // mate-equivalent encoding from scoreToCp
    return cpForBlack > 0 ? 'Sente mate' : 'Gote mate';
  }
  const sign = cpForBlack > 0 ? '+' : '';
  return `${sign}${Math.round(cpForBlack)}`;
}

function MarkerShape({ x, y, quality }: { x: number; y: number; quality: MoveQuality }) {
  const color = STATUS_VAR[quality];
  if (quality === 'blunder') {
    return <circle cx={x} cy={y} r={5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />;
  }
  if (quality === 'mistake') {
    return (
      <rect
        x={x - 4}
        y={y - 4}
        width={8}
        height={8}
        fill={color}
        stroke="var(--surface)"
        strokeWidth={1.5}
        transform={`rotate(45 ${x} ${y})`}
      />
    );
  }
  return (
    <polygon
      points={`${x},${y - 5} ${x + 5},${y + 4} ${x - 5},${y + 4}`}
      fill={color}
      stroke="var(--surface)"
      strokeWidth={1.5}
    />
  );
}

function MarkerShapeIcon({ quality }: { quality: MoveQuality }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
      <MarkerShape x={6} y={6} quality={quality} />
    </svg>
  );
}
