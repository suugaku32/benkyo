/*
 * Le choix du coup de l'adversaire : sa fréquence de meilleur coup, la fenêtre
 * dans laquelle il s'écarte, et le fait qu'il ne tombe jamais dans un mat.
 */
import {
  CUSTOM_LEVEL_ID,
  DEFAULT_CUSTOM,
  DEFAULT_LEVEL_ID,
  LEVELS,
  LOSS_CHOICES,
  NODE_CHOICES,
  chooseMove,
  formatNodes,
  levelById,
  resolveLevel,
  sanitizeCustom,
} from '../src/play/opponent';
import type { AnalyzeLine } from '../src/engine/UsiEngine';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// Générateur déterministe (mulberry32) : un test qui échoue doit échouer toujours.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cp = (move: string, scoreCp: number): AnalyzeLine => ({ move, scoreCp, scoreMate: null, pv: [move] });
const mate = (move: string, scoreMate: number): AnalyzeLine => ({ move, scoreCp: null, scoreMate, pv: [move] });

const lines = [cp('a', 100), cp('b', 60), cp('c', -20), cp('d', -400)];

console.log('=== Fréquence du meilleur coup ===');
for (const level of LEVELS) {
  // Les alternatives les plus proches du meilleur sont à 40 cp : en dessous, aucune n'est admise.
  if (level.pBest < 1 && level.maxLossCp < 40) continue;
  const rng = seeded(42);
  const N = 4000;
  let best = 0;
  for (let i = 0; i < N; i++) if (chooseMove(lines, level, rng) === 'a') best++;
  const rate = best / N;
  // Un coup écarté peut aussi retomber sur le meilleur : ici jamais, il est exclu des alternatives.
  check(`${level.label} : meilleur coup ≈ ${level.pBest}`, Math.abs(rate - level.pBest) < 0.03, rate.toFixed(3));
}

console.log('=== Fenêtre de perte ===');
{
  const medium = levelById('medium'); // 150 cp
  const rng = seeded(7);
  const seen = new Set<string>();
  for (let i = 0; i < 3000; i++) seen.add(chooseMove(lines, medium, rng)!);
  check('moyen : b (−40) et c (−120) possibles', seen.has('b') && seen.has('c'));
  check('moyen : d (−500) jamais joué', !seen.has('d'));
}
{
  const novice = levelById('novice'); // 400 cp
  const rng = seeded(7);
  const seen = new Set<string>();
  for (let i = 0; i < 3000; i++) seen.add(chooseMove(lines, novice, rng)!);
  check('débutant : d (−500) reste hors fenêtre', !seen.has('d'));
}

console.log('=== Les écarts proches sont les plus probables ===');
{
  const rng = seeded(3);
  let b = 0;
  let c = 0;
  for (let i = 0; i < 6000; i++) {
    const m = chooseMove(lines, levelById('medium'), rng);
    if (m === 'b') b++;
    if (m === 'c') c++;
  }
  check('b (−40) plus fréquent que c (−120)', b > c, `b=${b} c=${c}`);
}

console.log('=== Mats ===');
{
  // Il peut mater : les alternatives non matantes sont très loin du meilleur coup.
  const winning = [mate('m', 3), cp('x', 900), cp('y', 800)];
  const rng = seeded(1);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(chooseMove(winning, levelById('novice'), rng)!);
  check('mat disponible : joué à tous les niveaux', seen.size === 1 && seen.has('m'), [...seen].join(','));
}
{
  // Il ne se jette pas dans un mat pour « jouer moins bien ».
  const dangerous = [cp('safe', -50), mate('mated', -2)];
  const rng = seeded(1);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(chooseMove(dangerous, levelById('novice'), rng)!);
  check('jamais un coup qui perd par mat', !seen.has('mated'));
}

console.log('=== Cas limites ===');
check('aucune ligne : null', chooseMove([], levelById('medium')) === null);
check('une seule ligne : elle-même', chooseMove([cp('only', 0)], levelById('novice'), seeded(5)) === 'only');
check('maître : toujours le meilleur', (() => {
  const rng = seeded(9);
  for (let i = 0; i < 500; i++) if (chooseMove(lines, levelById('n29'), rng) !== 'a') return false;
  return true;
})());
check('niveau inconnu : repli sur le niveau par défaut', levelById('???').id === DEFAULT_LEVEL_ID);

console.log('=== Le barème ===');
{
  check('trente niveaux', LEVELS.length === 30);
  check('identifiants uniques', new Set(LEVELS.map((l) => l.id)).size === LEVELS.length);
  let ordered = true;
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    if (!(b.nodes > a.nodes && b.pBest >= a.pBest && b.maxLossCp <= a.maxLossCp)) ordered = false;
  }
  check('chaque palier cherche plus, joue mieux et s’écarte moins', ordered);
  check('premier palier : peu de nœuds', LEVELS[0].nodes <= 10);
  const top = LEVELS[LEVELS.length - 1];
  check('dernier palier : toujours le meilleur coup', top.pBest === 1 && top.multiPv === 1);
  check(
    'niveaux espacés d’environ ×1,5 (jamais plus de ×2)',
    LEVELS.every((l, i) => i === 0 || (l.nodes / LEVELS[i - 1].nodes <= 2 && l.nodes / LEVELS[i - 1].nodes >= 1.3)),
  );
  check(
    'profondeur du répertoire : de 4 à 24 demi-coups, croissante',
    LEVELS[0].bookPlies === 4 && LEVELS[LEVELS.length - 1].bookPlies === 24 && LEVELS.every((l, i) => i === 0 || l.bookPlies >= LEVELS[i - 1].bookPlies),
  );
  check('étiquettes uniques', new Set(LEVELS.map((l) => l.label)).size === LEVELS.length);
  check('chaque palier a de quoi trouver des alternatives sauf le meilleur coup assuré', LEVELS.every((l) => (l.pBest >= 1 ? true : l.multiPv >= 2)));
  check(
    'anciens identifiants : même force qu’avant',
    Math.abs(Math.log(levelById('medium').nodes / 3000)) < 0.3 &&
      Math.abs(Math.log(levelById('l9').nodes / 100_000)) < 0.3 &&
      Math.abs(Math.log(levelById('master').nodes / 1_000_000)) < 0.3,
  );
}

console.log('=== Niveau personnalisé ===');
{
  const lvl = resolveLevel(CUSTOM_LEVEL_ID, { nodes: 30_000, pBest: 0.25, maxLossCp: 250 });
  check('reprend les réglages', lvl.nodes === 30_000 && lvl.pBest === 0.25 && lvl.maxLossCp === 250);
  check('cherche des alternatives quand il peut se tromper', lvl.multiPv >= 2);
  check('une seule ligne quand il joue toujours le meilleur', resolveLevel(CUSTOM_LEVEL_ID, { nodes: 1000, pBest: 1, maxLossCp: 60 }).multiPv === 1);
  check('un palier se résout sans toucher aux réglages libres', resolveLevel('n4', DEFAULT_CUSTOM).id === 'n4');
  const dirty = sanitizeCustom({ nodes: 12345, pBest: 7, maxLossCp: -3 });
  check('valeur de stockage corrompue : nœuds ramenés au défaut', NODE_CHOICES.includes(dirty.nodes) && dirty.nodes === DEFAULT_CUSTOM.nodes);
  check('pBest borné à 1', dirty.pBest === 1);
  check('écart ramené à un choix proposé', LOSS_CHOICES.includes(dirty.maxLossCp));
  check('stockage vide : réglages par défaut', JSON.stringify(sanitizeCustom(null)) === JSON.stringify(DEFAULT_CUSTOM));
  check('formatNodes : 1 000 000', formatNodes(1_000_000) === '1 000 000');
}

console.log(failures === 0 ? '\nTout concorde.' : `\n${failures} écart(s).`);
process.exit(failures === 0 ? 0 : 1);
