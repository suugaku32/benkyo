import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import { detectBoard } from '../ocr/detect';
import type { Rect } from '../ocr/image';
import { gridToPosition, positionWarnings } from '../ocr/position';
import { loadOcr, readCell } from '../ocr/recognize';
import type { CellReading } from '../ocr/recognize';
import { pieceGlyph } from '../shogi/notation';
import type { Position } from '../shogi/position';
import type { Color, PieceType, Square } from '../shogi/types';
import { HAND_PIECE_ORDER, sameSquare } from '../shogi/types';
import './ImagePosition.css';

interface Props {
  /** L'image collée ou choisie. */
  file: File;
  /** La position lue et corrigée, en SFEN : à explorer. */
  onUse: (sfen: string) => void;
  onClose: () => void;
}

type Step = 'crop' | 'reading' | 'review' | 'error';
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_SIDE = 60;

/** Redimensionne le cadre en tirant un coin, en le gardant carré : un plateau est carré. */
function resizeFromCorner(orig: Rect, corner: Corner, dx: number, dy: number, bounds: { w: number; h: number }): Rect {
  const sx = corner[1] === 'r' ? 1 : -1;
  const sy = corner[0] === 'b' ? 1 : -1;
  const side = (orig.w + orig.h) / 2;
  let s = Math.max(MIN_SIDE, side + (sx * dx + sy * dy) / 2);
  // Le coin opposé reste en place : il borne la taille possible.
  const anchorX = sx > 0 ? orig.x : orig.x + orig.w;
  const anchorY = sy > 0 ? orig.y : orig.y + orig.h;
  const maxX = sx > 0 ? bounds.w - anchorX : anchorX;
  const maxY = sy > 0 ? bounds.h - anchorY : anchorY;
  s = Math.min(s, maxX, maxY);
  return { x: sx > 0 ? anchorX : anchorX - s, y: sy > 0 ? anchorY : anchorY - s, w: s, h: s };
}

/**
 * Position depuis une image : on cadre le plateau (détecté d'abord tout seul),
 * on le lit case par case, puis on corrige à la main ce que la lecture a mal
 * vu avant d'explorer la position. Tout se passe dans le navigateur : l'image
 * ne part nulle part.
 */
export function ImagePosition({ file, onUse, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [detected, setDetected] = useState<boolean | null>(null);
  const [goteAtBottom, setGoteAtBottom] = useState(false);
  const [step, setStep] = useState<Step>('crop');
  const [progress, setProgress] = useState<{ done: number; label: string }>({ done: 0, label: '' });
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const autoDetect = useCallback(() => {
    const img = imgRef.current;
    if (!img || !natural) return;
    const found = detectBoard(img, natural.w, natural.h);
    setDetected(found !== null);
    if (found) setRect(found);
    else {
      // Pas de grille reconnue : un carré centré, que l'utilisateur déplace.
      const side = Math.min(natural.w, natural.h) * 0.8;
      setRect({ x: (natural.w - side) / 2, y: (natural.h - side) / 2, w: side, h: side });
    }
  }, [natural]);

  useEffect(() => {
    if (natural && !rect) autoDetect();
  }, [natural, rect, autoDetect]);

  // ---- Cadrage : glisser un coin ou le cadre entier.
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: Corner | 'move'; x: number; y: number; orig: Rect } | null>(null);

  const onPointerDown = (kind: Corner | 'move') => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, orig: rect };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d || !stage || !natural) return;
    const k = natural.w / stage.clientWidth;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    if (d.kind === 'move') {
      setRect({
        ...d.orig,
        x: Math.min(Math.max(0, d.orig.x + dx), natural.w - d.orig.w),
        y: Math.min(Math.max(0, d.orig.y + dy), natural.h - d.orig.h),
      });
    } else {
      setRect(resizeFromCorner(d.orig, d.kind, dx, dy, natural));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ---- Lecture.
  const [position, setPosition] = useState<Position | null>(null);
  const [doubtful, setDoubtful] = useState<Square[]>([]);

  const read = async () => {
    const img = imgRef.current;
    if (!img || !rect) return;
    cancelled.current = false;
    setStep('reading');
    setError(null);
    setProgress({ done: 0, label: 'Chargement du moteur de lecture (première fois : quelques secondes)…' });
    try {
      await loadOcr();
      const grid: CellReading[][] = [];
      for (let row = 0; row < 9; row++) {
        const cells: CellReading[] = [];
        for (let col = 0; col < 9; col++) {
          if (cancelled.current) return;
          setProgress({ done: row * 9 + col, label: `Lecture des cases… ${row * 9 + col}/81` });
          cells.push(await readCell(img, rect, col, row));
        }
        grid.push(cells);
      }
      const result = gridToPosition(grid, { goteAtBottom, turn: 'b' });
      setPosition(result.position);
      setDoubtful(result.doubtful);
      setSelected(null);
      setStep('review');
    } catch (e) {
      setError((e as Error).message || 'La lecture a échoué.');
      setStep('error');
    }
  };

  // ---- Correction.
  const [selected, setSelected] = useState<Square | null>(null);
  const [editColor, setEditColor] = useState<Color>('b');
  const [editPromoted, setEditPromoted] = useState(false);

  const edit = (change: (p: Position) => void) =>
    setPosition((p) => {
      if (!p) return p;
      const next = p.clone();
      change(next);
      return next;
    });

  const setCell = (type: PieceType | null) => {
    if (!selected) return;
    const promotable = type !== null && type !== 'G' && type !== 'K';
    edit((p) => p.setPiece(selected, type ? { color: editColor, type, promoted: editPromoted && promotable } : null));
    setDoubtful((d) => d.filter((s) => !sameSquare(s, selected)));
  };

  const warnings = useMemo(() => (position ? positionWarnings(position) : []), [position]);
  const kingsOk = useMemo(() => {
    if (!position) return false;
    return (['b', 'w'] as const).every((c) => {
      let n = 0;
      for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) if (position.pieceAt({ file: f, rank: r })?.type === 'K' && position.pieceAt({ file: f, rank: r })?.color === c) n++;
      return n === 1;
    });
  }, [position]);

  const selectedPiece = position && selected ? position.pieceAt(selected) : null;

  return (
    <div className="ip-overlay" role="dialog" aria-modal="true" aria-label="Position depuis une image">
      <div className="ip-panel">
        <div className="ip-head">
          <h2>Position depuis une image</h2>
          <button className="btn btn-link" onClick={onClose}>
            Fermer
          </button>
        </div>

        {step === 'crop' && (
          <>
            <p className="ip-hint">
              Cadrez le plateau : le contour doit entourer exactement les 81 cases. Tirez un coin pour
              redimensionner, ou le cadre pour le déplacer.
              {detected === true && ' Le plateau a été repéré automatiquement.'}
              {detected === false && " Le plateau n'a pas été repéré : placez le cadre à la main."}
            </p>
            <div
              className="ip-stage"
              ref={stageRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {url && (
                <img
                  ref={imgRef}
                  src={url}
                  alt="Capture à lire"
                  draggable={false}
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
              )}
              {rect && natural && (
                <div
                  className="ip-crop"
                  style={{
                    left: `${(rect.x / natural.w) * 100}%`,
                    top: `${(rect.y / natural.h) * 100}%`,
                    width: `${(rect.w / natural.w) * 100}%`,
                    height: `${(rect.h / natural.h) * 100}%`,
                  }}
                  onPointerDown={onPointerDown('move')}
                >
                  {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                    <span key={c} className={`ip-handle ip-handle-${c}`} onPointerDown={onPointerDown(c)} />
                  ))}
                </div>
              )}
            </div>
            <label className="ip-check">
              <input type="checkbox" checked={goteAtBottom} onChange={(e) => setGoteAtBottom(e.target.checked)} />
              Le plateau est vu du côté de Gote (les pièces à l'endroit, en bas, sont celles de Gote)
            </label>
            <div className="ip-actions">
              <button className="btn btn-primary" onClick={read} disabled={!rect}>
                Lire la position
              </button>
              <button className="btn btn-ghost" onClick={autoDetect} disabled={!natural}>
                Détecter à nouveau
              </button>
            </div>
          </>
        )}

        {step === 'reading' && (
          <div className="ip-reading" role="status">
            <progress value={progress.done} max={81} />
            <p>{progress.label}</p>
            <button
              className="btn btn-ghost"
              onClick={() => {
                cancelled.current = true;
                setStep('crop');
              }}
            >
              Annuler
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="ip-reading">
            <p className="banner banner-error">{error}</p>
            <button className="btn btn-ghost" onClick={() => setStep('crop')}>
              Retour au cadrage
            </button>
          </div>
        )}

        {step === 'review' && position && (
          <div className="ip-review">
            <div className="ip-board">
              <Board
                position={position}
                interactive
                selected={selected ? { kind: 'square', sq: selected } : null}
                markSquares={doubtful}
                onSquareClick={(sq) => setSelected((s) => (s && sameSquare(s, sq) ? null : sq))}
              />
            </div>

            <div className="ip-controls">
              <p className="ip-hint">
                Vérifiez la position. Les cases au contour pointillé sont les lectures peu sûres.
                Touchez une case, puis choisissez la pièce.
              </p>

              <fieldset className="ip-field">
                <legend>
                  Case {selected ? `${selected.file}${'一二三四五六七八九'[selected.rank - 1]}` : '— aucune'}
                  {selectedPiece && ` : ${pieceGlyph(selectedPiece.type, selectedPiece.promoted)} ${selectedPiece.color === 'b' ? '▲' : '△'}`}
                </legend>
                <div className="ip-row">
                  <label>
                    <input type="radio" checked={editColor === 'b'} onChange={() => setEditColor('b')} /> ▲ Sente
                  </label>
                  <label>
                    <input type="radio" checked={editColor === 'w'} onChange={() => setEditColor('w')} /> △ Gote
                  </label>
                  <label>
                    <input type="checkbox" checked={editPromoted} onChange={(e) => setEditPromoted(e.target.checked)} /> Promue
                  </label>
                </div>
                <div className="ip-palette">
                  {(['P', 'L', 'N', 'S', 'G', 'B', 'R', 'K'] as const).map((t) => (
                    <button key={t} className="btn btn-ghost ip-piece" disabled={!selected} onClick={() => setCell(t)}>
                      {pieceGlyph(t, editPromoted && t !== 'G' && t !== 'K')}
                    </button>
                  ))}
                  <button className="btn btn-ghost" disabled={!selected || !selectedPiece} onClick={() => setCell(null)}>
                    Vider
                  </button>
                </div>
              </fieldset>

              <fieldset className="ip-field">
                <legend>Pièces en main</legend>
                {(['b', 'w'] as const).map((color) => (
                  <div key={color} className="ip-hand">
                    <span className="ip-hand-side">{color === 'b' ? '▲' : '△'}</span>
                    {HAND_PIECE_ORDER.map((t) => (
                      <span key={t} className="ip-stepper">
                        <button
                          className="btn btn-ghost"
                          aria-label={`Retirer ${pieceGlyph(t, false)} de ${color === 'b' ? 'Sente' : 'Gote'}`}
                          disabled={position.hands[color][t] === 0}
                          onClick={() => edit((p) => (p.hands[color][t] -= 1))}
                        >
                          −
                        </button>
                        <span className="ip-count">
                          {pieceGlyph(t, false)}
                          {position.hands[color][t]}
                        </span>
                        <button
                          className="btn btn-ghost"
                          aria-label={`Ajouter ${pieceGlyph(t, false)} à ${color === 'b' ? 'Sente' : 'Gote'}`}
                          onClick={() => edit((p) => (p.hands[color][t] += 1))}
                        >
                          +
                        </button>
                      </span>
                    ))}
                  </div>
                ))}
              </fieldset>

              <fieldset className="ip-field">
                <legend>Trait</legend>
                <div className="ip-row">
                  <label>
                    <input type="radio" checked={position.turn === 'b'} onChange={() => edit((p) => (p.turn = 'b'))} /> ▲ Sente joue
                  </label>
                  <label>
                    <input type="radio" checked={position.turn === 'w'} onChange={() => edit((p) => (p.turn = 'w'))} /> △ Gote joue
                  </label>
                </div>
              </fieldset>

              {warnings.length > 0 && (
                <ul className="ip-warnings" role="status">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <div className="ip-actions">
                <button className="btn btn-primary" disabled={!kingsOk} onClick={() => onUse(position.toSfen())}>
                  Explorer cette position
                </button>
                <button className="btn btn-ghost" onClick={() => setStep('crop')}>
                  Refaire le cadrage
                </button>
              </div>
              {!kingsOk && <p className="ip-hint">Il faut un roi par camp pour explorer la position.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
