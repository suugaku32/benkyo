import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import { GLYPHS } from './glyphs';
import type { Glyph } from './glyphs';
import { HAND_CHARS, countBars, parseTokens, segmentHand, tokenOf, withoutFrames } from './hands';
import type { Token } from './hands';
import { EMPTY_INK_RATIO, cellRect, glyphCanvas, inkMask, maskCanvas, minorityMask, toGray } from './image';
import type { Gray, Rect } from './image';
import type { Hand } from '../shogi/types';

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

async function readOnce(
  worker: Worker,
  canvas: HTMLCanvasElement,
  allowed?: string,
): Promise<{ char: string; confidence: number }> {
  let best = { char: '', confidence: 0 };
  for (const modes of [PAGE_MODES, FALLBACK_MODES]) {
    for (const mode of modes) {
      await worker.setParameters({ tessedit_pageseg_mode: mode as never });
      const { data } = await worker.recognize(canvas);
      const char = [...data.text.replace(/\s+/g, '')].find((c) => (allowed ? allowed.includes(c) : c in GLYPHS)) ?? '';
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

/** Les pièces en main lues dans une zone, avec ce qui a été lu (pour vérification) et la confiance d'ensemble. */
export interface HandReading {
  hand: Hand;
  tokens: Token[];
  /** Vrai si la zone a été lue retournée d'un demi-tour (pièces du camp d'en face, en haut de l'image). */
  upsideDown: boolean;
  /** Somme des confiances des signes reconnus : sert à départager les deux sens. */
  score: number;
}

/** Les cadrages essayés pour un caractère de pièce en main, du plus courant au plus inhabituel. */
const HAND_LOOKS = [
  { size: 96, pad: 0.2 },
  { size: 128, pad: 0.1 },
  { size: 64, pad: 0.3 },
  { size: 112, pad: 0.15 },
];

function rotateGray(g: Gray): Gray {
  const data = new Uint8ClampedArray(g.data.length);
  for (let i = 0; i < g.data.length; i++) data[g.data.length - 1 - i] = g.data[i];
  return { w: g.w, h: g.h, data };
}

/**
 * Lit une zone de pièces en main. La zone est découpée en caractères (voir
 * `segmentHand`), chacun lu comme une case du plateau ; les deux sens sont
 * essayés, car en haut de l'image les pièces sont souvent renversées, et on
 * garde celui où l'on a reconnu le plus de choses.
 */
export async function readHandZone(source: CanvasImageSource, rect: Rect): Promise<HandReading> {
  const worker = await loadOcr();
  // Assez grand pour que les petits chiffres de coin (une douzaine de pixels) gardent leurs traits.
  const scale = Math.min(6, Math.max(2, 320 / Math.min(rect.w, rect.h)));
  const gray = toGray(source, rect, scale);
  let best: HandReading | null = null;
  for (const upsideDown of [false, true]) {
    const g = upsideDown ? rotateGray(gray) : gray;
    const mask = withoutFrames(inkMask(g).mask, g.w, g.h);
    const { glyphs } = segmentHand(mask, g.w, g.h);
    const tokens: Token[] = [];
    let score = 0;
    const only = (box: { x0: number; y0: number; x1: number; y1: number }) => {
      const sub = new Uint8Array(mask.length);
      for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) sub[y * g.w + x] = mask[y * g.w + x];
      return sub;
    };
    for (const glyph of glyphs) {
      // Une, deux ou trois barres : un numéral que l'OCR rate, on le compte.
      const bars = countBars(mask, g.w, glyph.box);
      if (bars !== null) {
        tokens.push({ kind: 'number', value: bars, confidence: 80 });
        score += 80;
        continue;
      }
      let read = { char: '', confidence: 0 };
      for (const look of HAND_LOOKS) {
        read = await readOnce(worker, maskCanvas(only(glyph.box), g.w, g.h, false, look), HAND_CHARS);
        if (read.char && read.confidence >= 30) break;
      }
      const token = read.char ? tokenOf(read.char, read.confidence) : null;
      if (token) {
        tokens.push(token);
        score += token.confidence;
      }
      for (const badge of glyph.badges) {
        const small = minorityMask(g, badge);
        const digit = await readOnce(worker, maskCanvas(small.mask, small.w, small.h, false), '23456789');
        const t = digit.char ? tokenOf(digit.char, digit.confidence) : null;
        if (t) {
          tokens.push(t);
          score += t.confidence * 0.5;
        }
      }
    }
    const reading: HandReading = { hand: parseTokens(tokens), tokens, upsideDown, score };
    if (!best || reading.score > best.score) best = reading;
  }
  return best!;
}
