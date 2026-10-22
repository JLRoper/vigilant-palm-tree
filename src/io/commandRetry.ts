import { CommandError } from "./commands";

// Retry wrapper for commands that must not be silently dropped -- the manual
// arena's SubmitBattleResult / SubmitSettlementBattleResult, where the player
// has already fought the battle out by hand (plan/2026-10-21-battle-retreat-
// rules.md §1). A CommandError carrying a 4xx is the server's considered
// rejection (not_adjacent, forbidden_not_your_turn, ...): resending the same
// payload gets the same answer, so it fails fast. A 5xx rolls the command's
// transaction back (handleCommandTransactional) and a network/timeout error
// never produced a verdict, so those are retried with the identical payload.
// A resend after a lost-response success is rejected by the server's own
// battle preconditions (the pair is no longer adjacent / a side is gone), so
// a duplicate never applies twice.

export type CommandAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; transient: boolean };

export const COMMAND_RETRY_DELAYS_MS: readonly number[] = [400, 1200];

export function isTransientCommandError(err: unknown): boolean {
  if (err instanceof CommandError) return err.status >= 500;
  return true;
}

export function commandErrorReason(err: unknown): string {
  if (err instanceof CommandError) return err.reason;
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export async function sendWithRetry<T>(
  send: () => Promise<T>,
  options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CommandAttempt<T>> {
  const delays = options.delaysMs ?? COMMAND_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, value: await send() };
    } catch (err) {
      const transient = isTransientCommandError(err);
      if (!transient || attempt >= delays.length) {
        return { ok: false, reason: commandErrorReason(err), transient };
      }
      await sleep(delays[attempt]);
    }
  }
}
