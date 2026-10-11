export interface EmscriptenEngineModule {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  removeMessageListener(cb: (line: string) => void): void;
  terminate(): void;
}

declare global {
  interface Window {
    YaneuraOu_K_P?: (
      moduleOverrides?: Record<string, unknown>,
    ) => Promise<EmscriptenEngineModule>;
  }
}

/**
 * Build mizar (@mizarjp/yaneuraou.k-p). Le réseau d'évaluation est embarqué dans
 * le wasm : pas de fichier .data à charger, et pas de risque de désaccord entre
 * binaire et réseau — c'est ce qui avait fait échouer un échange de réseau seul.
 */
const ENGINE_SCRIPT = 'yaneuraou.k-p.js';

/** Taille de la table de transposition, en mégaoctets. Voir `init()`. */
const HASH_MB = 32;

export interface AnalyzeOptions {
  /**
   * Durée de la recherche. Avec `depth`, c'est un plafond de sécurité : la
   * recherche s'arrête à la première des deux limites atteinte.
   */
  movetimeMs?: number;
  /**
   * Profondeur de recherche. Contrairement à une durée, elle ne dépend pas de la
   * vitesse de l'appareil : c'est elle qui donne la même force partout.
   */
  depth?: number;
  /**
   * Nombre de nœuds de recherche. Comme la profondeur, il ne dépend pas de la
   * vitesse de l'appareil — mais il se règle bien plus finement : une
   * profondeur de plus coûte plusieurs fois le travail de la précédente, alors
   * que le nombre de nœuds avance du simple au double aussi vite qu'on veut.
   */
  nodes?: number;
  /**
   * Nombre de meilleures lignes demandées au moteur (1 par défaut). Au-delà de
   * 1, `AnalyzeResult.lines` les liste dans l'ordre : c'est ce qui permet de
   * choisir un coup autre que le meilleur, pour jouer plus faiblement.
   */
  multiPv?: number;
}

/** Une des meilleures lignes de la recherche, telle que le moteur la classe. */
export interface AnalyzeLine {
  /** Premier coup de la ligne. */
  move: string;
  scoreCp: number | null;
  scoreMate: number | null;
  pv: string[];
}

export interface AnalyzeResult {
  bestMove: string | null;
  /** Centipawn score from the perspective of the side to move in the analyzed position. */
  scoreCp: number | null;
  /** Moves-to-mate if the engine found a forced mate (positive = side to move mates). */
  scoreMate: number | null;
  pv: string[];
  /** Profondeur atteinte par la meilleure ligne (0 si le moteur n'en a rien dit). */
  depth: number;
  /** Les `multiPv` meilleures lignes, de la meilleure à la moins bonne. Toujours au moins une si le moteur a trouvé un coup. */
  lines: AnalyzeLine[];
}

let scriptLoadPromise: Promise<void> | null = null;

function engineBaseUrl(): string {
  return `${import.meta.env.BASE_URL}engine/`;
}

function loadEngineScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.YaneuraOu_K_P) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `${engineBaseUrl()}${ENGINE_SCRIPT}`;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(`Impossible de charger le moteur d'analyse (${ENGINE_SCRIPT} introuvable).`),
      );
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface EnvironmentReport {
  /** The engine cannot run at all in this browser as things stand. */
  blocking: boolean;
  messages: string[];
}

/**
 * The engine is compiled with pthreads, so its WebAssembly memory is shared and
 * it simply cannot instantiate without SharedArrayBuffer — which browsers only
 * expose to cross-origin-isolated pages.
 */
export function engineEnvironment(): EnvironmentReport {
  const messages: string[] = [];

  if (typeof WebAssembly === 'undefined') {
    return { blocking: true, messages: ['Ce navigateur ne supporte pas WebAssembly.'] };
  }

  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  const isolated = window.crossOriginIsolated === true;
  if (hasSab && isolated) return { blocking: false, messages: [] };

  const swSupported = 'serviceWorker' in navigator;
  const swControlling = swSupported && navigator.serviceWorker.controller !== null;

  if (!window.isSecureContext) {
    messages.push(
      "La page n'est pas servie en HTTPS, ce que l'isolation cross-origin exige. Ouvrez le site en https://.",
    );
    return { blocking: true, messages };
  }

  if (!swSupported) {
    messages.push(
      "Ce navigateur n'expose pas les service workers (navigation privée ?), qui sont nécessaires ici pour activer l'isolation cross-origin.",
    );
    return { blocking: true, messages };
  }

  if (!swControlling) {
    messages.push(
      "Le service worker vient de s'installer et ne contrôle pas encore la page. Rechargez pour activer le moteur.",
    );
    return { blocking: true, messages };
  }

  // Service worker in place but still no isolation: the browser is refusing the
  // headers rather than missing them.
  messages.push(
    "Le service worker est actif mais ce navigateur n'accorde pas l'isolation cross-origin, sans laquelle le moteur ne peut pas démarrer.",
  );
  messages.push(
    "Safari sur iPhone et iPad est le cas le plus courant : essayez Chrome ou Firefox, ou un ordinateur.",
  );
  return { blocking: true, messages };
}

export class UsiEngine {
  private module: EmscriptenEngineModule | null = null;
  private listeners: Set<(line: string) => void> = new Set();
  readonly ready: Promise<void>;
  /**
   * Fin de la dernière recherche demandée. Le moteur n'a qu'un seul état de
   * position : deux `analyze` entrelacés se volent mutuellement le `bestmove`.
   * Les mettre en file permet à l'analyse de la partie de tourner en tâche de
   * fond pendant qu'on explore — l'exploration passe entre deux positions.
   */
  private queue: Promise<unknown> = Promise.resolve();
  /** Valeur de `MultiPV` déjà envoyée au moteur : inutile de la renvoyer à chaque recherche. */
  private multiPv = 1;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const env = engineEnvironment();
    if (env.blocking) {
      // Fail with the diagnosis rather than letting the emscripten glue throw a
      // bare "Can't find variable: SharedArrayBuffer" at the user.
      throw new Error(env.messages.join(' '));
    }
    await loadEngineScript();
    const factory = window.YaneuraOu_K_P;
    if (!factory) {
      throw new Error("Le moteur d'analyse n'a pas pu s'initialiser (YaneuraOu_K_P introuvable).");
    }
    this.module = await factory({
      locateFile: (path: string) => `${engineBaseUrl()}${path}`,
    });
    this.module.addMessageListener((line) => {
      for (const cb of this.listeners) cb(line);
    });
    this.postRaw('usi');
    await this.waitFor((line) => line === 'usiok');
    // Le défaut du moteur est 1024 Mo, ce qui fait grossir le tas WebAssembly à
    // ~1,2 Go dès `isready` — intenable sur mobile. Mesuré : 32 Mo suffisent
    // largement pour des réflexions de 200 ms à 2 s (le tas reste sous 170 Mo).
    this.postRaw(`setoption name USI_Hash value ${HASH_MB}`);
    this.postRaw('isready');
    await this.waitFor((line) => line === 'readyok');
    this.postRaw('usinewgame');
  }

  private addListener(cb: (line: string) => void): void {
    this.listeners.add(cb);
  }

  private removeListener(cb: (line: string) => void): void {
    this.listeners.delete(cb);
  }

  private postRaw(cmd: string): void {
    if (!this.module) throw new Error('Moteur non initialisé.');
    this.module.postMessage(cmd);
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 20000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(onLine);
        reject(new Error("Le moteur d'analyse ne répond pas (délai dépassé)."));
      }, timeoutMs);
      const onLine = (line: string) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.removeListener(onLine);
          resolve(line);
        }
      };
      this.addListener(onLine);
    });
  }

  analyze(sfen: string, moves: string[], opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    const run = this.queue.then(() => this.analyzeNow(sfen, moves, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async analyzeNow(
    sfen: string,
    moves: string[],
    opts: AnalyzeOptions,
  ): Promise<AnalyzeResult> {
    await this.ready;
    const wanted = Math.max(1, Math.round(opts.multiPv ?? 1));
    if (wanted !== this.multiPv) {
      this.postRaw(`setoption name MultiPV value ${wanted}`);
      this.multiPv = wanted;
    }
    const posCmd = moves.length
      ? `position sfen ${sfen} moves ${moves.join(' ')}`
      : `position sfen ${sfen}`;
    this.postRaw(posCmd);

    /*
     * Une entrée par ligne (`multipv N`), chacune avec sa propre profondeur : le
     * moteur émet plusieurs itérations, et ne garder que la plus profonde évite
     * de retenir une ligne écourtée émise en fin de réflexion. Sans option
     * MultiPV, il n'y a que la ligne 1 et le comportement est celui d'avant.
     */
    const found = new Map<
      number,
      { depth: number; scoreCp: number | null; scoreMate: number | null; pv: string[] }
    >();
    const onInfo = (line: string) => {
      if (!line.startsWith('info')) return;
      // Une borne n'est qu'un résultat partiel de la fenêtre de recherche : sa
      // variante est tronquée et son score approximatif.
      if (/\b(lowerbound|upperbound)\b/.test(line)) return;

      const idxMatch = line.match(/\bmultipv (\d+)/);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : 1;
      const previous = found.get(idx);

      const depthMatch = line.match(/\bdepth (\d+)/);
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : (previous?.depth ?? -1);
      if (previous && depth < previous.depth) return;

      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (!cpMatch && !mateMatch && !pvMatch) return;

      const entry = previous ?? { depth, scoreCp: null, scoreMate: null, pv: [] };
      entry.depth = depth;
      if (cpMatch) {
        entry.scoreCp = parseInt(cpMatch[1], 10);
        entry.scoreMate = null;
      }
      if (mateMatch) {
        entry.scoreMate = parseInt(mateMatch[1], 10);
        entry.scoreCp = null;
      }
      if (pvMatch) entry.pv = pvMatch[1].trim().split(/\s+/);
      found.set(idx, entry);
    };
    this.addListener(onInfo);

    /*
     * Une profondeur seule n'a pas de durée garantie : sur un appareil lent ou
     * dans une position ouverte, elle peut prendre bien plus longtemps que
     * prévu. Le plafond de temps, s'il est donné, borne le pire cas sans
     * changer le cas ordinaire.
     */
    const limits: string[] = [];
    const bounded = Boolean(opts.depth || opts.nodes);
    if (opts.depth) limits.push(`depth ${opts.depth}`);
    if (opts.nodes) limits.push(`nodes ${opts.nodes}`);
    if (opts.movetimeMs || !bounded) limits.push(`movetime ${opts.movetimeMs ?? 500}`);
    this.postRaw(`go ${limits.join(' ')}`);
    const patience = (opts.movetimeMs ?? (bounded ? 120000 : 500)) + 20000;

    let bestmoveLine: string;
    try {
      bestmoveLine = await this.waitFor((line) => line.startsWith('bestmove'), patience);
    } finally {
      this.removeListener(onInfo);
    }
    const bestMoveToken = bestmoveLine.split(/\s+/)[1] ?? null;
    const bestMove = bestMoveToken === 'resign' || bestMoveToken === 'win' ? null : bestMoveToken;

    const lines: AnalyzeLine[] = [...found.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, e]) => e.pv.length > 0)
      .slice(0, wanted)
      .map(([, e]) => ({ move: e.pv[0], scoreCp: e.scoreCp, scoreMate: e.scoreMate, pv: e.pv }));
    const main = found.get(1);
    return {
      bestMove,
      scoreCp: main?.scoreCp ?? null,
      scoreMate: main?.scoreMate ?? null,
      pv: main?.pv ?? [],
      depth: main?.depth ?? 0,
      lines,
    };
  }

  terminate(): void {
    this.module?.terminate();
    this.module = null;
  }
}
