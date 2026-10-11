import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import type { AnalyzeLine, UsiEngine } from '../engine/UsiEngine';
import type { ParsedGame } from '../shogi/parser';
import { HIRATE_SFEN, Position } from '../shogi/position';
import { generateLegalMoves, isKingCapturable, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Color, Move, PieceType, Square } from '../shogi/types';
import { otherColor, sameSquare, usiToSquare } from '../shogi/types';
import { scoreToCp } from '../analysis/classify';
import {
  CUSTOM_LEVEL_ID,
  DEFAULT_CUSTOM,
  DEFAULT_LEVEL_ID,
  LEVELS,
  LOSS_CHOICES,
  MOVE_CAP_MS,
  NODE_CHOICES,
  chooseMove,
  formatNodes,
  levelById,
  resolveLevel,
  sanitizeCustom,
} from '../play/opponent';
import type { CustomSettings, Level } from '../play/opponent';
import {
  DEFAULT_OPENING_ID,
  OPENINGS,
  bookStatus,
  isBookMoveSafe,
  matchPlan,
  nextBookMove,
  openingById,
} from '../play/book';
import './PlayMode.css';

const KEY = 'jaaa7up-play-v1';

/** Les familles d'ouvertures, dans l'ordre où la liste les présente. */
const OPENING_GROUPS = [...new Set(OPENINGS.map((o) => o.group))];

type SidePick = 'b' | 'w' | 'random';

interface Choice {
  side: SidePick;
  /** Un palier, ou `CUSTOM_LEVEL_ID` pour les réglages libres de `custom`. */
  levelId: string;
  openingId: string;
  custom: CustomSettings;
}

function loadChoice(): Choice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Choice> | null;
    const side = raw?.side === 'b' || raw?.side === 'w' || raw?.side === 'random' ? raw.side : 'b';
    return {
      side,
      levelId:
        raw?.levelId === CUSTOM_LEVEL_ID ? CUSTOM_LEVEL_ID : levelById(raw?.levelId ?? DEFAULT_LEVEL_ID).id,
      openingId: openingById(raw?.openingId ?? DEFAULT_OPENING_ID).id,
      custom: sanitizeCustom(raw?.custom),
    };
  } catch {
    return {
      side: 'b',
      levelId: DEFAULT_LEVEL_ID,
      openingId: DEFAULT_OPENING_ID,
      custom: DEFAULT_CUSTOM,
    };
  }
}

function saveChoice(choice: Choice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Le choix ne survivra pas au rechargement, mais la partie se joue.
  }
}

/** Plateau, mains et camp au trait : ce qui fait « la même position », sans le numéro de coup. */
function repetitionKey(pos: Position): string {
  return pos.toSfen().split(' ').slice(0, 3).join(' ');
}

/** Sennichite : la même position quatre fois. */
const REPETITIONS_FOR_DRAW = 4;

/** Recherche qui juge un coup d'ouverture : assez profonde pour voir une pièce en prise, quel que soit le niveau. */
const BOOK_CHECK_DEPTH = 8;

/** Ce que le niveau choisi change, en clair : sa description, puis ses trois réglages. */
function describeLevel(choice: Choice): string {
  const level = resolveLevel(choice.levelId, choice.custom);
  const settings = `${formatNodes(level.nodes)} nœuds par coup${
    level.pBest >= 1
      ? ', toujours le meilleur coup'
      : `, meilleur coup ${Math.round(level.pBest * 100)} % du temps, sinon un coup à moins de ${level.maxLossCp} cp`
  }.`;
  if (level.id === CUSTOM_LEVEL_ID) return `${settings} Plafond de ${MOVE_CAP_MS / 1000} s par coup.`;
  const rank = LEVELS.findIndex((l) => l.id === level.id) + 1;
  return `Niveau ${rank} sur ${LEVELS.length} — ${level.description} ${settings}`;
}

interface PlayModeProps {
  ensureEngine: () => Promise<UsiEngine>;
  /** Envoie la partie jouée dans l'analyse. */
  onAnalyze: (game: ParsedGame) => void;
  onExit: () => void;
}

type Outcome =
  | { kind: 'mate'; winner: Color }
  | { kind: 'resign'; winner: Color }
  | { kind: 'draw' };

/**
 * Une partie contre l'ordinateur. Le moteur est toujours le même ; sa force se
 * règle en lui faisant parfois jouer un coup autre que le meilleur (voir
 * `play/opponent.ts`). La partie peut ensuite être envoyée dans l'analyse, qui
 * dit où l'on a gagné ou perdu du terrain.
 */
export function PlayMode({ ensureEngine, onAnalyze, onExit }: PlayModeProps) {
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const [started, setStarted] = useState(false);
  const [humanColor, setHumanColor] = useState<Color>('b');
  const [level, setLevel] = useState<Level>(() => levelById(DEFAULT_LEVEL_ID));
  const [openingId, setOpeningId] = useState(DEFAULT_OPENING_ID);
  const [moves, setMoves] = useState<string[]>([]);
  const [resigned, setResigned] = useState<Color | null>(null);
  const [thinking, setThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  /** Invalide la réponse d'une recherche devenue sans objet (coup repris, partie recommencée). */
  const token = useRef(0);

  const opening = openingById(openingId);

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

  const labels = useMemo(() => {
    const out: string[] = [];
    let previousTo: Square | null = null;
    moves.forEach((usi, i) => {
      out.push(formatUsiMoveAsKif(positions[i], usi, previousTo));
      previousTo = usiToSquare(usi.slice(2, 4));
    });
    return out;
  }, [moves, positions]);

  const outcome = useMemo((): Outcome | null => {
    if (resigned) return { kind: 'resign', winner: otherColor(resigned) };
    if (legalMoves.length === 0) return { kind: 'mate', winner: otherColor(position.turn) };
    const key = repetitionKey(position);
    const seen = positions.filter((p) => repetitionKey(p) === key).length;
    if (seen >= REPETITIONS_FOR_DRAW) return { kind: 'draw' };
    return null;
  }, [resigned, legalMoves, position, positions]);

  const inCheck = isKingCapturable(position, position.turn);

  /*
   * Où en est l'ouverture choisie, déduit des coups joués : c'est ce qui dit si
   * le moteur la suit encore ou s'il joue librement.
   */
  const computerColor = otherColor(humanColor);
  const book = bookStatus(opening, computerColor, moves);
  const bookPlies = new Set(matchPlan(opening, computerColor, moves).played);
  const myTurn = started && !outcome && position.turn === humanColor;

  const start = () => {
    saveChoice(choice);
    const side: Color =
      choice.side === 'random' ? (Math.random() < 0.5 ? 'b' : 'w') : choice.side;
    token.current++;
    setHumanColor(side);
    setLevel(resolveLevel(choice.levelId, choice.custom));
    setOpeningId(choice.openingId);
    setMoves([]);
    setResigned(null);
    setThinking(false);
    setEngineError(null);
    setSelected(null);
    setPromptPromotion(null);
    setStarted(true);
  };

  /*
   * Le tour de l'ordinateur : une recherche à plusieurs lignes, puis un tirage
   * (voir `chooseMove`). `token` écarte la réponse d'une recherche que l'on a
   * entre-temps rendue sans objet en reprenant un coup.
   */
  useEffect(() => {
    if (!started || outcome || thinking || position.turn === humanColor) return;
    const mine = ++token.current;
    setThinking(true);
    setEngineError(null);
    void (async () => {
      try {
        const engine = await ensureEngine();
        const legal = legalMoves.map(moveToUsi);

        /*
         * L'ouverture choisie d'abord. Le coup du plan n'est joué que s'il est
         * légal et que le moteur ne le juge pas mauvais : une recherche à part,
         * assez profonde et à plusieurs lignes quel que soit le niveau, car un
         * Débutant à profondeur 1 ne verrait pas qu'il laisse une pièce en prise.
         */
        const planned = nextBookMove(opening, position.turn, moves);
        if (planned && legal.includes(planned)) {
          const bookSearch = { depth: BOOK_CHECK_DEPTH, movetimeMs: MOVE_CAP_MS };
          const best = await engine.analyze(HIRATE_SFEN, moves, bookSearch);
          // La position d'après le coup du plan : son score est celui de
          // l'adversaire, donc retourné pour être du point de vue de qui joue.
          const after = await engine.analyze(HIRATE_SFEN, [...moves, planned], bookSearch);
          if (mine !== token.current) return;
          const bestCp = scoreToCp(best.scoreCp, best.scoreMate);
          const plannedCp = -scoreToCp(after.scoreCp, after.scoreMate);
          if (isBookMoveSafe(bestCp, plannedCp)) {
            setMoves((m) => [...m, planned]);
            return;
          }
        }

        const r = await engine.analyze(HIRATE_SFEN, moves, {
          nodes: level.nodes,
          movetimeMs: MOVE_CAP_MS,
          multiPv: level.multiPv,
        });
        if (mine !== token.current) return;
        const lines: AnalyzeLine[] = r.lines.length
          ? r.lines
          : r.bestMove
            ? [{ move: r.bestMove, scoreCp: r.scoreCp, scoreMate: r.scoreMate, pv: [r.bestMove] }]
            : [];
        const usi = chooseMove(lines, level);
        if (!usi) {
          // « bestmove resign » : le moteur s'avoue battu.
          setResigned(position.turn);
          return;
        }
        // Un coup illégal ne devrait pas venir du moteur ; s'il venait, mieux vaut
        // jouer un coup légal que de laisser la partie figée.
        setMoves((m) => [...m, legal.includes(usi) ? usi : legal[0]]);
      } catch (e) {
        if (mine === token.current) setEngineError((e as Error).message);
      } finally {
        if (mine === token.current) setThinking(false);
      }
    })();
  }, [started, outcome, thinking, position, humanColor, moves, level, opening, legalMoves, ensureEngine]);

  const play = useCallback((usi: string) => {
    setMoves((m) => [...m, usi]);
    setSelected(null);
  }, []);

  const destinations = (): Square[] => {
    if (!selected || !myTurn) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const tryMove = (to: Square) => {
    if (!selected || !myTurn) return;
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
    if (!myTurn || promptPromotion) return;
    if (selected?.kind === 'square' && sameSquare(selected.sq, sq)) {
      setSelected(null);
      return;
    }
    const piece = position.pieceAt(sq);
    if (piece && piece.color === humanColor) {
      setSelected({ kind: 'square', sq });
      return;
    }
    if (selected) tryMove(sq);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (!myTurn || promptPromotion) return;
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

  /*
   * Reprendre son coup, c'est aussi reprendre la réponse de l'ordinateur : on
   * revient à une position où c'est de nouveau à nous. Si l'ordinateur n'a
   * pas encore répondu, seul notre coup est à reprendre.
   */
  const lastMover = otherColor(position.turn);
  const undoCount = lastMover === humanColor ? 1 : 2;
  const canUndo = started && moves.length >= undoCount;
  const undo = () => {
    if (!canUndo) return;
    token.current++;
    setThinking(false);
    setEngineError(null);
    setResigned(null);
    setSelected(null);
    setPromptPromotion(null);
    setMoves((m) => m.slice(0, m.length - undoCount));
  };

  const resign = () => {
    token.current++;
    setThinking(false);
    setResigned(humanColor);
  };

  const names = useMemo(() => {
    const me = 'Vous';
    const cpu = `Ordinateur (${level.id === CUSTOM_LEVEL_ID ? `${formatNodes(level.nodes)} nœuds` : level.label})`;
    return humanColor === 'b' ? { black: me, white: cpu } : { black: cpu, white: me };
  }, [humanColor, level]);

  const analyse = () =>
    onAnalyze({
      format: 'usi',
      startSfen: HIRATE_SFEN,
      moves,
      black: names.black,
      white: names.white,
    });

  /*
   * Écran fixe : la partie occupe toute la fenêtre, sans défilement de la
   * page. Le plateau choisit donc sa case d'après la hauteur et la largeur
   * réellement libres de sa zone, mesurées ici.
   */
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
    if (el) {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    }
  }, [moves.length]);

  if (!started) {
    return (
      <div className="play">
        <div className="play-setup">
          <h2>Jouer contre l'ordinateur</h2>

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
                <label key={id} className={`play-choice${choice.side === id ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="play-side"
                    checked={choice.side === id}
                    onChange={() => setChoice((c) => ({ ...c, side: id }))}
                  />
                  <span className="play-choice-label">{label}</span>
                  {hint && <span className="play-choice-hint">{hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="play-field">
            <legend>Difficulté</legend>
            <select
              className="play-select"
              value={choice.levelId}
              onChange={(e) => setChoice((c) => ({ ...c, levelId: e.target.value }))}
              aria-label="Difficulté"
            >
              {LEVELS.map((l, i) => (
                <option key={l.id} value={l.id}>
                  {i + 1}. {l.label}
                </option>
              ))}
              <option value={CUSTOM_LEVEL_ID}>Personnalisé…</option>
            </select>
            <p className="play-opening-hint">{describeLevel(choice)}</p>

            {choice.levelId === CUSTOM_LEVEL_ID && (
              <div className="play-custom">
                <label className="play-custom-row">
                  <span>Nombre de nœuds par coup</span>
                  <select
                    value={choice.custom.nodes}
                    onChange={(e) =>
                      setChoice((c) => ({ ...c, custom: { ...c.custom, nodes: Number(e.target.value) } }))
                    }
                  >
                    {NODE_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {formatNodes(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="play-custom-row">
                  <span>Part de meilleurs coups</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(choice.custom.pBest * 100)}
                    onChange={(e) =>
                      setChoice((c) => ({
                        ...c,
                        custom: { ...c.custom, pBest: Number(e.target.value) / 100 },
                      }))
                    }
                    aria-label="Part de meilleurs coups"
                  />
                  <output>{Math.round(choice.custom.pBest * 100)} %</output>
                </label>
                <label className="play-custom-row">
                  <span>Écart maximal du coup choisi</span>
                  <select
                    value={choice.custom.maxLossCp}
                    disabled={choice.custom.pBest >= 1}
                    onChange={(e) =>
                      setChoice((c) => ({ ...c, custom: { ...c.custom, maxLossCp: Number(e.target.value) } }))
                    }
                  >
                    {LOSS_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {n} cp
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className="play-field">
            <legend>Ouverture de l'ordinateur</legend>
            <select
              className="play-select"
              value={choice.openingId}
              onChange={(e) => setChoice((c) => ({ ...c, openingId: e.target.value }))}
              aria-label="Ouverture de l'ordinateur"
            >
              {OPENING_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {OPENINGS.filter((o) => o.group === group).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="play-opening-hint">
              {openingById(choice.openingId).description}
              {choice.openingId !== 'free' &&
                " Il la joue tant qu'elle reste possible et que le moteur ne la juge pas mauvaise ; sinon il reprend son jeu normal."}
            </p>
          </fieldset>

          <div className="play-actions">
            <button className="btn btn-primary" onClick={start}>
              Commencer la partie
            </button>
            <button className="btn btn-ghost" onClick={onExit}>
              Retour
            </button>
          </div>
        </div>
      </div>
    );
  }

  const lastUsi = moves[moves.length - 1];
  const lastMove = lastUsi
    ? {
        from: lastUsi.includes('*') ? null : usiToSquare(lastUsi.slice(0, 2)),
        to: usiToSquare(lastUsi.slice(2, 4)),
      }
    : null;

  const sideLabel = (c: Color) => (c === 'b' ? '▲ Sente' : '△ Gote');
  let status: string;
  if (outcome) {
    const iWon = outcome.kind !== 'draw' && outcome.winner === humanColor;
    if (outcome.kind === 'draw') status = 'Répétition (sennichite) — partie nulle.';
    else if (outcome.kind === 'mate') status = iWon ? 'Mat — vous avez gagné !' : "Mat — l'ordinateur gagne.";
    else
      status = iWon
        ? "L'ordinateur abandonne — vous avez gagné !"
        : 'Vous avez abandonné.';
  } else if (thinking) {
    status = "L'ordinateur réfléchit…";
  } else if (engineError) {
    status = `Le moteur n'a pas pu répondre : ${engineError}`;
  } else {
    status = `À vous de jouer (${sideLabel(humanColor)})${inCheck ? ' — échec !' : ''}`;
  }

  return (
    <div className="play play-screen">
      <div className="play-head">
        <p className={`play-status${outcome ? ' over' : ''}`} role="status">
          {status}
        </p>
        <span className="play-level">
          {sideLabel(humanColor)} · {level.label}
          {opening.id !== 'free' && ` · ${opening.label}`}
        </span>
      </div>

      <div className="play-body">
        <div className="play-board" ref={boardZoneRef}>
          <Board
            hideCoords
            cellSize={110}
            fitHeight={zoneH}
            position={position}
            lastMove={lastMove}
            interactive={myTurn}
            selected={selected}
            legalDestinations={destinations()}
            handSide={humanColor}
            flipped={humanColor === 'w'}
            blackName={names.black}
            whiteName={names.white}
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
        </div>

        <div className="play-side">
        {book && (
          <p className={`play-book play-book-${book.state}`} role="status">
            {book.state === 'following' &&
              `Ouverture ${opening.label} : ${book.done}/${book.total} coups joués — l'ordinateur suit son plan.`}
            {book.state === 'paused' &&
              `Ouverture ${opening.label} interrompue (${book.done} sur ${book.total}) : le moteur a joué son propre coup. Le plan reprend si son prochain coup redevient possible.`}
            {book.state === 'done' &&
              `Ouverture ${opening.label} terminée : l'ordinateur joue maintenant librement.`}
          </p>
        )}
          <div className="play-actions">
            {outcome ? (
              <>
                <button className="btn btn-primary" onClick={analyse} disabled={moves.length === 0}>
                  Analyser cette partie
                </button>
                <button className="btn btn-ghost" onClick={() => setStarted(false)}>
                  Nouvelle partie
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={undo} disabled={!canUndo}>
                  ↶ Reprendre mon coup
                </button>
                <button className="btn btn-ghost" onClick={resign} disabled={moves.length === 0}>
                  Abandonner
                </button>
              </>
            )}
            {outcome && canUndo && (
              <button className="btn btn-ghost" onClick={undo}>
                ↶ Reprendre mon coup
              </button>
            )}
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
                {bookPlies.has(i) && (
                  <span className="play-book-tag" title="Coup joué par l'ouverture automatique">
                    ouverture
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
