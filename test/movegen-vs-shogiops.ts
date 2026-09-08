/*
 * Test différentiel : mon générateur de coups légaux contre celui de shogiops,
 * sur des milliers de positions atteintes par jeu aléatoire.
 *
 * shogiops sert d'oracle : c'est le code des règles de lishogi, éprouvé en
 * production. Toute divergence est très probablement un bug chez moi.
 */
import { Position as MyPosition, HIRATE_SFEN } from '../src/shogi/position';
import { generateLegalMoves, moveToUsi } from '../src/shogi/moveGen';
import { parseSfen } from 'shogiops/sfen';
import { makeUsi, parseUsi } from 'shogiops/util';

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

/** Tous les coups légaux d'une position selon shogiops, en notation USI. */
function theirMoves(sfen: string): string[] | null {
  const res = parseSfen('standard', sfen);
  if (!res.isOk) return null;
  const pos = res.value;
  const out: string[] = [];
  for (const [from, dests] of pos.allMoveDests()) {
    // allMoveDests() ne donne que les cases atteignables : il faut éprouver
    // chaque état de promotion. Supposer le coup non promu légal fait apparaître
    // des cavaliers et lances immobilisés en dernière rangée, où la promotion
    // est obligatoire.
    for (const to of dests) {
      for (const promotion of [false, true]) {
        const usi = makeUsi({ from, to, promotion });
        const parsed = parseUsi(usi);
        if (parsed && pos.isLegal(parsed)) out.push(usi);
      }
    }
  }
  // allDropDests() renvoie des clés colorées (« gote bishop ») ; makeUsi attend
  // un rôle nu, sans quoi il retombe silencieusement sur une lettre erronée.
  for (const [colored, dests] of pos.allDropDests()) {
    const role = String(colored).split(' ').slice(1).join(' ');
    for (const to of dests) out.push(makeUsi({ role, to } as never));
  }
  return out;
}

const norm = (a: string[]) => [...new Set(a)].sort();

let positions = 0;
let mismatches = 0;
const examples: string[] = [];

for (let game = 0; game < 120 && mismatches < 5; game++) {
  const pos = MyPosition.fromSfen(HIRATE_SFEN);
  for (let ply = 0; ply < 60; ply++) {
    const sfen = pos.toSfen();
    const mine = norm(generateLegalMoves(pos, pos.turn).map(moveToUsi));
    const theirs = theirMoves(sfen);
    if (theirs === null) break;
    positions++;

    const t = norm(theirs);
    if (mine.join(' ') !== t.join(' ')) {
      mismatches++;
      const onlyMine = mine.filter((m) => !t.includes(m));
      const onlyTheirs = t.filter((m) => !mine.includes(m));
      examples.push(
        `sfen: ${sfen}\n  chez moi seulement (${onlyMine.length}) : ${onlyMine.slice(0, 8).join(' ')}\n  chez eux seulement (${onlyTheirs.length}) : ${onlyTheirs.slice(0, 8).join(' ')}`,
      );
      break;
    }

    if (mine.length === 0) break;
    pos.applyUsiMove(mine[Math.floor(rnd() * mine.length)]);
  }
}

console.log(`positions comparées : ${positions}`);
console.log(`divergences          : ${mismatches}`);
examples.forEach((e) => console.log('\n' + e));
