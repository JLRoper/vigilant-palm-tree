// Shown when a hand-fought battle's result could not be recorded server-side
// (plan/2026-10-21-battle-retreat-rules.md §1). Before this card existed the
// arena overlay simply stayed up with no way out. Closing the card -- by its
// button, the dialog's own close, or Escape -- always runs onReturnToMap, so
// the caller's arena teardown can never be skipped.

import { styleButton } from "@screens/shared/panel";
import { openDialog } from "@screens/shared/dialog";

export interface BattleSubmitFailedCardOptions {
  reason: string;
  onReturnToMap: () => void;
}

export function battleSubmitFailedMessage(reason: string): string {
  return (
    "The server did not accept this battle's result, so it was not recorded. " +
    "Your hero returns to where they started the move.\n\n" +
    `Reason: ${reason}`
  );
}

export function showBattleSubmitFailedCard(opts: BattleSubmitFailedCardOptions): void {
  const modal = openDialog(document.body, "Couldn't record this battle", 420, false, false);
  const wrapper = modal.root.parentElement;
  modal.setOnClose(() => {
    wrapper?.remove();
    opts.onReturnToMap();
  });

  const msg = document.createElement("div");
  msg.textContent = battleSubmitFailedMessage(opts.reason);
  Object.assign(msg.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    whiteSpace: "pre-line",
  });
  modal.appendContent(msg);

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
