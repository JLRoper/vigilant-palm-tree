import type { Axial } from "../geometry";
import type { CharterId, HeroId, HorseVariantId, PlayerSeat, SettlementId } from "../ids";
import type { ResourceType } from "../resources";
import type { CaravanState, TransferDirection, TradeRouteEndpoint, TradeRoutePayload } from "../gameState";
import type { HeroTradeOffer } from "../commands/tradeHeroes";

// Per-hero battle verdict (hero-outcomes plan W1): how a hero finished a
// battle. Declared here because contracts is the single source (engine
// imports this union; it cannot be the other way around) and the
// BattleResolved event carries it per side. "defeated" = lost_all_troops
// (hero removed), "retreated"/"surrendered" = conceded retreat/surrender
// (hero relocated to nearest owned settlement), "stood" = won/survived.
export type HeroBattleVerdict = "defeated" | "retreated" | "surrendered" | "stood";

// Named EngineEvent, not GameEvent -- src/core/events.ts already has an
// unrelated GameEvent (the client-side UI-event-bus payload union). See
// plan/2026-08-16-phase-3-parallel-dev-plan.md's naming-collision note.
export type EngineEvent =
  | { type: "HeroMoved"; actor: PlayerSeat; heroId: HeroId; to: Axial }
  | {
      type: "GoldTransferred";
      actor: PlayerSeat;
      heroId: HeroId;
      settlementId: SettlementId;
      direction: TransferDirection;
    }
  | {
      type: "TurnEnded";
      actor: PlayerSeat;
      round: number;
      day: number;
      activePlayerId: number;
      wrapped: boolean;
    }
  | {
      type: "BattleResolved";
      actor: PlayerSeat;
      attackerId: HeroId;
      defenderId: HeroId;
      winner: "attacker" | "defender" | "draw";
      // @heroes/engine's CombatantOutcome (packages/engine/src/combat/types.ts)
      // inlined as its own literal union rather than imported -- contracts
      // is a zero-dependency leaf and cannot import from @heroes/engine (see
      // this file's own header comment / packages/contracts/src/index.ts).
      attackerOutcome: "won" | "lost_all_troops" | "retreated_self" | "retreated_hero" | "survived";
      defenderOutcome: "won" | "lost_all_troops" | "retreated_self" | "retreated_hero" | "survived";
      // Optional so pre-W1 events without verdicts stay valid. "surrendered"
      // vs "retreated" cannot be re-derived from the outcomes alone (both
      // collapse to retreated_hero) -- only this field discriminates them.
      attackerVerdict?: HeroBattleVerdict;
      defenderVerdict?: HeroBattleVerdict;
      rewardGold: number;
      rounds: number;
      // Persisted here so a battle can be replayed later -- the old
      // /resolve-battle route computed this per-call but never persisted
      // it anywhere (plan/2026-08-16-phase-3-parallel-dev-plan.md's own
      // "replaying this battle later would not reproduce the same
      // obstacle layout" callout).
      obstacleSeed: number;
    }
  | {
      // Marks a pending human-defended battle the defender must resolve
      // (AI-initiated battles no longer auto-resolve against a human
      // defender). Classified "apply": replaying it through startBattle
      // sets the BATTLE phase; the phase itself is re-derived at hydrate
      // from games.lobby.pendingBattle (the BATTLE phase is never
      // persisted as a phase).
      type: "BattleOffered";
      actor: PlayerSeat;
      attackerId: HeroId;
      defenderId: HeroId;
    }
  | {
      type: "HeroRecruited";
      actor: PlayerSeat;
      heroId: HeroId;
      name: string;
      settlementId: SettlementId;
      horseVariant: HorseVariantId;
    }
  | {
      type: "TownHallUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
      targetLevel: 2 | 3;
    }
  | {
      type: "AutoTradeToggled";
      actor: PlayerSeat;
      settlementId: SettlementId;
      autoTrade: boolean;
    }
  | {
      type: "StackReordered";
      actor: PlayerSeat;
      heroId: HeroId;
      fromIdx: number;
      toIdx: number;
    }
  | {
      type: "GarrisonReordered";
      actor: PlayerSeat;
      settlementId: SettlementId;
      fromIdx: number;
      toIdx: number;
    }
  | {
      type: "SettlementCaptured";
      actor: PlayerSeat;
      heroId: HeroId;
      settlementId: SettlementId;
      previousOwnerId: number | null;
    }
  | {
      type: "CharterStarted";
      actor: PlayerSeat;
      heroId: HeroId;
      charterId: CharterId;
      settlementId: SettlementId;
      targetQ: number;
      targetR: number;
    }
  | {
      type: "BuildingUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
      district?: { q: number; r: number };
    }
  | {
      type: "SettlementUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
      targetLevel: 2 | 3;
    }
    | {
        // #152: one hex-step of a charter's auto-travel, mirroring HeroMoved's
        // shape exactly (same `to`-only payload, same reasoning: movement
        // cost/whether-arrived isn't carried here, TurnEnded remains the
        // resync boundary that re-syncs anything this event's replay drifts).
        type: "CharterTravelAdvanced";
        actor: PlayerSeat;
        heroId: HeroId;
        charterId: CharterId;
        to: Axial;
      }
    | {
        // The city view's PlaceBuildings command committing its working
        // cart (palette placements + destroy-mode removals). Payload is
        // intentionally minimal: remote seats re-sync the full buildings
        // array via the same TurnEnded/poll resync boundary everything
        // else uses -- entityMirror's handler for this is a documented
        // no-op until the event carries per-building data worth applying.
        type: "BuildingsPlaced";
        actor: PlayerSeat;
        settlementId: SettlementId;
        district?: { q: number; r: number };
      }
    | {
        // Hero cargo load/unload at a same-hex owned settlement. Amounts
        // ride the TurnEnded resync boundary, like BuildingsPlaced.
        type: "ResourcesTransferred";
        actor: PlayerSeat;
        heroId: HeroId;
        settlementId: SettlementId;
        direction: "load" | "unload";
      }
    | {
        type: "WagonsAssigned";
        actor: PlayerSeat;
        heroId: HeroId;
        delta: number;
        // Which slot moved (Phase 1 treasury-wagons split). Optional so
        // pre-split rows keep reading as cargo assignments.
        slot?: "cargo" | "treasury";
      }
    | {
        type: "WagonsBought";
        actor: PlayerSeat;
        settlementId: SettlementId;
        count: number;
        // Which pool grew (Phase 1 treasury-wagons split). Optional so
        // pre-split rows keep reading as cargo purchases. Named `slot`
        // (not the brief's `kind`) to match AssignWagons and
        // WagonsAssigned -- one discriminator name for the same concept.
        slot?: "cargo" | "treasury";
      }
    | {
        type: "TradeRouteCreated";
        actor: PlayerSeat;
        routeId: string;
        // The route's endpoints and payload ride verbatim so a replaying
        // client can rebuild the route record (applyTradeRouteCreated's
        // targeted construction). Rows persisted by the pre-endpoint
        // generation carry the legacy flat fromSettlementId/toSettlementId/
        // resource fields instead; the applier normalizes both shapes.
        from: TradeRouteEndpoint;
        to: TradeRouteEndpoint;
        payload: TradeRoutePayload;
        wagons: number;
      }
    | {
        // One wrap of a caravan's journey -- the only place a caravan ever
        // moves is packages/engine/src/logistics.ts's advanceTradeRoutes, run
        // by advanceRound inside the EndTurn command. Derived server-side in
        // server/app/commandHandler.ts's EndTurn case by comparing each
        // route's caravan record before and after the wrap (the same
        // set-difference derivation TradeRouteRemoved uses), so the movement
        // pass itself stays unaware of the event log. Classified "apply" in
        // ENGINE_EVENT_SYNC_CLASS -- targeted construction, like its sibling
        // TradeRouteCreated -- because the record cannot be re-derived: a
        // leg's path is A* over the rebuilt map plus whatever of the wrap's
        // movement budget the delivery left over. ONE row per route per wrap
        // reports the three moments a playthrough found silent (the load, the
        // delivery, the turn for home) as FIELDS rather than as three rows:
        // they all describe one single-record mutation, and a second row for
        // the same fact is a second source of truth.
        type: "CaravanAdvanced";
        actor: PlayerSeat;
        routeId: string;
        // The route's caravan AFTER the wrap, verbatim (the applier assigns
        // it). null = the cart reached home and unloaded; it reloads on a
        // later wrap. `cargo` holds the route payload's units (units of
        // `payload.resource`, or gold).
        caravan: CaravanState | null;
        // What the wrap drew out of the FROM endpoint to start this leg (the
        // load), in the payload's own units; 0 when the wrap did not load.
        // Exactly the record's own cargo on a departure wrap: a caravan is
        // created from null only by the load branch, which returns with
        // `cargo: load, pathIndex: 0` and walks nothing that wrap.
        loaded: number;
        // What the wrap landed on the TO endpoint (the delivery), in the same
        // units; 0 when the wrap delivered nothing -- a turnaround with its
        // cargo intact (a dead or captured destination) and every homeward
        // deposit both report 0, because neither is a delivery. The endpoint
        // STORES are deliberately not carried: a lost origin reroutes a
        // return load to the owner's nearest settlement
        // (nearestSettlementOwnedBy), a target a route-level diff cannot
        // name, so stock effects ride the same TurnEnded/poll resync boundary
        // every other minimal-payload kind leaves them to.
        delivered: number;
      }
    | {
        type: "TradeRouteUpdated";
        actor: PlayerSeat;
        routeId: string;
      }
    | {
        type: "TradeRouteRemoved";
        actor: PlayerSeat;
        routeId: string;
      }
    | {
        type: "UnitsRecruited";
        actor: PlayerSeat;
        settlementId: SettlementId;
        unitTypeId: string;
        count: number;
        district?: { q: number; r: number };
      }
    | {
        type: "UnitsTransferred";
        actor: PlayerSeat;
        heroId: HeroId;
        settlementId: SettlementId;
        direction: "toHero" | "toGarrison";
        unitTypeId: string;
        count: number;
      }
    | {
        type: "HeroesTraded";
        actor: PlayerSeat;
        heroId: HeroId;
        partnerId: HeroId;
        give: HeroTradeOffer;
        take: HeroTradeOffer;
      }
    | {
        type: "SettlementBattleResolved";
        actor: PlayerSeat;
        attackerId: HeroId;
        settlementId: SettlementId;
        // Legacy collapsed winner, kept for existing consumers: a draw (and
        // every concession outcome) reports defender-won. The truthful
        // representation rides `outcome` + `attackerVerdict` below (B6/D6,
        // server-side AI actor plan Phase 2).
        winner: "attacker" | "defender";
        captured: boolean;
        // The battle-level outcome without the draw collapse. Optional so
        // rows persisted by pre-B6 servers stay valid; consumers normalize
        // an absent outcome back off `winner`.
        outcome?: "attackerWon" | "defenderWon" | "draw";
        // Optional so pre-B6 events without verdicts stay valid -- the same
        // style as BattleResolved's verdict fields above.
        attackerVerdict?: HeroBattleVerdict;
      }
    | {
        // A bank pot moved gold: "deposit" is treasury -> pot, "withdraw"
        // starts the 7-day countdown (the pot drops immediately; the money
        // lands in the treasury when it matures). Classified "apply" in
        // ENGINE_EVENT_SYNC_CLASS -- every field the reducer needs rides the
        // event, so a replaying client re-runs the same reducer rather than
        // guessing.
        type: "BankGoldMoved";
        actor: PlayerSeat;
        settlementId: SettlementId;
        gx: number;
        gy: number;
        amount: number;
        direction: "deposit" | "withdraw";
        district?: { q: number; r: number };
      }
    | {
        // One building's explicit workforce size (0 = shut down). Minimal
        // payload like BuildingsPlaced: the staffing totals ride the
        // TurnEnded/poll resync boundary for remote seats.
        type: "WorkersAssigned";
        actor: PlayerSeat;
        settlementId: SettlementId;
        gx: number;
        gy: number;
        workers: number;
        district?: { q: number; r: number };
      }
    | {
        // A settlers-mode covered wagon founded a settlement (SETTLERS-PLAN.md
        // §4 W1). Classified "resync" in ENGINE_EVENT_SYNC_CLASS, the
        // CharterStarted rule: the new settlement's terrain-derived rates,
        // food-biased city spots, stream-derived name and starter stockpile
        // are the engine's own draws (it needs the map to make them), so a
        // replaying client refetches instead of guessing at them.
        type: "SettlementFounded";
        actor: PlayerSeat;
        founderId: HeroId;
        /** The id the new settlement was allocated (s<nextSettlementId>). */
        settlementId: SettlementId;
        /** The settlement's terrain-derived name, for the event log. */
        name: string;
        q: number;
        r: number;
        /** True when the founder was consumed (design answer 1). */
        consumedFounder: boolean;
      }
    | {
        // A hero picked resources off the tile it stands on. Classified
        // "apply" in ENGINE_EVENT_SYNC_CLASS: the payload is everything a
        // replay needs -- the amount taken, what is left on the tile, and the
        // tile itself -- and none of it requires the map, so a replaying
        // client re-runs the same targeted construction the server did
        // rather than guessing or refetching.
        type: "ResourcePickedUp";
        actor: PlayerSeat;
        heroId: HeroId;
        q: number;
        r: number;
        /** The tile's resource TYPE, which a pickup never changes. */
        resource: ResourceType;
        /** How much moved into the hero's hold. Never 0 (a pickup that fits
         *  nothing is refused instead of evented). */
        amount: number;
        /** What is still on the floor of that tile afterwards. */
        remaining: number;
      };
