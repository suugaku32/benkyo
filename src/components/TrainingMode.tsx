import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import { VariationBar } from './VariationBar';
import { DeepenControl } from './DeepenControl';
import type { BoardArrow } from './Board';
import type { PlyEval } from '../analysis/analyze';
import type { UsiEngine } from '../engine/UsiEngine';
import { scoreToCp, QUALITY_LABEL_FR } from '../analysis/classify';
import { Position } from '../shogi/position';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './TrainingMode.css';

/** A user answer counts as correct if it loses at most this much vs the engine's best. */
const ACCEPT_MARGIN_CP = 50;

type Verdict =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** `exact` : le coup proposé *est* celui du moteur, pas seulement un coup toléré. */
  | { kind: 'correct'; playedCp: number; bestCp: number; usi: string; pv: string[]; exact: boolean }
  | { kind: 'wrong'; playedCp: number; bestCp: number; usi: string; pv: string[]; exact: false }
  /** Le moteur n'a pas pu démarrer : sans lui, impossible de juger un coup. */
  | { kind: 'engineError'; message: string }
  | { kind: 'revealed' };

/** Ligne rejouable montrée une fois la position résolue ou dévoilée. */
interface Line {
  label: string;
  tone: 'best' | 'played';
  baseSfen: string;
  moves: string[];
}

interface TrainingModeProps {
  /** Gaffes et erreurs à reprendre — pas seulement les gaffes. */
  mistakes: PlyEval[];
  /** Fournit le moteur, en le démarrant s'il ne l'est pas encore. */
  ensureEngine: () => Promise<UsiEngine>;
  /** Reprend cette position à la cadence demandée et met l'analyse à jour. */
  onDeepen?: (ply: number, movetimeMs: number) => Promise<void>;
  movetimeMs: number;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
  /**
   * Le coup regardé, à chaque changement — pour que l'onglet Analyse, si on
   * y revient, montre la même position plutôt que celle où il en était resté.
   */
  onPositionChange?: (ply: number) => void;
}

export function TrainingMode({
  mistakes,
  ensureEngine,
  onDeepen,
  movetimeMs,
  flipped,
  blackName,
  whiteName,
  onPositionChange,
}: TrainingModeProps) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [errorSquare, setErrorSquare] = useState<Square | null>(null);
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [solved, setSolved] = useState<Set<number>>(new Set());
  /** Suite en cours de lecture : quelle ligne, et combien de coups rejoués. */
  const [replay, setReplay] = useState<{ line: Line; index: number } | null>(null);
  const current = mistakes[idx];

  useEffect(() => {
    if (current) onPositionChange?.(current.ply);
  }, [current, onPositionChange]);

  const position = useMemo(
    () => (current ? Position.fromSfen(current.sfenBefore) : null),
    [current],
  );

  const legalMoves = useMemo(
    () => (position ? generateLegalMoves(position, position.turn) : []),
    [position],
  );

  // Atteindre la 7e gaffe demandait six appuis sur « suivante », sans jamais
  // voir ce que contenait la liste. Ces libellés la rendent consultable — la
  // qualité en tête distingue une gaffe d'une simple erreur dans une liste qui
  // mélange maintenant les deux.
  const labels = useMemo(
    () =>
      mistakes.map((b) => {
        const at = Position.fromSfen(b.sfenBefore);
        const side = b.color === 'b' ? '▲' : '△';
        return `${QUALITY_LABEL_FR[b.quality]} · ${b.ply}. ${side}${formatUsiMoveAsKif(at, b.moveUsi, null)} −${Math.round(
          b.centipawnLoss,
        )}`;
      }),
    [mistakes],
  );

  if (!current || !position) {
    return (
      <div className="training-empty">
        <p>Aucune erreur ni gaffe détectée dans cette partie — rien à réviser ici.</p>
      </div>
    );
  }

  const destinations = (): Square[] => {
    if (!selected) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves
      .filter((m) => m.from && sameSquare(m.from, selected.sq))
      .map((m) => m.to);
  };

  const flashError = (sq: Square) => {
    setErrorSquare(sq);
    setTimeout(() => setErrorSquare(null), 450);
  };

  const submitMove = async (usi: string) => {
    setVerdict({ kind: 'checking' });
    let engine: UsiEngine;
    try {
      engine = await ensureEngine();
    } catch (e) {
      setVerdict({ kind: 'engineError', message: (e as Error).message });
      return;
    }
    const after = await engine.analyze(current.sfenBefore, [usi], { movetimeMs });
    // Score comes back from the opponent's perspective — flip it to the mover's.
    const playedCp = -scoreToCp(after.scoreCp, after.scoreMate);

    /*
     * Une seule mesure, jamais deux.
     *
     * La référence est `current.evalBeforeCp` : le score de la position d'avant,
     * établi par l'analyse elle-même. C'est par définition la valeur du meilleur
     * coup, puisque c'est cette recherche qui l'a désigné. La recalculer en
     * jouant `bestMove` produisait un second chiffre, voisin mais différent, qui
     * contredisait la valeur affichée dans l'onglet Analyse — et pouvait rendre
     * un coup toléré « meilleur » que le meilleur. Deux mesures d'une même chose
     * ne s'accordent pas au centième près ; il n'y avait aucune raison d'en
     * produire une seconde.
     *
     * Jouer exactement le coup recommandé ne demande alors plus de mesure du
     * tout : il est juste par construction. C'était le vrai défaut d'origine —
     * la recherche partant de la position d'après pouvait rendre un score
     * inférieur à celui de la position de départ, instabilité ordinaire, et le
     * bon coup se faisait refuser.
     */
    const exact = !!current.bestMove && usi === current.bestMove;
    const bestCp = exact ? playedCp : current.evalBeforeCp;
    const correct = bestCp - playedCp <= ACCEPT_MARGIN_CP;
    // La variante renvoyée part de la position d'après le coup proposé : c'est
    // elle qui montre ce que devient la partie, et donc pourquoi le coup tient.
    if (correct) {
      setSolved((s) => new Set(s).add(idx));
      setVerdict({ kind: 'correct', playedCp, bestCp, usi, pv: after.pv, exact });
    } else {
      flashError(usiToSquare(usi.slice(2, 4)));
      setVerdict({ kind: 'wrong', playedCp, bestCp, usi, pv: after.pv, exact: false });
    }
  };

  const tryMove = (to: Square) => {
    if (!selected || verdict.kind === 'checking') return;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (selected.kind === 'hand') return !m.from && m.piece === selected.type;
      return m.from != null && sameSquare(m.from, selected.sq);
    });
    setSelected(null);
    if (candidates.length === 0) {
      flashError(to);
      return;
    }
    const promoting = candidates.filter((m) => m.promote);
    const plain = candidates.filter((m) => !m.promote);
    if (promoting.length > 0 && plain.length > 0) {
      setPromptPromotion({ from: plain[0].from!, to });
      return;
    }
    void submitMove(moveToUsi(candidates[0]));
  };

  const onSquareClick = (sq: Square) => {
    if (verdict.kind === 'checking' || promptPromotion) return;
    const piece = position.pieceAt(sq);
    if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
      setSelected(null);
      return;
    }
    if (piece && piece.color === position.turn) {
      setSelected({ kind: 'square', sq });
      return;
    }
    if (selected) tryMove(sq);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (verdict.kind === 'checking' || promptPromotion) return;
    if (selected?.kind === 'hand' && selected.type === type) {
      setSelected(null);
      return;
    }
    setSelected({ kind: 'hand', type });
  };

  const resolvePromotion = (promote: boolean) => {
    if (!promptPromotion) return;
    const { from, to } = promptPromotion;
    setPromptPromotion(null);
    const move = legalMoves.find(
      (m) => m.from && sameSquare(m.from, from) && sameSquare(m.to, to) && m.promote === promote,
    );
    if (move) void submitMove(moveToUsi(move));
  };

  const goTo = (next: number) => {
    setIdx(next);
    setSelected(null);
    setVerdict({ kind: 'idle' });
    setPromptPromotion(null);
    setErrorSquare(null);
    setReplay(null);
  };

  // Lignes proposées une fois la position résolue ou dévoilée. Jamais avant :
  // elles donneraient la réponse.
  const lines: Line[] = [];
  if (verdict.kind === 'correct' || verdict.kind === 'wrong') {
    /*
     * Les deux variantes partent de la *même* position, celle de l'exercice, et
     * commencent chacune par son propre coup. Auparavant « Meilleure suite »
     * incluait le coup du moteur tandis que celle-ci démarrait après le coup
     * proposé : on comparait donc deux colonnes décalées d'un demi-coup, l'une
     * ouvrant sur un coup de Sente et l'autre sur la réponse de Gote.
     */
    if (verdict.pv.length) {
      lines.push({
        label: verdict.kind === 'correct' ? 'Votre coup, la suite' : 'Après votre coup',
        tone: verdict.kind === 'correct' ? 'best' : 'played',
        baseSfen: current.sfenBefore,
        moves: [verdict.usi, ...verdict.pv],
      });
    }
  }
  if (verdict.kind === 'revealed' || verdict.kind === 'correct') {
    /*
     * Quand le coup proposé *est* celui du moteur, « Meilleure suite » fait
     * doublon avec « Votre coup, la suite » : même premier coup, donc même
     * position. Les deux lignes divergent pourtant dès le deuxième coup, l'une
     * venant de la recherche faite à l'instant et l'autre de celle de
     * l'analyse. C'est une transposition, pas un désaccord — mais rien ne le
     * dit à l'écran, et deux variantes pour un seul coup n'apprennent rien.
     *
     * On la garde partout ailleurs : dévoilée, elle *est* la réponse ; face à
     * un coup différent, elle montre ce qu'il fallait jouer.
     */
    const redondante = verdict.kind === 'correct' && verdict.exact;
    if (current.bestMovePv.length && !redondante) {
      lines.push({
        label: 'Meilleure suite',
        tone: 'best',
        baseSfen: current.sfenBefore,
        moves: current.bestMovePv,
      });
    }
  }

  /*
   * La ligne « meilleure suite » — ou, quand le coup proposé l'est déjà,
   * « Votre coup, la suite » qui porte alors le même ton : les chevrons
   * flottants n'ont qu'une suite à dérouler, jamais deux à la fois.
   */
  const bestLine = lines.find((l) => l.tone === 'best') ?? null;
  const stepBestLine = (delta: -1 | 1) => {
    if (!bestLine) return;
    const at = replay?.line.label === bestLine.label ? replay.index : 0;
    const next = at + delta;
    if (next < 0 || next > bestLine.moves.length) return;
    setReplay(next === 0 ? null : { line: bestLine, index: next });
  };

  // Le plateau suit la suite en cours de lecture, sinon la position de l'exercice.
  // Pas de useMemo ici : ce code vit après le retour anticipé plus haut, et un
  // hook conditionnel casserait l'ordre des hooks entre deux rendus. Rejouer une
  // poignée de coups ne coûte rien.
  const replayView = ((): {
    position: Position;
    lastMove: { from: Square | null; to: Square } | null;
    next: string | null;
  } | null => {
    if (!replay) return null;
    try {
      const pos = Position.fromSfen(replay.line.baseSfen);
      let last: { from: Square | null; to: Square } | null = null;
      for (const usi of replay.line.moves.slice(0, replay.index)) {
        last = {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
        pos.applyUsiMove(usi);
      }
      return { position: pos, lastMove: last, next: replay.line.moves[replay.index] ?? null };
    } catch {
      return null;
    }
  })();

  // Rien n'est montré tant que la position n'est pas résolue ou dévoilée : une
  // flèche affichée trop tôt donnerait la réponse.
  const arrows: BoardArrow[] = [];
  const toArrow = (usi: string, kind: BoardArrow['kind']): BoardArrow => ({
    from: usi[1] === '*' ? null : usiToSquare(usi.slice(0, 2)),
    to: usiToSquare(usi.slice(2, 4)),
    kind,
    // `P*7f` : la lettre de tête est la pièce parachutée.
    piece: usi[1] === '*' ? (usi[0] as PieceType) : undefined,
  });
  if (replayView) {
    if (replayView.next) arrows.push(toArrow(replayView.next, 'best'));
  } else {
    // Le coup joué est déjà nommé dans l'énoncé : la flèche rouge n'ajoute aucun
    // indice, elle rend seulement le contexte lisible sans chercher les cases.
    arrows.push(toArrow(current.moveUsi, 'played'));
    if (verdict.kind === 'revealed' && current.bestMove) {
      arrows.push(toArrow(current.bestMove, 'best'));
    } else if (verdict.kind === 'correct') {
      arrows.push(toArrow(verdict.usi, 'best'));
    }
  }

  const playedLabel =
    verdict.kind === 'correct' || verdict.kind === 'wrong'
      ? formatUsiMoveAsKif(position, verdict.usi, null)
      : '';
  const bestLabel = current.bestMove
    ? formatUsiMoveAsKif(position, current.bestMove, null)
    : '—';
  const actualLabel = formatUsiMoveAsKif(position, current.moveUsi, null);
  const bestLineAt = bestLine && replay?.line.label === bestLine.label ? replay.index : 0;

  return (
    <div className="training">
      <div className="training-head">
        <div className="training-progress">
          <label className="picker">
            <span className="picker-label">Coup</span>
            <select
              value={idx}
              onChange={(e) => goTo(Number(e.target.value))}
              aria-label="Choisir un coup à revoir"
            >
              {labels.map((text, i) => (
                <option key={i} value={i}>
                  {i + 1}/{mistakes.length} · {text}
                  {solved.has(i) ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="training-solved">{solved.size} résolue(s)</span>
        </div>
        {/*
          N'apparaissent qu'une fois la solution affichée (résolue ou
          dévoilée) — avant, il n'y a pas de suite à dérouler, et les
          afficher inactifs n'aurait rien appris de plus que le sélecteur
          ci-dessus, qui reste la façon de changer de coup à revoir.
        */}
        {bestLine && (
          <div className="training-nav float-nav">
            <button
              className="btn btn-ghost"
              onClick={() => stepBestLine(-1)}
              disabled={bestLineAt === 0}
              aria-label="Coup précédent de la meilleure suite"
            >
              ‹<span className="nav-word"> Précédente</span>
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => stepBestLine(1)}
              disabled={bestLineAt >= bestLine.moves.length}
              aria-label="Coup suivant de la meilleure suite"
            >
              <span className="nav-word">Suivante </span>›
            </button>
          </div>
        )}
      </div>

      <p className="training-prompt">
        Coup {current.ply} — c'est à{' '}
        <strong>
          {current.color === 'b' ? '▲ Sente' : '△ Gote'}
          {(current.color === 'b' ? blackName : whiteName)
            ? ` (${current.color === 'b' ? blackName : whiteName})`
            : ''}
        </strong>{' '}
        de jouer. Dans la partie : <strong className="training-played">{actualLabel}</strong>, qui a
        coûté <strong>{Math.round(current.centipawnLoss)}</strong> centipions.{' '}
        <strong>Trouvez mieux.</strong>
      </p>

      <div className="training-body">
        <div className="training-board">
          <Board
            position={replayView ? replayView.position : position}
            lastMove={replayView ? replayView.lastMove : null}
            interactive={
              !replayView && verdict.kind !== 'correct' && verdict.kind !== 'revealed'
            }
            selected={selected}
            legalDestinations={replayView ? [] : destinations()}
            errorSquare={errorSquare}
            handSide={position.turn}
            flipped={flipped}
            arrows={arrows}
            blackName={blackName}
            whiteName={whiteName}
            onSquareClick={onSquareClick}
            onHandPieceClick={onHandPieceClick}
          />
          {replayView && (
            <p className="variation-hint">
              Suite du moteur — le plateau ne montre plus la position de l'exercice.
            </p>
          )}
        </div>

        <div className="training-side">
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

          {verdict.kind === 'idle' && !promptPromotion && (
            <p className="training-hint">
              Sélectionnez une pièce puis sa case d'arrivée. Les coups légaux sont surlignés.
            </p>
          )}
          {verdict.kind === 'checking' && <p className="training-hint">Analyse du coup…</p>}

          {(verdict.kind === 'correct' || verdict.kind === 'wrong') && (
            <div className={`verdict verdict-${verdict.kind}`}>
              <strong>
                {verdict.kind === 'wrong'
                  ? '✗ Insuffisant'
                  : verdict.exact
                    ? '✓ C’est le coup du moteur'
                    : '✓ Coup acceptable'}{' '}
                — {playedLabel}
              </strong>
              {/*
               * Ne jamais laisser croire qu'un coup toléré est *le* coup du
               * moteur : la suite affichée plus bas part d'un autre coup, et
               * l'écart est incompréhensible tant qu'on n'a pas dit lequel.
               */}
              {!verdict.exact && current.bestMove && (
                <span>
                  Le moteur jouait <strong className="training-best">{bestLabel}</strong>
                </span>
              )}
              <span>
                Votre coup : {Math.round(verdict.playedCp)}
                {!verdict.exact && ` · analyse : ${Math.round(verdict.bestCp)}`}
              </span>
              {/*
               * Le second chiffre n'est pas une nouvelle mesure : c'est celui de
               * l'analyse, le même que dans l'onglet Analyse. Le premier vient
               * d'être établi. Deux recherches ne s'accordent pas au centième
               * près, et le coup proposé peut afficher un point de plus sans
               * pour autant valoir mieux — le dire évite d'y lire une
               * contradiction.
               */}
              {!verdict.exact && current.bestMove && (
                <span className="verdict-note">
                  Le second chiffre vient de l’analyse, pas d’un nouveau calcul. Un écart de cet
                  ordre ne départage pas les deux coups.
                </span>
              )}
              {verdict.kind === 'wrong' && (
                <button className="btn btn-ghost" onClick={() => setVerdict({ kind: 'idle' })}>
                  Réessayer
                </button>
              )}
            </div>
          )}

          {verdict.kind === 'engineError' && (
            <div className="verdict verdict-wrong">
              <strong>Le moteur n’a pas pu démarrer</strong>
              <span>{verdict.message}</span>
              <button className="btn btn-ghost" onClick={() => setVerdict({ kind: 'idle' })}>
                Réessayer
              </button>
            </div>
          )}

          {verdict.kind === 'revealed' && (
            <div className="verdict verdict-revealed">
              <strong>Meilleur coup : {bestLabel}</strong>
              <span>Coup joué dans la partie : {actualLabel}</span>
            </div>
          )}

          {onDeepen && (
            /*
             * Le complément d'une passe unique : quand un verdict paraît
             * douteux, on reprend *cette* position plus longtemps plutôt que de
             * relancer toute la partie. Le résultat écrase l'ancien, donc le
             * score de référence, le meilleur coup et les variantes repartent
             * tous de la nouvelle mesure — jamais deux chiffres concurrents
             * pour la même position.
             *
             * Deux recherches : la position d'avant le coup et celle d'après.
             */
            <DeepenControl
              searches={2}
              refined={current.refined}
              onRun={async (ms) => {
                await onDeepen(current.ply, ms);
                setVerdict({ kind: 'idle' });
                setReplay(null);
              }}
            />
          )}

          {lines.length > 0 && (
            <div className="training-lines">
              {lines.map((line) => (
                <VariationBar
                  key={line.label}
                  label={line.label}
                  tone={line.tone}
                  baseSfen={line.baseSfen}
                  moves={line.moves}
                  activeIndex={replay?.line.label === line.label ? replay.index : null}
                  onSelect={(i) => setReplay(i === null ? null : { line, index: i })}
                />
              ))}
            </div>
          )}

          {verdict.kind !== 'revealed' && verdict.kind !== 'correct' && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setVerdict({ kind: 'revealed' });
                setReplay(null);
              }}
            >
              Voir la solution
            </button>
          )}

          {(verdict.kind === 'correct' || verdict.kind === 'revealed') &&
            idx < mistakes.length - 1 && (
              <button className="btn btn-primary" onClick={() => goTo(idx + 1)}>
                Coup suivant ›
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
