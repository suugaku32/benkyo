/*
 * 打ち歩詰め — on n'a pas le droit de mater en *droppant* un pion, alors que le
 * même mat porté par un pion qui avance est parfaitement légal.
 *
 * La règle manquait au générateur, qui ne connaissait que le nifu et les
 * dernières rangées. Elle compte doublement dans le mode tsume : le coup y était
 * proposé, et aurait été accepté comme solution.
 *
 * Ces positions sont construites à la main plutôt que tirées de parties : le cas
 * est trop rare pour apparaître dans un tirage aléatoire — 7 200 positions
 * comparées à shogiops ne l'ont jamais rencontré.
 */
import { Position } from '../src/shogi/position';
import { generateLegalMoves, moveToUsi } from '../src/shogi/moveGen';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const movesOf = (sfen: string): string[] => {
  const pos = Position.fromSfen(sfen);
  return generateLegalMoves(pos, pos.turn).map(moveToUsi);
};

/*
 * Roi gote en 5a, encadré de ses propres lances en 6a et 4a — elles bouchent la
 * fuite sans pouvoir reprendre en 5b. Deux argents Sente en 6c et 4c couvrent 6b,
 * 4b et 5b sans attaquer 5a, donc la position n'est pas déjà en échec. Après
 * P*5b : ni fuite, ni prise. Mat par pion droppé.
 */
const MAT_PAR_DROP = '3lkl3/9/3S1S3/9/9/9/9/9/8K b P 1';

/* Un seul argent : 4b reste libre, le pion droppé fait échec sans mater. */
const ECHEC_SANS_MAT = '3lkl3/9/3S5/9/9/9/9/9/8K b P 1';

/* Même mat, mais porté par un pion qui avance de 5c en 5b : parfaitement légal. */
const MAT_PAR_AVANCE = '3lkl3/9/3SPS3/9/9/9/9/9/8K b - 1';

console.log('=== 打ち歩詰め ===');
{
  const m = movesOf(MAT_PAR_DROP);
  check('le drop de pion matant est refusé', !m.includes('P*5b'), `${m.length} coups légaux`);
  check(
    "les autres drops de pion restent proposés",
    m.some((u) => u.startsWith('P*')),
    m.filter((u) => u.startsWith('P*')).slice(0, 5).join(' '),
  );
}
{
  const m = movesOf(ECHEC_SANS_MAT);
  check('un drop de pion qui fait échec sans mater est permis', m.includes('P*5b'));
}
{
  const m = movesOf(MAT_PAR_AVANCE);
  check('le même mat par un pion qui avance reste légal', m.includes('5c5b'));
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
