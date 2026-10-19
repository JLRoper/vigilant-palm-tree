import type { GameState, HeroState, SettlementState } from "../../state/gameState";
import { settlementStacks, type Platoon } from "../../state/units";
import { SquadGrid } from "@screens/shared/squadGrid";

// The garrison, as one reusable representation. The settlement info panel's
// Garrison accordion mounts this and so does the recruitment panel, so both
// always show the same tiles, the same counts and the same drag affordances --
// a change made through either surface lands in the same engine state and both
// re-render from it (a change to the garrison UI is one edit here, not two).
//
// Troops are the shared square tiles (SquadGrid, the hero panel's Army art):
// dragging a tile inside one grid reorders that grid's slots, and dragging
// between the garrison grid and the hero grid below it moves the whole platoon
// (one TransferUnits per unit type, into the dropped slot).

export type GarrisonTransferDirection = "toHero" | "toGarrison";

export interface GarrisonTransferRequest {
  heroId: string;
  settlementId: string;
  direction: GarrisonTransferDirection;
  unitTypeId: string;
  count: number;
  /** Target platoon slot on the receiving side (the dropped tile). */
  toSlot?: number;
}

export interface GarrisonViewOptions {
  /** Commits one unit-type move; returns whether it landed. */
  onTransfer?: (req: GarrisonTransferRequest) => boolean;
  /** The hero (if any) standing on the settlement's tile. */
  getHeroesAtSettlement?: (settlementId: string) => HeroState[];
  /** Swap two garrison slots. */
  onReorderGarrison?: (settlementId: string, fromIdx: number, toIdx: number) => boolean;
  /** Swap two hero-army slots. */
  onReorderHero?: (heroId: string, fromIdx: number, toIdx: number) => boolean;
}

/**
 * One aggregated row per distinct unit type across a platoon set -- the transfer
 * engine addresses both sides as a type-keyed pool, and the grid tiles carry a
 * whole platoon, so a drag expands to one move per entry type.
 */
export function stackTotals(stacks: Platoon[]): Array<{ unitTypeId: string; count: number }> {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const p of stacks) {
    for (const e of p.entries) {
      if (e.count <= 0) continue;
      const prev = totals.get(e.unitTypeId) ?? 0;
      if (prev === 0) order.push(e.unitTypeId);
      totals.set(e.unitTypeId, prev + e.count);
    }
  }
  return order.map((unitTypeId) => ({ unitTypeId, count: totals.get(unitTypeId) ?? 0 }));
}

export class GarrisonView {
  readonly root: HTMLDivElement;

  private readonly garrisonGrid: SquadGrid;
  private readonly heroGrid: SquadGrid;
  private readonly heroHeader: HTMLDivElement;
  private readonly heroEmpty: HTMLDivElement;
  private readonly onTransfer?: (req: GarrisonTransferRequest) => boolean;
  private readonly getHeroesAtSettlement?: (settlementId: string) => HeroState[];
  private readonly onReorderGarrison?: (settlementId: string, fromIdx: number, toIdx: number) => boolean;
  private readonly onReorderHero?: (heroId: string, fromIdx: number, toIdx: number) => boolean;

  private signature: string | null = null;
  private owned = false;
  private total = 0;
  private settlement: SettlementState | null = null;
  private hero: HeroState | null = null;

  constructor(opts: GarrisonViewOptions = {}) {
    this.onTransfer = opts.onTransfer;
    this.getHeroesAtSettlement = opts.getHeroesAtSettlement;
    this.onReorderGarrison = opts.onReorderGarrison;
    this.onReorderHero = opts.onReorderHero;

    this.root = document.createElement("div");

    this.garrisonGrid = new SquadGrid({
      gridId: "garrison",
      onReorder: (fromIdx, toIdx) => {
        const settlementId = this.settlement?.id;
        if (!settlementId) return;
        this.onReorderGarrison?.(settlementId, fromIdx, toIdx);
      },
      // A hero-army tile dropped here: move that platoon into this slot.
      onDropFromOtherGrid: (fromSlotIdx, toSlotIdx) => {
        const hero = this.hero;
        const settlement = this.settlement;
        if (!hero || !settlement) return;
        this.movePlatoon(hero.stacks ?? [], fromSlotIdx, {
          heroId: hero.id,
          settlementId: settlement.id,
          direction: "toGarrison",
          toSlot: toSlotIdx,
        });
      },
    });
    this.root.appendChild(this.garrisonGrid.element);

    this.heroHeader = document.createElement("div");
    Object.assign(this.heroHeader.style, {
      fontSize: "10px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      marginTop: "6px",
      marginBottom: "4px",
    });
    this.root.appendChild(this.heroHeader);

    this.heroGrid = new SquadGrid({
      gridId: "hero-army",
      onReorder: (fromIdx, toIdx) => {
        const heroId = this.hero?.id;
        if (!heroId) return;
        this.onReorderHero?.(heroId, fromIdx, toIdx);
      },
      // A garrison tile dropped here: move that platoon onto this hero slot.
      onDropFromOtherGrid: (fromSlotIdx, toSlotIdx) => {
        const hero = this.hero;
        const settlement = this.settlement;
        if (!hero || !settlement) return;
        this.movePlatoon(settlementStacks(settlement), fromSlotIdx, {
          heroId: hero.id,
          settlementId: settlement.id,
          direction: "toHero",
          toSlot: toSlotIdx,
        });
      },
    });
    this.root.appendChild(this.heroGrid.element);

    this.heroEmpty = document.createElement("div");
    this.heroEmpty.textContent = "No units";
    Object.assign(this.heroEmpty.style, { fontSize: "11px", opacity: "0.5" });
    this.root.appendChild(this.heroEmpty);

    this.garrisonGrid.setInteractive(false);
    this.heroGrid.setInteractive(false);
  }

  /** True when the settlement belongs to the acting seat. */
  isOwned(): boolean {
    return this.owned;
  }

  /** Total units garrisoned (0 when empty or not owned). */
  totalUnits(): number {
    return this.total;
  }

  /**
   * Rebuilds the tiles only when the stack content or the garrisoned hero
   * changes (signature compare), so the tiles -- and their drag handlers -- are
   * not torn down under the pointer on every refresh tick. A successful
   * transfer or reorder replaceState()s, and the resulting
   * state:committed → update() cycle rebuilds with the new layout.
   */
  update(state: GameState | undefined, settlement: SettlementState | undefined): void {
    if (!state || !settlement) {
      this.reset();
      return;
    }
    this.owned = settlement.ownerId !== null && settlement.ownerId === state.activePlayerId;
    if (!this.owned) {
      this.reset();
      return;
    }

    const garrison = settlementStacks(settlement);
    const candidate = this.getHeroesAtSettlement?.(settlement.id)[0] ?? null;
    const heroHere = candidate && candidate.ownerId === settlement.ownerId ? candidate : null;
    this.total = stackTotals(garrison).reduce((sum, e) => sum + e.count, 0);

    const signature = JSON.stringify({
      id: settlement.id,
      garrison,
      heroId: heroHere?.id ?? null,
      heroArmy: heroHere?.stacks ?? [],
    });
    if (signature === this.signature) return;
    this.signature = signature;
    this.settlement = settlement;
    this.hero = heroHere;

    this.garrisonGrid.setInteractive(true);
    this.garrisonGrid.render(garrison);

    this.heroHeader.textContent = heroHere ? `${heroHere.name}'s Army` : "";
    this.heroHeader.style.display = heroHere ? "" : "none";
    this.heroGrid.setVisible(heroHere !== null);
    this.heroEmpty.style.display = heroHere && stackTotals(heroHere.stacks ?? []).length === 0 ? "" : "none";
    if (heroHere) {
      this.heroGrid.setInteractive(true);
      this.heroGrid.render(heroHere.stacks ?? []);
    } else {
      this.heroGrid.setInteractive(false);
    }
  }

  /** Moves every entry of one platoon, one TransferUnits per unit type. */
  private movePlatoon(
    stacks: Platoon[],
    slotIdx: number,
    base: Omit<GarrisonTransferRequest, "unitTypeId" | "count">,
  ): void {
    const entries = (stacks[slotIdx]?.entries ?? []).filter((e) => e.count > 0);
    let moved = false;
    for (const entry of entries) {
      const ok = this.onTransfer?.({ ...base, unitTypeId: entry.unitTypeId, count: entry.count }) ?? false;
      if (ok) moved = true;
    }
    void moved;
  }

  private reset(): void {
    this.owned = false;
    this.total = 0;
    this.settlement = null;
    this.hero = null;
    this.garrisonGrid.setInteractive(false);
    this.heroGrid.setInteractive(false);
    if (this.signature === null && this.root.childElementCount === 0) return;
    this.signature = null;
    this.garrisonGrid.render([]);
    this.heroHeader.textContent = "";
    this.heroHeader.style.display = "none";
    this.heroGrid.setVisible(false);
    this.heroEmpty.style.display = "none";
  }
}
