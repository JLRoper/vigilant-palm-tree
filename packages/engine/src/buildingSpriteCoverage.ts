import type { BuildingKind } from "@heroes/contracts";
import { BUILDING_SPRITE_KEYS } from "./generated/buildingSpriteKeys";

// Declared sprite-key coverage for every building kind.
//
// Before this file, a building level could silently have no sprite: the painter
// resolves `building.pixel.<kind>.<level>`, and a missing key draws nothing --
// the blank-tile bug class that crypt-2, gunnersRedoubt-2 and worldrootGrove-2
// each hit, and each of which was fixed by hand only after someone noticed.
//
// The type is what enforces it. `BUILDING_SPRITE_COVERAGE` is a
// `Record<BuildingKind, ...>`, so adding a kind to the contracts union is a
// compile error until its coverage is declared here. And within a kind, a level
// may be `null` only when `reasons` explains why -- so "absent" becomes a
// decision on the record rather than an omission nobody saw.
//
// `underConstruction` is deliberately not a `BuildingKind`: it is a painter-side
// pseudo-kind for the construction-stages art, not a placeable building, so it
// has no entry here and is not a gap.

export type BuildingSpriteLevel = 1 | 2 | 3;

export interface BuildingSpriteCoverage {
  /** Sprite key per level. `null` means deliberately absent -- see `reasons`. */
  readonly keys: Readonly<Record<BuildingSpriteLevel, string | null>>;
  /** Why a level is absent. Required for every `null` key. */
  readonly reasons?: Readonly<Partial<Record<BuildingSpriteLevel, string>>>;
}

function full(kind: string): BuildingSpriteCoverage {
  return {
    keys: {
      1: `pixel.${kind}.1`,
      2: `pixel.${kind}.2`,
      3: `pixel.${kind}.3`,
    },
  };
}

export const BUILDING_SPRITE_COVERAGE: Readonly<Record<BuildingKind, BuildingSpriteCoverage>> = {
  // --- original roster -----------------------------------------------------
  townHall: full("townHall"),
  house: full("house"),
  tower: full("tower"),
  mageGuild: full("mageGuild"),
  mine: {
    keys: {
      // The generic `mine` kind is non-buildable legacy data; it renders with
      // the stoneMine art via the alias table in the generated key list.
      1: "pixel.mine.1",
      2: "pixel.mine.2",
      3: "pixel.mine.3",
    },
  },
  stoneMine: full("stoneMine"),
  ironMine: full("ironMine"),
  market: full("market"),
  barracks: full("barracks"),
  smithy: full("smithy"),
  apartment: full("apartment"),
  farmField: full("farmField"),
  farmhouse: full("farmhouse"),
  archeryRange: full("archeryRange"),
  granary: full("granary"),
  warehouse: full("warehouse"),
  bank: full("bank"),
  treasury: full("treasury"),
  goldMine: full("goldMine"),
  woodcutterHut: full("woodcutterHut"),
  arcaneFont: full("arcaneFont"),
  shipyard: full("shipyard"),
  stables: full("stables"),
  huntingLodge: full("huntingLodge"),
  eyrie: full("eyrie"),
  // --- ashen court ---------------------------------------------------------
  crypt: full("crypt"),
  ossuary: full("ossuary"),
  wraithBarrows: full("wraithBarrows"),
  spireOfAsh: full("spireOfAsh"),
  // --- ironmark holds ------------------------------------------------------
  forgeHall: full("forgeHall"),
  gunnersRedoubt: full("gunnersRedoubt"),
  golemFoundry: full("golemFoundry"),
  deepAnvil: full("deepAnvil"),
  // --- verdant wild --------------------------------------------------------
  groveSanctum: full("groveSanctum"),
  warrenLodge: full("warrenLodge"),
  sylvanStables: full("sylvanStables"),
  worldrootGrove: full("worldrootGrove"),
  blackChapel: full("blackChapel"),
  dragonBoneyard: full("dragonBoneyard"),
  delversHall: full("delversHall"),
  hearthTemple: full("hearthTemple"),
  ramPens: full("ramPens"),
  seedlingGrove: full("seedlingGrove"),
  druidCircle: full("druidCircle"),
};

export const BUILDING_SPRITE_LEVELS: readonly BuildingSpriteLevel[] = [1, 2, 3];

const SPRITE_KEY_SET: ReadonlySet<string> = new Set(BUILDING_SPRITE_KEYS);

export interface SpriteCoverageProblem {
  readonly kind: BuildingKind;
  readonly level: BuildingSpriteLevel;
  readonly key: string;
  readonly problem: "key-not-registered" | "missing-reason";
  readonly detail: string;
}

/**
 * Every problem that makes the declared coverage wrong: a level whose declared
 * key is not in the generated key list (so the painter would draw nothing), or
 * a `null` level with no reason recorded.
 *
 * An empty result is the invariant the whole file exists to hold.
 */
export function spriteCoverageProblems(): readonly SpriteCoverageProblem[] {
  const problems: SpriteCoverageProblem[] = [];

  for (const [kind, coverage] of Object.entries(BUILDING_SPRITE_COVERAGE) as Array<
    [BuildingKind, BuildingSpriteCoverage]
  >) {
    for (const level of BUILDING_SPRITE_LEVELS) {
      const key = coverage.keys[level];
      if (key === null) {
        const reason = coverage.reasons?.[level];
        if (!reason) {
          problems.push({
            kind,
            level,
            key: "",
            problem: "missing-reason",
            detail: `${kind} L${level} is declared absent with no reason recorded`,
          });
        }
        continue;
      }
      if (!SPRITE_KEY_SET.has(key)) {
        problems.push({
          kind,
          level,
          key,
          problem: "key-not-registered",
          detail: `${kind} L${level} declares key "${key}", which is not in BUILDING_SPRITE_KEYS`,
        });
      }
    }
  }

  return problems;
}

/** The declared key for a kind+level, or `null` when absent or undeclared. */
export function buildingSpriteKey(kind: BuildingKind, level: number): string | null {
  if (level < 1 || level > 3) return null;
  return BUILDING_SPRITE_COVERAGE[kind].keys[level as BuildingSpriteLevel] ?? null;
}
