import type { Rect } from './image';

/**
 * Cherche la grille du plateau dans une image : dix traits verticaux et dix
 * traits horizontaux régulièrement espacés. On additionne, pour chaque colonne
 * de pixels, la force des contours qui la traversent : les traits de la grille
 * y font des pics, espacés d'une case, sur toute la hauteur du plateau — ce que
 * ne fait aucun caractère. Renvoie le cadre de la grille (les 9×9 cases), ou
 * `null` si rien ne ressemble à un plateau, auquel cas l'utilisateur le cadre
 * lui-même.
 */
export function detectBoard(source: CanvasImageSource, width: number, height: number): Rect | null {
  const MAX = 1600;
  const k = Math.min(1, MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];

  const gray_ = gray;
  /** Profils des contours, sur une fenêtre de l'image : [x0,x1) × [y0,y1). */
  const profiles = (x0: number, x1: number, y0: number, y1: number) => {
    const cols = new Float32Array(w);
    const rows = new Float32Array(h);
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
      for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
        const i = y * w + x;
        cols[x] += Math.abs(gray_[i + 1] - gray_[i - 1]);
        rows[y] += Math.abs(gray_[i + w] - gray_[i - w]);
      }
    }
    return { cols, rows };
  };
  // Première passe sur toute l'image ; puis chaque axe est relu à l'intérieur de la zone trouvée sur l'autre :
  // une rangée de pièces en main ou une marge de l'application ne fait pas de traits aussi longs que le plateau.
  let { cols, rows } = profiles(0, w, 0, h);
  let gx = gridLines(cols, Math.round(w / 8));
  let gy = gridLines(rows, Math.round(h / 8));
  if (!gx || !gy) return null;
  for (let pass = 0; pass < 2; pass++) {
    const refinedRows = profiles(gx.start, gx.start + 9 * gx.step, 0, h).rows;
    const nextY = gridLines(refinedRows, Math.round(h / 8));
    if (!nextY) break;
    gy = nextY;
    const refinedCols = profiles(0, w, gy.start, gy.start + 9 * gy.step).cols;
    const nextX = gridLines(refinedCols, Math.round(w / 8));
    if (!nextX) break;
    gx = nextX;
  }
  const ratio = gx.step / gy.step;
  if (ratio < 0.8 || ratio > 1.25) return null;
  return { x: gx.start / k, y: gy.start / k, w: (9 * gx.step) / k, h: (9 * gy.step) / k };
}

/**
 * Les traits d'un profil : on regroupe les colonnes voisines au-dessus d'une
 * fraction du plus fort (un trait de grille fait deux ou trois pixels de large,
 * au plateau parfois plat) et on prend le centre de chaque groupe.
 */
export function peaks(profile: Float32Array): number[] {
  let max = 0;
  for (const v of profile) if (v > max) max = v;
  const threshold = 0.3 * max;
  const out: number[] = [];
  let sum = 0;
  let weighted = 0;
  let last = -10;
  const flush = () => {
    if (sum > 0) out.push(weighted / sum);
    sum = 0;
    weighted = 0;
  };
  for (let x = 0; x < profile.length; x++) {
    if (profile[x] < threshold) continue;
    if (x - last > 2) flush();
    sum += profile[x];
    weighted += profile[x] * x;
    last = x;
  }
  flush();
  return out;
}

/**
 * Dix traits équidistants dans un profil : le pas et la position du premier.
 * On essaie chaque écart entre deux pics voisins comme pas candidat, on étend
 * la suite de part et d'autre tant qu'un pic tombe à la bonne place, et on garde
 * la fenêtre de dix traits la plus marquée.
 */
export function gridLines(profile: Float32Array, maxStep: number): { start: number; step: number } | null {
  const p = peaks(profile);
  const minStep = 12;
  let best: { start: number; step: number; score: number } | null = null;
  const strength = (pos: number, tol: number): number => {
    let top = 0;
    for (let x = Math.max(0, Math.round(pos - tol)); x <= Math.min(profile.length - 1, Math.round(pos + tol)); x++) {
      if (profile[x] > top) top = profile[x];
    }
    return top;
  };
  const threshold = (() => {
    let max = 0;
    for (const v of profile) if (v > max) max = v;
    // Le trait du bord est souvent plus pâle que ceux de l'intérieur : on le cherche à un seuil plus bas que les pics de départ.
    return 0.12 * max;
  })();
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const step = p[j] - p[i];
      if (step < minStep || step > maxStep) continue;
      if (step > (p[p.length - 1] - p[0]) / 8 + 2) continue;
      const tol = Math.max(2, step * 0.1);
      // On remonte jusqu'au premier trait de la suite, puis on la descend.
      let first = p[i];
      while (strength(first - step, tol) >= threshold) first -= step;
      const line: number[] = [];
      for (let pos = first; pos < profile.length; pos += step) {
        if (strength(pos, tol) >= threshold) line.push(pos);
        else break;
      }
      if (line.length < 9) continue;
      if (line.length === 9) {
        // Le trait du bord, parfois invisible : on ajoute le dixième du côté où le profil le soupçonne le plus.
        const before = strength(line[0] - step, tol);
        const after = strength(line[8] + step, tol);
        if (before > after) line.unshift(line[0] - step);
        else line.push(line[8] + step);
      }
      for (let s = 0; s + 10 <= line.length; s++) {
        let score = 0;
        for (let m = 0; m < 10; m++) score += strength(line[s + m], tol);
        if (!best || score > best.score) best = { start: line[s], step, score };
      }
    }
  }
  return best ? { start: best.start, step: best.step } : null;
}
