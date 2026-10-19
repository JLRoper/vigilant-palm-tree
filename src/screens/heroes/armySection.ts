import type { Platoon } from "../../state/units";
import { AccordionSection } from "@screens/shared/panelWidgets";
import { SquadGrid } from "@screens/shared/squadGrid";

export type ReorderHandler = (fromIdx: number, toIdx: number) => void;

export interface ArmySectionOptions {
  onReorder?: ReorderHandler;
  onToggle?: () => void;
}

/**
 * The hero panel's "Army" accordion: a square-tile grid over the hero's eight
 * army slots. The tiles themselves are the shared `SquadGrid` (the same one the
 * garrison grids use), so the hero's army and every garrison in the UI are one
 * representation.
 */
export class ArmySection {
  readonly element: HTMLDivElement;

  private readonly accordion: AccordionSection;
  private readonly grid: SquadGrid;

  constructor(opts: ArmySectionOptions = {}) {
    this.accordion = new AccordionSection({ label: "Army", onToggle: opts.onToggle });
    this.grid = new SquadGrid({
      gridId: "hero-army",
      onReorder: (fromIdx, toIdx) => opts.onReorder?.(fromIdx, toIdx),
    });
    this.element = this.accordion.element;
    this.accordion.body.appendChild(this.grid.element);
  }

  render(stacks: Platoon[]): void {
    this.grid.setInteractive(true);
    this.accordion.rightEl.textContent = "8 slots";
    this.grid.render(stacks);
  }
}
