import { collectTsumes } from '../analysis/analyze';
import type { AnalysisResult, EvalPoint, PlyEval } from '../analysis/analyze';
import type { MoveQuality } from '../analysis/classify';
import type { KifuFormat, ParsedGame } from '../shogi/parser';
import { Position } from '../shogi/position';

const KEY = 'jaaa7up-history-v1';
const MAX_ENTRIES = 30;

/**
 * Seules les évaluations sont conservées. Positions, couleurs et numéros de coup
 * se recalculent en rejouant la partie, ce qui évite de stocker deux SFEN d'une
 * soixantaine de caractères par demi-coup — l'essentiel du volume.
 */
interface StoredPly {
  b: number; // evalBeforeCp
  a: number; // evalAfterCp
  l: number; // centipawnLoss
  q: MoveQuality;
  m: string | null; // bestMove
  p: string[]; // bestMovePv
  r: string[]; // refutationPv
  f?: 1; // refined
  // Mats forcés. Absents des parties enregistrées avant l'ajout du mode tsume :
  // ces entrées se rechargent alors sans tsume plutôt que d'être rejetées.
  mb?: number; // mateBefore
  ma?: number; // mateAfter
}

export interface StoredGame {
  id: string;
  savedAt: number;
  black: string;
  white: string;
  format: KifuFormat;
  startSfen: string;
  moves: string[];
  movetimeMs: number;
  deepMovetimeMs: number;
  evalCurve: EvalPoint[];
  plies: StoredPly[];
}

/** Ce qu'il faut pour lister sans tout désérialiser. */
export interface HistoryEntry {
  id: string;
  savedAt: number;
  black: string;
  white: string;
  moveCount: number;
  blunders: number;
  mistakes: number;
}

function readAll(): StoredGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Stockage indisponible (navigation privée) ou contenu corrompu : on repart
    // d'une liste vide plutôt que de casser l'application.
    return [];
  }
}

function writeAll(games: StoredGame[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(games));
    return true;
  } catch {
    return false;
  }
}

export function isHistoryAvailable(): boolean {
  try {
    const probe = `${KEY}-probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function listHistory(): HistoryEntry[] {
  return readAll()
    .map((g) => ({
      id: g.id,
      savedAt: g.savedAt,
      black: g.black,
      white: g.white,
      moveCount: g.moves.length,
      blunders: g.plies.filter((p) => p.q === 'blunder').length,
      mistakes: g.plies.filter((p) => p.q === 'mistake').length,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame(
  game: ParsedGame,
  result: AnalysisResult,
  movetimeMs: number,
): { ok: boolean; reason?: string } {
  const entry: StoredGame = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    black: game.black,
    white: game.white,
    format: game.format,
    startSfen: game.startSfen,
    moves: game.moves,
    movetimeMs,
    // Conservé à zéro : la seconde passe n'existe plus, mais le champ reste
    // dans le format pour que les parties déjà enregistrées restent lisibles.
    deepMovetimeMs: 0,
    evalCurve: result.evalCurve,
    plies: result.plies.map((p) => ({
      b: p.evalBeforeCp,
      a: p.evalAfterCp,
      l: p.centipawnLoss,
      q: p.quality,
      m: p.bestMove,
      p: p.bestMovePv,
      r: p.refutationPv,
      ...(p.refined ? { f: 1 as const } : {}),
      ...(p.mateBefore !== null ? { mb: p.mateBefore } : {}),
      ...(p.mateAfter !== null ? { ma: p.mateAfter } : {}),
    })),
  };

  const games = readAll();
  // Une même partie réanalysée remplace la précédente au lieu de s'empiler.
  const sameGame = (g: StoredGame) =>
    g.startSfen === entry.startSfen && g.moves.join(' ') === entry.moves.join(' ');
  const next = [entry, ...games.filter((g) => !sameGame(g))].slice(0, MAX_ENTRIES);

  if (writeAll(next)) return { ok: true };

  // Quota dépassé : on retente en ne gardant que les plus récentes plutôt que de
  // perdre silencieusement la sauvegarde.
  for (const keep of [10, 5, 1]) {
    if (writeAll(next.slice(0, keep))) {
      return { ok: true, reason: `Historique réduit à ${keep} parties, faute de place.` };
    }
  }
  return { ok: false, reason: "Le navigateur refuse d'écrire dans le stockage local." };
}

export function deleteGame(id: string): void {
  writeAll(readAll().filter((g) => g.id !== id));
}

export function clearHistory(): void {
  writeAll([]);
}

/** Reconstruit la partie et son analyse à partir de la forme compacte stockée. */
export function loadGame(
  id: string,
): { game: ParsedGame; result: AnalysisResult; movetimeMs: number } | null {
  const stored = readAll().find((g) => g.id === id);
  if (!stored) return null;

  try {
    const sfens: string[] = [stored.startSfen];
    const pos = Position.fromSfen(stored.startSfen);
    const colors: ('b' | 'w')[] = [];
    for (const m of stored.moves) {
      colors.push(pos.turn);
      pos.applyUsiMove(m);
      sfens.push(pos.toSfen());
    }

    const plies: PlyEval[] = stored.plies.map((s, i) => ({
      ply: i + 1,
      moveUsi: stored.moves[i],
      color: colors[i],
      sfenBefore: sfens[i],
      sfenAfter: sfens[i + 1],
      evalBeforeCp: s.b,
      evalAfterCp: s.a,
      bestMove: s.m,
      bestMovePv: s.p ?? [],
      refutationPv: s.r ?? [],
      centipawnLoss: s.l,
      quality: s.q,
      refined: s.f === 1,
      mateBefore: s.mb ?? null,
      mateAfter: s.ma ?? null,
    }));

    const game: ParsedGame = {
      format: stored.format,
      startSfen: stored.startSfen,
      moves: stored.moves,
      black: stored.black,
      white: stored.white,
    };
    const result: AnalysisResult = {
      startSfen: stored.startSfen,
      plies,
      evalCurve: stored.evalCurve,
      blunders: plies.filter((p) => p.quality === 'blunder'),
      mistakes: plies.filter((p) => p.quality === 'mistake'),
      tsumes: collectTsumes(plies),
    };
    return {
      game,
      result,
      movetimeMs: stored.movetimeMs,
    };
  } catch {
    // Entrée écrite par une version antérieure, ou coup devenu invalide.
    return null;
  }
}
