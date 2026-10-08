// JavaScript evaluator for youtubei.js signature deciphering.
//
// youtubei.js v18 ships WITHOUT a JS interpreter: `Platform.shim.eval` is a
// stub that throws "you must provide your own JavaScript evaluator", which
// makes every stream-URL decipher fail (i.e. all playback fails). We run
// inside a real browser engine, so the evaluator executes the generated script
// with `new Function` (a function body legally contains the script's top-level
// `return process(...)`) and hands back its `{ sig, n }` result.
//
// Isolation: the script is code extracted from YouTube's player JS, fetched at
// run time. It is pure string shuffling, but it is still remote code, so it runs
// in a dedicated **Web Worker** rather than the page: a worker has no DOM, no
// `window.__TAURI_INTERNALS__` and therefore no IPC — it cannot call the
// keychain, the HTTP relay or any other command even if the fetched code were
// ever malicious. Each evaluation is time-boxed; a script that hangs gets its
// worker terminated (and replaced) instead of freezing playback forever.
//
// Only where `Worker` is unavailable (unit tests, very old engines) does it
// fall back to evaluating in the page.

// `youtubei.js` is imported lazily (see InnertubeClient) so the app shell can
// paint before the large player/client code is parsed. Only the type is needed
// here, which TypeScript erases at build time.
type Platform = typeof import('youtubei.js')['Platform'];

/** Generous: a decipher normally takes a few milliseconds. */
const EVAL_TIMEOUT_MS = 10_000;

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const { id, code } = event.data;
  try {
    const value = new Function(code)();
    self.postMessage({ id, ok: true, value });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
};
`;

type Evaluate = (code: string) => Promise<unknown>;

interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
}
export type WorkerFactory = () => WorkerLike;

/** Evaluate in the page (fallback only — see the module notes). */
export const evaluateInline: Evaluate = async (code) => {
  const run = new Function(code) as () => unknown;
  return run();
};

/**
 * Build an evaluator backed by workers from `createWorker`. Requests are
 * multiplexed over one worker; a timeout or crash rejects everything in flight
 * and the next call starts a fresh worker.
 */
export function createWorkerEvaluator(
  createWorker: WorkerFactory,
  timeoutMs = EVAL_TIMEOUT_MS,
): Evaluate {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const failAll = (message: string) => {
    for (const [id, entry] of waiting) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
      waiting.delete(id);
    }
  };
  const discard = (message: string) => {
    worker?.terminate();
    worker = null;
    failAll(message);
  };

  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; value?: unknown; error?: string };
      const entry = waiting.get(data.id);
      if (!entry) return;
      waiting.delete(data.id);
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.value);
      else entry.reject(new Error(`player script failed: ${data.error}`));
    };
    w.onerror = () => discard('player script worker crashed');
    worker = w;
    return w;
  };

  return (code) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (!waiting.has(id)) return;
        // A hung script blocks its worker for good; replace the worker.
        discard('player script timed out');
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      try {
        ensure().postMessage({ id, code });
      } catch (e) {
        clearTimeout(timer);
        waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
}

function blobWorkerFactory(): WorkerFactory | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return null;
  }
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  return () => new Worker(url) as unknown as WorkerLike;
}

/** The evaluator the app uses: sandboxed when possible. */
export function defaultEvaluator(): Evaluate {
  const factory = blobWorkerFactory();
  return factory ? createWorkerEvaluator(factory) : evaluateInline;
}

let installed = false;

export function installEvaluator(Platform: Platform): void {
  if (installed) return;
  installed = true;
  const evaluate = defaultEvaluator();
  const shim = Platform.shim as unknown as Record<string, unknown>;
  Platform.load({
    ...shim,
    eval: async (data: { output: string }) => (await evaluate(data.output)) as Record<string, unknown>,
  } as never);
}
