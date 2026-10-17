/*
 * Le travail sur les pixels : découper le plateau en cases, dire si une case
 * est vide, et préparer l'image d'une pièce pour la lecture — noir sur blanc,
 * sans fond ni liseré, quelle que soit la couleur de l'application d'où vient
 * la capture.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les niveaux de gris d'un morceau d'image. */
export interface Gray {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/**
 * `scale` agrandit le morceau en le lisant : sur une capture d'écran de téléphone
 * une case ne fait guère que 35 pixels, trop peu pour que la lecture distingue
 * les traits d'un 香 d'un 歩. Le navigateur lisse l'agrandissement, ce qui rend
 * au caractère des bords nets une fois seuillé.
 */
export function toGray(source: CanvasImageSource, rect: Rect, scale = 1): Gray {
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    data[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return { w, h, data };
}

export function median(values: ArrayLike<number>): number {
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < values.length; i++) counts[values[i]]++;
  let seen = 0;
  const half = values.length / 2;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen >= half) return v;
  }
  return 255;
}

/** Seuil d'Otsu sur des valeurs de 0 à 255 : celui qui sépare le mieux deux populations. */
export function otsu(values: ArrayLike<number>): number {
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < values.length; i++) counts[values[i]]++;
  const total = values.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * counts[v];
  let sumBack = 0;
  let back = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    back += counts[t];
    if (back === 0) continue;
    const fore = total - back;
    if (fore === 0) break;
    sumBack += t * counts[t];
    const mb = sumBack / back;
    const mf = (sumAll - sumBack) / fore;
    const between = back * fore * (mb - mf) * (mb - mf);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/**
 * L'encre d'une case : les pixels qui s'écartent nettement de la couleur de
 * fond (la médiane — le fond est toujours majoritaire, que le texte soit clair
 * ou sombre). Renvoie un masque 0/1 et la part de pixels d'encre.
 */
export function inkMask(cell: Gray): { mask: Uint8Array; ratio: number } {
  const bg = median(cell.data);
  const diff = new Uint8ClampedArray(cell.data.length);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.abs(cell.data[i] - bg);
  // Un écart d'au moins 40 sur 255 : en dessous c'est le grain du bois ou un dégradé, pas du texte.
  const threshold = Math.max(40, otsu(diff));
  const mask = new Uint8Array(diff.length);
  let ink = 0;
  for (let i = 0; i < diff.length; i++) {
    if (diff[i] >= threshold) {
      mask[i] = 1;
      ink++;
    }
  }
  return { mask, ratio: ink / diff.length };
}

/**
 * Retire de l'encre tout ce qui touche le bord du cadre : le contour de la
 * pièce (le pentagone) et les traits de la grille y touchent, le caractère,
 * lui, flotte au milieu. Si rien ne reste, on rend le masque d'origine.
 */
export function withoutBorderInk(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(mask);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (out[i]) {
      out[i] = 0;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let left = 0;
  for (let i = 0; i < out.length; i++) left += out[i];
  // Moins de 2 % du cadre : ce n'était pas un caractère entouré d'un contour, mais le caractère lui-même qui touchait le bord.
  return left > out.length * 0.02 ? out : mask;
}

/** Une case est vide quand presque rien n'y diffère du fond. */
export const EMPTY_INK_RATIO = 0.03;

/**
 * Ce que le moteur de lecture reçoit : le texte en noir sur fond blanc, cadré
 * au plus près, avec une marge, agrandi. `rotate` retourne l'image d'un demi-tour
 * (pour lire une pièce du camp d'en face).
 */
export function glyphCanvas(cell: Gray, rotate: boolean, look: { size: number; pad: number } = { size: 96, pad: 0.2 }): HTMLCanvasElement {
  const { mask: rawMask } = inkMask(cell);
  return maskCanvas(withoutBorderInk(rawMask, cell.w, cell.h), cell.w, cell.h, rotate, look);
}

/**
 * Un masque d'encre mis en forme pour la lecture : cadré au plus près, noir
 * sur blanc, centré dans un carré avec une marge. Sert aux cases du plateau
 * comme aux caractères des pièces en main.
 */
export function maskCanvas(
  mask: Uint8Array,
  w: number,
  h: number,
  rotate: boolean,
  look: { size: number; pad: number } = { size: 96, pad: 0.2 },
): HTMLCanvasElement {
  // Cadre serré autour de l'encre, en ignorant les pixels isolés des bords (liseré, ombre).
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    minX = 0;
    minY = 0;
    maxX = w - 1;
    maxY = h - 1;
  }
  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const side = Math.max(gw, gh);
  const SIZE = look.size;
  const pad = look.pad;
  const scale = (SIZE * (1 - 2 * pad)) / side;
  const out = document.createElement('canvas');
  out.width = SIZE;
  out.height = SIZE;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tmp = document.createElement('canvas');
  tmp.width = gw;
  tmp.height = gh;
  const tctx = tmp.getContext('2d')!;
  const img = tctx.createImageData(gw, gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const on = mask[(minY + y) * w + (minX + x)];
      const v = on ? 0 : 255;
      const o = (y * gw + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  ctx.save();
  if (rotate) {
    ctx.translate(SIZE, SIZE);
    ctx.rotate(Math.PI);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, (SIZE - gw * scale) / 2, (SIZE - gh * scale) / 2, gw * scale, gh * scale);
  ctx.restore();
  return out;
}

/** Les cases d'un plateau : `board` est le cadre de la grille, cellule (0,0) en haut à gauche. */
export function cellRect(board: Rect, col: number, row: number, margin = 0.1): Rect {
  const cw = board.w / 9;
  const ch = board.h / 9;
  // On rogne un peu : les traits de la grille ne sont pas de l'encre.
  const mx = cw * margin;
  const my = ch * margin;
  return { x: board.x + col * cw + mx, y: board.y + row * ch + my, w: cw - 2 * mx, h: ch - 2 * my };
}

/**
 * Le masque d'un petit signe (un chiffre de coin), pris dans les niveaux de gris
 * plutôt que dans le masque d'encre de la zone : un chiffre en clair sur une
 * pastille de couleur y deviendrait une pastille pleine. On sépare ici les deux
 * populations de la boîte (Otsu) et on garde la plus petite — le chiffre —, qu'il
 * soit plus clair ou plus sombre que son fond.
 */
export function minorityMask(gray: Gray, box: { x0: number; y0: number; x1: number; y1: number }): { mask: Uint8Array; w: number; h: number } {
  const pad = 2;
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(gray.w - 1, box.x1 + pad);
  const y1 = Math.min(gray.h - 1, box.y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const values = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[y * w + x] = gray.data[(y0 + y) * gray.w + (x0 + x)];
  const t = otsu(values);
  let low = 0;
  for (let i = 0; i < values.length; i++) if (values[i] <= t) low++;
  const lowIsInk = low <= values.length - low;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < values.length; i++) mask[i] = (values[i] <= t) === lowIsInk ? 1 : 0;
  return { mask, w, h };
}
