import { useMemo, useState } from 'react';
import { Board } from './Board';
import { VariationBar } from './VariationBar';
import { DeepenControl } from './DeepenControl';
import type { Tsume } from '../analysis/analyze';
import { firstQuietAttackerMove } from '../analysis/analyze';
import type { UsiEngine } from '../engine/UsiEngine';
import { Position } from '../shogi/position';
import { generateLegalMoves, isKingCapturable, moveToUsi } from '../shogi/moveGen';
import { formatUsiMoveAsKif } from '../shogi/notation';
import type { Move, PieceType, Square } from '../shogi/types';
import { sameSquare, usiToSquare } from '../shogi/types';
import './TsumeMode.css';

/**
 * Première vérification, volontairement courte : la plupart des mats sont peu
 * profonds et l'utilisateur ne doit pas attendre entre deux coups.
 *
 * Elle ne peut pas servir de verdict négatif pour autant. Un tsume repéré à la
 * cadence longue peut être un mat en 9 ; après un coup juste il reste un mat en
 * 8, qu'une recherche de 400 ms ne verra pas forcément — déclarer « le mat
 * s'échappe » sur ce seul silence rejetterait des solutions correctes. D'où la
 * seconde vérification à la cadence de l'analyse avant tout verdict d'échec.
 */
const QUICK_CHECK_MS = 400;

type State =
  /** L'utilisateur cherche son coup. */
  | { kind: 'solving' }
  | { kind: 'checking' }
  /** Le coup proposé laisse échapper le mat ; il reste posé jusqu'au retour en arrière. */
  | { kind: 'escaped'; label: string }
  /** Coup légal mais sans échec : un tsume ne s'y résout pas. */
  | { kind: 'noCheck'; label: string }
  | { kind: 'solved' }
  /** Le moteur n'a pas pu démarrer : sans lui, impossible de juger un coup. */
  | { kind: 'engineError'; message: string }
  | { kind: 'revealed' };

interface TsumeModeProps {
  tsumes: Tsume[];
  /** Fournit le moteur, en le démarrant s'il ne l'est pas encore. */
  ensureEngine: () => Promise<UsiEngine>;
  /** Reprend ce tsume à la cadence demandée : c'est la séquence qu'on y gagne. */
  onDeepen?: (ply: number, movetimeMs: number) => Promise<void>;
  /** Cadence de l'analyse : sert de recours quand la vérification rapide ne voit pas le mat. */
  movetimeMs: number;
  flipped?: boolean;
  blackName?: string;
  whiteName?: string;
}

/** Rejoue une séquence depuis un SFEN. Renvoie null si la séquence est invalide. */
function replay(sfen: string, moves: string[]): Position | null {
  try {
    const p = Position.fromSfen(sfen);
    for (const m of moves) p.applyUsiMove(m);
    return p;
  } catch {
    return null;
  }
}

export function TsumeMode({
  tsumes,
  ensureEngine,
  onDeepen,
  movetimeMs,
  flipped,
  blackName,
  whiteName,
}: TsumeModeProps) {
  const [idx, setIdx] = useState(0);
  /** Coups joués depuis la position de l'exercice : les nôtres et les défenses. */
  const [line, setLine] = useState<string[]>([]);
  const [state, setState] = useState<State>({ kind: 'solving' });
  const [selected, setSelected] = useState<
    { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType } | null
  >(null);
  const [errorSquare, setErrorSquare] = useState<Square | null>(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [solvedSet, setSolvedSet] = useState<Set<number>>(new Set());
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  /**
   * Demi-coups de la solution déjà joués d'avance, pour raccourcir l'exercice.
   * Toujours pair : sauter un nombre impair rendrait la main à l'adversaire, et
   * ce n'est plus le même problème.
   */
  const [skipped, setSkipped] = useState(0);
  /*
   * Exploration des défenses. Un tsume n'est prouvé que si *toutes* les
   * réponses mènent au mat ; l'exercice n'en montre qu'une, celle que le moteur
   * juge la meilleure. Ici on rend la main sur les deux camps : on joue une
   * autre fuite du roi, une autre interposition, et le moteur dit si le mat
   * tient encore. C'est la différence entre croire une solution et la vérifier.
   */
  const [exploring, setExploring] = useState(false);
  const [exploreNote, setExploreNote] = useState<string | null>(null);
  /**
   * Comment le mat se poursuit après la défense qu'on vient d'éprouver.
   * Annoncer « le mat tient » sans montrer par quoi ne répond qu'à la moitié de
   * la question : ce qu'on veut savoir, c'est *comment*.
   */
  const [exploreLine, setExploreLine] = useState<{ base: string; moves: string[] } | null>(null);
  const [exploreReplay, setExploreReplay] = useState<number | null>(null);

  const current = tsumes[idx];

  // Position d'où part réellement l'exercice, une fois le raccourci appliqué.
  const startPosition = useMemo(() => {
    if (!current) return null;
    try {
      const p = Position.fromSfen(current.sfen);
      for (const m of current.solution.slice(0, skipped)) p.applyUsiMove(m);
      return p;
    } catch {
      return null;
    }
  }, [current, skipped]);

  // Un tsume se choisit sur son énoncé — qui mate, en combien, et si l'occasion
  // a été saisie — pas en défilant à l'aveugle.
  const labels = useMemo(
    () =>
      tsumes.map(
        (t) =>
          `${t.ply}. ${t.color === 'b' ? '▲' : '△'} mat en ${t.mateIn}` +
          (t.delivered ? ' · porté' : ' · manqué'),
      ),
    [tsumes],
  );

  if (!current || !startPosition) {
    return (
      <div className="training-empty">
        <p>Aucun mat forcé repéré dans cette partie.</p>
        <p className="tsume-note">
          La détection s'appuie sur les mats que le moteur annonce pendant l'analyse : elle ne
          rate jamais un mat qu'il a vu, mais un balayage court laisse passer les mats profonds.
          Augmenter le temps par coup en révèle davantage.
        </p>
      </div>
    );
  }

  /*
   * Tout ce qui suit raisonne sur l'exercice *raccourci*, pas sur le tsume
   * d'origine : sa position de départ, sa solution restante, sa longueur. Un
   * mat en 13 est illisible comme exercice ; ses cinq derniers coups sont un
   * vrai problème.
   */
  const exerciseSfen = startPosition.toSfen();
  const solution = current.solution.slice(skipped);
  const mateIn = current.mateIn - skipped;

  /*
   * Jusqu'où on peut raccourcir. Deux plafonds :
   *  — laisser au moins un coup à trouver ;
   *  — ne pas dépasser la variante que le moteur a réellement fournie, qui peut
   *    être plus courte que le mat annoncé si la recherche l'a tronquée.
   * Et toujours un nombre pair, pour que le camp au trait reste le bon.
   */
  /*
   * Le filtre de détection ne se prononce que sur la variante qu'il voit :
   * tronquée par la recherche, elle peut cacher un coup tranquille dans sa
   * queue, et « Approfondir » la remplace sans repasser par lui. On revérifie
   * donc ce qui est réellement affiché, et on le dit — chercher un échec qui
   * n'existe pas est la pire façon de découvrir la nuance.
   */
  const quietAt = firstQuietAttackerMove(exerciseSfen, solution);

  const maxSkip =
    Math.floor(Math.min(current.mateIn - 1, current.solution.length - 1) / 2) * 2;

  // Position courante de l'exercice : départ + coups déjà joués. La solution
  // dévoilée prend la main sur le plateau quand on la parcourt.
  const solutionView =
    replayIndex === null ? null : replay(exerciseSfen, solution.slice(0, replayIndex));
  /*
   * La suite du mat après une défense éprouvée se déroule sur le plateau comme
   * la solution : c'est ce qu'on est venu voir. Elle passe devant, étant la plus
   * récemment demandée.
   */
  const exploreView =
    exploreLine && exploreReplay !== null
      ? replay(exploreLine.base, exploreLine.moves.slice(0, exploreReplay))
      : null;
  const livePosition = replay(exerciseSfen, line) ?? startPosition;
  const position = exploreView ?? solutionView ?? livePosition;

  const legalMoves = generateLegalMoves(position, position.turn);
  const attackerTurn = position.turn === current.color;
  const ourTurn =
    state.kind === 'solving' && !solutionView && !exploreView && (exploring || attackerTurn);

  const destinations = (): Square[] => {
    if (!selected || !ourTurn) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const flashError = (sq: Square) => {
    setErrorSquare(sq);
    setTimeout(() => setErrorSquare(null), 450);
  };

  /** Le camp au trait est-il en échec ? */
  const inCheck = (pos: Position): boolean => isKingCapturable(pos, pos.turn);

  /**
   * Mat, au sens strict : en échec *et* sans réponse. Se contenter de l'absence
   * de coup légal confondrait le mat avec le pat — qui perd aussi au shogi, mais
   * qui n'est pas ce qu'un tsume demande de trouver.
   */
  const isMated = (pos: Position): boolean =>
    inCheck(pos) && generateLegalMoves(pos, pos.turn).length === 0;

  /*
   * Défense jouée à la main, en mode exploration. On ne juge pas le coup — le
   * défenseur a le droit de mal jouer — on demande seulement au moteur si le
   * mat tient encore. Après la défense c'est l'attaquant au trait, donc un
   * `score mate` positif signifie « oui, et en N ».
   */
  const submitDefence = async (usi: string) => {
    const afterDefence = line.concat(usi);
    if (!replay(exerciseSfen, afterDefence)) return;
    const label = formatUsiMoveAsKif(livePosition, usi, null);
    setLine(afterDefence);
    setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
    setState({ kind: 'checking' });

    let engine: UsiEngine;
    try {
      engine = await ensureEngine();
    } catch (e) {
      setState({ kind: 'engineError', message: (e as Error).message });
      return;
    }
    const r = await engine.analyze(exerciseSfen, afterDefence, { movetimeMs });
    const tient = r.scoreMate !== null && r.scoreMate > 0;
    setExploreNote(
      tient
        ? `${label} : le mat tient — mat en ${r.scoreMate}.`
        : `${label} : cette défense échappe au mat.`,
    );
    const base = replay(exerciseSfen, afterDefence);
    setExploreLine(tient && base && r.pv.length ? { base: base.toSfen(), moves: r.pv } : null);
    setExploreReplay(null);
    setState({ kind: 'solving' });
  };

  const submitMove = async (usi: string) => {
    const afterOurs = line.concat(usi);
    const posAfterOurs = replay(exerciseSfen, afterOurs);
    if (!posAfterOurs) {
      setState({ kind: 'solving' });
      return;
    }

    /*
     * Poser le coup sur le plateau tout de suite, avant de le juger.
     *
     * Auparavant un coup faux était évalué puis rejeté sans jamais être
     * affiché : on tapait une pièce, on tapait une case, et rien ne bougeait.
     * Dans un tsume où la plupart des coups sont faux, l'exercice paraissait
     * simplement cassé. Le coup fautif reste visible jusqu'à « Réessayer ».
     */
    const label = formatUsiMoveAsKif(livePosition, usi, null);
    setLine(afterOurs);
    setState({ kind: 'checking' });

    // Mat immédiat : inutile de déranger le moteur — et l'exercice reste
    // résoluble même si celui-ci ne démarre pas.
    if (isMated(posAfterOurs)) {
      setSolvedSet((s) => new Set(s).add(idx));
      setState({ kind: 'solved' });
      return;
    }

    /*
     * Un tsume se résout en donnant échec à chaque coup : c'est la règle du
     * genre, et sans elle on accepterait des coups tranquilles qui conservent
     * un mat forcé sans rien y faire avancer. Le test précède la consultation
     * du moteur — inutile de le déranger pour un coup déjà hors sujet.
     */
    if (!inCheck(posAfterOurs)) {
      flashError(usiToSquare(usi.slice(2, 4)));
      setState({ kind: 'noCheck', label });
      return;
    }

    let engine: UsiEngine;
    try {
      engine = await ensureEngine();
    } catch (e) {
      setState({ kind: 'engineError', message: (e as Error).message });
      return;
    }

    // Le mat tient-il encore ? Le moteur parle du point de vue du défenseur :
    // un score de mat négatif chez lui veut dire qu'il est toujours perdu.
    const stillMated = (r: { scoreMate: number | null }) =>
      r.scoreMate !== null && r.scoreMate < 0;
    let verdict = await engine.analyze(exerciseSfen, afterOurs, {
      movetimeMs: QUICK_CHECK_MS,
    });
    if (!stillMated(verdict) && movetimeMs > QUICK_CHECK_MS) {
      verdict = await engine.analyze(exerciseSfen, afterOurs, { movetimeMs });
    }
    if (!stillMated(verdict)) {
      flashError(usiToSquare(usi.slice(2, 4)));
      setState({ kind: 'escaped', label });
      return;
    }

    /*
     * Le moteur défend, et on rend la main.
     *
     * `bestMove` peut être null : c'est `bestmove resign`, l'abandon. Ce n'est
     * pas un mat — le défenseur a encore des coups, il les juge seulement
     * perdus. Le compter comme une réussite créditerait une solution qui n'en
     * est pas une ; on choisit donc nous-mêmes une défense et l'exercice
     * continue jusqu'au vrai mat.
     */
    // En exploration, la défense revient à l'utilisateur : c'est tout l'objet
    // du mode. On s'arrête là, le mat est confirmé tenu.
    if (exploring) {
      setExploreNote('À vous de choisir la défense.');
      setState({ kind: 'solving' });
      return;
    }

    const defence =
      verdict.bestMove ?? verdict.pv[0] ?? moveToUsi(generateLegalMoves(posAfterOurs, posAfterOurs.turn)[0]);
    if (!defence) {
      setState({ kind: 'solving' });
      return;
    }
    const afterDefence = afterOurs.concat(defence);
    if (!replay(exerciseSfen, afterDefence)) {
      setState({ kind: 'solving' });
      return;
    }
    setLine(afterDefence);
    setState({ kind: 'solving' });
  };

  const tryMove = (to: Square) => {
    if (!ourTurn || !selected) return;
    const from = selected;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (from.kind === 'hand') return !m.from && m.piece === from.type;
      return m.from != null && sameSquare(m.from, from.sq);
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
    const chosen = moveToUsi(candidates[0]);
    void (attackerTurn ? submitMove(chosen) : submitDefence(chosen));
  };

  const onSquareClick = (sq: Square) => {
    if (!ourTurn || promptPromotion) return;
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
    if (!ourTurn || promptPromotion) return;
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
    if (move) void (attackerTurn ? submitMove(moveToUsi(move)) : submitDefence(moveToUsi(move)));
  };

  /** Retirer le coup fautif du plateau ; la progression acquise avant lui reste. */
  const retry = () => {
    setLine((l) => l.slice(0, -1));
    setState({ kind: 'solving' });
    setSelected(null);
    setErrorSquare(null);
  };

  const restart = () => {
    setLine([]);
    setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
    setState({ kind: 'solving' });
    setSelected(null);
    setPromptPromotion(null);
    setErrorSquare(null);
    setReplayIndex(null);
  };

  const goTo = (next: number) => {
    setIdx(next);
    setSkipped(0);
    setLine([]);
    setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
    setState({ kind: 'solving' });
    setSelected(null);
    setPromptPromotion(null);
    setErrorSquare(null);
    setReplayIndex(null);
  };

  /** Raccourcir remet l'exercice à zéro : ce n'est plus la même position. */
  const changeSkipped = (n: number) => {
    setSkipped(n);
    setLine([]);
    setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
    setState({ kind: 'solving' });
    setSelected(null);
    setPromptPromotion(null);
    setErrorSquare(null);
    setReplayIndex(null);
  };

  /*
   * Dernier coup joué, pour le surlignage du plateau. Il doit décrire la même
   * position que celle affichée : en parcourant une suite, c'est le dernier
   * coup de cette suite, pas le dernier coup qu'on avait joué soi-même.
   */
  const shownMoves =
    exploreView && exploreLine
      ? exploreLine.moves.slice(0, exploreReplay ?? 0)
      : solutionView
        ? solution.slice(0, replayIndex ?? 0)
        : line;
  const lastUsi = shownMoves[shownMoves.length - 1] ?? null;
  const lastMove = lastUsi
    ? {
        from: lastUsi.includes('*') ? null : usiToSquare(lastUsi.slice(0, 2)),
        to: usiToSquare(lastUsi.slice(2, 4)),
      }
    : null;

  /*
   * Aucune flèche ici, à la différence de l'analyse et de l'étude des gaffes.
   * Là-bas elle montre quelque chose qu'on ne demande pas de deviner — le coup
   * recommandé, ou celui qui a été joué dans la partie. Dans un tsume, trouver
   * le coup *est* l'exercice : le désigner le supprime.
   */

  /*
   * Les chevrons flottants passaient d'un tsume au suivant — un rôle déjà
   * tenu par le sélecteur juste au-dessus, et sans intérêt tant que la
   * solution n'est pas connue : on ne sait pas encore ce qu'il y aurait à
   * dérouler. Une fois affichée, ils déroulent plutôt la ligne qu'on
   * regarde — la suite après une défense éprouvée en exploration si elle est
   * là (la plus récemment demandée, voir plus haut), sinon la séquence de
   * mat elle-même — coup par coup, comme les petites flèches de sa propre
   * barre.
   */
  const activeLine =
    exploreLine && state.kind === 'revealed'
      ? { base: exploreLine.base, moves: exploreLine.moves, index: exploreReplay, setIndex: setExploreReplay }
      : (state.kind === 'revealed' || state.kind === 'solved') && solution.length > 0 && !exploreLine
        ? { base: exerciseSfen, moves: solution, index: replayIndex, setIndex: setReplayIndex }
        : null;
  const stepActiveLine = (delta: -1 | 1) => {
    if (!activeLine) return;
    const at = activeLine.index ?? 0;
    const next = at + delta;
    if (next < 0 || next > activeLine.moves.length) return;
    activeLine.setIndex(next === 0 ? null : next);
  };
  const activeLineAt = activeLine?.index ?? 0;

  const sideLabel = current.color === 'b' ? '▲ Sente' : '△ Gote';
  const playerName = current.color === 'b' ? blackName : whiteName;
  const playedLabel = formatUsiMoveAsKif(startPosition, current.playedUsi, null);
  const escapedLabel = state.kind === 'escaped' ? state.label : '';
  const ourMovesPlayed = Math.ceil(line.length / 2);

  return (
    <div className="training tsume">
      <div className="training-head">
        <div className="training-progress">
          <label className="picker">
            <span className="picker-label">Tsume</span>
            <select
              value={idx}
              onChange={(e) => goTo(Number(e.target.value))}
              aria-label="Choisir un tsume"
            >
              {labels.map((text, i) => (
                <option key={i} value={i}>
                  {i + 1}/{tsumes.length} · {text}
                  {solvedSet.has(i) ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="training-solved">{solvedSet.size} résolu(s)</span>
        </div>
        {activeLine && (
          <div className="training-nav float-nav">
            <button
              className="btn btn-ghost"
              onClick={() => stepActiveLine(-1)}
              disabled={activeLineAt === 0}
              aria-label="Coup précédent de la solution"
            >
              ‹<span className="nav-word"> Précédente</span>
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => stepActiveLine(1)}
              disabled={activeLineAt >= activeLine.moves.length}
              aria-label="Coup suivant de la solution"
            >
              <span className="nav-word">Suivante </span>›
            </button>
          </div>
        )}
      </div>

      <p className="training-prompt">
        Coup {current.ply} —{' '}
        <strong>
          {sideLabel}
          {playerName ? ` (${playerName})` : ''}
        </strong>{' '}
        {/*
          « Mat en N » se compte en coups au shogi, et N est impair : les coups
          de l'attaquant et ceux du défenseur comptent pareil. C'est le nombre
          que le moteur annonce, celui des recueils de tsume, et celui qu'on
          annonce à voix haute. Parler de « demi-coups » ou diviser par deux
          n'apportait qu'une conversion à refaire de tête.
        */}
        a un <strong className="tsume-count">mat en {mateIn}</strong>.{' '}
        {current.delivered ? (
          <span className="tsume-found">Le mat a été porté dans la partie.</span>
        ) : current.lostAtPly === current.ply ? (
          <span className="tsume-missed">
            Dans la partie : <strong>{playedLabel}</strong> — le mat a été laissé passer.
          </span>
        ) : current.lostAtPly !== null ? (
          <span className="tsume-missed">
            Dans la partie : <strong>{playedLabel}</strong> gardait le mat, mais il a été perdu au
            coup {current.lostAtPly}.
          </span>
        ) : (
          <span className="tsume-missed">
            Le mat était encore là quand la partie s’arrête, sans avoir été porté.
          </span>
        )}{' '}
        <strong>Portez-le.</strong>
      </p>

      {current.repeats > 0 && (
        <p className="tsume-note tsume-span">
          La même occasion revenait encore au coup {current.lastPly} ({current.repeats} position
          {current.repeats > 1 ? 's regroupées' : ' regroupée'} ici).
        </p>
      )}

      {maxSkip > 0 && (
        <div className="tsume-shorten">
          <label>
            <span className="tsume-shorten-label">Longueur</span>
            <input
              type="range"
              min={0}
              max={maxSkip}
              step={2}
              value={skipped}
              onChange={(e) => changeSkipped(Number(e.target.value))}
              aria-label="Raccourcir le tsume"
            />
            <output>mat en {mateIn}</output>
          </label>
          {skipped > 0 && (
            <span className="tsume-note">
              {skipped} coup{skipped > 1 ? 's' : ''} de la solution déjà joué
              {skipped > 1 ? 's' : ''}.
            </span>
          )}
        </div>
      )}

      <div className="training-body">
        <div className="training-board">
          <Board
            position={position}
            lastMove={lastMove}
            interactive={ourTurn}
            selected={selected}
            legalDestinations={destinations()}
            errorSquare={errorSquare}
            handSide={position.turn}
            flipped={flipped}
            blackName={blackName}
            whiteName={whiteName}
            onSquareClick={onSquareClick}
            onHandPieceClick={onHandPieceClick}
          />
          {solutionView && (
            <p className="variation-hint">
              Solution du moteur — le plateau ne montre plus votre partie en cours.
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

          {/*
            Un tsume n'est prouvé que si *toutes* les réponses mènent au mat.
            L'exercice n'en joue qu'une, celle que le moteur préfère ; le doute
            porte justement sur les autres — « et si le roi fuyait par là ? ».
            En exploration, les deux camps sont jouables et le moteur se borne à
            dire, après chaque défense, si le mat tient encore.
          */}
          <div className="tsume-explore">
            <label>
              <input
                type="checkbox"
                checked={exploring}
                onChange={(e) => {
                  setExploring(e.target.checked);
                  setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
                }}
              />
              Explorer les défenses
            </label>
            {exploring && (
              <span className="tsume-note">
                Les deux camps sont jouables : essayez une autre fuite du roi.
              </span>
            )}
          </div>

          {quietAt > 0 && (
            <p className="tsume-note">
              Mat forcé, mais pas un tsume au sens strict : le coup {quietAt} de la solution ne
              donne pas échec. Un tsume en exige un à chaque coup de l’attaquant.
            </p>
          )}

          {exploreNote && <p className="tsume-explore-note">{exploreNote}</p>}

          {/*
            La suite du mat est une réponse, pas un commentaire : l'afficher
            d'office éventait l'exercice au moment même où l'on cherchait à
            l'éprouver. On voulait savoir *si* le mat tient — le verdict le dit
            — et se réserver de chercher *comment*. Elle attend donc « Voir la
            solution », comme la solution principale.
          */}
          {exploreLine && state.kind === 'revealed' && (
            <div className="training-lines">
              <VariationBar
                label="Le mat se poursuit"
                tone="best"
                baseSfen={exploreLine.base}
                moves={exploreLine.moves}
                maxMoves={exploreLine.moves.length}
                activeIndex={exploreReplay}
                onSelect={setExploreReplay}
              />
            </div>
          )}


          {state.kind === 'solving' && !promptPromotion && (
            <p className="training-hint">
              {exploring && !attackerTurn
                ? 'À la défense de jouer — choisissez la réponse à éprouver.'
                : ourMovesPlayed === 0
                  ? 'Sélectionnez une pièce puis sa case d’arrivée. Chaque coup doit conserver le mat forcé.'
                  : `${ourMovesPlayed * 2 - 1} coup${ourMovesPlayed > 1 ? 's' : ''} joué${
                      ourMovesPlayed > 1 ? 's' : ''
                    } sur ${mateIn}, le mat tient toujours. Continuez.`}
            </p>
          )}
          {state.kind === 'checking' && (
            <p className="training-hint">
              {exploring && attackerTurn ? 'Le moteur vérifie le mat…' : 'Le moteur cherche sa défense…'}
            </p>
          )}

          {state.kind === 'engineError' && (
            <div className="verdict verdict-wrong">
              <strong>Le moteur n’a pas pu démarrer</strong>
              <span>{state.message}</span>
              <span>
                Sans lui, un coup ne peut pas être vérifié — sauf s’il donne mat immédiatement.
              </span>
              <div className="tsume-actions">
                <button className="btn btn-ghost" onClick={retry}>
                  Réessayer ce coup
                </button>
              </div>
            </div>
          )}

          {state.kind === 'noCheck' && (
            <div className="verdict verdict-wrong">
              <strong>✗ Pas d’échec — {state.label}</strong>
              <span>
                Un tsume se résout en donnant échec à chaque coup. Ce coup est légal, mais il
                laisse le roi adverse tranquille.
              </span>
              <div className="tsume-actions">
                <button className="btn btn-ghost" onClick={retry}>
                  Réessayer ce coup
                </button>
              </div>
            </div>
          )}

          {state.kind === 'escaped' && (
            <div className="verdict verdict-wrong">
              <strong>✗ Le mat s’échappe — {escapedLabel}</strong>
              <span>
                Après ce coup, le moteur n’est plus matable de force.
                {ourMovesPlayed > 0 && ' Vos coups précédents restent bons.'}
              </span>
              <div className="tsume-actions">
                <button className="btn btn-ghost" onClick={retry}>
                  Réessayer ce coup
                </button>
              </div>
            </div>
          )}

          {state.kind === 'solved' && (
            <div className="verdict verdict-correct">
              <strong>✓ Mat</strong>
              {/*
                Compté comme le moteur et comme les recueils : en coups, les
                deux camps confondus, donc un nombre impair. `ourMovesPlayed` ne
                compte que les nôtres — la moitié de l'affaire.

                La longueur obtenue est affichée plutôt que celle annoncée : les
                deux coïncident quand la défense est la meilleure, et quand elles
                divergent c'est la partie jouée qui fait foi.
              */}
              <span>
                Mat en {ourMovesPlayed * 2 - 1}.
                {ourMovesPlayed * 2 - 1 !== mateIn && ` Le moteur en annonçait ${mateIn}.`}
              </span>
            </div>
          )}

          {onDeepen && (
            /*
             * Sur un tsume l'enjeu n'est pas le verdict — un mat annoncé est une
             * ligne prouvée — mais la *séquence* : une recherche courte publie
             * une variante tronquée, qui s'arrête avant le mat. Une seule
             * position à reprendre, donc une seule recherche.
             */
            <DeepenControl
              searches={1}
              refined={current.refined}
              onRun={async (ms) => {
                await onDeepen(current.ply, ms);
                // L'exercice repart de zéro : la solution a pu s'allonger, donc
                // la ligne jouée et le raccourci ne veulent plus rien dire.
                setLine([]);
    setExploreNote(null);
    setExploreLine(null);
    setExploreReplay(null);
                setSkipped(0);
                setReplayIndex(null);
                setState({ kind: 'solving' });
              }}
            />
          )}

          {/*
            La séquence d'origine part de la position de l'exercice et suppose
            la défense que le moteur préférait. Dès qu'on en a éprouvé une
            autre, elle ne décrit plus la partie en cours : la montrer à côté de
            la suite réelle met deux lignes concurrentes sous les yeux, dont une
            caduque. `exploreLine` est justement le signe qu'on a dévié.
          */}
          {(state.kind === 'revealed' || state.kind === 'solved') &&
            solution.length > 0 &&
            !exploreLine && (
            <div className="training-lines">
              <VariationBar
                label="Séquence de mat du moteur"
                tone="best"
                baseSfen={exerciseSfen}
                moves={solution}
                activeIndex={replayIndex}
                onSelect={setReplayIndex}
                /*
                 * Pas de plafond ici. Les huit coups par défaut conviennent à
                 * une variante d'analyse, dont la queue n'apprend rien — mais
                 * une solution de tsume *est* la réponse : coupée, elle
                 * s'arrête avant le mat, et le lecteur croit à une erreur.
                 */
                maxMoves={solution.length}
              />
            </div>
          )}

          {/*
           * Le moteur annonce la longueur du mat depuis son score, mais la
           * variante qu'il publie peut être plus courte : la table de
           * transposition en tronque la queue. Mieux vaut le dire que laisser
           * croire à une séquence fausse.
           */}
          {(state.kind === 'revealed' || state.kind === 'solved') &&
            solution.length > 0 &&
            solution.length < mateIn && (
              <p className="tsume-note">
                Le moteur annonce un mat en {mateIn} mais n’a publié que {solution.length} coups :
                sa recherche a tronqué la fin de la variante. Les coups montrés restent justes.
              </p>
            )}

          {!current.refined && (
            <p className="tsume-note">
              Mat repéré pendant le balayage rapide, non revu à la cadence longue : la séquence
              proposée peut être incomplète.
            </p>
          )}

          {/*
            Recommencer est toujours là, quel que soit l'état de l'exercice.
            Le bouton n'existait qu'au fond des verdicts d'échec et, un temps,
            dans le seul mode exploration : il fallait donc se tromper pour
            avoir le droit de reprendre. Or on veut refaire un tsume qu'on vient
            de résoudre, en essayer une autre défense, ou simplement effacer une
            solution qu'on a dévoilée trop vite.

            Désactivé quand il n'y a rien à défaire : un bouton qui ne fait rien
            se remarque, un bouton grisé s'explique.
          */}
          <div className="tsume-actions">
            <button
              className="btn btn-ghost"
              onClick={restart}
              disabled={line.length === 0 && state.kind === 'solving'}
            >
              ↺ Recommencer
            </button>
            {state.kind !== 'revealed' && state.kind !== 'solved' && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setState({ kind: 'revealed' });
                  setSelected(null);
                }}
              >
                Voir la solution
              </button>
            )}
          </div>

          {(state.kind === 'solved' || state.kind === 'revealed') && idx < tsumes.length - 1 && (
            <button className="btn btn-primary" onClick={() => goTo(idx + 1)}>
              Tsume suivant ›
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
