/*
 * Le style de jeu : ce qu'un coup « attaque », le choix parmi les coups d'une
 * fenêtre, et ce qu'il ne doit jamais faire (laisser filer un mat, sortir de la fenêtre).
 */
import { Position, HIRATE_SFEN } from '../src/shogi/position';
import { STYLES, preferredMove, sharpness, styleById } from '../src/play/style';
import { chooseMove, levelById } from '../src/play/opponent';
import type { AnalyzeLine } from '../src/engine/UsiEngine';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const cp = (move: string, scoreCp: number): AnalyzeLine => ({ move, scoreCp, scoreMate: null, pv: [move] });
const mate = (move: string, scoreMate: number): AnalyzeLine => ({ move, scoreCp: null, scoreMate, pv: [move] });
let seed = 1;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

console.log('=== Ce qu’un coup attaque ===');
{
  const start = Position.fromSfen(HIRATE_SFEN);
  check('un coup de roi est moins offensif qu’un coup de pion', sharpness(start, '5i4h') < sharpness(start, '2g2f'));
  check('un coup tranquille de l’or près du roi est plus bas qu’un pion', sharpness(start, '6i7h') < sharpness(start, '7g7f'));
  // Prise de la dame : Sente prend la tour de Gote avec la sienne.
  const cap = Position.fromSfen('4k4/9/9/9/4r4/9/9/4R4/4K4 b - 1');
  check('une prise de tour > un coup de roi', sharpness(cap, '5h5e') > sharpness(cap, '5i4i'));
  // Échec : la tour passe en 5e avec le roi gote en 5a, colonne libre.
  const chk = Position.fromSfen('4k4/9/9/9/9/9/9/R8/4K4 b - 1');
  check('un échec compte', sharpness(chk, '9h5h') > sharpness(chk, '9h8h'));
}

console.log('=== Choix parmi la fenêtre ===');
{
  const pos = Position.fromSfen(HIRATE_SFEN);
  const lines = [cp('5i4h', 100), cp('2g2f', 95), cp('7g7f', 60), cp('6i7h', -400)];
  const balanced = styleById('balanced');
  check('équilibré : pas d’avis', preferredMove(pos, lines, balanced, rng) === null);
  const off = styleById('offensive'); // 60 cp
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(preferredMove(pos, lines, off, rng)!);
  check('offensif : jamais hors de la fenêtre (−400 exclu)', !seen.has('6i7h'));
  check('offensif : écarte le coup de roi (5i4h) au profit d’un coup actif', !seen.has('5i4h'));
  const ber = styleById('berserk');
  const many = lines.concat([cp('5i6h', 80)]);
  const s2 = new Set<string>();
  for (let i = 0; i < 400; i++) s2.add(preferredMove(pos, many, ber, rng)!);
  check('kamikaze : la fenêtre de 300 cp laisse choisir', s2.size >= 1 && !s2.has('6i7h'));
  check('un seul coup dans la fenêtre : pas d’avis', preferredMove(pos, [cp('a', 100), cp('b', -900)], off, rng) === null);
  check('mat à jouer : pas d’avis, on joue le mat', preferredMove(pos, [mate('2g2f', 3), cp('7g7f', 50)], styleById('berserk'), rng) === null);
}

console.log('=== Avec le niveau ===');
{
  const pos = Position.fromSfen(HIRATE_SFEN);
  const lines = [cp('5i4h', 100), cp('2g2f', 95)];
  const top = levelById('n30'); // toujours le meilleur coup
  check('sans style : meilleur coup', chooseMove(lines, top, rng, null) === '5i4h');
  check('avec style : le coup préféré remplace le meilleur', chooseMove(lines, { ...top, multiPv: 8 }, rng, '2g2f') === '2g2f');
  const sample = preferredMove(pos, lines, styleById('aggressive'), rng);
  check('style agressif : prend le coup actif', sample === '2g2f');
}

console.log('=== Barème des styles ===');
{
  check('quatre styles dont l’équilibré par défaut', STYLES.length === 4 && STYLES[0].id === 'balanced');
  check('fenêtres croissantes', STYLES.every((s, i) => i === 0 || s.windowCp > STYLES[i - 1].windowCp));
  check('inconnu → équilibré', styleById('???').id === 'balanced');
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
