import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './components/Board';
import type { BoardArrow } from './components/Board';
import { EvalGraph } from './components/EvalGraph';
import { KifuInput } from './components/KifuInput';
import { MoveList } from './components/MoveList';
import { TrainingMode } from './components/TrainingMode';
import { TsumeMode } from './components/TsumeMode';
import { VariationBar } from './components/VariationBar';
import { HistoryList } from './components/HistoryList';
import {
  clearHistory,
  deleteGame,
  isHistoryAvailable,
  listHistory,
  loadGame,
  saveGame,
} from './storage/history';
import type { HistoryEntry } from './storage/history';
import { UsiEngine, engineEnvironment } from './engine/UsiEngine';
import { analyzeGame } from './analysis/analyze';
import type { AnalysisPhase, AnalysisResult } from './analysis/analyze';
import { QUALITY_LABEL_FR } from './analysis/classify';
import { parseKifu } from './shogi/parser';
import type { ParsedGame } from './shogi/parser';
import { Position } from './shogi/position';
import { formatUsiMoveAsKif } from './shogi/notation';
import type { Square } from './shogi/types';
import { usiToSquare } from './shogi/types';
import { loadSettings, saveSettings } from './storage/settings';
import { THEMES, THEME_LABEL_FR, applyTheme, loadTheme } from './theme';
import type { Theme } from './theme';
import './App.css';

type Tab = 'analysis' | 'training' | 'tsume';

type Phase =
  | { kind: 'input' }
  | { kind: 'analyzing'; step: AnalysisPhase; done: number; total: number }
  | { kind: 'done' };

const PHASE_LABEL: Record<AnalysisPhase, string> = {
  scan: 'Balayage de la partie',
  refine: 'Étude des coups suspects',
  tsume: 'Vérification des mats',
};

export default function App() {
  const [kifuText, setKifuText] = useState('');
  const [initialSettings] = useState(loadSettings);
  const [movetimeMs, setMovetimeMs] = useState(initialSettings.movetimeMs);
  const [deepMovetimeMs, setDeepMovetimeMs] = useState(initialSettings.deepMovetimeMs);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentPly, setCurrentPly] = useState(0);
  const [tab, setTab] = useState<Tab>('analysis');
  const [flipped, setFlipped] = useState(initialSettings.flipped);
  const [showBestArrow, setShowBestArrow] = useState(initialSettings.showBestArrow);
  const [focusSide, setFocusSide] = useState<'both' | 'b' | 'w'>(initialSettings.focusSide);
  /** Variante rejouée par-dessus la partie : d'où elle part, ses coups, et où on en est. */
  const [variation, setVariation] = useState<{
    baseSfen: string;
    moves: string[];
    index: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => listHistory());
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const engineRef = useRef<UsiEngine | null>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Ces trois-là ne changent que par une action explicite : les suivre par effet
  // est sans surprise.
  useEffect(() => {
    saveSettings({ flipped, showBestArrow, focusSide });
  }, [flipped, showBestArrow, focusSide]);

  /*
   * Les temps de réflexion, eux, sont aussi réécrits par l'ouverture d'une
   * partie de l'historique, qui restitue la cadence à laquelle elle avait été
   * analysée. Les enregistrer par effet ferait donc silencieusement d'une
   * vieille cadence la nouvelle préférence — d'où la sauvegarde ici, au moment
   * du choix, et pas ailleurs.
   */
  const changeMovetime = useCallback((ms: number) => {
    setMovetimeMs(ms);
    saveSettings({ movetimeMs: ms });
  }, []);

  const changeDeepMovetime = useCallback((ms: number) => {
    setDeepMovetimeMs(ms);
    saveSettings({ deepMovetimeMs: ms });
  }, []);

  /*
   * Le moteur était créé uniquement par `runAnalysis`. Une partie rouverte
   * depuis l'historique n'en avait donc aucun, et l'entraînement comme les
   * tsume refusaient chaque coup sans rien afficher : on jouait, rien ne se
   * passait. Le créer à la demande fait disparaître cette dépendance à la
   * façon dont la partie est arrivée à l'écran.
   */
  const ensureEngine = useCallback(async (): Promise<UsiEngine> => {
    if (!engineRef.current) engineRef.current = new UsiEngine();
    await engineRef.current.ready;
    return engineRef.current;
  }, []);

  const closeOptions = useCallback(() => {
    if (optionsRef.current) optionsRef.current.open = false;
  }, []);

  // Un panneau replié qui ne se referme qu'en recliquant son propre bouton est
  // une chausse-trape sur mobile : il masque le contenu qu'on cherche à voir.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = optionsRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const historyAvailable = useMemo(() => isHistoryAvailable(), []);

  const env = useMemo(() => engineEnvironment(), []);

  const moveLabels = useMemo(() => {
    if (!game) return [];
    const labels: string[] = [];
    const pos = Position.fromSfen(game.startSfen);
    let previousTo: Square | null = null;
    for (const usi of game.moves) {
      labels.push(formatUsiMoveAsKif(pos, usi, previousTo));
      previousTo = usiToSquare(usi.slice(2, 4));
      pos.applyUsiMove(usi);
    }
    return labels;
  }, [game]);

  const positions = useMemo(() => {
    if (!game) return [];
    const list: Position[] = [];
    const pos = Position.fromSfen(game.startSfen);
    list.push(pos.clone());
    for (const usi of game.moves) {
      pos.applyUsiMove(usi);
      list.push(pos.clone());
    }
    return list;
  }, [game]);

  /** Analyse une partie déjà lue — le kifu n'a rien à voir avec l'affaire ici. */
  const analyseParsedGame = useCallback(
    async (parsed: ParsedGame) => {
      setError(null);
      setGame(parsed);
      setCurrentPly(0);
      setVariation(null);
      setPhase({ kind: 'analyzing', step: 'scan', done: 0, total: parsed.moves.length + 1 });

      try {
        const engine = await ensureEngine();
        const res = await analyzeGame(engine, parsed.startSfen, parsed.moves, {
          movetimeMs,
          deepMovetimeMs,
          onProgress: (step, done, total) => setPhase({ kind: 'analyzing', step, done, total }),
        });
        setResult(res);
        setPhase({ kind: 'done' });
        // Une analyse coûte des dizaines de secondes : la conserver évite de la
        // refaire pour revoir une partie.
        const saved = saveGame(parsed, res, movetimeMs, deepMovetimeMs);
        setHistory(listHistory());
        setHistoryNote(saved.reason ?? null);
      } catch (e) {
        setError(`Analyse interrompue : ${(e as Error).message}`);
        setPhase({ kind: 'input' });
      }
    },
    [movetimeMs, deepMovetimeMs, ensureEngine],
  );

  const runAnalysis = useCallback(async () => {
    setError(null);
    let parsed: ParsedGame;
    try {
      parsed = parseKifu(kifuText);
    } catch (e) {
      setError(`Lecture du kifu impossible : ${(e as Error).message}`);
      return;
    }
    if (parsed.moves.length === 0) {
      setError("Aucun coup n'a pu être lu dans ce kifu.");
      return;
    }
    await analyseParsedGame(parsed);
  }, [kifuText, analyseParsedGame]);

  /*
   * Rejouer l'analyse sur la partie déjà à l'écran, à la cadence courante.
   *
   * Sans ça, une partie rouverte depuis l'historique restait figée sur la
   * cadence de son analyse d'origine — et donc sur les gaffes et les tsume que
   * cette cadence avait su voir. Or c'est précisément le réglage qu'on veut
   * pouvoir monter quand une position mérite mieux.
   */
  const reanalyse = useCallback(() => {
    if (!game) return;
    closeOptions();
    void analyseParsedGame(game);
  }, [game, analyseParsedGame, closeOptions]);

  const openFromHistory = useCallback((id: string) => {
    const loaded = loadGame(id);
    if (!loaded) {
      setError("Cette partie n'a pas pu être relue depuis l'historique.");
      setHistory(listHistory());
      return;
    }
    setError(null);
    setHistoryNote(null);
    setGame(loaded.game);
    setResult(loaded.result);
    setMovetimeMs(loaded.movetimeMs);
    setDeepMovetimeMs(loaded.deepMovetimeMs);
    setCurrentPly(0);
    setVariation(null);
    setTab('analysis');
    setPhase({ kind: 'done' });
  }, []);

  // Quand une variante est en cours, c'est elle qu'on montre : le plateau rejoue
  // la ligne du moteur au lieu de la partie.
  const variationView = useMemo(() => {
    if (!variation) return null;
    try {
      const pos = Position.fromSfen(variation.baseSfen);
      let last: { from: Square | null; to: Square } | null = null;
      for (const usi of variation.moves.slice(0, variation.index)) {
        last = {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
        pos.applyUsiMove(usi);
      }
      const next = variation.moves[variation.index] ?? null;
      return { position: pos, lastMove: last, next };
    } catch {
      return null;
    }
  }, [variation]);

  const shownPosition = variationView ? variationView.position : (positions[currentPly] ?? null);

  const gameLastMove =
    currentPly > 0 && game
      ? {
          from: game.moves[currentPly - 1].includes('*')
            ? null
            : usiToSquare(game.moves[currentPly - 1].slice(0, 2)),
          to: usiToSquare(game.moves[currentPly - 1].slice(2, 4)),
        }
      : null;
  const lastMove = variationView ? variationView.lastMove : gameLastMove;

  const toArrow = (usi: string, kind: BoardArrow['kind']): BoardArrow => ({
    from: usi[1] === '*' ? null : usiToSquare(usi.slice(0, 2)),
    to: usiToSquare(usi.slice(2, 4)),
    kind,
  });

  // Dans une variante on annonce le coup suivant de la ligne ; sinon le meilleur
  // coup depuis la position affichée — plies[i] a pour sfenBefore sfens[i], donc
  // plies[currentPly] part bien de ce qu'on voit.
  const arrows = useMemo<BoardArrow[]>(() => {
    if (!showBestArrow) return [];
    if (variationView) return variationView.next ? [toArrow(variationView.next, 'best')] : [];
    const best = result?.plies[currentPly]?.bestMove;
    return best ? [toArrow(best, 'best')] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, currentPly, showBestArrow, variationView]);

  const currentPlyEval = result?.plies[currentPly - 1] ?? null;

  const selectPly = useCallback((ply: number) => {
    setCurrentPly(ply);
    setVariation(null);
  }, []);

  // « Suivre un joueur » : on ne montre que ses fautes, sans réanalyser la partie.
  const focusedPlies = useMemo(
    () => (result ? result.plies.filter((p) => focusSide === 'both' || p.color === focusSide) : []),
    [result, focusSide],
  );
  const focusedBlunders = useMemo(
    () => focusedPlies.filter((p) => p.quality === 'blunder'),
    [focusedPlies],
  );
  const focusedTsumes = useMemo(
    () =>
      result
        ? result.tsumes.filter((t) => focusSide === 'both' || t.color === focusSide)
        : [],
    [result, focusSide],
  );

  const summary = useMemo(() => {
    if (!result) return null;
    const bySide = {
      b: { inaccuracy: 0, mistake: 0, blunder: 0 },
      w: { inaccuracy: 0, mistake: 0, blunder: 0 },
    };
    for (const p of result.plies) {
      if (p.quality === 'inaccuracy' || p.quality === 'mistake' || p.quality === 'blunder') {
        bySide[p.color][p.quality] += 1;
      }
    }
    return bySide;
  }, [result]);

  return (
    <div className="app">
      <header className={`app-header${phase.kind === 'done' ? ' compact' : ''}`}>
        <div className="app-title">
          <h1>将棋 — Analyseur de parties</h1>
          <p className="app-tagline">
            Collez un kifu, obtenez la courbe d'évaluation, repérez vos gaffes et rejouez-les.
          </p>
        </div>

        {/* Ces réglages ne changent jamais d'un coup à l'autre : ils ne méritent
            pas une barre permanente au-dessus du plateau. Repliés ici, ils
            libèrent une rangée entière sans rien rendre inatteignable. */}
        <details className="options" ref={optionsRef}>
          <summary className="options-toggle" title="Réglages d'affichage">
            ⚙<span className="options-word"> Réglages</span>
          </summary>
          <div className="options-panel">
            {/* Le thème ne dépend pas d'une partie chargée : il reste
                accessible dès l'écran de saisie. */}
            <label className="focus-control">
              Thème
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                {THEMES.map((t) => (
                  <option key={t} value={t}>
                    {THEME_LABEL_FR[t]}
                  </option>
                ))}
              </select>
            </label>

            {phase.kind === 'done' && game && (
              <>
                <label className="focus-control">
                  Suivre
                  <select
                    value={focusSide}
                    onChange={(e) => setFocusSide(e.target.value as 'both' | 'b' | 'w')}
                  >
                    <option value="both">Les deux joueurs</option>
                    <option value="b">▲ {game.black || 'Sente'}</option>
                    <option value="w">△ {game.white || 'Gote'}</option>
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  onClick={() => setFlipped((f) => !f)}
                  title="Voir le plateau depuis l'autre camp"
                >
                  ⇅ {flipped ? 'Vue Gote' : 'Vue Sente'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowBestArrow((v) => !v)}
                  title="Flèche verte : le coup recommandé depuis la position affichée"
                >
                  {showBestArrow ? '↗ Flèches affichées' : '↗ Flèches masquées'}
                </button>
                {/* La cadence est ici, et pas seulement sur l'écran de saisie :
                    sans elle, « réanalyser » referait exactement la même chose. */}
                <label className="focus-control">
                  Balayage
                  <select
                    value={movetimeMs}
                    onChange={(e) => changeMovetime(Number(e.target.value))}
                  >
                    <option value={100}>100 ms</option>
                    <option value={200}>200 ms</option>
                    <option value={400}>400 ms</option>
                    <option value={800}>800 ms</option>
                  </select>
                </label>
                <label className="focus-control">
                  Étude des gaffes
                  <select
                    value={deepMovetimeMs}
                    onChange={(e) => changeDeepMovetime(Number(e.target.value))}
                  >
                    <option value={0}>désactivée</option>
                    <option value={1000}>1 s</option>
                    <option value={2000}>2 s</option>
                    <option value={4000}>4 s</option>
                  </select>
                </label>
                <button className="btn btn-primary" onClick={reanalyse}>
                  ↻ Réanalyser
                </button>
                <button
                  className="btn btn-ghost options-danger"
                  onClick={() => {
                    closeOptions();
                    setPhase({ kind: 'input' });
                    setResult(null);
                    setGame(null);
                  }}
                >
                  Nouvelle partie
                </button>
              </>
            )}
          </div>
        </details>
      </header>

      {env.messages.length > 0 && (
        <div className={`banner ${env.blocking ? 'banner-error' : 'banner-warn'}`}>
          {env.messages.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {phase.kind !== 'done' && (
        <KifuInput
          value={kifuText}
          onChange={setKifuText}
          onAnalyze={runAnalysis}
          movetimeMs={movetimeMs}
          onMovetimeChange={changeMovetime}
          deepMovetimeMs={deepMovetimeMs}
          onDeepMovetimeChange={changeDeepMovetime}
          disabled={phase.kind === 'analyzing' || env.blocking}
        />
      )}

      {phase.kind === 'input' && (
        <HistoryList
          entries={history}
          unavailable={!historyAvailable}
          onOpen={openFromHistory}
          onDelete={(id) => {
            deleteGame(id);
            setHistory(listHistory());
          }}
          onClear={() => {
            clearHistory();
            setHistory(listHistory());
          }}
        />
      )}

      {historyNote && <div className="banner banner-warn">{historyNote}</div>}

      {phase.kind === 'analyzing' && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className={`progress-fill${phase.step === 'refine' ? ' refine' : ''}`}
              style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
            />
          </div>
          <span>
            {PHASE_LABEL[phase.step]} — {phase.done} / {phase.total} positions
            {phase.step === 'scan' && deepMovetimeMs > 0 && ' (passe 1 sur 2)'}
          </span>
        </div>
      )}

      {phase.kind === 'done' && result && game && (
        <>
          <div className="toolbar">
            <div className="tabs">
              <button
                className={`tab${tab === 'analysis' ? ' active' : ''}`}
                onClick={() => setTab('analysis')}
              >
                Analyse
              </button>
              <button
                className={`tab${tab === 'training' ? ' active' : ''}`}
                onClick={() => setTab('training')}
              >
                Entraînement ({focusedBlunders.length})
              </button>
              <button
                className={`tab${tab === 'tsume' ? ' active' : ''}`}
                onClick={() => setTab('tsume')}
              >
                Tsume ({focusedTsumes.length})
              </button>
            </div>
          </div>

          {/* Le bilan par joueur appartient à l'analyse. En entraînement et en
              tsume, il n'ajoute rien que les compteurs des onglets ne disent
              déjà, et sur téléphone il repousse le plateau de 290 px. */}
          {summary && tab === 'analysis' && (
            <div className="summary">
              {(['b', 'w'] as const).map((side) => (
                <div className="summary-card" key={side}>
                  <span className="summary-side">
                    {side === 'b' ? '▲ Sente' : '△ Gote'}
                    {side === 'b' && game.black ? ` — ${game.black}` : ''}
                    {side === 'w' && game.white ? ` — ${game.white}` : ''}
                  </span>
                  <span className="summary-stats">
                    <em style={{ color: 'var(--status-inaccuracy)' }}>
                      {summary[side].inaccuracy} {QUALITY_LABEL_FR.inaccuracy.toLowerCase()}
                    </em>
                    <em style={{ color: 'var(--status-mistake)' }}>
                      {summary[side].mistake} {QUALITY_LABEL_FR.mistake.toLowerCase()}
                    </em>
                    <em style={{ color: 'var(--status-blunder)' }}>
                      {summary[side].blunder} {QUALITY_LABEL_FR.blunder.toLowerCase()}
                    </em>
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'analysis' ? (
            <>
              <EvalGraph
                evalCurve={result.evalCurve}
                plies={focusedPlies}
                moveLabels={moveLabels}
                currentPly={currentPly}
                onSelectPly={selectPly}
              />
              <div className="analysis-body">
                <div className="analysis-board">
                  {shownPosition && (
                    <Board
                      position={shownPosition}
                      lastMove={lastMove}
                      flipped={flipped}
                      arrows={arrows}
                      blackName={game.black}
                      whiteName={game.white}
                    />
                  )}
                  {variation && (
                    <p className="variation-hint">
                      Variante du moteur — le plateau ne suit plus la partie.
                    </p>
                  )}
                </div>
                <div className="analysis-side">
                  <div className="ply-nav">
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(0)}
                      disabled={currentPly === 0}
                    >
                      ⏮
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(Math.max(0, currentPly - 1))}
                      disabled={currentPly === 0}
                    >
                      ‹
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(Math.min(game.moves.length, currentPly + 1))}
                      disabled={currentPly >= game.moves.length}
                    >
                      ›
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => selectPly(game.moves.length)}
                      disabled={currentPly >= game.moves.length}
                    >
                      ⏭
                    </button>
                  </div>

                  {currentPlyEval && (
                    <div className="variations">
                      <VariationBar
                        label="Suite jouée"
                        tone="played"
                        baseSfen={currentPlyEval.sfenAfter}
                        moves={currentPlyEval.refutationPv}
                        activeIndex={
                          variation?.baseSfen === currentPlyEval.sfenAfter ? variation.index : null
                        }
                        onSelect={(i) =>
                          setVariation(
                            i === null
                              ? null
                              : {
                                  baseSfen: currentPlyEval.sfenAfter,
                                  moves: currentPlyEval.refutationPv,
                                  index: i,
                                },
                          )
                        }
                      />
                      <VariationBar
                        label="Meilleure suite"
                        tone="best"
                        baseSfen={currentPlyEval.sfenBefore}
                        moves={currentPlyEval.bestMovePv}
                        activeIndex={
                          variation?.baseSfen === currentPlyEval.sfenBefore ? variation.index : null
                        }
                        onSelect={(i) =>
                          setVariation(
                            i === null
                              ? null
                              : {
                                  baseSfen: currentPlyEval.sfenBefore,
                                  moves: currentPlyEval.bestMovePv,
                                  index: i,
                                },
                          )
                        }
                      />
                    </div>
                  )}

                  <MoveList
                    plies={result.plies}
                    moveLabels={moveLabels}
                    currentPly={currentPly}
                    onSelectPly={selectPly}
                    focusSide={focusSide}
                  />
                </div>
              </div>
            </>
          ) : tab === 'training' ? (
            <TrainingMode
              blunders={focusedBlunders}
              ensureEngine={ensureEngine}
              movetimeMs={deepMovetimeMs > 0 ? deepMovetimeMs : movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
            />
          ) : (
            <TsumeMode
              tsumes={focusedTsumes}
              ensureEngine={ensureEngine}
              movetimeMs={deepMovetimeMs > 0 ? deepMovetimeMs : movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
            />
          )}
        </>
      )}

      <footer className="app-footer">
        <span>
          Moteur : YaneuraOu compilé en WebAssembly — tout tourne dans votre navigateur, rien n'est
          envoyé sur un serveur.
        </span>
      </footer>
    </div>
  );
}
