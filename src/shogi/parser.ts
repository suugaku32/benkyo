import { isCsaLike, isKifLike, parseCsa, parseKif } from './kif';
import { isKingCapturable } from './moveGen';
import { HIRATE_SFEN, Position } from './position';

export type KifuFormat = 'kif' | 'csa' | 'usi';

export interface ParsedGame {
  format: KifuFormat;
  /** Always a canonical SFEN regenerated from a validated Position, never raw input. */
  startSfen: string;
  moves: string[]; // USI coordinate moves, e.g. "7g7f", "P*5e"
  black: string;
  white: string;
}

const USI_MOVE_RE = /^[1-9][a-i][1-9][a-i]\+?$|^[A-Z]\*[1-9][a-i]$/;

/** Guards against pathological inputs before any parsing work happens. */
const MAX_INPUT_CHARS = 2_000_000;
const MAX_MOVES = 2_000;

function parseUsiText(text: string): ParsedGame {
  let rest = text.trim();
  let startSfen = HIRATE_SFEN;

  const sfenMatch = rest.match(/sfen\s+([^\n]+?)(?:\s+moves\s+|$)/i);
  if (sfenMatch) {
    startSfen = sfenMatch[1].trim();
  }
  const movesMatch = rest.match(/moves\s+(.+)$/is);
  if (movesMatch) {
    rest = movesMatch[1];
  } else {
    rest = rest.replace(/position\s+startpos/i, '').replace(/position\s+sfen[^]*?(?=moves|$)/i, '');
  }

  const tokens = rest.split(/\s+/).filter(Boolean).filter((t) => t.toLowerCase() !== 'startpos');
  const moves = tokens.filter((t) => USI_MOVE_RE.test(t));

  return { format: 'usi', startSfen, moves, black: '', white: '' };
}

/**
 * Replays the game to prove it is coherent, and rewrites `startSfen` in canonical
 * form. Everything downstream — React render and the engine command string — then
 * works from engine-generated text rather than from whatever the user pasted.
 */
function validateAndNormalize(game: ParsedGame): ParsedGame {
  if (game.moves.length > MAX_MOVES) {
    throw new Error(`Partie trop longue : ${game.moves.length} coups (maximum ${MAX_MOVES}).`);
  }
  const pos = Position.fromSfen(game.startSfen);
  const startSfen = pos.toSfen();
  game.moves.forEach((usi, i) => {
    const mover = pos.turn;
    try {
      pos.applyUsiMove(usi);
    } catch (e) {
      throw new Error(`Coup ${i + 1} (${usi}) impossible : ${(e as Error).message}`);
    }
    // A move that leaves your own king capturable is illegal, and feeding such a
    // position to the engine makes it trap on an unreachable instruction — which
    // would kill the whole analysis with no usable message.
    if (isKingCapturable(pos, mover)) {
      throw new Error(
        `Coup ${i + 1} (${usi}) illégal : il laisse le roi ${mover === 'b' ? '▲' : '△'} en prise.`,
      );
    }
  });
  return { ...game, startSfen };
}

export function parseKifu(text: string): ParsedGame {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Le kifu est vide.');
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new Error('Le kifu dépasse la taille maximale acceptée (2 Mo).');
  }
  if (isCsaLike(trimmed)) {
    return validateAndNormalize(parseCsa(trimmed));
  }
  if (isKifLike(trimmed)) {
    return validateAndNormalize(parseKif(trimmed));
  }
  return validateAndNormalize(parseUsiText(trimmed));
}
