import type { UsiEngine } from '../engine/UsiEngine';
import { Position } from '../shogi/position';
import { generateLegalMoves, isKingCapturable } from '../shogi/moveGen';
import type { Color } from '../shogi/types';
import { classifyLoss, cpToWinPercent, scoreToCp, type MoveQuality } from './classify';

export interface PlyEval {
  ply: number; // 1-indexed: the move played to go from sfenBefore to sfenAfter
  moveUsi: string;
  color: Color;
  sfenBefore: string;
  sfenAfter: string;
  /** Engine cp score at sfenBefore, from the mover's perspective (≈ value of the best move). */
  evalBeforeCp: number;
  /** Engine cp score at sfenAfter, converted to the mover's perspective. */
  evalAfterCp: number;
  bestMove: string | null;
  /** Ce que le moteur aurait joué à la place, et la suite qu'il envisage. */
  bestMovePv: string[];
  /** La suite après le coup réellement joué : c'est elle qui montre pourquoi il est mauvais. */
  refutationPv: string[];
  centipawnLoss: number;
  quality: MoveQuality;
  /** True once the second pass has re-examined this ply at the deeper time control. */
  refined?: boolean;
  /**
   * Mat forcé disponible avant ce coup, du point de vue du joueur au trait :
   * positif = il mate en N, négatif = il se fait mater en N. `null` = pas de mat vu.
   */
  mateBefore: number | null;
  /** Idem après le coup joué, ramené au point de vue du joueur qui vient de jouer. */
  mateAfter: number | null;
}

/**
 * Une position de la partie où le joueur au trait disposait d'un mat forcé.
 *
 * Détecté via le `score mate` de la recherche normale : ce build du moteur
 * n'expose pas `go mate` (la commande y tombe dans une recherche *sans limite
 * de temps*, vérifié). Un score de mat est une ligne prouvée par la recherche,
 * donc les faux positifs sont exclus ; en revanche un balayage court rate les
 * mats profonds, d'où la troisième passe qui reprend ces positions plus
 * longtemps.
 */
export interface Tsume {
  /** Coup de la partie où l'occasion s'est présentée (1-indexé). */
  ply: number;
  color: Color;
  sfen: string;
  /**
   * Longueur du mat, telle que le moteur l'annonce : en coups, les deux camps
   * confondus, donc impaire. C'est le « mat en N » des recueils de tsume, et le
   * nombre affiché tel quel dans l'interface.
   */
  mateIn: number;
  /** La séquence de mat : c'est la solution. */
  solution: string[];
  /** Le coup effectivement joué dans la partie. */
  playedUsi: string;
  /** Vrai si le coup joué à `ply` conservait le mat forcé. */
  found: boolean;
  /** Vrai si la position a été revue à la cadence longue. */
  refined: boolean;
  /**
   * Positions supplémentaires absorbées : un mat forcé reste disponible tant
   * qu'on le porte, donc la même occasion réapparaît à chaque coup suivant. Les
   * lister séparément produirait une file de tsume quasi identiques.
   */
  repeats: number;
  /** Dernier coup de la partie où cette même occasion était encore là. */
  lastPly: number;
  /**
   * Le mat a-t-il été effectivement donné dans la partie ? À ne pas confondre
   * avec « le mat était encore forcé au dernier coup connu » : un kifu peut
   * s'arrêter (abandon, partie tronquée) alors que le mat tenait toujours.
   */
  delivered: boolean;
  /** Coup où le mat a été perdu, si le joueur l'a laissé filer en route. */
  lostAtPly: number | null;
}

export interface EvalPoint {
  ply: number;
  /** Positive = advantage for black (sente). */
  cpForBlack: number;
}

export interface AnalysisResult {
  startSfen: string;
  plies: PlyEval[];
  evalCurve: EvalPoint[];
  blunders: PlyEval[];
  mistakes: PlyEval[];
  tsumes: Tsume[];
}

export type AnalysisPhase = 'scan' | 'tsume';

export interface AnalyzeGameOptions {
  /** Time per position for the first pass, which sweeps the whole game. */
  movetimeMs?: number;
  depth?: number;
  onProgress?: (phase: AnalysisPhase, done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Ce que le moteur rapporte pour une position donnée. */
interface PositionEval {
  cp: number;
  /** `score mate N` brut, du point de vue du joueur au trait. */
  mate: number | null;
  bestMove: string | null;
  pv: string[];
}

export async function analyzeGame(
  engine: UsiEngine,
  startSfen: string,
  moves: string[],
  opts: AnalyzeGameOptions = {},
): Promise<AnalysisResult> {
  const sfens: string[] = [startSfen];
  const pos = Position.fromSfen(startSfen);
  for (const m of moves) {
    pos.applyUsiMove(m);
    sfens.push(pos.toSfen());
  }

  // Pass 1 — sweep every position quickly, just to locate the suspect moves.
  const total = sfens.length;
  const evals: PositionEval[] = [];
  for (let i = 0; i < sfens.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError');
    const result = await engine.analyze(sfens[i], [], {
      movetimeMs: opts.movetimeMs,
      depth: opts.depth,
    });
    evals.push({
      cp: scoreToCp(result.scoreCp, result.scoreMate),
      mate: result.scoreMate,
      bestMove: result.bestMove,
      pv: result.pv,
    });
    opts.onProgress?.('scan', i + 1, total);
  }

  const plies: PlyEval[] = [];
  const evalCurve: EvalPoint[] = [];
  const posAt = Position.fromSfen(startSfen);
  evalCurve.push({
    ply: 0,
    cpForBlack: posAt.turn === 'b' ? evals[0].cp : -evals[0].cp,
  });

  for (let i = 0; i < moves.length; i++) {
    const mover: Color = posAt.turn;
    const evalBeforeCp = evals[i].cp;
    const evalAfterFromNextMoverCp = evals[i + 1].cp;
    const evalAfterCp = -evalAfterFromNextMoverCp; // back to `mover`'s perspective
    const loss = Math.max(0, evalBeforeCp - evalAfterCp);
    const winBefore = cpToWinPercent(evalBeforeCp);
    const winAfter = cpToWinPercent(evalAfterCp);
    const winDrop = Math.max(0, winBefore - winAfter);

    const sfenBefore = sfens[i];
    const sfenAfter = sfens[i + 1];
    const moveUsi = moves[i];

    plies.push({
      ply: i + 1,
      moveUsi,
      color: mover,
      sfenBefore,
      sfenAfter,
      evalBeforeCp,
      evalAfterCp,
      bestMove: evals[i].bestMove,
      bestMovePv: evals[i].pv,
      refutationPv: evals[i + 1].pv,
      centipawnLoss: loss,
      quality: classifyLoss(winDrop),
      mateBefore: evals[i].mate,
      // Le moteur parle du point de vue du joueur au trait, qui est l'adversaire
      // après le coup : on inverse pour rester du côté de celui qui a joué.
      mateAfter: evals[i + 1].mate === null ? null : -evals[i + 1].mate!,
    });

    posAt.applyUsiMove(moveUsi);
    evalCurve.push({
      ply: i + 1,
      cpForBlack: mover === 'b' ? evalAfterCp : -evalAfterCp,
    });
  }

  /*
   * Il y avait ici une seconde passe, qui reprenait les coups suspects à une
   * cadence longue. Elle a été retirée : mesurée sur une partie de 80 coups,
   * elle rouvrait 44 positions — plus de la moitié — parce qu'un balayage,
   * quelle que soit sa durée, signale toujours autant de coups (43 à 200 ms,
   * 46 à 2 s). Son coût était donc structurel, pas réglable.
   *
   * Ce qu'elle apportait est mieux servi autrement : un balayage plus long
   * pour la justesse d'ensemble, et l'approfondissement à la demande pour la
   * position qu'on regarde vraiment. Deviner à l'avance où mettre le temps
   * était le mauvais pari.
   */
  const deep = new Map<number, PositionEval>();

  /*
   * Pass 3 — les positions où un mat forcé a été aperçu méritent une vraie
   * séquence de solution : le balayage donne le verdict « il y a un mat » mais
   * souvent une variante tronquée. On reprend donc ces positions à la cadence
   * la plus longue disponible, en sautant celles que la passe 2 a déjà traitées.
   *
   * Cette passe était gardée par la même condition que la passe 2,
   * `deepMs > movetimeMs`. Conséquence : régler le balayage aussi haut que
   * l'étude des gaffes désactivait les deux, et les tsume perdaient leur
   * séquence sans que rien ne le dise. Les deux passes ne répondent pourtant
   * pas à la même question — l'une réexamine un verdict douteux, l'autre
   * complète une solution — et n'ont aucune raison de partager un interrupteur.
   *
   * Elle ne concerne qu'une poignée de positions : la garder allumée coûte
   * quelques secondes, la perdre coûte l'onglet Tsume.
   */
  const tsumeMs = opts.movetimeMs ?? 0;
  if (tsumeMs > 0) {
    const toDeepen = plies
      .filter((p) => p.mateBefore !== null && p.mateBefore > 0)
      .map((p) => p.ply - 1)
      .filter((i) => !deep.has(i));
    const unique = [...new Set(toDeepen)];

    for (let k = 0; k < unique.length; k++) {
      if (opts.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError');
      const i = unique[k];
      const r = await engine.analyze(sfens[i], [], { movetimeMs: tsumeMs });
      deep.set(i, {
        cp: scoreToCp(r.scoreCp, r.scoreMate),
        mate: r.scoreMate,
        bestMove: r.bestMove,
        pv: r.pv,
      });
      opts.onProgress?.('tsume', k + 1, unique.length);
    }

    for (const p of plies) {
      const d = deep.get(p.ply - 1);
      if (!d || p.mateBefore === null || p.mateBefore <= 0) continue;
      // Un mat vu à 200 ms est une ligne prouvée : il ne disparaît pas en
      // cherchant plus longtemps. Si la passe longue rend malgré tout un score
      // en centipions (itération interrompue), on garde la détection initiale
      // plutôt que de perdre le tsume.
      if (d.mate !== null && d.mate > 0) {
        p.mateBefore = d.mate;
        p.bestMove = d.bestMove;
        p.bestMovePv = d.pv;
      }
    }
  }

  const blunders = plies.filter((p) => p.quality === 'blunder');
  const mistakes = plies.filter((p) => p.quality === 'mistake');
  const tsumes = collectTsumes(
    plies,
    new Set([...deep.keys()].map((i) => i + 1)),
  );

  return { startSfen, plies, evalCurve, blunders, mistakes, tsumes };
}

/**
 * Un tsume = une position de la partie où le joueur au trait avait un mat forcé.
 *
 * `found` distingue les deux cas intéressants : le mat a été porté, ou il a été
 * laissé passer. Le critère est simple et ne dépend que de ce qu'on a déjà —
 * après le coup joué, l'adversaire est-il *encore* en train de se faire mater ?
 * Peu importe que le joueur ait choisi le mat le plus court.
 */
export function collectTsumes(plies: PlyEval[], refinedPlies?: Set<number>): Tsume[] {
  const out: Tsume[] = [];
  /** Dernier tsume retenu pour chaque camp, avec le coup où on l'a laissé. */
  const chain = new Map<Color, { entry: Tsume; ply: number }>();

  for (const p of plies) {
    if (p.mateBefore === null || p.mateBefore <= 0) continue;
    if (!isCheckingSequence(p.sfenBefore, p.bestMovePv)) continue;
    // Deux choses distinctes, qu'il ne faut pas confondre : le coup a-t-il
    // *donné* le mat, ou seulement gardé le mat forcé pour plus tard ?
    const mated = deliveredMate(p.sfenAfter);
    const kept = mated || (p.mateAfter !== null && p.mateAfter > 0);

    // Porter un mat forcé le laisse disponible au coup suivant du même camp : la
    // position d'après est la même occasion, pas une nouvelle. On ne rattache
    // que les coups strictement consécutifs (ply + 2) — si le mat disparaît puis
    // réapparaît, c'est bien deux chances distinctes.
    const previous = chain.get(p.color);
    if (previous && previous.ply === p.ply - 2) {
      const e = previous.entry;
      e.repeats += 1;
      e.lastPly = p.ply;
      if (mated) e.delivered = true;
      if (!kept && e.lostAtPly === null) e.lostAtPly = p.ply;
      chain.set(p.color, { entry: e, ply: p.ply });
      continue;
    }

    const entry: Tsume = {
      ply: p.ply,
      color: p.color,
      sfen: p.sfenBefore,
      mateIn: p.mateBefore,
      solution: p.bestMovePv,
      playedUsi: p.moveUsi,
      found: kept,
      refined: refinedPlies ? refinedPlies.has(p.ply) : (p.refined ?? false),
      repeats: 0,
      lastPly: p.ply,
      delivered: mated,
      lostAtPly: kept ? null : p.ply,
    };
    out.push(entry);
    chain.set(p.color, { entry, ply: p.ply });
  }
  return out;
}

/**
 * Le coup a-t-il mis fin à la partie ?
 *
 * Sans ce test, un mat effectivement porté serait compté comme manqué : sur la
 * position finale le moteur répond `bestmove resign` sans score de mat, donc
 * `mateAfter` vaut `null` et le critère habituel échoue précisément dans le cas
 * le plus favorable au joueur.
 */
function deliveredMate(sfenAfter: string): boolean {
  try {
    const pos = Position.fromSfen(sfenAfter);
    // En échec *et* sans réponse : le pat perd aussi au shogi, mais ce n'est
    // pas un mat, et l'annoncer comme tel serait faux.
    return isKingCapturable(pos, pos.turn) && generateLegalMoves(pos, pos.turn).length === 0;
  } catch {
    return false;
  }
}

/**
 * La séquence annoncée est-elle un vrai tsume ?
 *
 * Un mat forcé n'en est pas forcément un : la variante du moteur peut contenir
 * un coup tranquille, alors qu'un tsume donne échec à chaque coup de
 * l'attaquant. Comme le mode de résolution impose cette règle, garder ces
 * positions produirait des exercices insolubles selon leur propre énoncé.
 *
 * La variante peut être tronquée par la recherche ; on vérifie alors ce qui est
 * disponible, ce qui suffit à écarter les cas manifestes.
 */
/**
 * Rang du premier coup de l'attaquant qui ne donne pas échec, ou `-1` si la
 * séquence est bien une suite d'échecs. Compté en coups, comme le reste : le
 * premier coup est le n° 1.
 *
 * `isCheckingSequence` ne peut se prononcer que sur ce qu'elle voit. Une
 * variante tronquée par la recherche cache sa queue, et un coup tranquille
 * peut s'y trouver : l'exercice est alors un mat forcé, mais pas un tsume. Le
 * dire vaut mieux que le taire — c'est une différence que le joueur ressent
 * immédiatement, puisqu'il cherche un échec qui n'existe pas.
 */
export function firstQuietAttackerMove(sfen: string, solution: string[]): number {
  try {
    const pos = Position.fromSfen(sfen);
    for (let i = 0; i < solution.length; i++) {
      pos.applyUsiMove(solution[i]);
      if (i % 2 === 0 && !isKingCapturable(pos, pos.turn)) return i + 1;
    }
  } catch {
    // Séquence invalide : rien à signaler ici, l'affichage s'en chargera.
  }
  return -1;
}

function isCheckingSequence(sfen: string, solution: string[]): boolean {
  if (solution.length === 0) return false;
  try {
    const pos = Position.fromSfen(sfen);
    for (let i = 0; i < solution.length; i++) {
      pos.applyUsiMove(solution[i]);
      // Les coups d'indice pair sont ceux de l'attaquant.
      if (i % 2 === 0 && !isKingCapturable(pos, pos.turn)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/*
 * Approfondissement à la demande, sur une seule position.
 *
 * C'est la contrepartie d'une passe unique : plutôt que de deviner à l'avance
 * quelles positions méritent du temps, on en donne à celle qu'on regarde. Deux
 * recherches suffisent — avant et après le coup joué.
 *
 * `quality` est délibérément conservée. La recalculer ferait sortir l'exercice
 * de la liste sous les yeux de qui vient de demander à l'examiner de plus près,
 * ce qui est la dernière chose à faire. Reclasser toute la partie, c'est le rôle
 * de « Réanalyser ».
 */
export async function deepenPly(
  engine: UsiEngine,
  p: PlyEval,
  movetimeMs: number,
): Promise<PlyEval> {
  const before = await engine.analyze(p.sfenBefore, [], { movetimeMs });
  const after = await engine.analyze(p.sfenAfter, [], { movetimeMs });
  const evalBeforeCp = scoreToCp(before.scoreCp, before.scoreMate);
  const evalAfterCp = -scoreToCp(after.scoreCp, after.scoreMate);
  return {
    ...p,
    evalBeforeCp,
    evalAfterCp,
    bestMove: before.bestMove,
    bestMovePv: before.pv,
    refutationPv: after.pv,
    mateBefore: before.scoreMate,
    mateAfter: after.scoreMate === null ? null : -after.scoreMate,
    centipawnLoss: Math.max(0, evalBeforeCp - evalAfterCp),
    refined: true,
  };
}

/**
 * Idem pour un tsume : une seule recherche, sur la position de l'exercice, dont
 * on retient la longueur annoncée et la séquence. Une recherche plus longue
 * publie une variante moins souvent tronquée — c'est tout l'intérêt ici.
 */
export async function deepenTsume(
  engine: UsiEngine,
  t: Tsume,
  movetimeMs: number,
): Promise<Tsume> {
  const r = await engine.analyze(t.sfen, [], { movetimeMs });
  if (r.scoreMate === null || r.scoreMate <= 0) return { ...t, refined: true };
  return { ...t, mateIn: r.scoreMate, solution: r.pv, refined: true };
}
