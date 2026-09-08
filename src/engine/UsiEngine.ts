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
  movetimeMs?: number;
  depth?: number;
}

export interface AnalyzeResult {
  bestMove: string | null;
  /** Centipawn score from the perspective of the side to move in the analyzed position. */
  scoreCp: number | null;
  /** Moves-to-mate if the engine found a forced mate (positive = side to move mates). */
  scoreMate: number | null;
  pv: string[];
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

  async analyze(sfen: string, moves: string[], opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    await this.ready;
    const posCmd = moves.length
      ? `position sfen ${sfen} moves ${moves.join(' ')}`
      : `position sfen ${sfen}`;
    this.postRaw(posCmd);

    let scoreCp: number | null = null;
    let scoreMate: number | null = null;
    let pv: string[] = [];
    let bestDepth = -1;
    const onInfo = (line: string) => {
      if (!line.startsWith('info')) return;
      // Une borne n'est qu'un résultat partiel de la fenêtre de recherche : sa
      // variante est tronquée et son score approximatif.
      if (/\b(lowerbound|upperbound)\b/.test(line)) return;

      const depthMatch = line.match(/\bdepth (\d+)/);
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : bestDepth;
      // Le moteur émet plusieurs itérations ; ne garder que la plus profonde
      // évite de retenir une ligne écourtée émise en fin de réflexion.
      if (depth < bestDepth) return;

      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (!cpMatch && !mateMatch && !pvMatch) return;

      bestDepth = depth;
      if (cpMatch) {
        scoreCp = parseInt(cpMatch[1], 10);
        scoreMate = null;
      }
      if (mateMatch) {
        scoreMate = parseInt(mateMatch[1], 10);
        scoreCp = null;
      }
      if (pvMatch) pv = pvMatch[1].trim().split(/\s+/);
    };
    this.addListener(onInfo);

    const movetime = opts.movetimeMs ?? 500;
    const goCmd = opts.depth ? `go depth ${opts.depth}` : `go movetime ${movetime}`;
    this.postRaw(goCmd);

    let bestmoveLine: string;
    try {
      bestmoveLine = await this.waitFor((line) => line.startsWith('bestmove'), movetime + 20000);
    } finally {
      this.removeListener(onInfo);
    }
    const bestMoveToken = bestmoveLine.split(/\s+/)[1] ?? null;
    const bestMove = bestMoveToken === 'resign' || bestMoveToken === 'win' ? null : bestMoveToken;
    return { bestMove, scoreCp, scoreMate, pv };
  }

  terminate(): void {
    this.module?.terminate();
    this.module = null;
  }
}
