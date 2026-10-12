import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import { useMoveInput } from './useMoveInput';
import type { UsiEngine } from '../engine/UsiEngine';
import { HIRATE_SFEN, Position } from '../shogi/position';
import { generateLegalMoves, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Color, Square } from '../shogi/types';
import { otherColor, usiToSquare } from '../shogi/types';
import { scoreToCp } from '../analysis/classify';
import { isBookMoveSafe } from '../play/book';
import { MOVE_CAP_MS } from '../play/opponent';
import { STRICTNESS, acceptedMoves, judgeMove, opponentReply } from '../play/repertoire';
import type { BookMove, Strictness } from '../play/repertoire';
import { inTree, isEmptyTree, loadTree } from '../play/tree';
import type { OpeningTree } from '../play/tree';
import './PlayMode.css';

const KEY = 'jaaa7up-repertoire-v1';

/** Recherche qui juge un coup hors livre : assez profonde pour voir une pièce en prise. */
const CHECK_DEPTH = 8;

/** Délai avant la réponse de l'adversaire : sans lui, elle surgit avant qu'on ait vu son propre coup se poser. */
const REPLY_DELAY_MS = 450;

type SidePick = 'b' | 'w' | 'random';
type OpponentMode = 'variety' | 'main';

interface Settings {
  side: SidePick;
  strictness: Strictness;
  mode: OpponentMode;
}

const DEFAULTS: Settings = { side: 'b', strictness: 'standard', mode: 'variety' };

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    return {
      side: raw?.side === 'b' || raw?.side === 'w' || raw?.side === 'random' ? raw.side : DEFAULTS.side,
      strictness: raw?.strictness && raw.strictness in STRICTNESS ? raw.strictness : DEFAULTS.strictness,
      mode: raw?.mode === 'main' ? 'main' : 'variety',
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Les réglages ne survivront pas au rechargement, la séance se joue.
  }
}

type Feedback =
  | { kind: 'good' | 'bad' | 'info'; title: string; detail?: string; moves?: BookMove[] }
  | null;

type Left = { note: string } | null;

const pct = (x: number) => `${Math.round(x * 100)} %`;

interface Props {
  ensureEngine: () => Promise<UsiEngine>;
  onExit: () => void;
}

/**
 * Entraînement aux ouvertures : on joue ses coups, l'adversaire répond avec ce
 * que jouent les humains (livre de `play/tree.ts`), et chaque coup est jugé
 * selon la théorie du livre. Un coup que le livre ne connaît pas est confié au
 * moteur, qui dit s'il est sain : on sort alors de la théorie sans faute.
 */
export function OpeningTrainer({ ensureEngine, onExit }: Props) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tree, setTree] = useState<OpeningTree | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadTree().then(
      (t) => alive && setTree(t),
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const [started, setStarted] = useState(false);
  const [humanColor, setHumanColor] = useState<Color>('b');
  const [moves, setMoves] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [stats, setStats] = useState({ good: 0, errors: 0, hints: 0 });
  const [left, setLeft] = useState<Left>(null);
  const [checking, setChecking] = useState(false);
  /** Invalide la vérification du moteur d'un coup devenu sans objet (coup repris, séance recommencée). */
  const token = useRef(0);

  const positions = useMemo(() => {
    const list: Position[] = [];
    const pos = Position.fromSfen(HIRATE_SFEN);
    list.push(pos.clone());
    for (const usi of moves) {
      pos.applyUsiMove(usi);
      list.push(pos.clone());
    }
    return list;
  }, [moves]);
  const position = positions[positions.length - 1];
  const legalMoves = useMemo(() => generateLegalMoves(position, position.turn), [position]);

  const labelOf = (pos: Position, usi: string, previous: string | undefined): string =>
    formatUsiMoveAsKif(pos, usi, previous ? usiToSquare(previous.slice(2, 4)) : null);

  const labels = useMemo(() => {
    const out: string[] = [];
    let previousTo: Square | null = null;
    moves.forEach((usi, i) => {
      out.push(formatUsiMoveAsKif(positions[i], usi, previousTo));
      previousTo = usiToSquare(usi.slice(2, 4));
    });
    return out;
  }, [moves, positions]);

  /* La séance s'arrête quand la position sort du livre (la théorie est jouée en entier), ou sur un coup sain hors livre. */
  const bookEnded = started && tree !== null && moves.length > 0 && !inTree(tree, moves);
  const over = bookEnded || left !== null;
  const myTurn = started && !over && !checking && position.turn === humanColor;

  const start = () => {
    saveSettings(settings);
    token.current++;
    setHumanColor(settings.side === 'random' ? (Math.random() < 0.5 ? 'b' : 'w') : settings.side);
    setMoves([]);
    setFeedback(null);
    setStats({ good: 0, errors: 0, hints: 0 });
    setLeft(null);
    setChecking(false);
    input.reset();
    setStarted(true);
  };

  // La réponse de l'adversaire, après un court délai.
  useEffect(() => {
    if (!started || !tree || over || checking || position.turn === humanColor) return;
    const timer = setTimeout(() => {
      const reply = opponentReply(tree, moves, position.turn, settings.mode);
      if (reply && legalMoves.some((m) => moveToUsi(m) === reply)) setMoves((m) => [...m, reply]);
    }, REPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [started, tree, over, checking, position, humanColor, moves, legalMoves, settings.mode]);

  const askedFor = (): BookMove[] =>
    tree ? acceptedMoves(tree, moves, humanColor, settings.strictness) : [];

  const onPlay = (usi: string) => {
    if (!tree) return;
    const verdict = judgeMove(tree, moves, usi, humanColor, settings.strictness);
    const label = labelOf(position, usi, moves[moves.length - 1]);

    if (verdict.kind === 'book') {
      setStats((s) => ({ ...s, good: s.good + 1 }));
      setFeedback({
        kind: 'good',
        title: `${label} — coup du livre`,
        detail: `Joué dans ${pct(verdict.move.share)} des parties, ${pct(verdict.move.winRate)} de points pour ce camp.`,
      });
      setMoves((m) => [...m, usi]);
      return;
    }

    if (verdict.kind === 'rare') {
      setStats((s) => ({ ...s, errors: s.errors + 1 }));
      setFeedback({
        kind: 'bad',
        title: `${label} — trop rare`,
        detail: `Le livre connaît ce coup (${pct(verdict.move.share)} des parties), mais pas assez pour l'exigence « ${STRICTNESS[settings.strictness].label} ». Coups attendus :`,
        moves: askedFor(),
      });
      return;
    }

    // Hors livre : le moteur dit si le coup est sain.
    const mine = ++token.current;
    setChecking(true);
    setFeedback({ kind: 'info', title: `${label} — hors du livre`, detail: 'Vérification par le moteur…' });
    void (async () => {
      try {
        const engine = await ensureEngine();
        const search = { depth: CHECK_DEPTH, movetimeMs: MOVE_CAP_MS };
        const best = await engine.analyze(HIRATE_SFEN, moves, search);
        const after = await engine.analyze(HIRATE_SFEN, [...moves, usi], search);
        if (mine !== token.current) return;
        const bestCp = scoreToCp(best.scoreCp, best.scoreMate);
        const playedCp = -scoreToCp(after.scoreCp, after.scoreMate);
        const loss = Math.max(0, bestCp - playedCp);
        if (isBookMoveSafe(bestCp, playedCp)) {
          setMoves((m) => [...m, usi]);
          setLeft({
            note: `${label} n'est pas dans le livre, mais le moteur le juge sain (${
              loss < 20 ? 'aussi bon que le meilleur coup' : `environ ${Math.round(loss)} cp de moins que le meilleur coup`
            }). Vous sortez de la théorie sans faute.`,
          });
        } else {
          setStats((s) => ({ ...s, errors: s.errors + 1 }));
          setFeedback({
            kind: 'bad',
            title: `${label} — hors livre et mauvais`,
            detail: `Le moteur y voit une perte d'environ ${Math.round(loss)} cp. Coups attendus :`,
            moves: askedFor(),
          });
        }
      } catch (e) {
        if (mine !== token.current) return;
        setFeedback({
          kind: 'info',
          title: `${label} — hors du livre`,
          detail: `Le moteur n'a pas pu juger ce coup : ${(e as Error).message}`,
        });
      } finally {
        if (mine === token.current) setChecking(false);
      }
    })();
  };

  const input = useMoveInput({ position, legalMoves, humanColor, enabled: myTurn, onPlay });

  const hint = () => {
    if (!tree || !myTurn) return;
    setStats((s) => ({ ...s, hints: s.hints + 1 }));
    setFeedback({ kind: 'info', title: 'Coups du livre', moves: askedFor() });
  };

  // Reprendre : revenir à une position où c'est de nouveau à nous.
  const lastMover = otherColor(position.turn);
  const undoCount = left ? 1 : lastMover === humanColor ? 1 : 2;
  const canUndo = started && !checking && moves.length >= undoCount;
  const undo = () => {
    if (!canUndo) return;
    token.current++;
    setLeft(null);
    setFeedback(null);
    input.reset();
    setMoves((m) => m.slice(0, m.length - undoCount));
  };

  // Écran fixe, comme la partie contre l'ordinateur.
  const boardZoneRef = useRef<HTMLDivElement>(null);
  const [zoneH, setZoneH] = useState(0);
  useEffect(() => {
    if (!started) return;
    const el = boardZoneRef.current;
    if (!el) return;
    const measure = () => setZoneH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      ro.disconnect();
      document.body.style.overflow = prev;
    };
  }, [started]);

  const movesRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = movesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  if (!started) {
    const empty = tree !== null && isEmptyTree(tree);
    return (
      <div className="play">
        <div className="play-setup">
          <h2>Entraînement aux ouvertures</h2>
          <p className="play-opening-hint">
            Vous jouez vos coups, l'ordinateur répond avec ce que jouent les meilleurs joueurs de Lishogi. Chaque
            coup est jugé d'après le livre ; un coup hors livre est vérifié par le moteur.
          </p>
          {loadFailed && <p className="banner banner-error">Le livre n'a pas pu être chargé.</p>}
          {empty && (
            <p className="banner banner-error">
              Le livre n'est pas encore généré : lancez le workflow « Build opening tree » sur GitHub.
            </p>
          )}

          <fieldset className="play-field">
            <legend>Votre camp</legend>
            <div className="play-choices">
              {(
                [
                  ['b', '▲ Sente', 'vous jouez en premier'],
                  ['w', '△ Gote', "l'ordinateur ouvre"],
                  ['random', 'Au hasard', ''],
                ] as const
              ).map(([id, label, hint]) => (
                <label key={id} className={`play-choice${settings.side === id ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="trainer-side"
                    checked={settings.side === id}
                    onChange={() => setSettings((s) => ({ ...s, side: id }))}
                  />
                  <span className="play-choice-label">{label}</span>
                  {hint && <span className="play-choice-hint">{hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="play-field">
            <legend>Exigence sur vos coups</legend>
            <select
              className="play-select"
              value={settings.strictness}
              onChange={(e) => setSettings((s) => ({ ...s, strictness: e.target.value as Strictness }))}
              aria-label="Exigence sur vos coups"
            >
              {(Object.keys(STRICTNESS) as Strictness[]).map((k) => (
                <option key={k} value={k}>
                  {STRICTNESS[k].label}
                </option>
              ))}
            </select>
            <p className="play-opening-hint">{STRICTNESS[settings.strictness].description}</p>
          </fieldset>

          <fieldset className="play-field">
            <legend>Réponses de l'adversaire</legend>
            <select
              className="play-select"
              value={settings.mode}
              onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as OpponentMode }))}
              aria-label="Réponses de l'adversaire"
            >
              <option value="variety">Variété — selon la fréquence des parties</option>
              <option value="main">Ligne principale — toujours le coup le plus joué</option>
            </select>
          </fieldset>

          <div className="play-actions">
            <button className="btn btn-primary" onClick={start} disabled={!tree || empty}>
              {tree ? 'Commencer' : 'Chargement du livre…'}
            </button>
            <button className="btn btn-ghost" onClick={onExit}>
              Retour
            </button>
          </div>
        </div>
      </div>
    );
  }

  const prefixMoves = moves.length;
  let status: string;
  if (left) status = 'Sortie de la théorie';
  else if (bookEnded) status = 'Fin du livre';
  else if (checking) status = 'Vérification du coup…';
  else if (position.turn !== humanColor) status = "L'adversaire répond…";
  else status = `À vous de jouer (${humanColor === 'b' ? '▲ Sente' : '△ Gote'})`;

  const summary = `${stats.good} coup${stats.good > 1 ? 's' : ''} juste${stats.good > 1 ? 's' : ''}, ${stats.errors} erreur${stats.errors > 1 ? 's' : ''}, ${stats.hints} indice${stats.hints > 1 ? 's' : ''}.`;

  return (
    <div className="play play-screen">
      <div className="play-head">
        <p className={`play-status${over ? ' over' : ''}`} role="status">
          {status}
        </p>
        <p className="trainer-score" aria-label="Score">
          <span title="Coups justes">✓ {stats.good}</span>
          <span title="Erreurs">✗ {stats.errors}</span>
          <span title="Indices utilisés">💡 {stats.hints}</span>
        </p>
      </div>

      <div className="play-body">
        <div className="play-board" ref={boardZoneRef}>
          <Board
            hideCoords
            cellSize={110}
            fitHeight={zoneH}
            position={position}
            lastMove={
              moves.length
                ? {
                    from: moves[moves.length - 1].includes('*') ? null : usiToSquare(moves[moves.length - 1].slice(0, 2)),
                    to: usiToSquare(moves[moves.length - 1].slice(2, 4)),
                  }
                : null
            }
            interactive={myTurn}
            selected={input.selected}
            legalDestinations={input.destinations}
            handSide={humanColor}
            flipped={humanColor === 'w'}
            blackName={humanColor === 'b' ? 'Vous' : 'Adversaire'}
            whiteName={humanColor === 'w' ? 'Vous' : 'Adversaire'}
            onSquareClick={input.onSquareClick}
            onHandPieceClick={input.onHandPieceClick}
            onDragStart={input.onDragStart}
            onDragEnd={input.onDragEnd}
          />
          {input.promptPromotion && (
            <div className="promo-prompt">
              <span>Promouvoir ?</span>
              <button className="btn btn-primary" onClick={() => input.resolvePromotion(true)}>
                成 Oui
              </button>
              <button className="btn btn-ghost" onClick={() => input.resolvePromotion(false)}>
                Non
              </button>
            </div>
          )}
        </div>

        <div className="play-side">
          {over ? (
            <div className="trainer-card trainer-info">
              <strong>{left ? 'Sortie de la théorie' : 'Fin du livre'}</strong>
              <span>
                {left
                  ? left.note
                  : `Vous avez joué toute la théorie connue après ${prefixMoves} demi-coups.`}
              </span>
              <span>{summary}</span>
            </div>
          ) : (
            feedback && (
              <div className={`trainer-card trainer-${feedback.kind}`} role="status">
                <strong>{feedback.title}</strong>
                {feedback.detail && <span>{feedback.detail}</span>}
                {feedback.moves && (
                  <ul>
                    {feedback.moves.map((m) => (
                      <li key={m.move}>
                        {labelOf(position, m.move, moves[moves.length - 1])} — {pct(m.share)} des parties, {pct(m.winRate)} de
                        points
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}

          <div className="play-actions">
            {over ? (
              <button className="btn btn-primary" onClick={start}>
                Nouvelle séance
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={hint} disabled={!myTurn}>
                💡 Indice
              </button>
            )}
            <button className="btn btn-ghost" onClick={undo} disabled={!canUndo}>
              ↶ Reprendre
            </button>
            <button className="btn btn-link" onClick={onExit}>
              Quitter
            </button>
          </div>

          <ol className="play-moves" aria-label="Coups joués" ref={movesRef}>
            {labels.length === 0 && <li className="play-moves-empty">Aucun coup joué.</li>}
            {labels.map((label, i) => (
              <li key={i} className={moves.length === i + 1 ? 'last' : ''}>
                <span className="move-num">{i + 1}.</span>
                <span className="move-side">{i % 2 === 0 ? '▲' : '△'}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
