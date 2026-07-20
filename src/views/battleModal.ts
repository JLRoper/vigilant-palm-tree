import { openCenteredModal, styleButton } from "./menu";

export interface BattleModalOptions {
  attackerName: string;
  defenderName: string;
}

export type BattleModalResult = "resolve" | "cancel";

export function showBattleModal(opts: BattleModalOptions): Promise<BattleModalResult> {
  return new Promise<BattleModalResult>((resolve) => {
    const modal = openCenteredModal(document.body, "Battle!", 320);

    const intro = document.createElement("div");
    intro.textContent = `${opts.attackerName} vs ${opts.defenderName}`;
    intro.style.fontSize = "14px";
    intro.style.opacity = "0.9";
    intro.style.textAlign = "center";
    intro.style.margin = "4px 0 12px";
    modal.appendContent(intro);

    const note = document.createElement("div");
    note.textContent = "Resolve to award +50 gold to the attacker and remove the defender.";
    note.style.fontSize = "11px";
    note.style.opacity = "0.7";
    note.style.textAlign = "center";
    note.style.marginBottom = "12px";
    modal.appendContent(note);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";

    const flee = document.createElement("button");
    flee.textContent = "Flee";
    styleButton(flee);
    flee.addEventListener("click", () => {
      modal.close();
      resolve("cancel");
    });
    row.appendChild(flee);

    const resolveBtn = document.createElement("button");
    resolveBtn.textContent = "Resolve";
    styleButton(resolveBtn, true);
    resolveBtn.addEventListener("click", () => {
      modal.close();
      resolve("resolve");
    });
    row.appendChild(resolveBtn);

    modal.appendContent(row);
  });
}
