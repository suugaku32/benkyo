/*
 * Le livre de parties humaines : poids des coups, tirage sans répétition,
 * reconnaissance d'une position connue, livre vide.
 */
import { buildBook, inTree, isEmptyTree, pickTreeMoves, treeKey, weightOf } from '../src/play/tree';
import type { GamesFile, OpeningTree } from '../src/play/tree';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
let seed = 7;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const tree: OpeningTree = {
  meta: { source: 't', games: 100, players: 3, minRating: 2000, depth: 4, minCount: 3, builtAt: '' },
  nodes: {
    '': [['7g7f', 60, 30, 30], ['2g2f', 30, 15, 15], ['5g5f', 10, 2, 8]],
    '7g7f': [['3c3d', 40, 20, 20], ['8c8d', 20, 5, 15]],
  },
};

check('clé : coups joints', treeKey(['7g7f', '3c3d']) === '7g7f 3c3d');
check('position connue', inTree(tree, []) && inTree(tree, ['7g7f']));
check('position inconnue', !inTree(tree, ['9g9f']));
check('livre vide reconnu', isEmptyTree({ ...tree, meta: { ...tree.meta, games: 0 } }) && !isEmptyTree(tree));

// Poids : la popularité compte d'abord, le résultat relève ou rabaisse.
const w = (e: [string, number, number, number], c: 'b' | 'w') => weightOf(e, c);
check('un coup qui gagne pèse plus qu’un coup qui perd, à parties égales', w(['a', 10, 8, 2], 'b') > w(['a', 10, 2, 8], 'b'));
check('le même coup pèse l’inverse pour l’autre camp', w(['a', 10, 8, 2], 'w') < w(['a', 10, 2, 8], 'w'));
check('un coup très joué l’emporte sur un coup rare', w(['a', 60, 30, 30], 'b') > w(['b', 10, 6, 4], 'b'));

// Tirage : fréquences proches des poids, jamais deux fois le même coup.
const first: Record<string, number> = {};
let repeated = false;
for (let i = 0; i < 3000; i++) {
  const picks = pickTreeMoves(tree, [], 'b', rng, 3);
  first[picks[0]] = (first[picks[0]] ?? 0) + 1;
  if (new Set(picks).size !== picks.length) repeated = true;
}
check('aucune répétition dans un tirage', !repeated);
check('le plus joué sort le plus souvent', first['7g7f'] > first['2g2f'] && first['2g2f'] > first['5g5f'], JSON.stringify(first));
check('le moins joué sort quand même parfois', (first['5g5f'] ?? 0) > 0);
check('hors livre : aucun coup', pickTreeMoves(tree, ['9g9f'], 'b', rng).length === 0);
check('au plus `count` coups', pickTreeMoves(tree, [], 'b', rng, 2).length === 2);
check('moins de coups que demandé : tous', pickTreeMoves(tree, ['7g7f'], 'w', rng, 5).length === 2);

console.log('=== Le répertoire filtré par stratégie ===');
{
  // 6 parties où Sente joue shikenbisha, 4 où il joue yagura ; les mêmes coups de Gote à chaque fois.
  const shiken = '7g7f 3c3d 6g6f 8c8d 2h6h 8d8e 6i7h 4a3b';
  const yagura = '7g7f 3c3d 6i7h 8c8d 7i6h 8d8e 6g6f 4a3b';
  const file: GamesFile = {
    meta: { source: 't', games: 10, players: 2, minRating: 1700, plies: 30, builtAt: '' },
    games: [
      ...Array.from({ length: 6 }, (): [string, 'b' | 'w' | 'd'] => [shiken, 'b']),
      ...Array.from({ length: 4 }, (): [string, 'b' | 'w' | 'd'] => [yagura, 'w']),
    ],
  };
  const book = buildBook(file);
  check('stratégies comptées pour les deux camps', book.strategyCounts.get('shikenbisha') === 6 && book.strategyCounts.get('yagura') === 4);
  check('Gote, en rook en place, compte aussi', (book.strategyCounts.get('ibisha-other') ?? 0) === 10);
  const all = book.tree(null, null);
  check('arbre complet : 10 parties', all.meta.games === 10 && all.nodes[''][0][1] === 10);
  const sk = book.tree('b', 'shikenbisha');
  check('shikenbisha de Sente : 6 parties', sk.meta.games === 6);
  check('… et son troisième coup est 6g6f', sk.nodes['7g7f 3c3d'][0][0] === '6g6f');
  const yg = book.tree('b', 'yagura');
  check('yagura de Sente : son troisième coup est 6i7h', yg.nodes['7g7f 3c3d'][0][0] === '6i7h');
  check('le filtre est mémorisé', book.tree('b', 'yagura') === yg);
  check('stratégie jamais jouée par ce camp : arbre vide', book.tree('w', 'shikenbisha').meta.games === 0);
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
