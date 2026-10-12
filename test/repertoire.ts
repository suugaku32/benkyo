/* L'entraînement aux ouvertures : verdicts selon l'exigence, indices, réponses de l'adversaire. */
import { acceptedMoves, bookMoves, judgeMove, opponentReply } from '../src/play/repertoire';
import type { OpeningTree } from '../src/play/tree';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
let seed = 3;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const tree: OpeningTree = {
  meta: { source: 't', games: 100, players: 3, minRating: 2000, depth: 4, minCount: 3, builtAt: '' },
  nodes: {
    '': [['7g7f', 60, 30, 30], ['2g2f', 32, 20, 12], ['5g5f', 6, 1, 5], ['9g9f', 2, 1, 1]],
    '7g7f': [['3c3d', 40, 20, 20], ['8c8d', 20, 5, 15]],
  },
};

const known = bookMoves(tree, [], 'b');
check('parts : somme à 1', Math.abs(known.reduce((s, m) => s + m.share, 0) - 1) < 1e-9);
check('le plus joué d’abord', known[0].move === '7g7f' && Math.abs(known[0].share - 0.6) < 1e-9);
check('taux de points du camp (Sente 7g7f : 30/60)', Math.abs(known[0].winRate - 0.5) < 1e-9);
check('taux de points de Gote sur 8c8d : 15/20', Math.abs(bookMoves(tree, ['7g7f'], 'w')[1].winRate - 0.75) < 1e-9);

const kind = (usi: string, s: 'wide' | 'standard' | 'strict') => judgeMove(tree, [], usi, 'b', s).kind;
check('strict : le plus joué passe', kind('7g7f', 'strict') === 'book');
check('strict : le deuxième est « rare »', kind('2g2f', 'strict') === 'rare');
check('standard : 32 % passe', kind('2g2f', 'standard') === 'book');
check('standard : 6 % est « rare »', kind('5g5f', 'standard') === 'rare');
check('large : 6 % passe', kind('5g5f', 'wide') === 'book');
check('large : 2 % est « rare »', kind('9g9f', 'wide') === 'rare');
check('hors livre : inconnu', kind('1g1f', 'wide') === 'unknown');
check('position inconnue : inconnu', judgeMove(tree, ['9g9f'], '1c1d', 'w', 'wide').kind === 'unknown');

check('indice strict : un seul coup', acceptedMoves(tree, [], 'b', 'strict').length === 1);
check('indice standard : deux coups', acceptedMoves(tree, [], 'b', 'standard').map((m) => m.move).join() === '7g7f,2g2f');
check('indice large : trois coups', acceptedMoves(tree, [], 'b', 'wide').length === 3);

check('ligne principale : toujours le plus joué', Array.from({ length: 50 }, () => opponentReply(tree, [], 'b', 'main', rng)).every((m) => m === '7g7f'));
const counts: Record<string, number> = {};
for (let i = 0; i < 4000; i++) {
  const m = opponentReply(tree, [], 'b', 'variety', rng)!;
  counts[m] = (counts[m] ?? 0) + 1;
}
check('variété : fréquences proches des parts', Math.abs(counts['7g7f'] / 4000 - 0.6) < 0.03 && Math.abs(counts['2g2f'] / 4000 - 0.32) < 0.03, JSON.stringify(counts));
check('fin du livre : aucune réponse', opponentReply(tree, ['1a1b'], 'w', 'variety', rng) === null);

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
