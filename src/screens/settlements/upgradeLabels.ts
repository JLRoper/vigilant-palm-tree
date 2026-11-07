/**
 * The two "raise it a level" controls in the settlement surfaces, worded so they
 * cannot be mistaken for one another (playthrough ledger #10).
 *
 * They set DIFFERENT things and always did:
 *
 *  - the settlement PANEL's control raises the SETTLEMENT a tier (its level:
 *    population cap, city grid size, resource rates, and — through the town
 *    hall requirement it states — nothing else);
 *  - the town hall's own menu raises that BUILDING a level.
 *
 * Both used to read as a bare level — `Upgrade to L2` beside `L2: 1500g 15w
 * 10s / 7d` — so a player reading the panel could not tell which "L2" the 5000g
 * asked for. One function per control, so the words on screen and the accessible
 * name come from the same string and a courier change cannot re-collide them.
 */

/** The settlement panel's own tier-upgrade wording (`goldCost` omitted while the control is refused). */
export function settlementUpgradeLabel(nextLevel: number, goldCost?: number | null): string {
  const base = `Upgrade settlement to L${nextLevel}`;
  return goldCost == null ? base : `${base} — ${goldCost}g`;
}

export interface TownHallUpgradeCost {
  gold: number;
  wood: number;
  stone: number;
  days: number;
}

/** The town hall's own building-upgrade wording, shown inside the town hall's menu. */
export function townHallUpgradeLabel(nextLevel: number, cost: TownHallUpgradeCost): string {
  return `Town hall L${nextLevel}: ${cost.gold}g ${cost.wood}w ${cost.stone}s / ${cost.days}d`;
}
