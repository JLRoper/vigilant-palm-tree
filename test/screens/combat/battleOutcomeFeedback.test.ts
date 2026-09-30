import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, GameState } from "@heroes/contracts";
import {
  attachBattleOutcomeFeedback,
  buildCardModel,
  buildPendingOutcome,
  buildToastText,
  detachBattleOutcomeFeedback,
  isLocalSeatInvolved,
  type BattleOutcomeCardModel,
  type PendingBattleOutcome,
} from "../../../src/screens/combat/battleOutcomeFeedback";
import { clearServerDriven, registerServerDriven } from "../../../src/io/serverDrivenGames";
import { bus } from "../../../src/core/eventBus";
import { makeHero, makeSettlement, makeState } from "../../charter/_helpers";

// B6/D6 consumer (server-side AI actor plan Phase 2): the flagged-gate,
// card-vs-toast policy, dedupe, and draw/absent-verdict wording for the
// event-derived battle feedback. DOM renderers are injected as fakes so the
// suite runs under bare node:test; the module's top-level imports are
// DOM-safe (menu/toast only touch document inside function bodies).

const FLAGGED = "fb-flagged";
const UNFLAGGED = "fb-unflagged";

function heroBattleEvent(overrides: Partial<Extract<EngineEvent, { type: "BattleResolved" }>> = {}): Extract<
  EngineEvent,
  { type: "BattleResolved" }
> {
  return {
    type: "BattleResolved",
    actor: 1,
    attackerId: "h1",
    defenderId: "h0",
    winner: "attacker",
    attackerOutcome: "won",
    defenderOutcome: "lost_all_troops",
    attackerVerdict: "stood",
    defenderVerdict: "defeated",
    rewardGold: 50,
    rounds: 3,
    obstacleSeed: 1234,
    ...overrides,
  };
}

function settlementBattleEvent(
  overrides: Partial<Extract<EngineEvent, { type: "SettlementBattleResolved" }>> = {},
): Extract<EngineEvent, { type: "SettlementBattleResolved" }> {
  return {
    type: "SettlementBattleResolved",
    actor: 1,
    attackerId: "h1",
    settlementId: "s0",
    winner: "attacker",
    captured: true,
    outcome: "attackerWon",
    attackerVerdict: "stood",
    ...overrides,
  };
}

interface Sink {
  cards: BattleOutcomeCardModel[];
  toasts: string[];
}

function makeSink(): Sink & {
  render: { card(model: BattleOutcomeCardModel): void; toast(message: string): void };
} {
  const cards: BattleOutcomeCardModel[] = [];
  const toasts: string[] = [];
  return {
    cards,
    toasts,
    render: {
      card: (model) => cards.push(model),
      toast: (message) => toasts.push(message),
    },
  };
}

interface Harness {
  sink: ReturnType<typeof makeSink>;
  emitOutcome(args: {
    gameName?: string;
    id: string;
    payload: EngineEvent;
    actorSeat: number | null;
    kind?: "heroBattle" | "settlementBattle";
  }): void;
  emitResync(gameName: string, state: GameState): void;
}

function attachHarness(opts: {
  state: GameState;
  localSeat: number | null;
  activeGame?: string | null;
  identityWindowMs?: number;
  renderFallbackMs?: number;
}): Harness {
  const sink = makeSink();
  attachBattleOutcomeFeedback({
    getState: () => opts.state,
    getGameName: () => opts.activeGame ?? FLAGGED,
    getLocalSeat: () => opts.localSeat,
    ...(opts.identityWindowMs !== undefined ? { identityWindowMs: opts.identityWindowMs } : {}),
    ...(opts.renderFallbackMs !== undefined ? { renderFallbackMs: opts.renderFallbackMs } : {}),
    render: sink.render,
  });
  return {
    sink,
    emitOutcome(args) {
      bus.emit({
        type: "mp:battleOutcome",
        gameName: args.gameName ?? FLAGGED,
        id: args.id,
        kind: args.kind ?? (args.payload.type === "BattleResolved" ? "heroBattle" : "settlementBattle"),
        payload: args.payload as never,
        actorSeat: args.actorSeat,
      });
    },
    emitResync(gameName, state) {
      bus.emit({ type: "mp:resynced", gameName, state, cursor: 99, reason: "event_not_derivable" });
    },
  };
}

beforeEach(() => {
  detachBattleOutcomeFeedback();
  clearServerDriven(FLAGGED);
  clearServerDriven(UNFLAGGED);
});

afterEach(() => {
  detachBattleOutcomeFeedback();
  clearServerDriven(FLAGGED);
  clearServerDriven(UNFLAGGED);
});

test("flagged gate: a settlement battle on a flagged game renders; the same event on an unflagged game is ignored", () => {
  registerServerDriven(FLAGGED);
  // AI (seat 1) assaults the local seat's settlement s0.
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const h = attachHarness({ state, localSeat: 0 });

  h.emitOutcome({ id: "11", payload: settlementBattleEvent(), actorSeat: 1 });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 1, "flagged game: the local defender gets the verdict card");
  assert.equal(h.sink.toasts.length, 0);
  detachBattleOutcomeFeedback();

  const h2 = attachHarness({ state, localSeat: 0 });
  h2.emitOutcome({ gameName: UNFLAGGED, id: "12", payload: settlementBattleEvent(), actorSeat: 1 });
  h2.emitResync(UNFLAGGED, state);
  assert.equal(h2.sink.cards.length, 0, "unflagged game: ignored entirely (byte-identical)");
  assert.equal(h2.sink.toasts.length, 0);
});

test("own-seat rows never render (the direct-response arena path owns the local attacker's UX)", () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0 });

  h.emitOutcome({ id: "21", payload: settlementBattleEvent({ settlementId: "s1" }), actorSeat: 0 });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 0, "own battle: no event-derived card");
  assert.equal(h.sink.toasts.length, 0, "own battle: no toast either");
});

test("card-vs-toast: local-involved battles render the card; remote battles render an info toast", () => {
  registerServerDriven(FLAGGED);
  // Three seats: 0 local human, 1 and 2 AI. AI 1 attacks AI 2's hero.
  const threeSeatState = makeState({
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
      { id: 1, faction: "ai", name: "AI 2", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
      { id: 2, faction: "ai", name: "AI 3", color: "#222222", heroIds: ["h2"], settlementIds: ["s2"] },
    ],
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 20, 20), makeHero("h2", 2, 22, 22)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 20, 20), makeSettlement("s2", 2, 22, 22)],
  });
  const h = attachHarness({ state: threeSeatState, localSeat: 0 });

  h.emitOutcome({
    id: "31",
    payload: heroBattleEvent({ actor: 1, attackerId: "h1", defenderId: "h2" }),
    actorSeat: 1,
  });
  h.emitResync(FLAGGED, threeSeatState);
  assert.equal(h.sink.cards.length, 0, "AI-vs-AI: no card");
  assert.equal(h.sink.toasts.length, 1, "AI-vs-AI: one info toast");
  assert.equal(
    h.sink.toasts[0],
    "AI 2's h1 defeated AI 3's h2 — AI 3's hero slain.",
  );
  detachBattleOutcomeFeedback();

  const h2 = attachHarness({ state: threeSeatState, localSeat: 0 });
  h2.emitOutcome({
    id: "32",
    payload: heroBattleEvent({ actor: 1, attackerId: "h1", defenderId: "h0" }),
    actorSeat: 1,
  });
  h2.emitResync(FLAGGED, threeSeatState);
  assert.equal(h2.sink.cards.length, 1, "local hero is the defender: card");
  assert.deepEqual(
    h2.sink.cards[0].lines.map((l) => l.text),
    ["Player 1's h0 was slain."],
    "the card carries the per-side verdict lines",
  );
  detachBattleOutcomeFeedback();

  const h3 = attachHarness({ state: threeSeatState, localSeat: 0 });
  h3.emitOutcome({
    id: "33",
    payload: settlementBattleEvent({ actor: 1, attackerId: "h1", settlementId: "s2", captured: true }),
    actorSeat: 1,
  });
  h3.emitResync(FLAGGED, threeSeatState);
  assert.equal(h3.sink.cards.length, 0, "remote settlement falls: no card for the local seat");
  assert.equal(h3.sink.toasts.length, 1, "remote settlement falls: info toast");
  assert.equal(h3.sink.toasts[0], "AI 2's h1 captured s2.");
});

test("dedupe: the same event id renders once, and the same battle identity under a fresh id is swallowed inside the window", () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0, identityWindowMs: 60_000 });

  h.emitOutcome({ id: "41", payload: settlementBattleEvent(), actorSeat: 1 });
  h.emitOutcome({ id: "41", payload: settlementBattleEvent(), actorSeat: 1 });
  h.emitOutcome({ id: "42", payload: settlementBattleEvent(), actorSeat: 1 });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 1, "same id twice + same identity once more -> exactly one render");
});

test("a genuinely new battle between the same pair (new obstacleSeed) is not swallowed", () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0, identityWindowMs: 60_000 });

  h.emitOutcome({
    id: "51",
    payload: heroBattleEvent({ attackerId: "h1", defenderId: "h0", obstacleSeed: 1 }),
    actorSeat: 1,
  });
  h.emitOutcome({
    id: "52",
    payload: heroBattleEvent({ attackerId: "h1", defenderId: "h0", obstacleSeed: 2 }),
    actorSeat: 1,
  });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 2, "different battles both render");
});

test("draw wording: hero stalemate card banner and settlement stalemate toast are accurate", () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0 });

  h.emitOutcome({
    id: "61",
    payload: heroBattleEvent({
      winner: "draw",
      attackerOutcome: "survived",
      defenderOutcome: "survived",
      attackerVerdict: "stood",
      defenderVerdict: "stood",
    }),
    actorSeat: 1,
  });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 1);
  assert.equal(h.sink.cards[0].banner, "Draw — both sides stand.");
  assert.equal(h.sink.cards[0].lines.length, 0, "'stood' verdicts render no lines");
  detachBattleOutcomeFeedback();

  const remoteState = makeState({
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
      { id: 1, faction: "ai", name: "AI 2", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
      { id: 2, faction: "ai", name: "AI 3", color: "#222222", heroIds: ["h2"], settlementIds: ["s2"] },
    ],
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 22, 22), makeHero("h2", 2, 24, 24)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 20, 20), makeSettlement("s2", 2, 22, 22)],
  });
  const h2 = attachHarness({ state: remoteState, localSeat: 0 });
  h2.emitOutcome({
    id: "62",
    payload: settlementBattleEvent({
      attackerId: "h1",
      settlementId: "s2",
      winner: "defender",
      captured: false,
      outcome: "draw",
      attackerVerdict: "stood",
    }),
    actorSeat: 1,
  });
  h2.emitResync(FLAGGED, remoteState);
  assert.equal(h2.sink.toasts.length, 1);
  assert.equal(
    h2.sink.toasts[0],
    "The assault on s2 stalled — the garrison holds.",
    "a settlement draw is a stalemate, never 'both sides fell'",
  );
});

test("absent verdicts (pre-B6 servers) suppress verdict lines and normalize outcome off the legacy winner", () => {
  registerServerDriven(FLAGGED);
  const state = makeState();

  const legacySettlement = settlementBattleEvent();
  delete (legacySettlement as Partial<typeof legacySettlement>).outcome;
  delete (legacySettlement as Partial<typeof legacySettlement>).attackerVerdict;
  const h = attachHarness({ state, localSeat: 0 });
  h.emitOutcome({ id: "71", payload: legacySettlement, actorSeat: 1 });
  h.emitResync(FLAGGED, state);
  assert.equal(h.sink.cards.length, 1);
  assert.equal(h.sink.cards[0].lines.length, 0, "absent verdict renders no line");
  assert.equal(h.sink.cards[0].banner, "AI's h1 captured s0!", "winner+captured still word the banner");
  detachBattleOutcomeFeedback();

  const legacyHero = heroBattleEvent();
  delete (legacyHero as Partial<typeof legacyHero>).attackerVerdict;
  delete (legacyHero as Partial<typeof legacyHero>).defenderVerdict;
  const h2 = attachHarness({ state, localSeat: 0 });
  h2.emitOutcome({ id: "72", payload: legacyHero, actorSeat: 1 });
  h2.emitResync(FLAGGED, state);
  assert.equal(h2.sink.cards.length, 1);
  assert.equal(h2.sink.cards[0].lines.length, 0, "absent hero verdicts render no lines");
  assert.equal(h2.sink.cards[0].banner, "AI's h1 wins!");
});

test("retreat verdicts resolve the relocation settlement name from post-resync state", () => {
  registerServerDriven(FLAGGED);
  // Pre-battle: AI h1 stands on the local settlement s0 at (2,2).
  const preState = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  // Post-resync: the garrison held and h1 relocated to its own s1 at (18,4).
  const postState = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const h = attachHarness({ state: preState, localSeat: 0 });

  h.emitOutcome({
    id: "81",
    payload: settlementBattleEvent({
      winner: "defender",
      captured: false,
      outcome: "defenderWon",
      attackerVerdict: "retreated",
    }),
    actorSeat: 1,
  });
  h.emitResync(FLAGGED, postState);
  assert.equal(h.sink.cards.length, 1);
  assert.deepEqual(
    h.sink.cards[0].lines.map((l) => l.text),
    ["AI's h1 retreated to s1."],
  );
});

test("fallback timer renders from current state when the resync never lands", async () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0, renderFallbackMs: 15 });

  h.emitOutcome({ id: "91", payload: settlementBattleEvent(), actorSeat: 1 });
  assert.equal(h.sink.cards.length, 0, "nothing renders before the resync/timer");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(h.sink.cards.length, 1, "the fallback timer rendered from current state");
});

test("a pending from a switched-away game is dropped by the fallback timer, not rendered against the wrong game", async () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  let activeGame: string | null = FLAGGED;
  const sink = makeSink();
  attachBattleOutcomeFeedback({
    getState: () => state,
    getGameName: () => activeGame,
    getLocalSeat: () => 0,
    renderFallbackMs: 15,
    render: sink.render,
  });
  bus.emit({
    type: "mp:battleOutcome",
    gameName: FLAGGED,
    id: "101",
    kind: "settlementBattle",
    payload: settlementBattleEvent() as never,
    actorSeat: 1,
  });
  activeGame = "some-other-game";
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sink.cards.length + sink.toasts.length, 0, "cross-game render is dropped");
});

test("detach stops all listening and clears pending timers", async () => {
  registerServerDriven(FLAGGED);
  const state = makeState();
  const h = attachHarness({ state, localSeat: 0, renderFallbackMs: 15 });
  h.emitOutcome({ id: "111", payload: settlementBattleEvent(), actorSeat: 1 });
  detachBattleOutcomeFeedback();
  h.emitResync(FLAGGED, state);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(h.sink.cards.length + h.sink.toasts.length, 0, "nothing renders after detach");
});

test("pure policy: null local seat and neutral settlements are never involved", () => {
  const state = makeState();
  const settlementEvent = settlementBattleEvent();
  assert.equal(isLocalSeatInvolved("settlementBattle", settlementEvent, 1, null, state), false);
  const neutralState = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", null, 2, 2)],
  });
  assert.equal(
    isLocalSeatInvolved("settlementBattle", settlementEvent, 1, 0, neutralState),
    false,
    "a neutral garrison has no owner seat to involve",
  );
  assert.equal(
    isLocalSeatInvolved("heroBattle", heroBattleEvent(), 1, 0, state),
    true,
    "the local seat's hero as defender is involved",
  );
});

test("pure builders: pending capture and render-time wording", () => {
  const preState = makeState();
  const ev = {
    gameName: FLAGGED,
    kind: "settlementBattle" as const,
    payload: settlementBattleEvent(),
    actorSeat: 1,
  };
  const pending: PendingBattleOutcome = buildPendingOutcome(ev, true, preState);
  assert.equal(pending.family, "settlement");
  assert.equal(buildCardModel(pending, preState).banner, "AI's h1 captured s0!");
  assert.equal(buildToastText(pending, preState), "AI's h1 captured s0.");
});
