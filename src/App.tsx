import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExploreBoard, ExploreSettings } from './components/ExploreBoard';
import type { ExploreBoardHandle } from './components/ExploreBoard';
import type { BoardArrow } from './components/Board';
import { EvalGraph } from './components/EvalGraph';
import { KifuInput } from './components/KifuInput';
import { MovetimeSlider } from './components/MovetimeSlider';
import { MoveList } from './components/MoveList';
import { TrainingMode } from './components/TrainingMode';
import { TsumeMode } from './components/TsumeMode';
import { StudyMode } from './components/StudyMode';
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
import { analyzeGame, deepenPly, deepenTsume } from './analysis/analyze';
import type { AnalysisPhase, AnalysisResult } from './analysis/analyze';
import { QUALITY_LABEL_FR } from './analysis/classify';
import { parseKifu } from './shogi/parser';
import type { ParsedGame } from './shogi/parser';
import { Position } from './shogi/position';
import { formatUsiMoveAsKif } from './shogi/notation';
import type { PieceType, Square } from './shogi/types';
import { usiToSquare } from './shogi/types';
import { loadSettings, saveSettings } from './storage/settings';
import { THEMES, THEME_LABEL_FR, applyTheme, loadTheme } from './theme';
import type { Theme } from './theme';
import { PIECE_FONTS, PIECE_FONT_LABEL_FR, applyPieceFont, loadPieceFont } from './pieceFont';
import type { PieceFont } from './pieceFont';
import { useWakeLock } from './useWakeLock';
import './App.css';

type Tab = 'analysis' | 'training' | 'tsume' | 'study';

type Phase =
  | { kind: 'input' }
  | { kind: 'analyzing'; step: AnalysisPhase; done: number; total: number }
  | { kind: 'done' };

const PHASE_LABEL: Record<AnalysisPhase, string> = {
  scan: 'Balayage de la partie',
  tsume: 'Vérification des mats',
};

export default function App() {
  const [kifuText, setKifuText] = useState('');
  const [initialSettings] = useState(loadSettings);
  const [movetimeMs, setMovetimeMs] = useState(initialSettings.movetimeMs);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [currentPly, setCurrentPly] = useState(0);
  const [tab, setTab] = useState<Tab>('analysis');
  const [flipped, setFlipped] = useState(initialSettings.flipped);
  const [showArrowB, setShowArrowB] = useState(initialSettings.showArrowB);
  const [showArrowW, setShowArrowW] = useState(initialSettings.showArrowW);
  const [focusSide, setFocusSide] = useState<'both' | 'b' | 'w'>(initialSettings.focusSide);
  /**
   * Dernier coup regardé en entraînement — pour que revenir à l'onglet Analyse
   * y affiche la même position plutôt que de reprendre où l'analyse en était
   * restée, potentiellement une tout autre partie de la même partie.
   */
  const [trainingPly, setTrainingPly] = useState<number | null>(null);
  /*
   * Demandé une fois l'analyse finie, jamais avant : le choix porte sur des
   * noms de joueurs qu'on ne connaît qu'après lecture du kifu. Et il commande
   * deux choses à la fois — ce qu'on compte, et de quel côté on regarde le
   * plateau — qu'il serait absurde de faire régler séparément.
   */
  const [askFocus, setAskFocus] = useState(false);
  /*
   * Sous le plateau se suivaient la liste des coups et les réglages
   * d'exploration — de quoi faire défiler l'écran pour retrouver une
   * information. Sur un écran étroit ils partagent maintenant une même place, et
   * on choisit lequel occupe le terrain. Au-dessus de 860 px, où la colonne de
   * droite a de la hauteur à revendre, les deux restent affichés ensemble.
   */
  const [panel, setPanel] = useState<'moves' | 'explore'>('moves');
  /** Temps de réflexion du moteur dans le plateau d'exploration. */
  const [replyMs, setReplyMs] = useState(1000);
  /*
   * L'état de la variante en cours, remonté par le plateau. Les chevrons
   * flottants sont ici : ils doivent savoir s'ils commandent la partie ou la
   * variante, faute de quoi avancer d'un coup effacerait ce qu'on est en train
   * d'explorer.
   */
  const exploreRef = useRef<ExploreBoardHandle>(null);
  const [branchState, setBranchState] = useState({ moves: 0, thinking: false });
  const onBranchState = useCallback(
    (st: { moves: number; thinking: boolean }) => setBranchState(st),
    [],
  );
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
  const [pieceFont, setPieceFont] = useState<PieceFont>(() => loadPieceFont());
  /*
   * La courbe d'évaluation est masquée tant qu'on n'a pas demandé à la voir :
   * elle donne le résultat de la partie d'un coup d'œil, et on veut parfois
   * chercher soi-même avant de savoir.
   */
  const [graphRevealed, setGraphRevealed] = useState(false);

  useWakeLock();

  // Nouvelle analyse (ou partie rechargée depuis l'historique) : la courbe
  // redevient un spoiler tant qu'on ne l'a pas révélée pour cette partie-là.
  useEffect(() => {
    setGraphRevealed(false);
  }, [result]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyPieceFont(pieceFont);
  }, [pieceFont]);

  // Ces quatre-là ne changent que par une action explicite : les suivre par effet
  // est sans surprise.
  useEffect(() => {
    saveSettings({ flipped, showArrowB, showArrowW, focusSide });
  }, [flipped, showArrowB, showArrowW, focusSide]);

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
          onProgress: (step, done, total) => setPhase({ kind: 'analyzing', step, done, total }),
        });
        setResult(res);
        setPhase({ kind: 'done' });
        setAskFocus(true);
        // Une analyse coûte des dizaines de secondes : la conserver évite de la
        // refaire pour revoir une partie.
        const saved = saveGame(parsed, res, movetimeMs);
        setHistory(listHistory());
        setHistoryNote(saved.reason ?? null);
      } catch (e) {
        setError(`Analyse interrompue : ${(e as Error).message}`);
        setPhase({ kind: 'input' });
      }
    },
    [movetimeMs, ensureEngine],
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
      // Le dernier coup joué de la ligne, en notation kifu : c'est ce qu'on
      // annonce sous le plateau, faute de liste où le lire.
      let label = '';
      for (const usi of variation.moves.slice(0, variation.index)) {
        label = formatUsiMoveAsKif(pos, usi, last?.to ?? null);
        last = {
          from: usi.includes('*') ? null : usiToSquare(usi.slice(0, 2)),
          to: usiToSquare(usi.slice(2, 4)),
        };
        pos.applyUsiMove(usi);
      }
      const next = variation.moves[variation.index] ?? null;
      return { position: pos, lastMove: last, next, label };
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
    // `P*7f` : la lettre de tête est la pièce parachutée.
    piece: usi[1] === '*' ? (usi[0] as PieceType) : undefined,
  });

  /*
   * Dans une variante on annonce le coup suivant de la ligne ; sinon le
   * meilleur coup depuis la position affichée — plies[i] a pour sfenBefore
   * sfens[i], donc plies[currentPly] part bien de ce qu'on voit.
   *
   * Par camp : la flèche du trait de Sente ne s'affiche que si Sente est
   * coché, indépendamment de Gote — utile pour ne suivre les suggestions que
   * du camp qu'on étudie sans se faire souffler la réponse de l'adversaire.
   */
  const arrows = useMemo<BoardArrow[]>(() => {
    const showFor = (color: 'b' | 'w') => (color === 'b' ? showArrowB : showArrowW);
    if (variationView) {
      if (!variationView.next || !showFor(variationView.position.turn)) return [];
      return [toArrow(variationView.next, 'best')];
    }
    const ply = result?.plies[currentPly];
    if (!ply?.bestMove || !showFor(ply.color)) return [];
    return [toArrow(ply.bestMove, 'best')];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, currentPly, showArrowB, showArrowW, variationView]);

  const selectPly = useCallback((ply: number) => {
    setCurrentPly(ply);
    setVariation(null);
  }, []);

  /*
   * La suite que le moteur jouerait *depuis la position affichée* — la même
   * ligne dont le premier coup est la flèche verte sur le plateau. `plies[i]` a
   * pour `sfenBefore` la position après i coups, donc `plies[currentPly]` part
   * bien de ce qu'on voit.
   */
  const bestLine = result?.plies[currentPly] ?? null;

  /*
   * Lire une suite dans une liste de coups oblige à tenir le plateau d'une main
   * et la liste de l'autre — impossible sur un téléphone, où l'un chasse
   * l'autre. Le bouton donne la barre des flèches à la suite du moteur : on la
   * déroule sur le plateau, coup par coup, et un second appui rend la main à la
   * partie.
   */
  const toggleBestLine = useCallback(() => {
    setVariation((v) => {
      if (v) return null;
      if (!bestLine || bestLine.bestMovePv.length === 0) return null;
      return { baseSfen: bestLine.sfenBefore, moves: bestLine.bestMovePv, index: 0 };
    });
  }, [bestLine]);

  const stepBack = useCallback(() => {
    // Dans une variante jouée sur le plateau, reculer c'est reprendre son coup.
    if (branchState.moves > 0) {
      exploreRef.current?.undo();
      return;
    }
    setVariation((v) => (v ? { ...v, index: Math.max(0, v.index - 1) } : v));
    if (!variation) setCurrentPly((p) => Math.max(0, p - 1));
  }, [variation, branchState.moves]);

  const stepForward = useCallback(() => {
    /*
     * Dans une variante, avancer c'est demander son coup au moteur — et c'est la
     * seule façon de le voir quand la réponse automatique est coupée : on tient
     * les deux camps, mais on veut encore pouvoir consulter.
     */
    if (branchState.moves > 0) {
      void exploreRef.current?.playEngineMove();
      return;
    }
    setVariation((v) => (v ? { ...v, index: Math.min(v.moves.length, v.index + 1) } : v));
    if (!variation) setCurrentPly((p) => Math.min(game?.moves.length ?? 0, p + 1));
  }, [variation, game, branchState.moves]);

  // « Suivre un joueur » : on ne montre que ses fautes, sans réanalyser la partie.
  /*
   * Suivre un joueur, c'est aussi le regarder jouer. Retourner le plateau
   * séparément était une seconde manipulation à faire, qu'on oubliait — et un
   * plateau à l'envers rend la lecture d'une position pénible pour qui n'a pas
   * l'habitude.
   */
  const chooseFocus = useCallback((side: 'both' | 'b' | 'w') => {
    setFocusSide(side);
    if (side !== 'both') setFlipped(side === 'w');
    setAskFocus(false);
  }, []);

  const focusedPlies = useMemo(
    () => (result ? result.plies.filter((p) => focusSide === 'both' || p.color === focusSide) : []),
    [result, focusSide],
  );
  /*
   * Approfondir une position à la demande. Contrepartie d'une passe unique :
   * le temps va à l'exercice qu'on regarde, pas à celui qu'une heuristique a
   * deviné. Le résultat est réécrit sur place pour que tout ce qui en dérive —
   * verdict, variantes, courbe — reparte de la nouvelle mesure.
   */
  const deepenBlunder = useCallback(
    async (ply: number, movetimeMs: number) => {
      const engine = await ensureEngine();
      const target = result?.plies.find((p) => p.ply === ply);
      if (!target) return;
      const updated = await deepenPly(engine, target, movetimeMs);
      setResult((r) =>
        r ? { ...r, plies: r.plies.map((p) => (p.ply === ply ? updated : p)) } : r,
      );
    },
    [result, ensureEngine],
  );

  const deepenTsumeAt = useCallback(
    async (ply: number, movetimeMs: number) => {
      const engine = await ensureEngine();
      const target = result?.tsumes.find((t) => t.ply === ply);
      if (!target) return;
      const updated = await deepenTsume(engine, target, movetimeMs);
      setResult((r) =>
        r ? { ...r, tsumes: r.tsumes.map((t) => (t.ply === ply ? updated : t)) } : r,
      );
    },
    [result, ensureEngine],
  );

  /*
   * Gaffes et erreurs, pas seulement les gaffes : une erreur perd déjà assez de
   * pourcentage de victoire pour valoir d'être reprise, et n'y trouver que les
   * gaffes en laissait la moitié de côté sans raison.
   */
  const focusedMistakes = useMemo(
    () => focusedPlies.filter((p) => p.quality === 'blunder' || p.quality === 'mistake'),
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
    <div
      className={`app${
        /* La barre de navigation flottante sort du flux et se poserait sur le
           pied de page : seul l'onglet qui la porte réserve la place. */
        phase.kind === 'done' && result && game && tab !== 'tsume' ? ' app-navbar' : ''
      }`}
    >
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

            {/* Le dessin des kanji est affaire de goût, et ce qui se lit bien
                dépend de l'écran : un mincho fin peut s'empâter sur un petit
                plateau, là où un gothique reste net. */}
            <label className="focus-control">
              Police
              <select
                value={pieceFont}
                onChange={(e) => setPieceFont(e.target.value as PieceFont)}
              >
                {PIECE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {PIECE_FONT_LABEL_FR[f]}
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
                    onChange={(e) => chooseFocus(e.target.value as 'both' | 'b' | 'w')}
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
                {/* La cadence est ici, et pas seulement sur l'écran de saisie :
                    sans elle, « réanalyser » referait exactement la même chose.
                    Le même composant des deux côtés — le menu qui vivait ici
                    plafonnait à 800 ms, si bien qu'un réglage à 2 s n'y avait
                    pas de valeur correspondante. */}
                <MovetimeSlider
                  label="Balayage"
                  value={movetimeMs}
                  onChange={changeMovetime}
                  positions={game.moves.length + 1}
                />
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
            {/*
             * Dernière ligne du panneau, volontairement discrète. Elle répond à
             * une question qu'on se pose sans arrêt quand le site est publié
             * par une chaîne qui traîne : est-ce que ce que je regarde est bien
             * la dernière version ? Sans elle, un correctif absent et un cache
             * périmé se ressemblent trait pour trait.
             */}
            <p className="options-build">Version : {__BUILD_STAMP__}</p>
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
              className={`progress-fill${phase.step === 'tsume' ? ' refine' : ''}`}
              style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
            />
          </div>
          <span>
            {PHASE_LABEL[phase.step]} — {phase.done} / {phase.total} positions
          </span>
        </div>
      )}

      {phase.kind === 'done' && result && game && (
        <>
          <div className="toolbar">
            <div className="tabs">
              <button
                className={`tab${tab === 'analysis' ? ' active' : ''}`}
                onClick={() => {
                  /*
                   * Revenir de l'entraînement montre la même position qu'on y
                   * regardait, plutôt que celle où l'analyse était restée —
                   * potentiellement un tout autre moment de la partie.
                   */
                  if (tab === 'training' && trainingPly !== null) setCurrentPly(trainingPly - 1);
                  setTab('analysis');
                }}
              >
                Analyse
              </button>
              <button
                className={`tab${tab === 'training' ? ' active' : ''}`}
                onClick={() => setTab('training')}
              >
                Entraînement ({focusedMistakes.length})
              </button>
              <button
                className={`tab${tab === 'tsume' ? ' active' : ''}`}
                onClick={() => setTab('tsume')}
              >
                Tsume ({focusedTsumes.length})
              </button>
              <button
                className={`tab${tab === 'study' ? ' active' : ''}`}
                onClick={() => setTab('study')}
              >
                Étude
              </button>
            </div>
          </div>

          {tab === 'analysis' ? (
            <>
              <div className="analysis-body">
                {/*
                  Le bilan par joueur vivait dans sa propre rangée, pleine
                  largeur, au-dessus de la courbe. Sur un grand écran la courbe
                  elle-même plafonne à 760 px (voir `EvalGraph.css`) : tout ce
                  qui suivait à sa droite restait vide. Le bilan s'y loge
                  maintenant à la place ; en dessous de 861 px il n'y a plus de
                  place à côté, la ligne se replie et le bilan repasse sous la
                  courbe — voir `.analysis-graph-row` dans App.css.
                */}
                <div className="analysis-graph-row">
                  <div className="analysis-graph">
                  <EvalGraph
                    evalCurve={result.evalCurve}
                    plies={focusedPlies}
                    moveLabels={moveLabels}
                    currentPly={currentPly}
                    onSelectPly={selectPly}
                    spoiler={{ revealed: graphRevealed, onReveal: () => setGraphRevealed(true) }}
                    navControls={
                      /*
                       * Les chevrons servent à chaque coup : sur téléphone ils
                       * quittent la carte pour se poser en bas à droite de
                       * l'écran, sous le pouce (voir `.eval-nav`). ⏮ et ⏭ ont
                       * disparu : la courbe est cliquable, et un coup précis
                       * se choisit mieux dessus qu'en tenant une flèche.
                       */
                      <div className="float-nav">
                        <button
                          className="btn btn-ghost"
                          onClick={stepBack}
                          disabled={
                            branchState.moves > 0
                              ? branchState.thinking
                              : variation
                                ? variation.index === 0
                                : currentPly === 0
                          }
                          aria-label="Coup précédent"
                        >
                          ‹
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={stepForward}
                          disabled={
                            branchState.moves > 0
                              ? branchState.thinking
                              : variation
                                ? variation.index >= variation.moves.length
                                : currentPly >= game.moves.length
                          }
                          aria-label={
                            branchState.moves > 0 ? 'Jouer le coup du moteur' : 'Coup suivant'
                          }
                        >
                          ›
                        </button>
                      </div>
                    }
                    lineControl={
                      /*
                       * Reste à droite de la rangée : un appui par ligne ne
                       * justifie pas d'occuper le coin le plus précieux de
                       * l'écran, contrairement aux chevrons.
                       */
                      <button
                        className={`btn btn-line${variation ? ' active' : ''}`}
                        onClick={toggleBestLine}
                        disabled={
                          branchState.moves > 0 ||
                          (!variation && (bestLine?.bestMovePv.length ?? 0) === 0)
                        }
                      >
                        {variation ? '↩ Revenir à la partie' : 'Meilleure suite'}
                      </button>
                    }
                  />
                  </div>

                  {summary && (
                    <div className="summary">
                      {(['b', 'w'] as const).map((side) => (
                        <div className={`summary-card${focusSide === side ? ' active' : ''}`} key={side}>
                          {/*
                            Cliquer le nom reprend « Suivre » sans passer par
                            les réglages : un second clic sur le même camp
                            revient à « les deux joueurs », plutôt que de
                            forcer à en choisir un. La carte entière change de
                            fond pour marquer le camp suivi — le nom seul se
                            voyait mal.
                          */}
                          <button
                            type="button"
                            className="summary-side"
                            onClick={() => chooseFocus(focusSide === side ? 'both' : side)}
                          >
                            {side === 'b' ? '▲ Sente' : '△ Gote'}
                            {side === 'b' && game.black ? ` — ${game.black}` : ''}
                            {side === 'w' && game.white ? ` — ${game.white}` : ''}
                          </button>
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
                </div>
                {/*
                  Colonne de gauche : ce qu'on manipule en boucle. Le plateau,
                  puis immédiatement dessous les flèches de navigation et l'état
                  du coup affiché. Tout le reste attend son tour à droite.
                */}
                <div className="analysis-main">
                  {/*
                    Le plateau d'analyse est jouable : « et si j'avais joué ça ? »
                    est la question qu'on se pose devant une partie, et à laquelle
                    une courbe ne répond pas. Il reçoit la position affichée —
                    celle de la partie, ou celle d'une variante qu'on parcourt.
                  */}
                  {shownPosition && (
                    <ExploreBoard
                      baseSfen={shownPosition.toSfen()}
                      ensureEngine={ensureEngine}
                      flipped={flipped}
                      gameArrows={arrows}
                      lastMove={lastMove}
                      blackName={game.black}
                      whiteName={game.white}
                      replyMs={replyMs}
                      showArrowB={showArrowB}
                      showArrowW={showArrowW}
                      onBranchStart={() => setPanel('explore')}
                      onBranchState={onBranchState}
                      ref={exploreRef}
                    />
                  )}
                  {variation && (
                    <p className="variation-hint">
                      Meilleure suite — {variation.index} / {variation.moves.length}
                      {variationView?.label ? ` · ${variationView.label}` : ''}
                    </p>
                  )}
                </div>

                <div className="analysis-side">
                  {/*
                    Au-dessus des onglets plutôt que dans le seul panneau
                    Explorer : la flèche verte sert aussi bien en parcourant
                    la partie (« Coups ») qu'en l'explorant, pas la peine de
                    changer d'onglet pour la couper.
                  */}
                  <div className="arrow-toggles">
                    <label className="explore-toggle">
                      <input
                        type="checkbox"
                        checked={showArrowB}
                        onChange={(e) => setShowArrowB(e.target.checked)}
                      />
                      <span>Flèche Sente</span>
                    </label>
                    <label className="explore-toggle">
                      <input
                        type="checkbox"
                        checked={showArrowW}
                        onChange={(e) => setShowArrowW(e.target.checked)}
                      />
                      <span>Flèche Gote</span>
                    </label>
                  </div>

                  <div className="analysis-segments" role="tablist">
                    <button
                      role="tab"
                      aria-selected={panel === 'moves'}
                      className={panel === 'moves' ? 'active' : ''}
                      onClick={() => setPanel('moves')}
                    >
                      Coups
                    </button>
                    <button
                      role="tab"
                      aria-selected={panel === 'explore'}
                      className={panel === 'explore' ? 'active' : ''}
                      onClick={() => setPanel('explore')}
                    >
                      Explorer
                    </button>
                  </div>

                  <div className={`analysis-panel panel-moves${panel === 'moves' ? ' active' : ''}`}>
                    <MoveList
                      plies={result.plies}
                      moveLabels={moveLabels}
                      currentPly={currentPly}
                      onSelectPly={selectPly}
                      focusSide={focusSide}
                    />
                  </div>

                  <div className={`analysis-panel panel-explore${panel === 'explore' ? ' active' : ''}`}>
                    <p className="explore-hint">
                      Jouez un coup sur le plateau pour ouvrir une variante. Vous jouez les deux
                      camps ; « › » demande son coup au moteur, et la partie reprendra son cours
                      au coup suivant.
                    </p>
                    <ExploreSettings
                      replyMs={replyMs}
                      onReplyMs={setReplyMs}
                      showArrowB={showArrowB}
                      showArrowW={showArrowW}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : tab === 'training' ? (
            <TrainingMode
              mistakes={focusedMistakes}
              ensureEngine={ensureEngine}
              onDeepen={deepenBlunder}
              movetimeMs={movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
              onPositionChange={setTrainingPly}
            />
          ) : tab === 'tsume' ? (
            <TsumeMode
              tsumes={focusedTsumes}
              ensureEngine={ensureEngine}
              onDeepen={deepenTsumeAt}
              movetimeMs={movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
            />
          ) : (
            <StudyMode
              plies={result.plies}
              moveLabels={moveLabels}
              ensureEngine={ensureEngine}
              movetimeMs={movetimeMs}
              flipped={flipped}
              blackName={game.black}
              whiteName={game.white}
            />
          )}
        </>
      )}

      {/*
        `<dialog open>` plutôt qu'une div : le navigateur lui donne le rôle
        d'accessibilité, la touche Échap et la place au-dessus du reste sans
        qu'on ait à empiler des z-index. Pas de `showModal()` — il refuserait
        le rendu déclaratif de React et fermerait la boîte à chaque re-rendu.
      */}
      {askFocus && game && (
        <div className="modal-backdrop">
          <dialog open className="focus-dialog" aria-labelledby="focus-title">
            <h2 id="focus-title">Quel joueur suivez-vous ?</h2>
            <p>
              Les compteurs, les gaffes et les tsume ne retiendront que ses coups, et le plateau
              se placera de son côté.
            </p>
            <div className="focus-dialog-choices">
              <button className="btn btn-primary" onClick={() => chooseFocus('b')}>
                ▲ {game.black || 'Sente'}
              </button>
              <button className="btn btn-primary" onClick={() => chooseFocus('w')}>
                △ {game.white || 'Gote'}
              </button>
              <button className="btn btn-ghost" onClick={() => chooseFocus('both')}>
                Les deux joueurs
              </button>
            </div>
          </dialog>
        </div>
      )}

      <footer className="app-footer">
        <span>
          Moteur : YaneuraOu compilé en WebAssembly — tout tourne dans votre navigateur, rien n'est
          envoyé sur un serveur.
        </span>
        {/*
          Crédits repliés mais présents sur chaque page. YaneuraOu est sous
          GPL-3.0 : distribuer le binaire oblige à indiquer clairement où
          trouver les sources correspondantes, ce que fait le lien ci-dessous.
          Le reste est de la simple reconnaissance — ces outils ont fait le
          travail, ils méritent d'être nommés.
        */}
        <details className="credits">
          <summary>Crédits et licences</summary>
          <ul>
            <li>
              <a href="https://github.com/yaneurao/YaneuraOu" target="_blank" rel="noreferrer">
                YaneuraOu
              </a>{' '}
              — le moteur, par yaneurao. GPL-3.0. Compilé en WebAssembly par{' '}
              <a href="https://github.com/mizar/YaneuraOu.wasm" target="_blank" rel="noreferrer">
                mizar/YaneuraOu.wasm
              </a>
              , distribué ici via le paquet{' '}
              <code>@mizarjp/yaneuraou.k-p</code> 7.6.3. Texte de la licence et empreintes des
              fichiers dans <code>public/engine/</code>.
            </li>
            <li>
              <a href="https://react.dev" target="_blank" rel="noreferrer">
                React
              </a>{' '}
              et{' '}
              <a href="https://vite.dev" target="_blank" rel="noreferrer">
                Vite
              </a>{' '}
              — interface et compilation. MIT.
            </li>
            <li>
              <a href="https://github.com/gzuidhof/coi-serviceworker" target="_blank" rel="noreferrer">
                coi-serviceworker
              </a>{' '}
              de Guido Zuidhof — pose les en-têtes COOP/COEP que GitHub Pages ne permet pas de
              configurer, sans lesquels le moteur ne peut pas utiliser plusieurs fils. MIT.
            </li>
            <li>
              Thèmes d'après{' '}
              <a href="https://catppuccin.com" target="_blank" rel="noreferrer">
                Catppuccin
              </a>
              ,{' '}
              <a href="https://nordtheme.com" target="_blank" rel="noreferrer">
                Nord
              </a>
              ,{' '}
              <a href="https://draculatheme.com" target="_blank" rel="noreferrer">
                Dracula
              </a>
              ,{' '}
              <a href="https://github.com/morhetz/gruvbox" target="_blank" rel="noreferrer">
                Gruvbox
              </a>
              ,{' '}
              <a href="https://ethanschoonover.com/solarized" target="_blank" rel="noreferrer">
                Solarized
              </a>{' '}
              et{' '}
              <a
                href="https://github.com/enkia/tokyo-night-vscode-theme"
                target="_blank"
                rel="noreferrer"
              >
                Tokyo Night
              </a>
              .
            </li>
            <li>
              L'interface et l'analyse viennent de{' '}
              <a href="https://github.com/suugaku32/scb-analyseur" target="_blank" rel="noreferrer">
                scb-analyseur
              </a>
              , dont ce projet est dérivé. GPL-3.0-or-later.
            </li>
            <li>
              Le classement des coups en points de <em>win %</em> suit la méthode de{' '}
              <a href="https://lichess.org" target="_blank" rel="noreferrer">
                lichess
              </a>
              .
            </li>
          </ul>
          {/*
            La licence du site lui-même, et non plus seulement celle de ce qu'il
            embarque. Elle suit celle du moteur : la compatibilité est acquise,
            et la frontière entre les deux cesse d'être une question.
          */}
          <p className="credits-licence">
            Cette application est distribuée sous{' '}
            <a
              href="https://github.com/suugaku32/benkyo/blob/HEAD/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              GPL-3.0-or-later
            </a>
            .
          </p>
        </details>
      </footer>
    </div>
  );
}
