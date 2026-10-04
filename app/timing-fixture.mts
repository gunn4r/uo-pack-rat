// timing-fixture.mts — speed checks that time the code, not a busy CI runner (issue #195).
// A shared runner's neighbours steal the CPU in bursts, so one sample (or the best of a few taken back to back) can land
// entirely inside a burst and miss a budget the code meets easily. The standard cure is to warm up once (JIT, caches),
// then keep the FASTEST of several samples spread out a little in time: noise only ever adds time, so the minimum is the
// closest reading of the code's own cost. Sampling stops at the first run inside the budget, so a passing check costs one
// or two runs; a real regression is slow on every run and still fails, after `tries` of them.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Milliseconds one call of `fn` takes. */
export function msOf(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/**
 * The fastest of up to `tries` samples, after one untimed warm-up. `sample` runs the work once and returns how long it
 * took in ms (use `msOf` for in-process code; a browser test returns the time it measured inside the page).
 */
export async function fastestMs(sample: () => number | Promise<number>, budgetMs: number, tries = 10): Promise<number> {
  await sample();
  let best = Infinity;
  for (let i = 0; i < tries && best >= budgetMs; i++) {
    if (i) await pause(50);
    best = Math.min(best, await sample());
  }
  return best;
}
