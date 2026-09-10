import { useEffect, useMemo, useState } from 'react';
import { Board } from './Board';
import type { BoardArrow } from './Board';
import type { PlyEval } from '../analysis/analyze';
import { QUALITY_LABEL_FR, QUALITY_COLOR, cpToWinPercent } from '../analysis/classify';
import { Position } from '../shogi/position';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { PieceType } from '../shogi/types';
import { usiToSquare } from '../shogi/types';
import './QuizMode.css';

interface QuizModeProps {
  /** Dix coups (ou moins) à écart marqué, mélangés — voir `App.tsx`. */
  items: PlyEval[];
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
}

/**
 * Reconnaître un bon coup n'est pas la même chose que le trouver. L'entraînement
 * demande de produire le coup ; ici il s'agit seulement de juger celui qui a été
 * joué — un réflexe qu'on peut avoir sans savoir jouer soi-même la suite.
 */
export function QuizMode({ items, flipped, blackName, whiteName }: QuizModeProps) {
  const [idx, setIdx] = useState(0);
  const [guess, setGuess] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  // Une nouvelle sélection (partie rouverte, camp suivi changé) reprend le
  // quiz à zéro plutôt que de laisser l'index pointer sur une autre question.
  useEffect(() => {
    setIdx(0);
    setGuess(null);
    setScore(0);
    setDone(false);
  }, [items]);

  const current = items[idx];

  /*
   * La position *avant* le coup, pas après : deviner devant le résultat déjà
   * consommé (pièce prise disparue, position réorganisée) revient à juger un
   * fait accompli plutôt que le choix lui-même. La flèche rouge — même
   * convention que l'entraînement — montre quel coup juger sans dire s'il
   * était bon.
   */
  const beforePosition = useMemo(
    () => (current ? Position.fromSfen(current.sfenBefore) : null),
    [current],
  );
  const moveLabel = useMemo(() => {
    if (!current || !beforePosition) return '';
    try {
      return formatUsiMoveAsKif(Position.fromSfen(current.sfenBefore), current.moveUsi, null);
    } catch {
      return current.moveUsi;
    }
  }, [current, beforePosition]);
  const bestLabel = useMemo(() => {
    if (!current?.bestMove) return null;
    try {
      return formatUsiMoveAsKif(Position.fromSfen(current.sfenBefore), current.bestMove, null);
    } catch {
      return current.bestMove;
    }
  }, [current]);
  const playedArrow = useMemo((): BoardArrow | null => {
    if (!current) return null;
    const usi = current.moveUsi;
    return {
      from: usi[1] === '*' ? null : usiToSquare(usi.slice(0, 2)),
      to: usiToSquare(usi.slice(2, 4)),
      kind: 'played',
      piece: usi[1] === '*' ? (usi[0] as PieceType) : undefined,
    };
  }, [current]);

  if (items.length === 0) {
    return (
      <div className="quiz-empty">
        <p>
          Aucun coup avec un écart marqué dans cette partie — rien à deviner ici.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="quiz-done">
        <p className="quiz-score">
          {score} / {items.length} bonnes réponses
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setIdx(0);
            setGuess(null);
            setScore(0);
            setDone(false);
          }}
        >
          ↺ Recommencer
        </button>
      </div>
    );
  }

  if (!current || !beforePosition || !playedArrow) return null;

  const isGood = current.quality === 'best' || current.quality === 'good';
  const correct = guess !== null && guess === isGood;

  const submit = (guessedGood: boolean) => {
    if (guess !== null) return;
    setGuess(guessedGood);
    if (guessedGood === isGood) setScore((s) => s + 1);
  };

  const next = () => {
    if (idx + 1 >= items.length) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setGuess(null);
  };

  /*
   * En points de win %, pas en centipions bruts : c'est ce qui classe le
   * coup (voir `classifyLoss`), donc ce qui doit se lire ici. En centipions,
   * un coup qui creuse encore un avantage déjà écrasant peut swinguer de
   * plusieurs centaines de points sans rien perdre en % de victoire — un
   * « Meilleur coup » affichant un grand écart n'aurait aucun sens.
   */
  const loss = Math.max(
    0,
    cpToWinPercent(current.evalBeforeCp) - cpToWinPercent(current.evalAfterCp),
  );
  const lossLabel = loss.toFixed(1).replace('.', ',');

  return (
    <div className="quiz">
      <div className="quiz-head">
        <span>
          Coup {idx + 1}/{items.length}
        </span>
        <span className="quiz-running-score">{score} bonne(s) réponse(s)</span>
      </div>

      <p className="quiz-prompt">
        Coup {current.ply} —{' '}
        <strong>
          {current.color === 'b' ? '▲ Sente' : '△ Gote'}
          {(current.color === 'b' ? blackName : whiteName)
            ? ` (${current.color === 'b' ? blackName : whiteName})`
            : ''}
        </strong>{' '}
        a joué <strong>{moveLabel}</strong>. Était-ce un bon coup ?
      </p>

      {/*
        Au-dessus du plateau, pas en dessous : sur l'onglet Analyse cette
        place est celle de la courbe, absente ici — la remplir plutôt que la
        laisser vide évite de faire défiler jusque sous le plateau pour
        répondre ou lire le verdict.
      */}
      {guess === null ? (
        <div className="quiz-actions">
          <button className="btn btn-primary" onClick={() => submit(true)}>
            ✓ Bon coup
          </button>
          <button className="btn btn-ghost" onClick={() => submit(false)}>
            ✗ Pas un bon coup
          </button>
        </div>
      ) : (
        <div className={`quiz-verdict ${correct ? 'quiz-verdict-correct' : 'quiz-verdict-wrong'}`}>
          <strong>{correct ? '✓ Bonne réponse' : '✗ Mauvaise réponse'}</strong>
          <span style={{ color: QUALITY_COLOR[current.quality] }}>
            {QUALITY_LABEL_FR[current.quality]}
          </span>
          <span>Perte : {lossLabel} point{loss >= 2 ? 's' : ''} de win %</span>
          {!isGood && bestLabel && (
            <span>
              Le moteur préférait <strong>{bestLabel}</strong>
            </span>
          )}
          <button className="btn btn-primary" onClick={next}>
            {idx + 1 < items.length ? 'Coup suivant ›' : 'Voir le score'}
          </button>
        </div>
      )}

      <div className="quiz-board">
        <Board
          position={beforePosition}
          arrows={[playedArrow]}
          interactive={false}
          handSide={current.color}
          flipped={flipped}
          blackName={blackName}
          whiteName={whiteName}
        />
      </div>
    </div>
  );
}
