// restart-policy.mts — whether electron/main.mts restarts a server child that exited unexpectedly.
// Pure and electron-free for the same reason as host-args.mts, so scripts/electron-guards.test.mts can
// check it with real clock values.
//
// A crash is restarted unless the previous restart was less than RESTART_WINDOW_MS ago: a child that
// dies again straight after being restarted is crash-looping, and the shell gives up with a dialog
// instead of spinning. Crashes far apart are unrelated and each one is restarted, which a lifetime
// counter (what this replaced) got wrong: one crash at hour 1 and another at hour 5 quit the app.
export const RESTART_WINDOW_MS = 5 * 60 * 1000;

// `lastRestartAt` is when main.mts last restarted the child, or null if it never has.
export function shouldRestart(lastRestartAt: number | null, now: number): boolean {
  return lastRestartAt === null || now - lastRestartAt >= RESTART_WINDOW_MS;
}
