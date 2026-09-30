// Re-export shim: aiBrain moved into @heroes/engine (packages/engine/src/
// ai/aiBrain.ts) for the server-side AI actor (B2 Phase 0). Keep all imports
// pointing here.
export type { AiMove, GarrisonRecruitment } from "@heroes/engine";
export { GARRISON_BACKOFF_ROUNDS, pickAiMove, pickGarrisonRecruitment } from "@heroes/engine";
