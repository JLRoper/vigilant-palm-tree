# Battle retreat rules + stuck-arena fix (2026-10-21)

Status: agreed with the user 2026-10-21, in progress on
`claude/battle-retreat-stuck-bug-4ae088`.

## 1. The bug: arena stuck after a failed submission

`GameActions.fightInArena()` / `startSettlementBattleFlow()` only close the
arena overlay from the result card's **Carry On**, which only exists on the
success path. Every other exit — the server rejecting SubmitBattleResult /
SubmitSettlementBattleResult (403/409/500/network), the BATTLE phase gone
after the fight, or a throw between `onComplete` and the card — returns
without closing it. The arena has already shown "Battle Over" and hidden its
controls, so the full-screen overlay (z-index 100) leaves no way out.

Verified 2026-10-21 against a local DB: the success path closes correctly for
attacker and defender retreats, so the user's stuck screen was a failed
submission (their dev env points at the shared gameserver).

### Fix

- The arena is closed on **every** exit from both flows (try/finally owner).
- Transient failures (network error, 5xx) are retried silently (3 attempts,
  short backoff) with the identical payload.
- If the submission still fails, or is a permanent rejection (4xx), show a
  "Couldn't record this battle" card naming the reason, with
  **Return to map**: the arena closes and the pre-battle position is
  restored (the existing flee semantics).

## 2. Retreat rules

| | Hero vs hero | Settlement assault |
|---|---|---|
| Retreat allowed from | battle round 2 | battle round 3 |
| Who escapes | platoons standing on their side's starting edge column | same |
| Loss for escapees | none | none |
| Every other platoon | lost (counts as casualties) | lost |
| Hero ends at | nearest owned settlement; pre-move hex if none | same |
| Movement | 0 for the rest of the day, 0 the next day, normal after | same |

- "Starting edge column" = the outer column the side deployed on
  (`deploymentPosition`: q-column 0 for the left side, `cols-1` for the
  right, per the battle's `sideChoice`).
- Applies to manual fights (attacker or defender), Quick Resolve, and AI
  heroes. The AI / auto-resolver retreats when retreat is allowed and its
  remaining total health is below `AI_RETREAT_STRENGTH_RATIO` (0.4) of the
  enemy's.
- Surrender is unchanged: pay gold (or leave units behind) and keep the
  rest of the army; relocation as today. It does NOT stun the next day, but
  relocation ends the hero's current day (0 movement) for both concessions.
- A defender who retreats on the enemy's turn is stunned through the next
  day, i.e. misses their own next turn.

## 3. Implementation notes

- **Stun**: `HeroState.movementLockedThroughDay?: number` (absent = none).
  Retreat on day D sets `movementRemaining: 0` and
  `movementLockedThroughDay: D + 1`. `resetHeroMovement` takes the day being
  entered (`state.day + 1` from both `applyEndOfTurnDetailed` and
  `advanceRound`) and grants 0 while `lockedThrough >= thatDay`, clearing the
  field once it has passed. Persisted in the JSONB row and a new nullable
  `heroes.movement_locked_through_day` column (migration 032).
- **Edge rule (engine)**: one helper decides edge membership for a
  combatant; the manual arena's `retreatHero` and the auto-resolver's hero
  retreat both use it. Escapees keep their entries; the rest are zeroed and
  logged as casualties.
- **Round gates**: `HERO_BATTLE_MIN_RETREAT_ROUND = 2`,
  `SETTLEMENT_BATTLE_MIN_RETREAT_ROUND = 3` in `combatConfig.ts`; the arena
  receives its gate via an option.
- **Server**: the `retreated` verdict keeps the submitted (edge-filtered)
  stacks instead of zeroing them, relocates, and applies the stun. Survivor
  stacks may never exceed the pre-battle stacks per unit type.
- **Arena UI**: Retreat disabled with a reason before the gate; the confirm
  dialog highlights the edge column and lists escaping vs lost platoons; the
  result card renders the server's authoritative hero stacks.
- The relocated hero no longer gets a fresh `MOVEMENT_PER_TURN` (that was a
  free teleport home with full movement).
