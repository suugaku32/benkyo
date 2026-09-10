import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import type { BoardArrow } from './Board';
import type { UsiEngine } from '../engine/UsiEngine';
import { scoreToCp } from '../analysis/classify';
import { Position } from '../shogi/position';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './ExploreBoard.css';

interface ExploreBoardProps {
  /** Position de la partie actuellement affichée : le point de départ possible. */
  baseSfen: string;
  ensureEngine: () => Promise<UsiEngine>;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
  /** Flèche du coup recommandé, tant qu'on n'a pas quitté la partie. */
  gameArrows?: BoardArrow[];
  lastMove?: { from: Square | null; to: Square } | null;
  /** Temps de réflexion accordé au moteur pour chercher la flèche conseillée. */
  replyMs: number;
  /** Flèche du coup conseillé dans la variante, cherchée en direct, par camp. */
  showArrowB: boolean;
  showArrowW: boolean;
  /**
   * Appelé au premier coup joué hors de la partie. Le panneau « Explorer »
   * n'a d'intérêt qu'à partir de là : c'est le moment de le montrer, plutôt
   * que de laisser chercher où l'on règle ce qui vient de changer sous les yeux.
   */
  onBranchStart?: () => void;
}

/** Rejoue une séquence depuis un SFEN. `null` si elle est invalide. */
function replay(sfen: string, moves: string[]): Position | null {
  try {
    const p = Position.fromSfen(sfen);
    for (const m of moves) p.applyUsiMove(m);
    return p;
  } catch {
    return null;
  }
}

/**
 * Le plateau d'analyse, mais jouable.
 *
 * « Et si j'avais joué ça ? » est la question qu'on se pose devant une partie,
 * et à laquelle une courbe ne répond pas. Jouer un coup ouvre un embranchement :
 * la partie n'est plus suivie, et les deux camps se jouent à la main — aucun
 * adversaire ne s'invite tout seul dans la variante, seule la flèche du coup
 * conseillé aide à juger.
 */
export function ExploreBoard({
  baseSfen,
  ensureEngine,
  flipped,
  blackName,
  whiteName,
  gameArrows,
  lastMove,
  replyMs,
  showArrowB,
  showArrowW,
  onBranchStart,
}: ExploreBoardProps) {
  const [branch, setBranch] = useState<{ base: string; moves: string[] } | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  /** Flèche du coup conseillé dans la variante, cherchée en direct. */
  const [suggestArrow, setSuggestArrow] = useState<BoardArrow | null>(null);
  const [suggestThinking, setSuggestThinking] = useState(false);

  /*
   * Naviguer dans la partie abandonne l'embranchement. L'alternative — le
   * garder et rendre la main plus tard — obligerait à choisir en permanence
   * entre deux positions affichées, pour une idée qu'on explore le plus souvent
   * d'un trait.
   */
  useEffect(() => {
    setBranch(null);
    setSelected(null);
    setEvalCp(null);
    setSuggestArrow(null);
  }, [baseSfen]);

  const position = useMemo(
    () => (branch ? (replay(branch.base, branch.moves) ?? Position.fromSfen(baseSfen)) : Position.fromSfen(baseSfen)),
    [branch, baseSfen],
  );

  /*
   * La flèche verte suivait la partie (`gameArrows`, précalculée à l'analyse) :
   * dans une variante, la position n'a jamais été vue d'avance, il faut donc la
   * faire chercher au moteur — et son évaluation avec, puisque la recherche la
   * donne de toute façon.
   */
  useEffect(() => {
    if (!branch) {
      setSuggestArrow(null);
      setEvalCp(null);
      return;
    }
    const showForMover = position.turn === 'b' ? showArrowB : showArrowW;
    if (!showForMover) {
      setSuggestArrow(null);
      setEvalCp(null);
      return;
    }
    let cancelled = false;
    setSuggestThinking(true);
    (async () => {
      try {
        const engine = await ensureEngine();
        const r = await engine.analyze(branch.base, branch.moves, { movetimeMs: replyMs });
        if (cancelled) return;
        setEvalCp(scoreToCp(r.scoreCp, r.scoreMate));
        setSuggestArrow(
          r.bestMove
            ? {
                from: r.bestMove[1] === '*' ? null : usiToSquare(r.bestMove.slice(0, 2)),
                to: usiToSquare(r.bestMove.slice(2, 4)),
                kind: 'best',
                // `P*7f` : la lettre de tête est la pièce parachutée.
                piece: r.bestMove[1] === '*' ? (r.bestMove[0] as PieceType) : undefined,
              }
            : null,
        );
      } catch {
        // Une flèche ratée n'empêche pas de continuer à explorer.
        if (!cancelled) {
          setSuggestArrow(null);
          setEvalCp(null);
        }
      } finally {
        if (!cancelled) setSuggestThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branch, position, showArrowB, showArrowW, replyMs, ensureEngine]);

  const legalMoves = useMemo(() => generateLegalMoves(position, position.turn), [position]);

  const labels = useMemo(() => {
    if (!branch) return [];
    const out: string[] = [];
    const p = Position.fromSfen(branch.base);
    let previous: Square | null = null;
    for (const usi of branch.moves) {
      out.push(formatUsiMoveAsKif(p, usi, previous));
      previous = usiToSquare(usi.slice(2, 4));
      p.applyUsiMove(usi);
    }
    return out;
  }, [branch]);

  const play = (usi: string) => {
    const base = branch?.base ?? baseSfen;
    const moves = (branch?.moves ?? []).concat(usi);
    if (!replay(base, moves)) return;
    if (!branch) onBranchStart?.();
    setBranch({ base, moves });
    setSelected(null);
  };

  const destinations = (): Square[] => {
    if (!selected) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const tryMove = (to: Square) => {
    if (!selected) return;
    const from = selected;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (from.kind === 'hand') return !m.from && m.piece === from.type;
      return m.from != null && sameSquare(m.from, from.sq);
    });
    setSelected(null);
    if (candidates.length === 0) return;
    const promoting = candidates.filter((m) => m.promote);
    const plain = candidates.filter((m) => !m.promote);
    if (promoting.length > 0 && plain.length > 0) {
      setPromptPromotion({ from: plain[0].from!, to });
      return;
    }
    play(moveToUsi(candidates[0]));
  };

  const onSquareClick = (sq: Square) => {
    if (promptPromotion) return;
    if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
      setSelected(null);
      return;
    }
    const piece = position.pieceAt(sq);
    if (piece && piece.color === position.turn) {
      setSelected({ kind: 'square', sq });
      return;
    }
    if (selected) tryMove(sq);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (promptPromotion) return;
    setSelected((s) => (s?.kind === 'hand' && s.type === type ? null : { kind: 'hand', type }));
  };

  const resolvePromotion = (promote: boolean) => {
    if (!promptPromotion) return;
    const { from, to } = promptPromotion;
    setPromptPromotion(null);
    const move = legalMoves.find(
      (m) => m.from && sameSquare(m.from, from) && sameSquare(m.to, to) && m.promote === promote,
    );
    if (move) play(moveToUsi(move));
  };

  const undo = () => {
    if (!branch) return;
    const moves = branch.moves.slice(0, -1);
    setBranch(moves.length ? { base: branch.base, moves } : null);
    setSelected(null);
  };

  const branchLastMove = branch?.moves.length
    ? (() => {
        const usi = branch.moves[branch.moves.length - 1];
        return {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
      })()
    : null;

  return (
    <div className="analysis-board">
      <Board
        position={position}
        lastMove={branch ? branchLastMove : lastMove}
        interactive={!promptPromotion}
        selected={selected}
        legalDestinations={destinations()}
        handSide={position.turn}
        flipped={flipped}
        arrows={branch ? (suggestArrow ? [suggestArrow] : undefined) : gameArrows}
        blackName={blackName}
        whiteName={whiteName}
        onSquareClick={onSquareClick}
        onHandPieceClick={onHandPieceClick}
      />

      {promptPromotion && (
        <div className="promo-prompt">
          <span>Promouvoir ?</span>
          <button className="btn btn-primary" onClick={() => resolvePromotion(true)}>
            成 Oui
          </button>
          <button className="btn btn-ghost" onClick={() => resolvePromotion(false)}>
            Non
          </button>
        </div>
      )}

      {branch && (
        <div className="explore-branch">
          <div className="explore-branch-head">
            <span className="explore-branch-label">Votre variante</span>
            {evalCp !== null && !suggestThinking && (
              <span className="explore-eval">{evalCp > 0 ? `+${Math.round(evalCp)}` : Math.round(evalCp)}</span>
            )}
            {suggestThinking && <span className="explore-thinking">le moteur réfléchit…</span>}
          </div>
          <p className="explore-moves">{labels.join('  ')}</p>
          <div className="explore-actions">
            <button className="btn btn-ghost" onClick={undo}>
              ‹ Reculer
            </button>
            <button className="btn btn-ghost" onClick={() => setBranch(null)}>
              ↺ Revenir à la partie
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Les réglages de l'exploration, séparés du plateau parce qu'ils se règlent une
 * fois et se lisent rarement — alors que le plateau et la navigation servent à
 * chaque coup.
 */
export function ExploreSettings({
  replyMs,
  onReplyMs,
  showArrowB,
  onShowArrowB,
  showArrowW,
  onShowArrowW,
}: {
  replyMs: number;
  onReplyMs: (ms: number) => void;
  showArrowB: boolean;
  onShowArrowB: (on: boolean) => void;
  showArrowW: boolean;
  onShowArrowW: (on: boolean) => void;
}) {
  return (
    <div className="explore-settings">
      <label className="explore-toggle">
        <input
          type="checkbox"
          checked={showArrowB}
          onChange={(e) => onShowArrowB(e.target.checked)}
        />
        <span>Flèche Sente</span>
      </label>
      <label className="explore-toggle">
        <input
          type="checkbox"
          checked={showArrowW}
          onChange={(e) => onShowArrowW(e.target.checked)}
        />
        <span>Flèche Gote</span>
      </label>
      <label className="explore-time">
        <span>Temps de réflexion</span>
        <select
          value={replyMs}
          onChange={(e) => onReplyMs(Number(e.target.value))}
          aria-label="Temps de réflexion du moteur"
        >
          <option value={200}>0,2 s</option>
          <option value={500}>0,5 s</option>
          <option value={1000}>1 s</option>
          <option value={2000}>2 s</option>
          <option value={3000}>3 s</option>
          <option value={4000}>4 s</option>
          <option value={5000}>5 s</option>
        </select>
      </label>
    </div>
  );
}
