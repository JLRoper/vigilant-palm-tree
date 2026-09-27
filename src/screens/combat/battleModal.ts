import { openCenteredModal, styleButton } from "@screens/shared/menu";

export interface BattleModalOptions {
  attackerName: string;
  defenderName: string;
}

// Three paths since the manual arena was wired in as the default collision
// outcome (plan/2026-09-27-manual-battle-wiring.md, decisions locked
// 2026-09-27 + work item 1): "fight" opens the tactical arena with the real
// armies, "quickResolve" runs the server auto-resolver (the old "Resolve"),
// "cancel" flees the pre-battle position (unchanged semantics).
export type BattleModalResult = "fight" | "quickResolve" | "cancel";

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
    note.textContent =
      "Fight to command your armies on the tactical battlegrid yourself, or Quick Resolve to settle it immediately by unit strength and type matchups. Fleeing cancels your move.";
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

    // The old "Resolve" button, relabeled to make room for Fight as the
    // primary — same server auto-resolver behind it as before.
    const quickResolve = document.createElement("button");
    quickResolve.textContent = "Quick Resolve";
    styleButton(quickResolve);
    quickResolve.addEventListener("click", () => {
      modal.close();
      resolve("quickResolve");
    });
    row.appendChild(quickResolve);

    // Fight is the default collision outcome (decision 1): the manual arena
    // opens with the two heroes' real armies.
    const fight = document.createElement("button");
    fight.textContent = "Fight";
    styleButton(fight, true);
    fight.addEventListener("click", () => {
      modal.close();
      resolve("fight");
    });
    row.appendChild(fight);

    modal.appendContent(row);
  });
}
