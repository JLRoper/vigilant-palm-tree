# Hero battle outcomes — defeat removal, retreat respawn, surrender relocate — 2026-09-29

Status: **Approved** (user-specified semantics; edge-case defaults chosen, see D4). Branch: continues on `playtest-fixes`.

## Semantics (user-specified)

| Outcome | Hero on adventure map | Troops | Position |
|---|---|---|---|
| **Defeated** (side outcome `lost_all_troops`, i.e. battle lost and wiped) | **Removed entirely** (state.heroes delete + player.heroIds prune + hero_platoons row cleanup) | gone (purse already looted by winner — existing rule) | — |
| **Retreat** (manual-arena retreat; engine `retreated_hero`) | Disappears, respawns | **All lost** (stacks emptied on arrival; the arena's existing 15% pre-loss is subsumed) | Nearest **owned** settlement (hexDistance min) |
| **Surrender** (manual-arena surrender; keeps troops today) | Disappears, teleports | **Kept** (purse minus surrender cost — existing rule) | Nearest **owned** settlement |

- **D1 edge — no owned settlement:** retreat/surrender cannot relocate (nothing to respawn to): the hero stays at its post-cancel battle position, semantics otherwise unchanged (documented; keeps the hero alive for empty-settlement capture play).
- **D2 stalemate** (`survived`/`survived`): both heroes stay put (existing behavior).
- **D3 flee (modal cancel) is not a battle outcome** — unchanged (cancels the attack pre-battle).
- **D4 auto-resolver never concedes** (no retreat policies passed): AI-involved silent battles produce win/`lost_all_troops`/stalemate only — the loser of an auto-resolved battle is therefore always **removed**. Manual arena supplies retreat/surrender.
- **D5 surrender ≡ retreat discrimination:** today both collapse to `retreated_hero` in the event; the verdict must ride a new explicit field so the client can message "surrendered" vs "retreated".

## Implementation

| # | Item | Files |
|---|---|---|
| W1 (engine/contracts) | Per-hero battle verdict helper (derive `"defeated"|"retreated"|"surrendered"|"stood"` from outcome + command outcome); `nearestOwnedSettlement(state, hero)`; `relocateHeroToSettlement(hero, settlement)` (q/r set, previous* nulled, trail `[{q,r}]` seeded — recruit.ts:47-71 shape); extend `BattleResolved` event + `ResolveBattleResult`/`SubmitBattleResultResult` with optional per-hero verdicts; hero records may now be absent → make result hero fields optional | packages/engine/src/combat/*, packages/engine/src/hero/* (or new battleOutcome.ts), packages/contracts/src/events/engineEvent.ts, packages/contracts/src/commands/{resolveBattle,submitBattleResult}.ts |
| W2a (server) | commandHandler both battle cases: apply verdict — defeated → delete from heroes record + prune player.heroIds; retreat/surrender → relocate (nearest owned; none → stay per D1); persist: heroRepo platoon NOT-IN cleanup (heroRepo.ts:124-131,180-183 gap), persistBattleOutcome always passes `players` (fixes heroIds dangle); handler results carry optional heroes + verdicts; update the 256-259 comment | server/app/commandHandler.ts, server/persistence/repositories/heroRepo.ts |
| W2b (client) | turnHooks resolve merge + GameActions submit merge handle absent heroes (delete from local state record, prune heroIds, clear selection — existence-checked like mergeFromEndTurn); result card + AI toast wording per verdict ("slain" / "retreated to <name>" / "surrendered"); keep 0-troop AI guards (retreated heroes legitimately sit at 0) | src/game/turnHooks.ts, src/managers/GameActions.ts, src/screens/combat/battleResultCard.ts, test updates |

## Waves

1. W1 (contracts/engine shapes first — W2 depends on them).
2. W2a ∥ W2b.
3. Gate → commit/push → redeploy → deployed-stack verification: AI-vs-AI battle → loser removed from map/state; human attacks AI + Quick Resolve → loser removed; arena Fight → Retreat → hero respawns at nearest owned settlement with 0 troops; arena Surrender → keeps troops at nearest owned settlement; result card wording; docs pass.

## Out of scope

Hero death for non-battle causes, ransom/capture-for-ransom (supersedes the old locked plan), AI voluntary retreat/surrender, Flee behavior change (D3).
