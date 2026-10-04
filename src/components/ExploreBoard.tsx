import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { Ref } from 'react';
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
  /**
   * Temps de réflexion accordé au moteur pour répondre. Réglé au-dehors : le
   * curseur vit dans le panneau « Explorer », pas sous le plateau, où il
   * repoussait la navigation hors de l'écran.
   */
  replyMs: number;
  /**
   * Flèche du coup conseillé dans la variante, par camp. `gameArrows` ne
   * couvre que la partie suivie — une position jouée dans une variante n'a
   * jamais été analysée à l'avance, il faut donc que le moteur la cherche en
   * direct, à la cadence `replyMs`.
   */
  showArrowB: boolean;
  showArrowW: boolean;
  /**
   * Appelé au premier coup joué hors de la partie. Le panneau des réglages
   * d'exploration n'a d'intérêt qu'à partir de là : c'est le moment de le
   * montrer, plutôt que de laisser chercher où l'on règle ce qui vient de
   * changer sous les yeux.
   */
  onBranchStart?: () => void;
  /**
   * Signale l'état de la variante au parent : c'est lui qui porte les chevrons
   * flottants, et il doit savoir s'ils commandent la partie ou la variante.
   */
  onBranchState?: (state: { moves: number; thinking: boolean }) => void;
  ref?: Ref<ExploreBoardHandle>;
}

/**
 * Ce que le parent peut demander au plateau. Les chevrons vivent au-dehors —
 * ils flottent en bas de l'écran — mais dans une variante ce sont ces deux
 * gestes-là qu'ils doivent commander.
 */
export interface ExploreBoardHandle {
  /** Joue le coup que le moteur choisit dans la position courante. */
  playEngineMove: () => Promise<void>;
  /** Revient d'un coup (ou de deux, si le moteur avait répondu). */
  undo: () => void;
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
 * la partie n'est plus suivie, on tient les deux camps, et le moteur — sur
 * demande — dit ce qu'il jouerait.
 *
 * Le temps de réponse est réglable parce qu'il arbitre entre deux usages —
 * dérouler vite une idée, ou éprouver sérieusement une position. Une seconde
 * suffit pour la première, dix ne sont pas de trop pour la seconde.
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
  onBranchState,
  ref,
}: ExploreBoardProps) {
  const [branch, setBranch] = useState<{ base: string; moves: string[] } | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
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
    setEngineError(null);
    setSuggestArrow(null);
  }, [baseSfen]);

  const position = useMemo(
    () => (branch ? (replay(branch.base, branch.moves) ?? Position.fromSfen(baseSfen)) : Position.fromSfen(baseSfen)),
    [branch, baseSfen],
  );

  /*
   * La flèche verte suivait la partie (`gameArrows`, précalculée à l'analyse) :
   * dans une variante, la position n'a jamais été vue d'avance, il faut donc la
   * faire chercher au moteur. `thinking` (le coup du moteur demandé par « › »)
   * exclut cette recherche : la relancer en double gâcherait un calcul pour un
   * résultat qui va de toute façon être écrasé dès que le coup tombe.
   */
  useEffect(() => {
    if (!branch || thinking) {
      setSuggestArrow(null);
      return;
    }
    const mover = position.turn;
    if (!(mover === 'b' ? showArrowB : showArrowW)) {
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
                piece: r.bestMove[1] === '*' ? (r.bestMove[0] as PieceType) : undefined,
              }
            : null,
        );
      } catch {
        // Une flèche ratée n'empêche pas de continuer à explorer.
        if (!cancelled) setSuggestArrow(null);
      } finally {
        if (!cancelled) setSuggestThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branch, thinking, position, showArrowB, showArrowW, replyMs, ensureEngine]);

  const legalMoves = useMemo(
    () => generateLegalMoves(position, position.turn),
    [position],
  );

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

  /**
   * Demande son coup au moteur dans la position donnée et le joue.
   *
   * Le score renvoyé est celui du camp au trait dans cette position : on le
   * retourne pour l'afficher toujours du point de vue de celui qui vient de
   * jouer.
   */
  const engineMove = useCallback(
    async (base: string, moves: string[]) => {
      setThinking(true);
      setEngineError(null);
      try {
        const engine = await ensureEngine();
        const r = await engine.analyze(base, moves, { movetimeMs: replyMs });
        setEvalCp(-scoreToCp(r.scoreCp, r.scoreMate));
        const reply = r.bestMove;
        // `bestmove resign` : le moteur s'avoue battu. Il n'y a pas de coup à
        // jouer, et lui en inventer un serait mentir sur ce qu'il a dit.
        if (reply && replay(base, moves.concat(reply))) {
          setBranch({ base, moves: moves.concat(reply) });
        }
      } catch (e) {
        setEngineError((e as Error).message);
      } finally {
        setThinking(false);
      }
    },
    [ensureEngine, replyMs],
  );

  const play = (usi: string) => {
    const base = branch?.base ?? baseSfen;
    const moves = (branch?.moves ?? []).concat(usi);
    if (!replay(base, moves)) return;
    if (!branch) onBranchStart?.();
    setBranch({ base, moves });
    setSelected(null);
    // Le coup est joué, la main passe à l'autre camp, et c'est l'utilisateur qui
    // la tient. Le chevron « › » reste là pour demander son coup au moteur quand
    // on veut le voir.
    setEvalCp(null);
  };

  const destinations = (): Square[] => {
    if (!selected || thinking) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const tryMove = (to: Square) => {
    if (!selected || thinking) return;
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
    if (thinking || promptPromotion) return;
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
    if (thinking || promptPromotion) return;
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

  const undo = useCallback(() => {
    if (!branch) return;
    // On tient les deux camps : un seul coup à reprendre, c'est la main d'avant.
    const moves = branch.moves.slice(0, Math.max(0, branch.moves.length - 1));
    setBranch(moves.length ? { base: branch.base, moves } : null);
    setEvalCp(null);
    setSelected(null);
  }, [branch]);

  /*
   * Les chevrons flottants commandent la variante dès qu'elle existe : « › »
   * demande son coup au moteur, « ‹ » revient en arrière.
   */
  useImperativeHandle(
    ref,
    () => ({
      playEngineMove: async () => {
        if (!branch || thinking) return;
        await engineMove(branch.base, branch.moves);
      },
      undo,
    }),
    [branch, thinking, engineMove, undo],
  );

  useEffect(() => {
    onBranchState?.({ moves: branch?.moves.length ?? 0, thinking });
  }, [branch, thinking, onBranchState]);

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
        interactive={!thinking}
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
            {evalCp !== null && !thinking && (
              <span className="explore-eval">{evalCp > 0 ? `+${Math.round(evalCp)}` : Math.round(evalCp)}</span>
            )}
            {(thinking || suggestThinking) && (
              <span className="explore-thinking">le moteur réfléchit…</span>
            )}
          </div>
          <p className="explore-moves">{labels.join('  ')}</p>
          <div className="explore-actions">
            <button className="btn btn-ghost" onClick={undo} disabled={thinking}>
              ‹ Reculer
            </button>
            <button className="btn btn-ghost" onClick={() => setBranch(null)} disabled={thinking}>
              ↺ Revenir à la partie
            </button>
          </div>
        </div>
      )}

      {engineError && <p className="explore-hint">Le moteur n’a pas pu répondre : {engineError}</p>}
    </div>
  );
}

/**
 * Les réglages de l'exploration, séparés du plateau parce qu'ils se règlent une
 * fois et se lisent rarement — alors que le plateau et la navigation servent à
 * chaque coup. Ils vivent donc dans le panneau « Explorer ».
 *
 * Les cases « Flèche Sente / Gote » ne s'affichent ici que si le parent les
 * confie à ce panneau ; sur l'onglet Analyse elles sont déjà au-dessus des
 * onglets, où elles servent aussi bien à la partie qu'à la variante.
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
  onShowArrowB?: (on: boolean) => void;
  showArrowW: boolean;
  onShowArrowW?: (on: boolean) => void;
}) {
  return (
    <div className="explore-settings">
      {onShowArrowB && (
        <label className="explore-toggle">
          <input
            type="checkbox"
            checked={showArrowB}
            onChange={(e) => onShowArrowB(e.target.checked)}
          />
          <span>Flèche Sente</span>
        </label>
      )}
      {onShowArrowW && (
        <label className="explore-toggle">
          <input
            type="checkbox"
            checked={showArrowW}
            onChange={(e) => onShowArrowW(e.target.checked)}
          />
          <span>Flèche Gote</span>
        </label>
      )}
      {/* Le temps ne sert qu'à la flèche du coup conseillé et au coup du moteur
          demandé par « › » : sans flèche cochée, il ne règle plus que ce
          dernier, et reste donc toujours utile. */}
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
