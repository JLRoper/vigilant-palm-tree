// Per-frame error reporting for the rAF loop (src/managers/GameEngine.ts).
//
// The loop catches its own errors so one bad frame cannot kill the loop, but
// that turns a persistent fault into a 60x/second console flood. This
// suppresses *repeats of the same error* inside a window while still logging
// a genuinely new fault the moment it appears -- so "logs once per
// occurrence" rather than "logs once ever, which hides a second bug".

export const DEFAULT_FRAME_ERROR_MIN_INTERVAL_MS = 5_000;

function frameErrorKey(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export interface FrameErrorLog {
  /** Returns true when the error was actually logged (i.e. not suppressed). */
  report(error: unknown): boolean;
  /** Forget the last error, so the next occurrence always logs. */
  reset(): void;
}

export interface FrameErrorLogOptions {
  /** Suppress a repeat of the SAME error inside this window. Default 5000ms. */
  minIntervalMs?: number;
  now?: () => number;
  log?: (error: unknown) => void;
}

export function createFrameErrorLog(options: FrameErrorLogOptions = {}): FrameErrorLog {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_FRAME_ERROR_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((error: unknown) => console.error("[loop] frame failed:", error));
  let lastKey: string | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  return {
    report(error: unknown): boolean {
      const key = frameErrorKey(error);
      const at = now();
      if (key === lastKey && at - lastAt < minIntervalMs) return false;
      lastKey = key;
      lastAt = at;
      log(error);
      return true;
    },
    reset(): void {
      lastKey = null;
      lastAt = Number.NEGATIVE_INFINITY;
    },
  };
}