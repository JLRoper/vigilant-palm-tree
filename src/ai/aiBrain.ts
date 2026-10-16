// Re-export shim: aiBrain moved into @heroes/engine (packages/engine/src/
// ai/aiBrain.ts) for the server-side AI actor (B2 Phase 0). Keep all imports
// pointing here.
export type { AiMove, CharterAction, GarrisonRecruitment } from "@heroes/engine";
export {
  CHARTER_TARGET_REACH,
  GARRISON_BACKOFF_ROUNDS,
  pickAiMove,
  pickCharterAction,
  pickGarrisonRecruitment,
} from "@heroes/engine";
