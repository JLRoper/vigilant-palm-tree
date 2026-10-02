import type { GameState, HeroState, HorseVariantId, PlayerId, RecruitHeroResult, SettlementId } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { normalizePlatoons } from "../units";
import { DEFAULT_HERO_ARCANE, DEFAULT_HERO_INTELLIGENCE } from "../combatConfig";
import { DEFAULT_HERO_SPELL, maxManaFor } from "../combat/spells";
import { DEFAULT_HERO_WAGONS, DEFAULT_TREASURY_WAGONS, playerTreasuryWagonsUnassigned, playerWagonsUnassigned } from "../settlement/capacity";

export const MAX_HEROES_PER_PLAYER = 5;
export const HERO_RECRUIT_COST = 1;

export function recruitHero(
  state: GameState,
  playerId: PlayerId,
  heroName: string,
  settlementId: SettlementId,
  horseVariant: HorseVariantId,
): RecruitHeroResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { state, error: "Player not found" };
  if (player.heroIds.length >= MAX_HEROES_PER_PLAYER) {
    return { state, error: "Already have 5 heroes" };
  }

  const settlement = state.settlements[settlementId];
  if (!settlement) return { state, error: "Settlement not found" };
  if (settlement.ownerId !== playerId) return { state, error: "Not your settlement" };
  if (settlement.gold < HERO_RECRUIT_COST) {
    return { state, error: "Not enough gold" };
  }

  for (const hero of Object.values(state.heroes)) {
    if (hero.q === settlement.q && hero.r === settlement.r) {
      return { state, error: "Hex is occupied" };
    }
  }

  const indices = Array.from({ length: MAX_HEROES_PER_PLAYER }, (_, i) => i);
  const usedIndices = new Set(
    Object.keys(state.heroes)
      .map((id) => {
        const m = /^h(\d+)$/.exec(id);
        return m ? parseInt(m[1], 10) : -1;
      }),
  );
  const nextIdx = indices.find((i) => !usedIndices.has(i)) ?? player.heroIds.length;
  const heroId = `h${nextIdx}`;

  // Wagons are a real, counted resource (Phase 1): a recruited hero used to
  // get 5 free wagons because neither `wagons` nor the pool was touched --
  // assignWagons(+1) on such a hero then SHRANK its purse cap. The recruit
  // now draws its starting complement from the player's unassigned pools,
  // clamped to what is actually there so the pool invariant
  // (unassigned >= 0) always holds -- an empty pool yields a hero with 0
  // cargo wagons / 0 treasury carts (explicit 0, i.e. real 0-cap slots the
  // player can buy and assign carts for), never a free out-of-thin-air 5.
  const cargoWagons = Math.min(DEFAULT_HERO_WAGONS, playerWagonsUnassigned(player));
  const treasuryCarts = Math.min(DEFAULT_TREASURY_WAGONS, playerTreasuryWagonsUnassigned(player));

  const hero: HeroState = {
    id: heroId,
    name: heroName,
    ownerId: playerId,
    q: settlement.q,
    r: settlement.r,
    movementRemaining: MOVEMENT_PER_TURN,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q: settlement.q, r: settlement.r }],
    gold: 0,
    troops: 1,
    stacks: normalizePlatoons([]),
    isChartering: false,
    charterId: null,
    horseVariant,
    // Spellcasting v1: every recruited hero starts as a Magic Arrow mage
    // with the fixed v1 stat block (roadmap §"Spellcasting v1", decision 7).
    arcane: DEFAULT_HERO_ARCANE,
    intelligence: DEFAULT_HERO_INTELLIGENCE,
    heroMana: maxManaFor(DEFAULT_HERO_INTELLIGENCE),
    heroMaxMana: maxManaFor(DEFAULT_HERO_INTELLIGENCE),
    heroSpell: DEFAULT_HERO_SPELL,
    // Upkeep shortfall (weekly upkeep pass): a newly recruited hero starts
    // paid up and content.
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    wagons: cargoWagons,
    treasuryWagons: treasuryCarts,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };

  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [heroId]: hero },
      settlements: {
        ...state.settlements,
        [settlement.id]: { ...settlement, gold: settlement.gold - HERO_RECRUIT_COST },
      },
      players: state.players.map((p) =>
        p.id === playerId
          ? {
              ...p,
              heroIds: [...p.heroIds, heroId],
              wagonsUnassigned: playerWagonsUnassigned(p) - cargoWagons,
              treasuryWagonsUnassigned: playerTreasuryWagonsUnassigned(p) - treasuryCarts,
            }
          : p,
      ),
      dirty: true,
    },
    hero,
  };
}
