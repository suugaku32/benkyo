import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import { GLYPHS } from './glyphs';
import type { Glyph } from './glyphs';
import { EMPTY_INK_RATIO, cellRect, glyphCanvas, inkMask, toGray } from './image';
import type { Rect } from './image';

/** Une case lue : vide, ou une pièce avec le sens dans lequel elle a été lue et la confiance de la lecture (0 à 100). */
export type CellReading =
  | { kind: 'empty' }
  | { kind: 'piece'; glyph: Glyph; char: string; upsideDown: boolean; confidence: number };

let workerPromise: Promise<Worker> | null = null;

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${path}`, document.baseURI).href;
}

/**
 * Le moteur de lecture (Tesseract, compilé en WebAssembly) et son modèle
 * japonais sont servis avec l'application : rien ne part vers un serveur, et
 * la politique de sécurité de la page n'autorise de toute façon que le site
 * lui-même. Chargé au premier usage seulement : l'ensemble pèse une dizaine de
 * mégaoctets.
 */
export function loadOcr(): Promise<Worker> {
  workerPromise ??= (async () => {
    // La variante SIMD, plus rapide, puis la variante de base pour les navigateurs qui ne la connaissent pas.
    // On donne le fichier du noyau en entier : sans cela Tesseract choisit lui-même parmi des variantes que nous ne servons pas.
    const cores = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'];
    let lastError: unknown;
    for (const core of cores) {
      try {
        const worker = await createWorker('jpn', 1, {
          workerPath: assetUrl('worker.min.js'),
          corePath: assetUrl(core),
          langPath: assetUrl(''),
          gzip: true,
          workerBlobURL: false,
        });
        return worker;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  })();
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

/*
 * Deux modes de lecture, 10 (un caractère) et 8 (un mot) : ils se trompent
 * rarement sur la même pièce — sur un même 香, le premier lisait « を » et le
 * second « 香 » —, donc on garde la lecture la plus sûre. Aucune liste blanche
 * de caractères : elle faisait échouer des lectures que le modèle réussissait
 * sans (金, 角, 飛). On écarte plutôt tout ce qui n'est pas une pièce.
 */
const PAGE_MODES = ['10', '8'] as const;
/** Les modes de secours, quand aucun des deux premiers n'a donné une pièce : 7 (une ligne), 13 (ligne brute). */
const FALLBACK_MODES = ['7', '13'] as const;

async function readOnce(worker: Worker, canvas: HTMLCanvasElement): Promise<{ char: string; confidence: number }> {
  let best = { char: '', confidence: 0 };
  for (const modes of [PAGE_MODES, FALLBACK_MODES]) {
    for (const mode of modes) {
      await worker.setParameters({ tessedit_pageseg_mode: mode as never });
      const { data } = await worker.recognize(canvas);
      const char = [...data.text.replace(/\s+/g, '')].find((c) => c in GLYPHS) ?? '';
      if (char && data.confidence > best.confidence) best = { char, confidence: data.confidence };
    }
    if (best.char) break;
  }
  return best;
}

/**
 * Lit une case. La pièce peut être posée à l'endroit (camp du bas) ou à
 * l'envers (camp du haut) : on lit les deux sens, et on garde le plus sûr.
 */
export async function readCell(source: CanvasImageSource, board: Rect, col: number, row: number): Promise<CellReading> {
  const area = cellRect(board, col, row);
  // Une case lue à au moins 96 px de côté, même sur une petite capture.
  const cell = toGray(source, area, Math.max(1, 96 / Math.min(area.w, area.h)));
  // La case est vide si son centre l'est : un cadre décalé d'un pixel ou deux laisse déborder un bout de
  // trait de grille sur le pourtour, jamais au centre.
  const centre = cellRect(board, col, row, 0.22);
  if (inkMask(toGray(source, centre, Math.max(1, 64 / Math.min(centre.w, centre.h)))).ratio < EMPTY_INK_RATIO) return { kind: 'empty' };
  const worker = await loadOcr();
  // Une première présentation de la pièce ; si aucun sens ne donne de pièce, d'autres cadrages (plus grand, plus serré).
  const looks = [
    { size: 96, pad: 0.2 },
    { size: 128, pad: 0.1 },
    { size: 64, pad: 0.3 },
  ];
  let up = { char: '', confidence: 0 };
  let down = { char: '', confidence: 0 };
  for (const look of looks) {
    up = await readOnce(worker, glyphCanvas(cell, false, look));
    down = await readOnce(worker, glyphCanvas(cell, true, look));
    if (up.char || down.char) break;
  }
  const upsideDown = down.confidence > up.confidence;
  const best = upsideDown ? down : up;
  if (!best.char) return { kind: 'piece', glyph: { type: 'P', promoted: false }, char: '?', upsideDown, confidence: 0 };
  return { kind: 'piece', glyph: GLYPHS[best.char], char: best.char, upsideDown, confidence: best.confidence };
}
