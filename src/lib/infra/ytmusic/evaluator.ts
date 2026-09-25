// JavaScript evaluator for youtubei.js signature deciphering.
//
// youtubei.js v18 ships WITHOUT a JS interpreter: `Platform.shim.eval` is a
// stub that throws "you must provide your own JavaScript evaluator", which
// makes every stream-URL decipher fail (i.e. all playback fails). We run
// inside a real browser engine, so the evaluator is trivial: execute the
// generated script with `new Function` (a function body legally contains the
// script's top-level `return process(...)`) and hand back its result.
//
// Scope note: the generated code is YouTube's own player decipher routine
// (pure string shuffling, no DOM access). Proven byte-for-byte via range
// requests during development.

import { Platform } from 'youtubei.js';

let installed = false;

export function installEvaluator(): void {
  if (installed) return;
  installed = true;
  const shim = Platform.shim as unknown as Record<string, unknown>;
  Platform.load({
    ...shim,
    eval: async (data: { output: string }) => {
      const run = new Function(data.output) as () => unknown;
      return run() as Record<string, unknown>;
    },
  } as never);
}
