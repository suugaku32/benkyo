import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import type { PlyEval } from '../analysis/analyze';
import { QUALITY_COLOR, QUALITY_LABEL_FR, scoreToCp } from '../analysis/classify';
import type { MoveQuality } from '../analysis/classify';
import type { UsiEngine } from '../engine/UsiEngine';
import { Position } from '../shogi/position';
import { formatUsiMoveAsKif } from '../shogi/notation';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import type { Color, Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './StudyMode.css';

/**
 * Échelle à quatre niveaux plutôt qu'un simple bon/mauvais : c'est la façon
 * dont on commente une partie de shogi (良い手 / 普通 / 疑問手 / 悪手), et elle force
 * à trancher une nuance que le binaire écrasait — un coup honnête mais pas
 * optimal n'est pas la même chose qu'une vraie gaffe.
 */
type UserLevel = 'good' | 'normal' | 'dubious' | 'bad';

const LEVELS: { id: UserLevel; label: string; colorVar: string }[] = [
  { id: 'good', label: '良い手（bon coup）', colorVar: 'var(--status-good)' },
  { id: 'normal', label: '普通（normal）', colorVar: 'var(--status-inaccuracy)' },
  { id: 'dubious', label: '疑問手（coup douteux）', colorVar: 'var(--status-mistake)' },
  { id: 'bad', label: '悪手（mauvais coup）', colorVar: 'var(--status-blunder)' },
];
const LEVEL_INDEX: Record<UserLevel, number> = { good: 0, normal: 1, dubious: 2, bad: 3 };
const LEVEL_LABEL: Record<UserLevel, string> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l.label]),
) as Record<UserLevel, string>;
const LEVEL_COLOR: Record<UserLevel, string> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l.colorVar]),
) as Record<UserLevel, string>;

/**
 * Le moteur distingue cinq niveaux, l'utilisateur quatre : mistake et blunder
 * se confondent dans « 悪手 », le reste s'aligne un cran plus bas (un coup
 * « bon » selon le moteur, mais pas le meilleur, est un coup « normal » plutôt
 * qu'un coup à féliciter).
 */
const QUALITY_TO_LEVEL_INDEX: Record<MoveQuality, number> = {
  best: 0,
  good: 1,
  inaccuracy: 2,
  mistake: 3,
  blunder: 3,
};

interface Judgment {
  level: UserLevel;
  /** Coup proposé à la place, demandé dès que le niveau n'est pas 良い手. */
  altMove?: string;
  /** Évaluation réelle de ce coup par le moteur, du point de vue de qui l'a proposé. */
  altCp?: number;
}

type Match = 'hit' | 'close' | 'miss';

function matchFor(judgment: Judgment, quality: MoveQuality): Match {
  const diff = Math.abs(LEVEL_INDEX[judgment.level] - QUALITY_TO_LEVEL_INDEX[quality]);
  if (diff === 0) return 'hit';
  if (diff === 1) return 'close';
  return 'miss';
}

const MATCH_LABEL: Record<Match, string> = { hit: '✓ Bien vu', close: '≈ Proche', miss: '✗ Raté' };

function formatCp(cp: number): string {
  return `${cp > 0 ? '+' : ''}${Math.round(cp)}`;
}

interface StudyModeProps {
  plies: PlyEval[];
  moveLabels: string[]; // index i = label for ply i+1, comme dans MoveList
  ensureEngine: () => Promise<UsiEngine>;
  movetimeMs: number;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
}

type Phase = 'pick' | 'review' | 'result';

export function StudyMode({
  plies,
  moveLabels,
  ensureEngine,
  movetimeMs,
  flipped,
  blackName,
  whiteName,
}: StudyModeProps) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [side, setSide] = useState<Color>('b');
  const [idx, setIdx] = useState(0);
  const [judgments, setJudgments] = useState<Map<number, Judgment>>(new Map());
  const [openDetail, setOpenDetail] = useState<number | null>(null);

  /** Niveau choisi mais pas encore finalisé : on attend le coup alternatif. */
  const [pendingLevel, setPendingLevel] = useState<UserLevel | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [errorSquare, setErrorSquare] = useState<Square | null>(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [altAnalyzing, setAltAnalyzing] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);

  // Une nouvelle analyse (ou une partie rechargée) repart de zéro : les
  // jugements d'une étude précédente n'ont plus de sens sur une autre partie.
  useEffect(() => {
    setPhase('pick');
    setIdx(0);
    setJudgments(new Map());
    setOpenDetail(null);
  }, [plies]);

  const sidePlies = useMemo(() => plies.filter((p) => p.color === side), [plies, side]);

  // Changer de coup annule toute proposition en cours : elle n'a de sens que
  // pour le coup affiché au moment où elle a été demandée.
  useEffect(() => {
    setPendingLevel(null);
    setSelected(null);
    setErrorSquare(null);
    setPromptPromotion(null);
    setAltError(null);
  }, [idx, side]);

  const sideLabel = (c: Color) => (c === 'b' ? `▲ ${blackName || 'Sente'}` : `△ ${whiteName || 'Gote'}`);

  const startSide = (c: Color) => {
    setSide(c);
    setIdx(0);
    setJudgments(new Map());
    setOpenDetail(null);
    setPhase('review');
  };

  const goTo = (next: number) => {
    setIdx(Math.max(0, Math.min(sidePlies.length - 1, next)));
  };

  if (phase === 'pick') {
    return (
      <div className="study study-pick">
        <p className="study-intro">
          Choisissez le camp à étudier. Pour chaque coup qui vous semble mériter un arrêt :
          jugez-le d'abord (良い手・普通・疑問手・悪手) ; s'il n'est pas 良い手, proposez le coup que
          vous auriez joué à la place — il sera évalué par le moteur — puis seulement ensuite
          comparez avec le verdict réel.
        </p>
        <p className="study-intro">
          Pas besoin de juger chaque coup — les flèches avancent librement. Réservez le jugement
          aux coups qui vous surprennent ou vous laissent hésiter ; un coup de développement
          naturel n'a souvent rien à apprendre.
        </p>
        <div className="study-pick-buttons">
          <button className="btn btn-primary" onClick={() => startSide('b')}>
            {sideLabel('b')}
          </button>
          <button className="btn btn-primary" onClick={() => startSide('w')}>
            {sideLabel('w')}
          </button>
        </div>
      </div>
    );
  }

  if (sidePlies.length === 0) {
    return (
      <div className="study">
        <p className="study-empty">{sideLabel(side)} n'a joué aucun coup dans cette partie.</p>
        <button className="btn btn-ghost" onClick={() => setPhase('pick')}>
          ← Changer de camp
        </button>
      </div>
    );
  }

  if (phase === 'review') {
    const current = sidePlies[idx];
    const positionBefore = Position.fromSfen(current.sfenBefore);
    const positionAfter = Position.fromSfen(current.sfenAfter);
    const playedLastMove = {
      from: current.moveUsi.includes('*') ? null : usiToSquare(current.moveUsi.slice(0, 2)),
      to: usiToSquare(current.moveUsi.slice(2, 4)),
    };
    const judgment = judgments.get(current.ply) ?? null;
    const match = judgment ? matchFor(judgment, current.quality) : null;
    const isLast = idx >= sidePlies.length - 1;
    const isProposing = pendingLevel !== null;

    const advance = () => {
      if (isLast) setPhase('result');
      else goTo(idx + 1);
    };

    const finalize = (j: Judgment) => {
      setJudgments((prev) => {
        const next = new Map(prev);
        next.set(current.ply, j);
        return next;
      });
      setPendingLevel(null);
      setSelected(null);
    };

    const chooseLevel = (level: UserLevel) => {
      if (level === 'good') finalize({ level });
      else setPendingLevel(level);
    };

    const legalMoves = isProposing ? generateLegalMoves(positionBefore, positionBefore.turn) : [];

    const destinations = (): Square[] => {
      if (!selected) return [];
      if (selected.kind === 'hand') {
        return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
      }
      return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
    };

    const flashError = (sq: Square) => {
      setErrorSquare(sq);
      setTimeout(() => setErrorSquare(null), 450);
    };

    const submitAlt = async (usi: string) => {
      if (!pendingLevel) return;
      setAltAnalyzing(true);
      setAltError(null);
      try {
        const engine = await ensureEngine();
        const res = await engine.analyze(current.sfenBefore, [usi], { movetimeMs });
        // Le score revient du point de vue de l'adversaire — on le ramène à
        // celui de qui vient de jouer, comme en mode Entraînement.
        const altCp = -scoreToCp(res.scoreCp, res.scoreMate);
        finalize({ level: pendingLevel, altMove: usi, altCp });
      } catch (e) {
        setAltError((e as Error).message);
      } finally {
        setAltAnalyzing(false);
      }
    };

    const tryMove = (to: Square) => {
      if (!selected || altAnalyzing) return;
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
      void submitAlt(moveToUsi(candidates[0]));
    };

    const onSquareClick = (sq: Square) => {
      if (altAnalyzing || promptPromotion) return;
      const piece = positionBefore.pieceAt(sq);
      if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
        setSelected(null);
        return;
      }
      if (piece && piece.color === positionBefore.turn) {
        setSelected({ kind: 'square', sq });
        return;
      }
      if (selected) tryMove(sq);
    };

    const onHandPieceClick = (type: PieceType) => {
      if (altAnalyzing || promptPromotion) return;
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
      if (move) void submitAlt(moveToUsi(move));
    };

    return (
      <div className="study">
        <div className="study-floating-nav">
          <button
            type="button"
            className="study-floating-btn"
            onClick={() => goTo(idx - 1)}
            disabled={idx === 0}
            aria-label="Coup précédent"
          >
            ‹
          </button>
          <button
            type="button"
            className="study-floating-btn"
            onClick={advance}
            aria-label={isLast ? 'Voir le bilan' : 'Coup suivant'}
          >
            ›
          </button>
        </div>

        <div className="study-head">
          <label className="picker">
            <span className="picker-label">Coup</span>
            <select
              value={idx}
              onChange={(e) => goTo(Number(e.target.value))}
              aria-label="Choisir un coup"
            >
              {sidePlies.map((p, i) => (
                <option key={i} value={i}>
                  {i + 1}/{sidePlies.length} · {p.ply}. {moveLabels[p.ply - 1]}
                  {judgments.has(p.ply) ? ` · ${LEVEL_LABEL[judgments.get(p.ply)!.level]}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="study-nav">
            <button
              className="btn btn-ghost"
              onClick={() => goTo(idx - 1)}
              disabled={idx === 0}
              aria-label="Coup précédent"
            >
              ‹<span className="nav-word"> Précédent</span>
            </button>
            <button
              className="btn btn-ghost"
              onClick={advance}
              aria-label={isLast ? 'Voir le bilan' : 'Coup suivant'}
            >
              <span className="nav-word">{isLast ? 'Bilan ' : 'Suivant '}</span>›
            </button>
          </div>
        </div>

        <p className="study-prompt">
          Coup {current.ply} — <strong>{sideLabel(side)}</strong> joue{' '}
          <strong>{moveLabels[current.ply - 1]}</strong>.
          {isProposing && ' Sélectionnez le coup que vous auriez joué à la place.'}
        </p>

        <div className="study-body">
          <div className="study-board">
            <Board
              position={isProposing ? positionBefore : positionAfter}
              lastMove={isProposing ? null : playedLastMove}
              interactive={isProposing && !promptPromotion && !altAnalyzing}
              selected={isProposing ? selected : undefined}
              legalDestinations={isProposing ? destinations() : undefined}
              errorSquare={isProposing ? errorSquare : undefined}
              handSide={isProposing ? positionBefore.turn : undefined}
              flipped={flipped}
              blackName={blackName}
              whiteName={whiteName}
              onSquareClick={isProposing ? onSquareClick : undefined}
              onHandPieceClick={isProposing ? onHandPieceClick : undefined}
            />
          </div>
          <div className="study-side">
            {isProposing ? (
              <div className="study-propose">
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
                {altAnalyzing && <p className="study-hint">Analyse du coup…</p>}
                {altError && (
                  <p className="study-hint">
                    Le moteur n'a pas pu analyser ce coup : {altError}
                  </p>
                )}
                {!altAnalyzing && !promptPromotion && (
                  <button className="btn btn-ghost" onClick={() => setPendingLevel(null)}>
                    Ne pas proposer de coup
                  </button>
                )}
              </div>
            ) : !judgment ? (
              <div className="study-judge-buttons">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="btn study-level-btn"
                    style={{ borderColor: l.colorVar, color: l.colorVar }}
                    onClick={() => chooseLevel(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="study-verdict-inline">
                  <strong style={{ color: LEVEL_COLOR[judgment.level] }}>
                    Vous : {LEVEL_LABEL[judgment.level]}
                  </strong>
                  {judgment.altMove && (
                    <span>
                      Votre coup : {formatUsiMoveAsKif(positionBefore, judgment.altMove, null)}
                      {judgment.altCp !== undefined ? ` — évalué à ${formatCp(judgment.altCp)}` : ''}
                    </span>
                  )}
                </div>
                <div className={`study-verdict-inline study-verdict-${match}`}>
                  <strong>{MATCH_LABEL[match!]}</strong>
                  <span style={{ color: QUALITY_COLOR[current.quality] }}>
                    Analyse : {QUALITY_LABEL_FR[current.quality]}
                    {current.centipawnLoss > 0
                      ? ` — perte de ${Math.round(current.centipawnLoss)} cp`
                      : ''}
                  </span>
                  {current.bestMove && current.quality !== 'best' && (
                    <span>
                      Coup recommandé : {formatUsiMoveAsKif(positionBefore, current.bestMove, null)}
                    </span>
                  )}
                </div>
                <button className="btn btn-primary" onClick={advance}>
                  {isLast ? 'Voir le bilan →' : 'Coup suivant →'}
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => setPhase('result')}>
              Voir le bilan à tout moment
            </button>
          </div>
        </div>
      </div>
    );
  }

  // phase === 'result'
  const judgedCount = sidePlies.filter((p) => judgments.has(p.ply)).length;
  const skippedCount = sidePlies.length - judgedCount;
  const matches = sidePlies
    .filter((p) => judgments.has(p.ply))
    .map((p) => matchFor(judgments.get(p.ply)!, p.quality));
  const hits = matches.filter((m) => m === 'hit').length;
  const close = matches.filter((m) => m === 'close').length;
  const misses = matches.filter((m) => m === 'miss').length;

  let verdictText: string;
  if (judgedCount === 0) {
    verdictText = `Aucun coup jugé chez ${sideLabel(side)} — parcourez la partie et donnez votre avis sur ceux qui vous interpellent.`;
  } else {
    verdictText = `Sur ${judgedCount} coup${judgedCount > 1 ? 's' : ''} jugé${judgedCount > 1 ? 's' : ''} : ${hits} bien vu${hits > 1 ? 's' : ''}, ${close} proche${close > 1 ? 's' : ''}, ${misses} raté${misses > 1 ? 's' : ''}${skippedCount > 0 ? ` · ${skippedCount} non jugé${skippedCount > 1 ? 's' : ''}` : ''}.`;
  }

  return (
    <div className="study study-result">
      <p className="study-verdict">{verdictText}</p>

      <ol className="study-rows">
        {sidePlies.map((p) => {
          const judgment = judgments.get(p.ply) ?? null;
          const match = judgment ? matchFor(judgment, p.quality) : null;
          const status = match ?? 'skipped';
          const before = Position.fromSfen(p.sfenBefore);
          const isOpen = openDetail === p.ply;
          return (
            <li key={p.ply} className={`study-row study-row-${status}`}>
              <button
                type="button"
                className="study-row-main"
                onClick={() => setOpenDetail(isOpen ? null : p.ply)}
                aria-expanded={isOpen}
              >
                <span className="study-row-icon">{STATUS_ICON[status]}</span>
                <span className="study-row-move">
                  {p.ply}. {moveLabels[p.ply - 1]}
                </span>
                <span className="study-row-label">
                  {judgment ? MATCH_LABEL[match!] : 'Non jugé'}
                </span>
              </button>
              {isOpen && (
                <div className="study-row-detail">
                  {/* Le texte seul (« 3. 2六歩 ») ne dit rien de la position : on
                      montre le plateau au moment du coup, pas seulement sa
                      notation. */}
                  <div className="study-row-board">
                    <Board
                      position={Position.fromSfen(p.sfenAfter)}
                      lastMove={{
                        from: p.moveUsi.includes('*') ? null : usiToSquare(p.moveUsi.slice(0, 2)),
                        to: usiToSquare(p.moveUsi.slice(2, 4)),
                      }}
                      flipped={flipped}
                      blackName={blackName}
                      whiteName={whiteName}
                      cellSize={32}
                    />
                  </div>
                  <div className="study-row-text">
                    {judgment && (
                      <span style={{ color: LEVEL_COLOR[judgment.level] }}>
                        Vous : {LEVEL_LABEL[judgment.level]}
                      </span>
                    )}
                    {judgment?.altMove && (
                      <span>
                        Votre coup : {formatUsiMoveAsKif(before, judgment.altMove, null)}
                        {judgment.altCp !== undefined ? ` — évalué à ${formatCp(judgment.altCp)}` : ''}
                      </span>
                    )}
                    <span style={{ color: QUALITY_COLOR[p.quality] }}>
                      Analyse : {QUALITY_LABEL_FR[p.quality]}
                      {p.centipawnLoss > 0 ? ` — perte de ${Math.round(p.centipawnLoss)} cp` : ''}
                    </span>
                    {p.bestMove && p.quality !== 'best' && (
                      <span>Coup recommandé : {formatUsiMoveAsKif(before, p.bestMove, null)}</span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="study-result-actions">
        <button className="btn btn-ghost" onClick={() => setPhase('pick')}>
          ← Changer de camp
        </button>
        <button className="btn btn-ghost" onClick={() => startSide(side)}>
          ↻ Recommencer {sideLabel(side)}
        </button>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<Match | 'skipped', string> = {
  hit: '✓',
  close: '≈',
  miss: '✗',
  skipped: '·',
};
