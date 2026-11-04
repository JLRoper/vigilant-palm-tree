// Re-export shim: aiBrain moved into @heroes/engine (packages/engine/src/
// ai/aiBrain.ts) for the server-side AI actor (B2 Phase 0). Keep all imports
// pointing here.
export type {
  AiMove,
  AiWorkerAssignment,
  CharterAction,
  GarrisonRecruitment,
  HeroArmyPlacement,
  HeroArmyRecruitment,
  SettlersWagonAction,
} from "@heroes/engine";
export {
  CHARTER_TARGET_REACH,
  GARRISON_BACKOFF_ROUNDS,
  HERO_ARMY_TARGET_POWER,
  pickAiConstructionStaffing,
  pickAiMove,
  pickCharterAction,
  pickFoundingHex,
  pickGarrisonRecruitment,
  pickHeroArmyBuildings,
  pickHeroArmyRecruitment,
  pickHeroRefitStep,
  pickSettlersWagonAction,
} from "@heroes/engine";
