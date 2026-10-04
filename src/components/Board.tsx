import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
  /** Pièce parachutée. Renseignée pour un drop seulement : le cercle dit où,
   *  il faut bien que quelque chose dise quoi. */
  piece?: PieceType;
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

/** Largeur de la colonne des noms, quand elle sort du ruban pour se loger à côté du plateau. */
const NAMES_COL_WIDTH = 108;
const NAMES_GAP = 10;
/** En dessous, ni la colonne ni un plateau de taille correcte (case ≥ 40 px) ne tiendraient côte à côte. */
const WIDE_THRESHOLD = NAMES_COL_WIDTH + NAMES_GAP + Math.ceil(40 * 9.55);

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
  cellSize: maxCellSize = 60,
}: BoardProps) {
  /*
   * Le plateau était figé à 40 px par case, soit 382 px avec la colonne des
   * rangées. Sous 400 px de large — iPhone SE, mini, ou simplement un
   * navigateur avec les marges du système — il débordait de l'écran, et la
   * dernière colonne passait sous le bord.
   *
   * La case se règle donc sur la largeur réellement disponible, sans jamais
   * dépasser la taille demandée. Le cadre vaut 9 cases plus 0,55 pour les
   * kanji de rangée : c'est ce diviseur qu'on inverse.
   *
   * Le plafond lui-même est monté à 60 px (573 px de plateau) : sur mobile,
   * la mesure ci-dessus le réduit de toute façon à la largeur de l'écran, mais
   * sur un bureau où la colonne dépasse 573 px, 40 px laissait le plateau
   * minuscule au milieu d'une colonne bien plus large que lui.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Avant la première mesure on rend à la taille demandée : mieux vaut un
  // plateau trop large le temps d'une image qu'un plateau qui grandit sous
  // l'œil à chaque affichage.
  /*
   * Les rubans de nom, un par camp, occupaient toute la largeur du plateau
   * pour un nom qui n'en emplit qu'une fraction — plus le plateau grandit,
   * plus le vide autour du nom se voit. Sur un large écran, le nom sort donc
   * du ruban et se loge dans une colonne étroite à côté du plateau : c'est le
   * même `available` qui décide, puisqu'il faut la place des deux à la fois.
   * Sous ce seuil, ni la colonne ni le plateau ne tiendraient — le nom
   * retourne dans le ruban, seul endroit qui reste.
   */
  const wide = available !== null && available >= WIDE_THRESHOLD;
  const boardAvailable = available === null ? null : wide ? available - NAMES_COL_WIDTH - NAMES_GAP : available;
  const cellSize =
    boardAvailable === null
      ? maxCellSize
      : Math.max(18, Math.min(maxCellSize, Math.floor(boardAvailable / 9.55)));

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

  /*
   * Animation du coup. L'app Tsume fait voler une pièce en `position: fixed`
   * par-dessus le plateau, puis reconstruit le DOM à la main — nécessaire quand
   * on écrit le HTML soi-même. Ici la pièce est déjà rendue à l'arrivée : il
   * suffit de la faire *entrer* depuis sa case de départ, en partant du décalage
   * inverse pour revenir à zéro. Aucun élément en plus, aucune case à masquer.
   *
   * La clé porte le coup : sans elle React réutilise le même nœud d'un coup à
   * l'autre et l'animation ne rejoue pas.
   */
  const flight = lastMove?.from
    ? (() => {
        const from = centreOf(lastMove.from);
        const to = centreOf(lastMove.to);
        return {
          dx: from.x - to.x,
          dy: from.y - to.y,
          key: `${lastMove.from.file}${lastMove.from.rank}-${lastMove.to.file}${lastMove.to.rank}`,
        };
      })()
    : null;

  const rows = ranks.map((rank) => (
    <div className="board-row" key={rank}>
      {files.map((file) => {
        const sq = { file, rank };
        const piece = position.pieceAt(sq);
        const arriving = flight && lastMove && sameSquare(lastMove.to, sq);
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
                key={arriving ? flight.key : undefined}
                className={`pc${piece.promoted ? ' promoted' : ''}${upsideDown ? ' gote' : ''}${
                  arriving ? ' pc-arriving' : ''
                }`}
                style={
                  arriving
                    ? ({
                        fontSize: Math.round(cellSize * 0.72),
                        '--fx': `${flight.dx}px`,
                        '--fy': `${flight.dy}px`,
                      } as CSSProperties)
                    : { fontSize: Math.round(cellSize * 0.72) }
                }
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

  /*
   * Extrait une fois : en mode large, la colonne des noms porte les rubans de
   * pièces (voir plus bas), et le plateau n'a plus besoin de rien au-dessus
   * ni en dessous de lui — seul ce bloc reste. Sa hauteur devient alors celle
   * de `.board-stack`, ce qui aligne la colonne des noms (`justify-content:
   * space-between`, sur la même hauteur) exactement sur le haut et le bas du
   * goban, et non plus sur un ruban de pièces qui les en écartait.
   */
  const boardFrame = (
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
                    /*
                     * Un parachutage n'a pas d'origine : on cercle la case au
                     * lieu de pointer vers elle. Le cercle seul ne dit que
                     * l'endroit, jamais quelle pièce tombe — le kanji va donc
                     * au centre, où il ne masque rien : une pièce ne peut être
                     * parachutée que sur une case vide.
                     */
                    return (
                      <g key={i}>
                        <circle
                          cx={to.x}
                          cy={to.y}
                          r={cellSize * 0.38}
                          className={`arrow-drop arrow-${a.kind}`}
                        />
                        {a.piece && (
                          <text
                            x={to.x}
                            y={to.y}
                            className={`arrow-drop-piece arrow-${a.kind}`}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={Math.round(cellSize * 0.5)}
                            /*
                             * Une pièce parachutée se pose dans le sens de son
                             * camp, comme toutes les autres. La flèche annonce
                             * le coup du joueur au trait — c'est donc `turn` qui
                             * décide, selon la même règle que les pièces du
                             * plateau.
                             */
                            transform={
                              (position.turn === 'w') !== flipped
                                ? `rotate(180 ${to.x} ${to.y})`
                                : undefined
                            }
                          >
                            {pieceGlyph(a.piece, false)}
                          </text>
                        )}
                      </g>
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
  );

  return (
    <div className="board-wrap" ref={wrapRef}>
      {wide ? (
        <div className="board-main">
          <div className="names-col">
            <NameLabel
              side={top}
              name={nameOf(top)}
              hand={position.hands[top]}
              upsideDown
              interactive={interactive && handSide === top}
              selectedType={selected?.kind === 'hand' && handSide === top ? selected.type : null}
              onClick={onHandPieceClick}
            />
            <NameLabel
              side={bottom}
              name={nameOf(bottom)}
              hand={position.hands[bottom]}
              interactive={interactive && handSide === bottom}
              selectedType={selected?.kind === 'hand' && handSide === bottom ? selected.type : null}
              onClick={onHandPieceClick}
            />
          </div>
          <div className="board-stack">{boardFrame}</div>
        </div>
      ) : (
        <div className="board-stack">
          <HandRow
            color={top}
            name={nameOf(top)}
            hand={position.hands[top]}
            upsideDown
            interactive={interactive && handSide === top}
            selectedType={selected?.kind === 'hand' && handSide === top ? selected.type : null}
            onClick={onHandPieceClick}
          />
          {boardFrame}
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
      )}
    </div>
  );
}

/**
 * Le nom, à côté du plateau, avec ses pièces prises en dessous — plus le
 * plateau grandit, plus un ruban pleine largeur pour quelques mots se voyait
 * vide. Sans fond ni cadre : ce n'est plus une carte à remplir, juste une
 * étiquette. En haut et en bas de la colonne (`justify-content: space-between`
 * sur `.names-col`), ce qui l'aligne sur le haut et le bas du goban : lui seul
 * occupe encore `.board-stack` en mode large, rien ne les écarte plus.
 */
function NameLabel({
  side,
  name,
  hand,
  upsideDown,
  interactive,
  selectedType,
  onClick,
}: {
  side: Color;
  name?: string;
  hand: Record<Exclude<PieceType, 'K'>, number>;
  upsideDown?: boolean;
  interactive?: boolean;
  selectedType?: PieceType | null;
  onClick?: (type: PieceType) => void;
}) {
  const pieces = HAND_PIECE_ORDER.filter((t) => hand[t] > 0);
  return (
    <div className="name-label">
      <span className="name-label-side">{side === 'b' ? '▲ Sente' : '△ Gote'}</span>
      {name && <span className="name-label-name">{name}</span>}
      <HandPieces
        pieces={pieces}
        hand={hand}
        upsideDown={upsideDown}
        interactive={interactive}
        selectedType={selectedType}
        onClick={onClick}
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
      <HandPieces
        pieces={pieces}
        hand={hand}
        upsideDown={upsideDown}
        interactive={interactive}
        selectedType={selectedType}
        onClick={onClick}
      />
    </div>
  );
}

/**
 * Les pièces prises, seules — partagé entre `HandRow` (ruban, sous 500 px de
 * colonne) et `NameLabel` (à côté du plateau, au-dessus). Rien n'est rendu à
 * mains vides : un tiret sans rien à côté ne disait rien qu'un blanc ne dise
 * aussi bien, et flottait, seul, au-dessus ou en dessous du goban.
 */
function HandPieces({
  pieces,
  hand,
  upsideDown,
  interactive,
  selectedType,
  onClick,
}: {
  pieces: Exclude<PieceType, 'K'>[];
  hand: Record<Exclude<PieceType, 'K'>, number>;
  upsideDown?: boolean;
  interactive?: boolean;
  selectedType?: PieceType | null;
  onClick?: (type: PieceType) => void;
}) {
  if (pieces.length === 0) return null;
  return (
    <div className="hpieces">
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
  );
}
