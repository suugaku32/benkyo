/* Pièces en main : découpe en caractères, suite de signes → pièces, barres 一二三. */
import { countBars, parseTokens, segmentHand, tokenOf, withoutFrames } from '../src/ocr/hands';
import type { Token } from '../src/ocr/hands';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const t = (chars: string): Token[] => [...chars].map((c) => tokenOf(c, 90)!).filter(Boolean);

console.log('=== De la suite de signes aux pièces ===');
{
  const h = parseTokens(t('飛角金二歩三'));
  check('飛 角 金二 歩三', h.R === 1 && h.B === 1 && h.G === 2 && h.P === 3 && h.S === 0, JSON.stringify(h));
  const h2 = parseTokens(t('歩十八'));
  check('歩 十八 = 18', parseTokens(t('歩十八')).P === 18, JSON.stringify(h2));
  check('歩 十 = 10', parseTokens(t('歩十')).P === 10);
  check('une pièce sans nombre vaut 1', parseTokens(t('銀')).S === 1);
  check('la même pièce répétée s’additionne', parseTokens(t('歩歩歩')).P === 3);
  check('chiffres arabes', parseTokens(t('金3歩9')).G === 3 && parseTokens(t('金3歩9')).P === 9);
  check('forme promue lue pour une pièce en main : ramenée à sa base', parseTokens(t('と')).P === 1 && parseTokens(t('龍')).R === 1);
  check('un nombre sans pièce est ignoré', JSON.stringify(parseTokens(t('三'))) === JSON.stringify(parseTokens([])));
  check('caractère inconnu ignoré', tokenOf('x', 90) === null);
}

// Un masque 100×30 : trois « caractères » carrés de 24 px, séparés de 10 px.
function maskOf(w: number, h: number, rects: [number, number, number, number][]): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}

console.log('=== Découpe ===');
{
  const w = 130;
  const h = 30;
  const row = maskOf(w, h, [[2, 3, 25, 26], [36, 3, 59, 26], [70, 3, 93, 26]]);
  const seg = segmentHand(row, w, h);
  check('une rangée : axe x, trois caractères', seg.axis === 'x' && seg.glyphs.length === 3, `${seg.axis} ${seg.glyphs.length}`);
  check('dans l’ordre de lecture', seg.glyphs[0].box.x0 < seg.glyphs[1].box.x0 && seg.glyphs[1].box.x0 < seg.glyphs[2].box.x0);

  // Un caractère fait de deux morceaux (haut et bas) ne doit pas être coupé en deux.
  const split = maskOf(w, h, [[2, 3, 25, 11], [2, 17, 25, 26], [36, 3, 59, 26]]);
  check('un caractère en deux morceaux reste un caractère', segmentHand(split, w, h).glyphs.length === 2);

  // Une colonne (livre) : trois caractères empilés.
  const col = maskOf(30, 130, [[3, 2, 26, 25], [3, 36, 26, 59], [3, 70, 26, 93]]);
  const vs = segmentHand(col, 30, 130);
  check('une colonne : axe y, trois caractères', vs.axis === 'y' && vs.glyphs.length === 3, `${vs.axis} ${vs.glyphs.length}`);

  // Un chiffre de coin : petit, en haut à droite d'un caractère.
  const badge = maskOf(w, h, [[2, 3, 19, 26], [22, 0, 28, 8], [36, 3, 59, 26]]);
  const bs = segmentHand(badge, w, h);
  check('chiffre de coin mis à part', bs.glyphs[0].badges.length === 1 && bs.glyphs.length === 2, JSON.stringify(bs.glyphs.map((g) => g.badges.length)));

  // Une étiquette bien plus petite que les pièces est écartée.
  const label = maskOf(w, h, [[2, 11, 13, 16], [36, 3, 59, 26], [70, 3, 93, 26]]);
  check('étiquette écartée', segmentHand(label, w, h).glyphs.length === 2);
  check('zone vide : aucun caractère', segmentHand(new Uint8Array(w * h), w, h).glyphs.length === 0);
}

console.log('=== Cadres et barres ===');
{
  const w = 60;
  const h = 70;
  // Un cadre creux de 50×60 autour d'un carré de 20×20.
  const m = new Uint8Array(w * h);
  for (let x = 3; x < 53; x++) { m[3 * w + x] = 1; m[62 * w + x] = 1; }
  for (let y = 3; y < 63; y++) { m[y * w + 3] = 1; m[y * w + 52] = 1; }
  for (let y = 20; y < 40; y++) for (let x = 18; x < 38; x++) m[y * w + x] = 1;
  const cleaned = withoutFrames(m, w, h);
  check('le cadre est retiré', cleaned[3 * w + 10] === 0 && cleaned[30 * w + 3] === 0);
  check('le caractère à l’intérieur reste', cleaned[30 * w + 25] === 1);

  const bars = (n: number) => {
    const mk = new Uint8Array(40 * 40);
    for (let i = 0; i < n; i++) for (let y = 8 + i * 8; y < 11 + i * 8; y++) for (let x = 4; x < 36; x++) mk[y * 40 + x] = 1;
    return countBars(mk, 40, { x0: 4, y0: 8, x1: 35, y1: 10 + (n - 1) * 8 });
  };
  check('一 二 三 : 1, 2, 3 barres', bars(1) === 1 && bars(2) === 2 && bars(3) === 3, `${bars(1)} ${bars(2)} ${bars(3)}`);
  const sq = new Uint8Array(40 * 40);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) sq[y * 40 + x] = 1;
  check('un carré plein n’est pas une suite de barres', countBars(sq, 40, { x0: 5, y0: 5, x1: 34, y1: 34 }) === null);
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
