import type { BuildingDef } from "@heroes/contracts";
import { buildersOnSite, buildRate, staffingCeiling } from "@heroes/engine";

// The construction site's own status line, as a pure string (2026-11-03).
//
// The engine decides how fast a site advances, and a site with nobody on it
// does not advance at all -- so the line the player reads has to name the CREW
// and the RATE, not only the days left. The day word keeps the menu's existing
// wording and its raw number, fractions included (`2.6 days remaining`), and the
// rate and the ceiling come from the engine's own `buildRate` /
// `staffingCeiling`, never a second literal.
//
// It lives in its own module because `buildingMenu.ts` imports the floating-
// panel machinery (Vite `?url` assets and all), so the sentence is asserted
// directly here -- the established pattern in this repo for a DOM-only surface.

export interface SiteStatus {
  /** The exact sentence the menu prints. */
  text: string;
  /** Builders actually on the site (the auto crew reads as the full ceiling). */
  builders: number;
  /** The daily decrement as printed: `0.00` / `1.00` / `1.33` / `1.67` / `2.00`. */
  rate: string;
}

export function siteStatus(b: BuildingDef, daysRemaining: number): SiteStatus {
  const builders = buildersOnSite(b);
  const rate = buildRate(builders);
  const dayWord = `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
  return {
    text:
      builders <= 0
        ? `Under construction \u2014 stalled: no builders \u00b7 ${dayWord}`
        : `Under construction \u2014 ${rate.toFixed(2)}\u00d7 (${builders} of ${staffingCeiling(b)} builders) \u00b7 ${dayWord}`,
    builders,
    rate: rate.toFixed(2),
  };
}
