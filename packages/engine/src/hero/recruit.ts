import type { GameState, HeroState, HorseVariantId, PlayerId, RecruitHeroResult, SettlementId } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { normalizePlatoons } from "../units";
import { DEFAULT_HERO_ARCANE, DEFAULT_HERO_INTELLIGENCE } from "../combatConfig";
import { DEFAULT_HERO_SPELL, maxManaFor } from "../combat/spells";

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
        p.id === playerId ? { ...p, heroIds: [...p.heroIds, heroId] } : p,
      ),
      dirty: true,
    },
    hero,
  };
}
