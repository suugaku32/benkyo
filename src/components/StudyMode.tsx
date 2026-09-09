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

const BAD_QUALITIES = new Set<MoveQuality>(['inaccuracy', 'mistake', 'blunder']);

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
  /** Coups déjà jugés (bon ou mauvais) — distinct de `marks`, qui ne garde que les « mauvais ». */
  const [judged, setJudged] = useState<Set<number>>(new Set());
  const [marks, setMarks] = useState<Set<number>>(new Set());
  const [openDetail, setOpenDetail] = useState<number | null>(null);

  // Une nouvelle analyse (ou une partie rechargée) repart de zéro : les marques
  // d'une étude précédente n'ont plus de sens sur une autre partie.
  useEffect(() => {
    setPhase('pick');
    setIdx(0);
    setJudged(new Set());
    setMarks(new Set());
    setOpenDetail(null);
  }, [plies]);

  const sidePlies = useMemo(() => plies.filter((p) => p.color === side), [plies, side]);

  const sideLabel = (c: Color) => (c === 'b' ? `▲ ${blackName || 'Sente'}` : `△ ${whiteName || 'Gote'}`);

  const startSide = (c: Color) => {
    setSide(c);
    setIdx(0);
    setJudged(new Set());
    setMarks(new Set());
    setOpenDetail(null);
    setPhase('review');
  };

  const goTo = (next: number) => {
    setIdx(Math.max(0, Math.min(sidePlies.length - 1, next)));
  };

  /** Enregistre le jugement du coup courant et révèle aussitôt le verdict réel. */
  const judge = (ply: number, bad: boolean) => {
    setJudged((prev) => new Set(prev).add(ply));
    setMarks((prev) => {
      const next = new Set(prev);
      if (bad) next.add(ply);
      else next.delete(ply);
      return next;
    });
  };

  if (phase === 'pick') {
    return (
      <div className="study study-pick">
        <p className="study-intro">
          Choisissez le camp à étudier. Ses coups défileront un à un ; pour chacun, dites s'il
          vous semble bon ou mauvais et le verdict de l'analyse tombe aussitôt.
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
    const isJudged = judged.has(current.ply);
    const judgedBad = marks.has(current.ply);
    const actuallyBad = BAD_QUALITIES.has(current.quality);
    const correct = judgedBad === actuallyBad;
    const isLast = idx >= sidePlies.length - 1;
    const canAdvance = isJudged && !isLast;

    const advance = () => {
      if (isJudged) {
        if (isLast) setPhase('result');
        else goTo(idx + 1);
      }
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
            disabled={!canAdvance}
            aria-label="Coup suivant"
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
                  {judged.has(p.ply) ? (marks.has(p.ply) ? ' ⚑' : ' ✓') : ''}
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
              disabled={!isJudged}
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
            {!isJudged ? (
              <div className="study-judge-buttons">
                <button
                  type="button"
                  className="btn study-btn-bad"
                  onClick={() => judge(current.ply, true)}
                >
                  ✗ Mauvais coup
                </button>
                <button
                  type="button"
                  className="btn study-btn-good"
                  onClick={() => judge(current.ply, false)}
                >
                  ✓ Bon coup
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`study-verdict-inline ${correct ? 'study-verdict-correct' : 'study-verdict-wrong'}`}
                >
                  <strong>{correct ? '✓ Bien vu' : '✗ Raté'}</strong>
                  <span style={{ color: QUALITY_COLOR[current.quality] }}>
                    {QUALITY_LABEL_FR[current.quality]}
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
  const rows = sidePlies.map((p) => ({
    p,
    marked: marks.has(p.ply),
    actuallyBad: BAD_QUALITIES.has(p.quality),
  }));
  const truePositives = rows.filter((r) => r.marked && r.actuallyBad).length;
  const falsePositives = rows.filter((r) => r.marked && !r.actuallyBad).length;
  const actualBadCount = rows.filter((r) => r.actuallyBad).length;

  let verdictText: string;
  if (actualBadCount === 0) {
    verdictText =
      falsePositives === 0
        ? `Aucun coup faible détecté chez ${sideLabel(side)} sur cette partie — et vous n'en avez signalé aucun.`
        : `Aucun coup faible détecté chez ${sideLabel(side)} sur cette partie, mais vous en avez signalé ${falsePositives} qui tenai${falsePositives > 1 ? 'ent' : 't'} la route.`;
  } else if (truePositives === actualBadCount && falsePositives === 0) {
    verdictText = `Repérage parfait : les ${actualBadCount} coup${actualBadCount > 1 ? 's' : ''} faible${actualBadCount > 1 ? 's' : ''} de la partie, ni plus ni moins.`;
  } else {
    verdictText = `Trouvés : ${truePositives}/${actualBadCount} coup${actualBadCount > 1 ? 's' : ''} faible${actualBadCount > 1 ? 's' : ''} · Fausses alertes : ${falsePositives}.`;
  }

  return (
    <div className="study study-result">
      <p className="study-verdict">{verdictText}</p>

      <ol className="study-rows">
        {rows.map(({ p, marked, actuallyBad }) => {
          const status: 'hit' | 'miss' | 'false-alarm' | 'quiet' = marked
            ? actuallyBad
              ? 'hit'
              : 'false-alarm'
            : actuallyBad
              ? 'miss'
              : 'quiet';
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
                <span className="study-row-label">{STATUS_LABEL_FR[status]}</span>
              </button>
              {isOpen && (
                <div className="study-row-detail">
                  <span style={{ color: QUALITY_COLOR[p.quality] }}>
                    {QUALITY_LABEL_FR[p.quality]}
                    {p.centipawnLoss > 0 ? ` — perte de ${Math.round(p.centipawnLoss)} cp` : ''}
                  </span>
                  {p.bestMove && p.quality !== 'best' && (
                    <span>Coup recommandé : {formatUsiMoveAsKif(before, p.bestMove, null)}</span>
                  )}
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

const STATUS_ICON: Record<'hit' | 'miss' | 'false-alarm' | 'quiet', string> = {
  hit: '✓',
  miss: '✗',
  'false-alarm': '⚠',
  quiet: '·',
};

const STATUS_LABEL_FR: Record<'hit' | 'miss' | 'false-alarm' | 'quiet', string> = {
  hit: 'Trouvé',
  miss: 'Manqué',
  'false-alarm': 'Fausse alerte',
  quiet: 'Bon coup',
};
