import { useState } from 'react';
import type { DragSource } from './Board';
import type { Position } from '../shogi/position';
import { moveToUsi } from '../shogi/moveGen';
import type { Color, Move, PieceType, Square } from '../shogi/types';
import { sameSquare } from '../shogi/types';

export type Selection = { kind: 'square'; sq: Square } | { kind: 'hand'; type: PieceType };

interface Options {
  position: Position;
  legalMoves: Move[];
  humanColor: Color;
  /** Faux : le plateau ignore les appuis (tour de l'adversaire, partie finie…). */
  enabled: boolean;
  /** Le coup choisi, en USI, une fois la promotion éventuelle tranchée. */
  onPlay: (usi: string) => void;
}

/**
 * La saisie d'un coup sur le plateau : tap en deux temps (pièce, puis case),
 * glissé-déposé, parachutage depuis la main, et question de promotion. Le
 * plateau ne sait que dessiner ; les règles de ce qu'on peut jouer viennent de
 * `legalMoves`. Partagé par la partie contre l'ordinateur et l'entraînement
 * aux ouvertures.
 */
export function useMoveInput({ position, legalMoves, humanColor, enabled, onPlay }: Options) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [promptPromotion, setPromptPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const play = (usi: string) => {
    setSelected(null);
    onPlay(usi);
  };

  const destinations = (): Square[] => {
    if (!selected || !enabled) return [];
    if (selected.kind === 'hand') {
      return legalMoves.filter((m) => !m.from && m.piece === selected.type).map((m) => m.to);
    }
    return legalMoves.filter((m) => m.from && sameSquare(m.from, selected.sq)).map((m) => m.to);
  };

  const tryMove = (to: Square, source: Selection | null = selected) => {
    if (!source || !enabled) return;
    const candidates: Move[] = legalMoves.filter((m) => {
      if (!sameSquare(m.to, to)) return false;
      if (source.kind === 'hand') return !m.from && m.piece === source.type;
      return m.from != null && sameSquare(m.from, source.sq);
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
    if (!enabled || promptPromotion) return;
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

  /*
   * Glissé-déposé : même règle que le tap en deux temps, mais d'un geste. La
   * pièce est sélectionnée dès que le doigt bouge (les cases possibles
   * s'allument), puis le coup se joue là où on la lâche — sur une case
   * impossible, il ne se passe rien et la sélection est levée.
   */
  const onDragStart = (src: DragSource) => {
    if (!enabled || promptPromotion) return;
    setSelected(src);
  };

  const onDragEnd = (src: DragSource, to: Square) => {
    if (!enabled || promptPromotion) return;
    if (src.kind === 'square' && sameSquare(src.sq, to)) {
      setSelected(null);
      return;
    }
    tryMove(to, src);
  };

  const onHandPieceClick = (type: PieceType) => {
    if (!enabled || promptPromotion) return;
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

  /** Efface la sélection et la question de promotion (coup repris, partie recommencée). */
  const reset = () => {
    setSelected(null);
    setPromptPromotion(null);
  };

  return {
    selected,
    promptPromotion,
    destinations: destinations(),
    onSquareClick,
    onHandPieceClick,
    onDragStart,
    onDragEnd,
    resolvePromotion,
    reset,
  };
}
