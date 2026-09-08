import type { Position } from '../shogi/position';
import { pieceGlyph } from '../shogi/notation';
import type { Color, PieceType, Square } from '../shogi/types';
import { HAND_PIECE_ORDER, sameSquare } from '../shogi/types';
import './Board.css';

/** Drawn over the grid: a move worth pointing at, not a move being made. */
export interface BoardArrow {
  from: Square | null; // null = drop, marked on the destination instead
  to: Square;
  kind: 'best' | 'played';
}

export interface BoardProps {
  position: Position;
  lastMove?: { from: Square | null; to: Square } | null;
  interactive?: boolean;
  selected?: { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null;
  legalDestinations?: Square[];
  errorSquare?: Square | null;
  /** Which side's hand accepts clicks when interactive. */
  handSide?: Color;
  /** Gote at the bottom instead of Sente — pieces, hands and coordinates turn with it. */
  flipped?: boolean;
  arrows?: BoardArrow[];
  blackName?: string;
  whiteName?: string;
  onSquareClick?: (sq: Square) => void;
  onHandPieceClick?: (type: PieceType) => void;
  cellSize?: number;
}

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function Board({
  position,
  lastMove,
  interactive,
  selected,
  legalDestinations,
  errorSquare,
  handSide = 'b',
  flipped = false,
  arrows,
  blackName,
  whiteName,
  onSquareClick,
  onHandPieceClick,
  cellSize = 40,
}: BoardProps) {
  const isLegalDest = (sq: Square) => (legalDestinations ?? []).some((d) => sameSquare(d, sq));

  // Unflipped the board reads rank 1→9 downwards and file 9→1 rightwards; flipping
  // reverses both axes, which is exactly a 180° turn.
  const ranks = flipped ? [9, 8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const files = flipped ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1];

  const boardPx = cellSize * 9;
  const centreOf = (sq: Square) => ({
    x: (files.indexOf(sq.file) + 0.5) * cellSize,
    y: (ranks.indexOf(sq.rank) + 0.5) * cellSize,
  });

  const rows = ranks.map((rank) => (
    <div className="board-row" key={rank}>
      {files.map((file) => {
        const sq = { file, rank };
        const piece = position.pieceAt(sq);
        const classes = ['cell'];
        if (lastMove && sameSquare(lastMove.to, sq)) classes.push('ht');
        if (lastMove?.from && sameSquare(lastMove.from, sq)) classes.push('hf');
        if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) classes.push('sel');
        if (errorSquare && sameSquare(errorSquare, sq)) classes.push('err');
        if (isLegalDest(sq)) classes.push('hint');
        // A piece faces away from whoever sits at the bottom of the board.
        const upsideDown = piece ? (piece.color === 'w') !== flipped : false;
        return (
          <div
            key={file}
            className={classes.join(' ')}
            style={{ width: cellSize, height: cellSize }}
            onClick={() => interactive && onSquareClick?.(sq)}
            role={interactive ? 'button' : undefined}
            aria-label={`${file}${rank}`}
          >
            {piece && (
              <span
                className={`pc${piece.promoted ? ' promoted' : ''}${upsideDown ? ' gote' : ''}`}
                style={{ fontSize: Math.round(cellSize * 0.72) }}
              >
                {pieceGlyph(piece.type, piece.promoted)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  ));

  const top: Color = flipped ? 'b' : 'w';
  const bottom: Color = flipped ? 'w' : 'b';
  const nameOf = (c: Color) => (c === 'b' ? blackName : whiteName);

  return (
    <div className="board-wrap">
      <HandRow
        color={top}
        name={nameOf(top)}
        hand={position.hands[top]}
        upsideDown
        interactive={interactive && handSide === top}
        selectedType={selected?.kind === 'hand' && handSide === top ? selected.type : null}
        onClick={onHandPieceClick}
      />

      <div className="board-frame" style={{ width: boardPx + cellSize * 0.55 }}>
        <div className="coords-files" style={{ width: boardPx }}>
          {files.map((f) => (
            <span key={f} style={{ width: cellSize }}>
              {f}
            </span>
          ))}
        </div>
        <div className="board-body">
          <div className="goban" style={{ width: boardPx }}>
            {rows}
            {arrows && arrows.length > 0 && (
              <svg
                className="arrow-layer"
                viewBox={`0 0 ${boardPx} ${boardPx}`}
                width={boardPx}
                height={boardPx}
                aria-hidden="true"
              >
                <defs>
                  {(['best', 'played'] as const).map((kind) => (
                    <marker
                      key={kind}
                      id={`head-${kind}`}
                      viewBox="0 0 10 10"
                      refX="7"
                      refY="5"
                      markerWidth="4.5"
                      markerHeight="4.5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 9 5 L 0 9 z" className={`arrow-head arrow-${kind}`} />
                    </marker>
                  ))}
                </defs>
                {arrows.map((a, i) => {
                  const to = centreOf(a.to);
                  if (!a.from) {
                    // A drop has no origin: ring the square instead of pointing at it.
                    return (
                      <circle
                        key={i}
                        cx={to.x}
                        cy={to.y}
                        r={cellSize * 0.38}
                        className={`arrow-drop arrow-${a.kind}`}
                      />
                    );
                  }
                  const from = centreOf(a.from);
                  // Départ au centre de la case d'origine — rogner les deux bouts
                  // ne laissait presque rien sur un coup d'une seule case. Seule
                  // l'arrivée est retirée, pour que la pointe borde la pièce visée
                  // au lieu de la masquer.
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const pad = Math.min(cellSize * 0.34, len * 0.34);
                  return (
                    <line
                      key={i}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x - (dx / len) * pad}
                      y2={to.y - (dy / len) * pad}
                      className={`arrow-line arrow-${a.kind}`}
                      markerEnd={`url(#head-${a.kind})`}
                    />
                  );
                })}
              </svg>
            )}
          </div>
          <div className="coords-ranks">
            {ranks.map((r) => (
              <span key={r} style={{ height: cellSize }}>
                {RANK_KANJI[r - 1]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <HandRow
        color={bottom}
        name={nameOf(bottom)}
        hand={position.hands[bottom]}
        upsideDown={false}
        interactive={interactive && handSide === bottom}
        selectedType={selected?.kind === 'hand' && handSide === bottom ? selected.type : null}
        onClick={onHandPieceClick}
      />
    </div>
  );
}

function HandRow({
  color,
  name,
  hand,
  upsideDown,
  interactive,
  selectedType,
  onClick,
}: {
  color: Color;
  name?: string;
  hand: Record<Exclude<PieceType, 'K'>, number>;
  upsideDown?: boolean;
  interactive?: boolean;
  selectedType?: PieceType | null;
  onClick?: (type: PieceType) => void;
}) {
  const pieces = HAND_PIECE_ORDER.filter((t) => hand[t] > 0);
  return (
    <div className="hbox">
      <span className="hl">
        <span className="hl-side">{color === 'b' ? '▲ Sente' : '△ Gote'}</span>
        {name && <span className="hl-name">{name}</span>}
      </span>
      <div className="hpieces">
        {pieces.length === 0 && <span className="hempty">—</span>}
        {pieces.map((type) => (
          <div
            key={type}
            className={`hp${selectedType === type ? ' sel' : ''}${interactive ? ' clickable' : ''}`}
            onClick={() => interactive && onClick?.(type)}
            role={interactive ? 'button' : undefined}
            aria-label={`${pieceGlyph(type, false)} en main`}
          >
            <span className={`pc${upsideDown ? ' gote' : ''}`} style={{ fontSize: 20 }}>
              {pieceGlyph(type, false)}
            </span>
            {hand[type] > 1 && <span className="hpc">{hand[type]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
