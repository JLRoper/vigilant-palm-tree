// The faction registry: the single catalog source for roster factions
// (contracts FactionId). Exhaustive over the union by construction — a new
// FactionId without an entry here is a tsc error, the same compile
// enforcement buildingRegistry.ts's Record<BuildingKind, BuildingEffect>
// uses. `roster` is the unit-id membership list the parity test pins against
// the unit_types DB column; ashen/verdant ship EMPTY rosters until their
// content plans land (their entries exist so ids resolve and banners can
// be addressed), and their label/motto/palette values are the seeds their
// plans refine.
import type { FactionDef, FactionId } from "@heroes/contracts";

export const FACTION_REGISTRY: Record<FactionId, FactionDef> = {
  human: {
    id: "human",
    label: "The Crownlands",
    motto: "The crown endures.",
    description:
      "Today's single roster: the 12 purchasable units of the Crownlands, from peasant militias to the Eagle Princes of the realm's eyries.",
    palette: { primary: "#d4af37", secondary: "#a31621", accent: "#f2e8c9" },
    roster: [
      "peasant",
      "archer",
      "crossbowman",
      "swordsman",
      "pikeman",
      "cavalry",
      "monk",
      "crusader",
      "mage",
      "warhound",
      "giant_eagle",
      "eagle_prince",
    ],
  },
  ashen: {
    id: "ashen",
    label: "The Ashen Court",
    motto: "What death releases, the Court reclaims.",
    description:
      "A necropolis-confederacy that raises its levies from the barrow fields: cheap fast infantry swarms, spectral ranged, and an elite undead aristocracy. No living soldiers — even its bowmen are revenants.",
    palette: { primary: "#2b2b33", secondary: "#e8e0d0", accent: "#ff6b35" },
    roster: [
      "ghoul",
      "bone_pikeman",
      "bone_archer",
      "wraith",
      "blood_knight",
      "vampire_lord",
      "lich",
    ],
  },
  ironmark: {
    id: "ironmark",
    label: "The Ironmark Holds",
    motto: "The mountain remembers every debt.",
    description:
      "Clan-holds carved under the Ironmark peaks: everything armored, expensive, and nearly immobile — grind them down or be ground. Ranged comes from gunpowder, elites from runeforged tradition.",
    palette: { primary: "#3f5c78", secondary: "#6b7280", accent: "#e0a526" },
    roster: [
      "dwarf_axeman",
      "shield_bearer",
      "hand_gunner",
      "ironsworn",
      "iron_golem",
      "runesmith",
      "forge_lord",
    ],
  },
  verdant: {
    id: "verdant",
    label: "The Verdant Wild",
    motto: "The forest keeps what the forest grows.",
    description: "Placeholder entry until the Verdant Wild content plan lands its roster.",
    palette: { primary: "#3f6212", secondary: "#5c4033", accent: "#d4a017" },
    roster: [],
  },
  neutral: {
    id: "neutral",
    label: "Neutral",
    motto: "",
    description:
      "Wild creatures outside every seat's roster: catalog-only content recruitable by nobody (no building offers them).",
    palette: { primary: "#8a8a8a", secondary: "#4a4a4a", accent: "#c0c0c0" },
    roster: ["griffin", "hydra", "wisp", "black_dragon"],
  },
};

// The seat-side twin of units.ts's unitFactionId: every Player is implicitly
// "human" until a creator assigns a seat faction (Player.factionId is
// optional so legacy rows and old JSONB stay valid).
export function playerFactionId(p: { factionId?: FactionId } | undefined): FactionId {
  return p?.factionId ?? "human";
}