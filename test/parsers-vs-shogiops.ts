/*
 * Test différentiel des parsers de kifu, avec shogiops comme oracle.
 *
 * Limite connue et assumée : shogiops ne lit pas le KI2 (format ▲/△ sans case
 * de départ) — sa regex exige `(77)` — donc ce format n'est comparable à rien
 * et reste couvert par les seuls cas ci-dessous.
 */
import { parseKifu } from '../src/shogi/parser';
import { Position } from '../src/shogi/position';
import { parseKifHeader, parseKifMovesOrDrops } from 'shogiops/notation/kif';
import { parseCsaHeader, parseCsaMovesOrDrops } from 'shogiops/notation/csa';
import { makeUsi } from 'shogiops/util';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const KIF = `手合割：平手
先手：Alice
後手：Bob
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２二角成(88)
   4 同　銀(31)
   5 ４五角打
   6 ３三桂(21)`;

const CSA = `V2.2
N+Alice
N-Bob
PI
+
+7776FU
-3334FU
+8822UM
-3122GI`;

console.log('=== KIF numéroté ===');
{
  const mine = parseKifu(KIF).moves;
  const head = parseKifHeader(KIF);
  let theirs: string[] = [];
  if (head.isOk) {
    theirs = parseKifMovesOrDrops(KIF.split('\n').slice(3), head.value).map(makeUsi);
  }
  check('même nombre de coups', mine.length === theirs.length, `${mine.length} vs ${theirs.length}`);
  check('mêmes coups', mine.join(' ') === theirs.join(' '), `\n    moi : ${mine.join(' ')}\n    eux : ${theirs.join(' ')}`);
}

console.log('=== CSA ===');
{
  const mine = parseKifu(CSA).moves;
  const head = parseCsaHeader(CSA);
  let theirs: string[] = [];
  if (head.isOk) {
    const csaMoveLines = CSA.split('\n').filter((l) => /^[+-]\d{4}[A-Z]{2}/.test(l));
    theirs = parseCsaMovesOrDrops(head.value, csaMoveLines).map(makeUsi);
  }
  check('même nombre de coups', mine.length === theirs.length, `${mine.length} vs ${theirs.length}`);
  check('mêmes coups', mine.join(' ') === theirs.join(' '), `\n    moi : ${mine.join(' ')}\n    eux : ${theirs.join(' ')}`);
}

console.log('=== KI2 (hors périmètre de shogiops) ===');
{
  const g = parseKifu('▲７六歩　△３四歩　▲２六歩　△８四歩');
  check('4 coups lus', g.moves.length === 4, g.moves.join(' '));
  const pos = Position.fromSfen(g.startSfen);
  let replayed = true;
  try {
    for (const m of g.moves) pos.applyUsiMove(m);
  } catch {
    replayed = false;
  }
  check('partie rejouable', replayed);
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
