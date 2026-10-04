import { useState } from 'react';
import type { ReactNode } from 'react';
import type { EvalPoint, PlyEval } from '../analysis/analyze';
import type { MoveQuality } from '../analysis/classify';
import { QUALITY_LABEL_FR } from '../analysis/classify';
import './EvalGraph.css';

interface EvalGraphProps {
  evalCurve: EvalPoint[];
  plies: PlyEval[];
  moveLabels: string[]; // index i = label for ply i+1 (evalCurve index i+1)
  currentPly: number;
  onSelectPly: (ply: number) => void;
  /**
   * Chevrons ‹ › de la rangée de commandes, en tête de la carte. Naviguer dans
   * la partie et situer un moment de la partie sont le même geste ; une
   * rangée séparée coûtait une ligne d'écran pour rien.
   */
  navControls?: ReactNode;
  /**
   * Nombre de points de la courbe une fois l'analyse terminée. Tant qu'elle se
   * poursuit, la courbe ne couvre que le début : l'axe garde pourtant la
   * longueur de la partie, pour qu'elle s'allonge sans que tout se déplace.
   */
  totalPoints?: number;
  /** Bouton « Meilleure suite », à droite de la même rangée. */
  lineControl?: ReactNode;
  /**
   * Masque la courbe — et le coup, le score, la qualité lus à côté — tant qu'on
   * n'a pas demandé à la voir : elle dit d'un coup d'œil le résultat de la
   * partie, ce qu'on ne veut pas toujours savoir avant d'avoir cherché soi-même.
   * Les chevrons restent utilisables : on navigue sans rien dévoiler.
   */
  spoiler?: { revealed: boolean; onReveal: () => void };
}

const WIDTH = 760;
/* Réduite de 220 : la carte gagne de la hauteur d'écran, et l'échelle en
   racine carrée reste lisible même moins haute. */
const HEIGHT = 170;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

/**
 * Plafond de l'axe vertical, en centièmes de pion. Au shogi, ±2000 à ±4000 sont
 * des écarts courants ; l'ancienne courbe traçait un pourcentage de victoire
 * dont l'entrée est écrêtée à ±1000, si bien que +1200 et +4000 donnaient le
 * même point. Le graphe montre désormais l'évaluation elle-même.
 *
 * Le pourcentage de victoire reste ce qui *classe* les coups, et c'est voulu :
 * perdre 1800 centièmes quand on est à +3000 ne change pas l'issue, et ne
 * mérite donc pas d'être appelé une gaffe. Les deux échelles répondent à deux
 * questions différentes — combien, et est-ce grave.
 */
const AXIS_MAX_CP = 4000;

/**
 * −1..+1, positif = avantage Sente. Compression en racine carrée plutôt que
 * linéaire : sur un axe linéaire jusqu'à 4000, les ±150 de l'ouverture sont
 * indiscernables du zéro. Ici 1000 occupe la moitié de la hauteur, 250 le quart.
 */
function displayValue(cpForBlack: number): number {
  const capped = Math.max(-AXIS_MAX_CP, Math.min(AXIS_MAX_CP, cpForBlack));
  return Math.sign(capped) * Math.sqrt(Math.abs(capped) / AXIS_MAX_CP);
}

/** Repères de l'axe : sans eux, une échelle comprimée ne se lit pas. */
const GRID_CP = [1000, 2000];

const MARKER_QUALITIES: MoveQuality[] = ['blunder', 'mistake', 'inaccuracy'];
const STATUS_VAR: Record<MoveQuality, string> = {
  blunder: 'var(--status-blunder)',
  mistake: 'var(--status-mistake)',
  inaccuracy: 'var(--status-inaccuracy)',
  good: 'var(--status-good)',
  best: 'var(--status-good)',
};

export function EvalGraph({
  evalCurve,
  plies,
  moveLabels,
  currentPly,
  onSelectPly,
  navControls,
  lineControl,
  spoiler,
  totalPoints,
}: EvalGraphProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const innerW = WIDTH - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const midY = PAD_TOP + innerH / 2;
  const scaleY = innerH / 2;

  const n = evalCurve.length;
  const axisN = Math.max(totalPoints ?? n, n);
  const xAt = (i: number) => PAD_X + (axisN <= 1 ? 0 : (i / (axisN - 1)) * innerW);
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
    const idx = axisN <= 1 ? 0 : Math.round(((relX - PAD_X) / innerW) * (axisN - 1));
    setHoverIdx(Math.max(0, Math.min(axisN - 1, idx)));
  };

  const activeIdx = hoverIdx ?? currentPly;
  const activePoint = evalCurve[activeIdx];
  const activePly = plies[activeIdx - 1];
  const activePlyLabel =
    activeIdx === 0 ? 'Position initiale' : `Coup ${activeIdx}${moveLabels[activeIdx - 1] ? ` — ${moveLabels[activeIdx - 1]}` : ''}`;

  const concealed = spoiler !== undefined && !spoiler.revealed;

  return (
    <div className={`eval-graph${concealed ? ' eval-graph-concealed' : ''}`}>
      {/*
        En tête de la carte, et non sous la courbe : sur un téléphone la courbe
        est déjà sous le plateau, et des commandes placées après elle tombaient
        au ras du bord de l'écran (797 px sur 844).

        L'indication « bon coup ou pas » vivait dans l'info-bulle sous le
        graphe, où on ne la voyait qu'en cherchant. Elle rejoint ici les
        chevrons et le bouton de la suite : les trois répondent à la même
        question — où en est-on dans la partie — et se lisent d'un coup d'œil
        au lieu de deux endroits différents.
      */}
      <div className="eval-controls">
        {navControls}
        {activePoint && (
          <span className="eval-controls-info">
            <span className="eval-controls-ply">{activePlyLabel}</span>
            <span className="eval-controls-score">{formatCp(activePoint.cpForBlack)}</span>
            {activePly && (
              <span className="eval-quality-badge" style={{ color: STATUS_VAR[activePly.quality] }}>
                {QUALITY_LABEL_FR[activePly.quality]}
              </span>
            )}
          </span>
        )}
        {lineControl}
      </div>

      <div className="eval-graph-plot">
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

        {GRID_CP.map((cp) => (
          <g key={cp}>
            {[cp, -cp].map((v) => (
              <line
                key={v}
                x1={PAD_X}
                x2={WIDTH - PAD_X}
                y1={midY - displayValue(v) * scaleY}
                y2={midY - displayValue(v) * scaleY}
                className="eval-gridline"
              />
            ))}
            <text
              x={PAD_X + 2}
              y={midY - displayValue(cp) * scaleY - 3}
              className="eval-gridlabel"
            >
              {cp}
            </text>
            <text
              x={PAD_X + 2}
              y={midY + displayValue(cp) * scaleY - 3}
              className="eval-gridlabel"
            >
              −{cp}
            </text>
          </g>
        ))}

        <line x1={PAD_X} x2={WIDTH - PAD_X} y1={midY} y2={midY} className="eval-baseline" />

        {markers.map(({ p, i }) => (
          <MarkerShape key={i} x={xAt(i)} y={yAt(i)} quality={p.quality} />
        ))}

        {activePoint && (
          <line x1={xAt(activeIdx)} x2={xAt(activeIdx)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} className="eval-crosshair" />
        )}
        {activePoint && <circle cx={xAt(activeIdx)} cy={yAt(activeIdx)} r={4} className="eval-cursor-dot" />}
      </svg>
      {concealed && (
        <button
          type="button"
          className="btn btn-primary eval-graph-reveal"
          onClick={spoiler.onReveal}
        >
          👁 Afficher la courbe d'évaluation
        </button>
      )}
      </div>

      {/*
        Sur bureau la rangée de commandes dit déjà tout ça — redondant, elle y
        a disparu (voir `.eval-controls-info` dans `EvalGraph.css`). Sur
        téléphone en revanche cette rangée est resserrée par les chevrons qui
        en sortent (voir `.float-nav`), pas la place d'y ajouter coup, score
        et qualité sans les tronquer ; ils gardent donc leur propre ligne, la
        qualité en tête plutôt qu'en fin — c'est elle qu'on cherche d'abord.
      */}
      {activePoint && (
        <div className="eval-tooltip">
          {activePly && (
            <span className="eval-quality-badge" style={{ color: STATUS_VAR[activePly.quality] }}>
              {QUALITY_LABEL_FR[activePly.quality]}
            </span>
          )}
          <span className="eval-tooltip-ply">{activePlyLabel}</span>
          <span className="eval-tooltip-score">
            {formatCp(activePoint.cpForBlack)}
          </span>
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
