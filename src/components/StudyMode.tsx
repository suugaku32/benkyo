import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import type { PlyEval } from '../analysis/analyze';
import { QUALITY_COLOR, QUALITY_LABEL_FR } from '../analysis/classify';
import type { MoveQuality } from '../analysis/classify';
import { Position } from '../shogi/position';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Color } from '../shogi/types';
import { usiToSquare } from '../shogi/types';
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
  reason: string;
  altMove: string;
}

type Match = 'hit' | 'close' | 'miss';

function matchFor(judgment: Judgment, quality: MoveQuality): Match {
  const diff = Math.abs(LEVEL_INDEX[judgment.level] - QUALITY_TO_LEVEL_INDEX[quality]);
  if (diff === 0) return 'hit';
  if (diff === 1) return 'close';
  return 'miss';
}

const MATCH_LABEL: Record<Match, string> = { hit: '✓ Bien vu', close: '≈ Proche', miss: '✗ Raté' };

interface StudyModeProps {
  plies: PlyEval[];
  moveLabels: string[]; // index i = label for ply i+1, comme dans MoveList
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
}

type Phase = 'pick' | 'review' | 'result';

export function StudyMode({ plies, moveLabels, flipped, blackName, whiteName }: StudyModeProps) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [side, setSide] = useState<Color>('b');
  const [idx, setIdx] = useState(0);
  const [judgments, setJudgments] = useState<Map<number, Judgment>>(new Map());
  const [reasonDraft, setReasonDraft] = useState('');
  const [altDraft, setAltDraft] = useState('');
  const [openDetail, setOpenDetail] = useState<number | null>(null);

  // Une nouvelle analyse (ou une partie rechargée) repart de zéro : les
  // jugements d'une étude précédente n'ont plus de sens sur une autre partie.
  useEffect(() => {
    setPhase('pick');
    setIdx(0);
    setJudgments(new Map());
    setOpenDetail(null);
  }, [plies]);

  const sidePlies = useMemo(() => plies.filter((p) => p.color === side), [plies, side]);

  // Le brouillon (raisonnement, alternative) est propre au coup affiché : en
  // changer efface ce qui n'a pas été validé par un clic sur un niveau.
  useEffect(() => {
    setReasonDraft('');
    setAltDraft('');
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

  const judge = (ply: number, level: UserLevel) => {
    setJudgments((prev) => {
      const next = new Map(prev);
      next.set(ply, { level, reason: reasonDraft.trim(), altMove: altDraft.trim() });
      return next;
    });
  };

  if (phase === 'pick') {
    return (
      <div className="study study-pick">
        <p className="study-intro">
          Choisissez le camp à étudier. Pour chaque coup qui vous semble mériter un arrêt : dites
          d'abord ce que vous en pensez et pourquoi, proposez éventuellement mieux, et regardez
          l'analyse seulement ensuite pour comparer votre raisonnement au sien.
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
    const position = Position.fromSfen(current.sfenAfter);
    const lastMove = {
      from: current.moveUsi.includes('*') ? null : usiToSquare(current.moveUsi.slice(0, 2)),
      to: usiToSquare(current.moveUsi.slice(2, 4)),
    };
    const judgment = judgments.get(current.ply) ?? null;
    const match = judgment ? matchFor(judgment, current.quality) : null;
    const isLast = idx >= sidePlies.length - 1;

    // Avancer ne demande pas d'avoir jugé le coup : certains coups n'ont rien
    // à juger (une suite forcée, une reprise évidente), et l'imposer forçait à
    // deviner un verdict juste pour continuer à lire la partie.
    const advance = () => {
      if (isLast) setPhase('result');
      else goTo(idx + 1);
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
        </p>

        <div className="study-body">
          <div className="study-board">
            <Board
              position={position}
              lastMove={lastMove}
              flipped={flipped}
              blackName={blackName}
              whiteName={whiteName}
            />
          </div>
          <div className="study-side">
            {!judgment ? (
              <div className="study-judge-form">
                <label className="study-field">
                  Pourquoi ? (votre raisonnement)
                  <textarea
                    className="study-textarea"
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    rows={3}
                    placeholder="Ex : améliore l'activité de la tour, prépare une percée sur l'aile…"
                  />
                </label>
                <label className="study-field">
                  Votre alternative (optionnel)
                  <input
                    className="study-input"
                    type="text"
                    value={altDraft}
                    onChange={(e) => setAltDraft(e.target.value)}
                    placeholder="Ex : 3三角成"
                  />
                </label>
                <div className="study-judge-buttons">
                  {LEVELS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="btn study-level-btn"
                      style={{ borderColor: l.colorVar, color: l.colorVar }}
                      onClick={() => judge(current.ply, l.id)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="study-verdict-inline">
                  <strong style={{ color: LEVEL_COLOR[judgment.level] }}>
                    Vous : {LEVEL_LABEL[judgment.level]}
                  </strong>
                  {judgment.reason && <span>« {judgment.reason} »</span>}
                  {judgment.altMove && <span>Votre alternative : {judgment.altMove}</span>}
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
                      Coup recommandé :{' '}
                      {formatUsiMoveAsKif(Position.fromSfen(current.sfenBefore), current.bestMove, null)}
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
                    {judgment?.reason && <span>« {judgment.reason} »</span>}
                    {judgment?.altMove && <span>Votre alternative : {judgment.altMove}</span>}
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
