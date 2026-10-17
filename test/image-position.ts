/* De la lecture d'une image à la position : orientation, camp des pièces, avertissements. */
import { gridToPosition, positionWarnings } from '../src/ocr/position';
import type { CellReading } from '../src/ocr/recognize';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const piece = (char: string, type: 'P' | 'L' | 'N' | 'S' | 'G' | 'B' | 'R' | 'K', upsideDown: boolean, confidence = 90, promoted = false): CellReading => ({
  kind: 'piece',
  glyph: { type, promoted },
  char,
  upsideDown,
  confidence,
});
const empty: CellReading = { kind: 'empty' };

// La position de départ, lue comme sur une image vue de Sente.
const row = (spec: (CellReading)[]) => spec;
const E = empty;
const back = (up: boolean) => [piece('香', 'L', up), piece('桂', 'N', up), piece('銀', 'S', up), piece('金', 'G', up), piece('玉', 'K', up), piece('金', 'G', up), piece('銀', 'S', up), piece('桂', 'N', up), piece('香', 'L', up)];
const grid: CellReading[][] = [
  row(back(true)),
  row([E, piece('飛', 'R', true), E, E, E, E, E, piece('角', 'B', true), E]),
  row(Array.from({ length: 9 }, () => piece('歩', 'P', true))),
  row(Array(9).fill(E)),
  row(Array(9).fill(E)),
  row(Array(9).fill(E)),
  row(Array.from({ length: 9 }, () => piece('歩', 'P', false))),
  row([E, piece('角', 'B', false), E, E, E, E, E, piece('飛', 'R', false), E]),
  row(back(false)),
];

const start = gridToPosition(grid, { goteAtBottom: false, turn: 'b' });
check('position de départ reconnue (SFEN)', start.position.toSfen() === 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1', start.position.toSfen());
check('aucune case douteuse', start.doubtful.length === 0);
check('aucun avertissement', positionWarnings(start.position).length === 0);

// Même image, mais l'application montre le plateau côté Gote : les pièces à l'endroit sont celles de Gote.
const flipped = gridToPosition(grid, { goteAtBottom: true, turn: 'b' });
check('camp du bas = Gote : même position de départ, vue de l’autre côté', flipped.position.toSfen() === start.position.toSfen(), flipped.position.toSfen());
check('camp du bas = Gote : le roi du bas est à Gote', flipped.position.findKing('w') !== null && flipped.position.findKing('w')!.rank === 1);

// Un pion promu (と) et un doute.
const g2 = grid.map((r) => r.slice());
g2[4][4] = piece('と', 'P', false, 85, true);
g2[3][4] = piece('?', 'P', true, 0);
const r2 = gridToPosition(g2, { goteAtBottom: false, turn: 'w' });
check('pion promu au centre', r2.position.pieceAt({ file: 5, rank: 5 })?.promoted === true && r2.position.pieceAt({ file: 5, rank: 5 })?.color === 'b');
check('trait à Gote', r2.position.turn === 'w' && r2.position.toSfen().includes(' w '));
check('lecture douteuse signalée', r2.doubtful.length === 1 && r2.doubtful[0].file === 5 && r2.doubtful[0].rank === 4);

// Avertissements.
const noKing = start.position.clone();
noKing.setPiece({ file: 5, rank: 9 }, null);
check('roi manquant signalé', positionWarnings(noKing).some((w) => w.includes('roi de Sente')));
const nifu = start.position.clone();
nifu.setPiece({ file: 5, rank: 5 }, { color: 'b', type: 'P', promoted: false });
check('nifu signalé', positionWarnings(nifu).some((w) => w.includes('nifu')));
const tooMany = start.position.clone();
tooMany.hands.b.R = 3;
check('trop de tours signalé', positionWarnings(tooMany).some((w) => w.includes('Trop de pièces')));

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
