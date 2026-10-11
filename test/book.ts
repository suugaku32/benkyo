/*
 * Les ouvertures de l'ordinateur : chaque plan doit être jouable du début à la
 * fin, pour les deux camps, et l'avancement dans le plan doit se déduire
 * correctement des coups déjà joués.
 */
import { BOOK_TOLERANCE_CP, OPENINGS, isBookMoveSafe, mirror, nextBookMove, openingById } from '../src/play/book';
import { HIRATE_SFEN, Position } from '../src/shogi/position';
import { generateLegalMoves, moveToUsi } from '../src/shogi/moveGen';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('=== mirror ===');
check('7g7f ↔ 3c3d', mirror('7g7f') === '3c3d' && mirror('3c3d') === '7g7f');
check('2h7h ↔ 8b3b', mirror('2h7h') === '8b3b');
check('une promotion garde son « + »', mirror('8h2b+') === '2b8h+');
check('un parachutage est retourné', mirror('P*5e') === 'P*5e' && mirror('B*3c') === 'B*7g');

console.log('=== Chaque plan est jouable, pour les deux camps ===');
/*
 * L'adversaire joue des coups de pion de bord qui ne touchent à rien de ce que
 * les plans déplacent : ils ne peuvent donc pas rendre un coup du plan illégal.
 */
const HARMLESS_FOR_GOTE = ['1c1d', '9c9d', '1d1e', '9d9e', '1a1b', '9a9b', '1b1c', '9b9c'];

/*
 * L'échange des fous ne se joue que si l'adversaire a ouvert sa diagonale : le
 * pion de 3c (pour Gote) doit avoir bougé. Le test lui fait faire ce coup-là.
 */
const OPPONENT_SCRIPT: Record<string, string[]> = {
  kakugawari: ['3c3d', '1c1d', '9c9d', '1d1e'],
};

for (const opening of OPENINGS) {
  for (const computer of ['b', 'w'] as const) {
    const pos = Position.fromSfen(HIRATE_SFEN);
    const moves: string[] = [];
    const script = OPPONENT_SCRIPT[opening.id] ?? HARMLESS_FOR_GOTE;
    const idle = (computer === 'b' ? script : script.map(mirror)).slice();
    let ok = true;
    let played = 0;
    for (let guard = 0; guard < 30 && ok; guard++) {
      let usi: string | null;
      if (pos.turn === computer) {
        usi = nextBookMove(opening, computer, moves);
        if (usi === null) break;
        played++;
      } else {
        usi = idle.shift() ?? null;
        if (usi === null) break;
      }
      const legal = generateLegalMoves(pos, pos.turn).map(moveToUsi);
      if (!legal.includes(usi)) {
        ok = false;
        check(`${opening.label} (${computer === 'b' ? 'Sente' : 'Gote'}) : ${usi} légal`, false);
        break;
      }
      pos.applyUsiMove(usi);
      moves.push(usi);
    }
    if (ok) {
      check(
        `${opening.label} (${computer === 'b' ? 'Sente' : 'Gote'})`,
        played === opening.plan.length,
        `${played}/${opening.plan.length} coups`,
      );
    }
  }
}

console.log('=== Avancement dans le plan ===');
{
  const sanken = openingById('sanken'); // 7g7f 6g6f 2h7h 7i6h
  check('départ : premier coup', nextBookMove(sanken, 'b', []) === '7g7f');
  check('après le 1er coup : le 2e', nextBookMove(sanken, 'b', ['7g7f', '3c3d']) === '6g6f');
  check(
    'un coup hors plan ne fait pas avancer',
    nextBookMove(sanken, 'b', ['2g2f', '3c3d']) === '7g7f',
  );
  check(
    'plan terminé : plus rien',
    nextBookMove(sanken, 'b', ['7g7f', 'x', '6g6f', 'x', '2h7h', 'x', '7i6h', 'x']) === null,
  );
  check('Gote suit le plan retourné', nextBookMove(sanken, 'w', ['2g2f']) === '3c3d');
  check('jeu libre : jamais de coup', nextBookMove(openingById('free'), 'b', []) === null);
  check('identifiant inconnu : jeu libre', openingById('???').id === 'free');
}

console.log('=== Garde-fou ===');
check('un coup au niveau du meilleur : accepté', isBookMoveSafe(100, 100));
check('un coup un peu inférieur : accepté', isBookMoveSafe(100, 20));
check('à la limite de la tolérance : accepté', isBookMoveSafe(100, 100 - BOOK_TOLERANCE_CP));
check('un coup nettement inférieur : refusé', !isBookMoveSafe(100, -250));
check('une pièce en prise (−500) : refusée', !isBookMoveSafe(50, -500));
check('un coup meilleur que le « meilleur » mesuré : accepté', isBookMoveSafe(100, 130));

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
