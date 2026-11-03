// "This fight was voided" -- the card the client shows when the server
// force-resolved a battle the player was still in (server/app/aiDriver.ts's
// AI_DEFENDER_WAIT_TIMEOUT_MS fired: the fight went quiet for longer than the
// idle window). It replaces the old dead end, where the played-out fight was
// POSTed anyway and came back as "Couldn't record this battle": the player is
// now told plainly that the server settled it, what the server's outcome was,
// and that the map already holds that result.
//
// Closing the card -- button, the dialog's own close, or Escape -- always runs
// onReturnToMap, so the caller's teardown can never be skipped (the
// battleSubmitFailedCard contract).

import { styleButton } from "@screens/shared/panel";
import { openDialog } from "@screens/shared/dialog";
import type { HeroBattleResolvedPayload } from "./serverVoidedBattle";

export const BATTLE_VOIDED_TITLE = "This fight was voided";

export function battleVoidedMessage(): string {
  return (
    "The server resolved this battle before your result arrived, so the fight you played was not " +
    "recorded — a battle that goes quiet for longer than the wait deadline is settled by the server " +
    "instead of waiting forever.\n\n" +
    "The map shows the server's outcome, not the one you played."
  );
}

export interface BattleVoidedCardOptions {
  /** The server's own BattleResolved payload, when the client saw it land. */
  payload?: HeroBattleResolvedPayload | null;
  attackerLabel: string;
  defenderLabel: string;
  onReturnToMap: () => void;
}

/** The server's verdict lines, reusing the shared wording helper. */
export async function battleVoidedOutcomeLines(
  payload: HeroBattleResolvedPayload | null | undefined,
  attackerLabel: string,
  defenderLabel: string,
): Promise<string[]> {
  if (!payload) return [];
  const { battleVerdictCardLine } = await import("./battleResultText");
  const lines: string[] = [];
  const attacker = battleVerdictCardLine(attackerLabel, payload.attackerVerdict);
  if (attacker) lines.push(`Server's result — ${attacker}`);
  const defender = battleVerdictCardLine(defenderLabel, payload.defenderVerdict);
  if (defender) lines.push(`Server's result — ${defender}`);
  return lines;
}

export function showBattleVoidedCard(opts: BattleVoidedCardOptions): void {
  const modal = openDialog(document.body, BATTLE_VOIDED_TITLE, 460, false, false);
  const wrapper = modal.root.parentElement;
  modal.setOnClose(() => {
    wrapper?.remove();
    opts.onReturnToMap();
  });

  const msg = document.createElement("div");
  msg.textContent = battleVoidedMessage();
  Object.assign(msg.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    whiteSpace: "pre-line",
  });
  modal.appendContent(msg);

  void (async () => {
    const lines = await battleVoidedOutcomeLines(opts.payload, opts.attackerLabel, opts.defenderLabel);
    for (const line of lines) {
      const el = document.createElement("div");
      el.textContent = line;
      Object.assign(el.style, {
        fontSize: "12px",
        color: "rgba(241,228,195,0.85)",
        marginTop: "6px",
      });
      modal.appendContent(el);
    }
  })();

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.marginTop = "12px";
  const back = document.createElement("button");
  back.textContent = "Return to map";
  styleButton(back, true);
  back.addEventListener("click", () => modal.close());
  row.appendChild(back);
  modal.appendContent(row);
}
