/* Le classement des parties par stratégie, sur des suites de coups construites à la main. */
import { STRATEGIES, strategyById, strategyOf } from '../src/play/strategy';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const game = (s: string) => s.split(' ');

// Sente joue shikenbisha (2h6h après 7g7f 6g6f), Gote reste en place.
const shiken = game('7g7f 3c3d 6g6f 8c8d 2h6h 8d8e 6i7h 4a3b');
check('Sente : shikenbisha', strategyOf(shiken, 'b') === 'shikenbisha');
check('Gote dans la même partie : rook en place', strategyOf(shiken, 'w') === 'ibisha-other');

const sanken = game('7g7f 3c3d 6g6f 8c8d 2h7h 8d8e 7i6h 4a3b');
check('Sente : sankenbisha (tour en 7h)', strategyOf(sanken, 'b') === 'sankenbisha');

const naka = game('5g5f 3c3d 2h5h 8c8d 7g7f 8d8e 6i7h 4a3b');
check('Sente : nakabisha (tour en 5h)', strategyOf(naka, 'b') === 'nakabisha');

// Gote joue le miroir de shikenbisha : sa tour (8b) va en 4b.
const goteShiken = game('7g7f 3c3d 6g6f 8b4b 6i7h 4a3b 7i6h 6a5b');
check('Gote : shikenbisha (tour 8b→4b, repère retourné)', strategyOf(goteShiken, 'w') === 'shikenbisha');
check('Sente en face : rook en place', strategyOf(goteShiken, 'b') !== 'shikenbisha');

const mukai = game('7g7f 3c3d 8h7g 8c8d 2h8h 8d8e 6i7h 4a3b');
check('Sente : mukai-bisha (tour en 8h après le fou)', strategyOf(mukai, 'b') === 'mukai');

const yagura = game('7g7f 3c3d 6i7h 8c8d 7i6h 8d8e 6g6f 4a3b');
check('Sente : yagura (6i7h et 7i6h)', strategyOf(yagura, 'b') === 'yagura');

const kaku = game('7g7f 3c3d 2g2f 8c8d 8h2b+ 3a2b 6i7h 4a3b');
check('échange des fous : les deux camps en kakugawari', strategyOf(kaku, 'b') === 'kakugawari' && strategyOf(kaku, 'w') === 'kakugawari');

const aigakari = game('2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 7g7f 3c3d');
check('aigakari : pions de tour poussés des deux côtés', strategyOf(aigakari, 'b') === 'aigakari');
check('aigakari vu de Gote', strategyOf(aigakari, 'w') === 'aigakari');

const bogin = game('7g7f 3c3d 3i3h 8c8d 3h2g 8d8e 2g2f 4a3b');
check('bōgin : l’argent monte sur la 2e colonne', strategyOf(bogin, 'b') === 'bogin');

check('la tour prise avant de bouger ne fausse pas : rook en place', strategyOf(game('7g7f 3c3d 8h2b+ 3a2b'), 'b') === 'kakugawari');
check('dix stratégies, identifiants uniques', STRATEGIES.length === 10 && new Set(STRATEGIES.map((s) => s.id)).size === 10);
check('strategyById', strategyById('yagura')?.family === 'ibisha' && strategyById('???') === undefined);

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
