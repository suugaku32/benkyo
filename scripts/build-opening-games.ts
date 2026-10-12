/*
 * Télécharge les parties du répertoire « parties humaines » depuis l'API
 * publique de Lishogi (https://lishogi.org/api).
 *
 *   npx tsx scripts/build-opening-games.ts
 *
 * Étapes : on prend les meilleurs joueurs du classement en temps réel, on
 * télécharge leurs parties classées (format ndjson, coups en USI), et on garde
 * pour chacune ses premiers coups et son résultat — rien d'autre : ni noms, ni
 * identifiants. Le résultat est écrit dans `src/play/openingGames.json`. C'est
 * l'application qui en tire l'arbre des coups et classe les parties par
 * stratégie (voir `src/play/tree.ts` et `strategy.ts`) : changer une règle de
 * classement ne demande donc pas de retélécharger.
 *
 * Réglages (variables d'environnement) :
 *   LISHOGI_PLAYERS    nombre de joueurs du classement        (défaut 60)
 *   LISHOGI_GAMES      parties téléchargées par joueur        (défaut 400)
 *   LISHOGI_MIN_RATING classement minimal des DEUX joueurs    (défaut 1700)
 *   GAME_PLIES         demi-coups conservés par partie        (défaut 30)
 *   TREE_MIN_GAMES     parties minimales pour écrire le fichier (défaut 200)
 *
 * L'API demande de ne faire qu'une requête à la fois et, après un 429, d'attendre
 * une minute : c'est ce que fait ce script.
 */
import { writeFileSync } from 'node:fs';

const BASE = process.env.LISHOGI_BASE ?? 'https://lishogi.org';
const PLAYERS = Number(process.env.LISHOGI_PLAYERS ?? 60);
const GAMES = Number(process.env.LISHOGI_GAMES ?? 400);
const MIN_RATING = Number(process.env.LISHOGI_MIN_RATING ?? 1700);
const PLIES = Number(process.env.GAME_PLIES ?? 30);
/** En dessous, le téléchargement a mal tourné (réseau bloqué, API changée) : on n'écrase pas le livre. */
const MIN_GAMES = Number(process.env.TREE_MIN_GAMES ?? 200);
const OUT = new URL('../src/play/openingGames.json', import.meta.url);

const HIRATE_BOARD = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL';
const UNFINISHED = new Set(['created', 'started', 'aborted', 'noStart']);
const USI_MOVE = /^([1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string, accept: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE + path, { headers: { Accept: accept } });
    if (res.status === 429) {
      console.log('  429 : attente d’une minute, comme le demande l’API');
      await sleep(61_000);
      continue;
    }
    if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`);
    return res;
  }
  throw new Error(`${path} : trop de 429`);
}

interface ApiGame {
  id: string;
  status?: string;
  winner?: 'sente' | 'gote';
  initialSfen?: string;
  moves?: string;
  players?: { sente?: { rating?: number }; gote?: { rating?: number } };
}

/** Qui a gagné : Sente, Gote, ou nulle. */
type Outcome = 'b' | 'w' | 'd';

// Une partie = ses premiers coups, et qui a gagné ('b' Sente, 'w' Gote, 'd' nulle).
const games: [string, Outcome][] = [];
const seen = new Set<string>();
let kept = 0;
let skipped = 0;

function record(game: ApiGame): void {
  if (!game.id || seen.has(game.id)) return;
  seen.add(game.id);
  if (game.status && UNFINISHED.has(game.status)) return void skipped++;
  if (game.initialSfen && game.initialSfen.split(' ')[0] !== HIRATE_BOARD) return void skipped++;
  const rs = game.players?.sente?.rating ?? 0;
  const rg = game.players?.gote?.rating ?? 0;
  if (rs < MIN_RATING || rg < MIN_RATING) return void skipped++;
  const moves = (game.moves ?? '').split(' ').filter(Boolean);
  if (moves.length < 20 || !moves.slice(0, PLIES).every((m) => USI_MOVE.test(m))) return void skipped++;
  const outcome: Outcome = game.winner === 'sente' ? 'b' : game.winner === 'gote' ? 'w' : 'd';
  games.push([moves.slice(0, PLIES).join(' '), outcome]);
  kept++;
}

async function main(): Promise<void> {
  console.log(`Classement : les ${PLAYERS} premiers joueurs en temps réel…`);
  const top = (await (await get(`/player/top/${Math.min(200, PLAYERS)}/realTime`, 'application/vnd.lishogi.v3+json')).json()) as {
    users: { username: string }[];
  };
  const names = top.users.map((u) => u.username).slice(0, PLAYERS);
  for (const [i, name] of names.entries()) {
    const before = kept;
    try {
      const res = await get(
        `/api/games/user/${encodeURIComponent(name)}?perfType=realTime&rated=true&moves=true&tags=false&max=${GAMES}`,
        'application/x-ndjson',
      );
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          record(JSON.parse(line) as ApiGame);
        } catch {
          // Ligne tronquée : on passe à la suivante.
        }
      }
    } catch (e) {
      console.log(`  ${name} : ${(e as Error).message}`);
    }
    console.log(`[${i + 1}/${names.length}] ${name} : +${kept - before} parties (total ${kept}, écartées ${skipped})`);
    await sleep(1500);
  }

  if (kept < MIN_GAMES) throw new Error(`Seulement ${kept} parties retenues (minimum ${MIN_GAMES}) : le fichier n'est pas écrit.`);

  const out = {
    meta: {
      source: 'lishogi.org (API)',
      games: kept,
      players: names.length,
      minRating: MIN_RATING,
      plies: PLIES,
      builtAt: new Date().toISOString(),
    },
    games,
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Écrit : ${kept} parties.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
