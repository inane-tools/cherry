import { describe, expect, it, vi } from 'vitest';
import { createWorkerEvaluator, evaluateInline, type WorkerFactory } from './evaluator';

/**
 * A stand-in for a Web Worker that runs the same protocol on the main thread
 * (jsdom has no Worker). `hang` simulates a script that never returns.
 */
function fakeWorkers(options: { hang?: boolean } = {}) {
  const created: { terminated: boolean }[] = [];
  const factory: WorkerFactory = () => {
    const state = { terminated: false };
    created.push(state);
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      postMessage(message: unknown) {
        const { id, code } = message as { id: number; code: string };
        if (options.hang) return;
        queueMicrotask(() => {
          if (state.terminated) return;
          let data: unknown;
          try {
            data = { id, ok: true, value: new Function(code)() };
          } catch (error) {
            data = { id, ok: false, error: String((error as Error).message) };
          }
          worker.onmessage?.({ data } as MessageEvent);
        });
      },
      terminate() {
        state.terminated = true;
      },
    };
    return worker;
  };
  return { factory, created };
}

const DECIPHER = 'function process(n){return {n: n.split("").reverse().join(""), sig: "s"}} return process("abc");';

describe('evaluator', () => {
  it('evaluates inline as a fallback', async () => {
    expect(await evaluateInline(DECIPHER)).toEqual({ n: 'cba', sig: 's' });
  });

  it('returns the script result through the worker protocol', async () => {
    const { factory, created } = fakeWorkers();
    const evaluate = createWorkerEvaluator(factory);
    expect(await evaluate(DECIPHER)).toEqual({ n: 'cba', sig: 's' });
    expect(await evaluate('return 1 + 1')).toBe(2);
    // One worker serves every request.
    expect(created).toHaveLength(1);
  });

  it('surfaces a script error as a rejection', async () => {
    const { factory } = fakeWorkers();
    const evaluate = createWorkerEvaluator(factory);
    await expect(evaluate('throw new Error("boom")')).rejects.toThrow(/boom/);
  });

  it('terminates a hung worker and starts a fresh one', async () => {
    vi.useFakeTimers();
    try {
      const hung = fakeWorkers({ hang: true });
      const evaluate = createWorkerEvaluator(hung.factory, 50);
      const pending = evaluate('while (true) {}');
      vi.advanceTimersByTime(60);
      await expect(pending).rejects.toThrow(/timed out/);
      expect(hung.created[0].terminated).toBe(true);
      void evaluate('return 1').catch(() => undefined);
      expect(hung.created).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
