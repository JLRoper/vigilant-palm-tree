import type { GameState, TradeRouteEndpoint, TradeRoutePayload, WarehouseResource } from "@heroes/contracts";
import {
  evaluateTradeNeeds,
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  heroTreasuryWagons,
  heroWagons,
  playerTreasuryWagonsOwned,
  playerTreasuryWagonsUnassigned,
  playerWagonsOwned,
  playerWagonsUnassigned,
  routeOwnerId,
  settlementProductionRates,
  settlementResourceCap,
  settlementTreasuryCap,
} from "@heroes/engine";
import { cachedUnitTypes } from "../../data/unitCatalog";
import { showToast } from "../shared/toast";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";

const RES: WarehouseResource[] = ["wood", "stone", "iron", "arcane", "food"];

// U2 (logistics-interface-fixes plan §5.8): local {ok, reason} rejections used
// to vanish — with the standard 0-wagon starting pool, Accept and wagon "+1"
// silently did nothing. The same toast surface reportCommandFailure feeds
// (src/screens/shared/toast.ts) now carries the engine's reason codes.
const REJECTION_MESSAGES: Record<string, string> = {
  not_your_turn: "it is not your turn",
  no_hero: "the hero no longer exists",
  no_settlement: "the settlement no longer exists",
  no_player: "the player seat no longer exists",
  no_route: "the route no longer exists",
  forbidden_not_your_hero: "the hero is not yours",
  forbidden_not_your_settlement: "the settlement is not yours",
  not_enough_gold: "not enough gold in the settlement treasury",
  not_enough_wood: "not enough wood in the settlement warehouse",
  not_enough_wagons: "the hero has no wagons of that slot to give back",
  not_enough_wagons_unassigned: "no unassigned wagons — buy one below",
  no_unassigned_wagons: "no unassigned wagons — buy one below",
  same_endpoint: "origin and destination are the same endpoint",
  same_tile: "origin and destination share a tile — a caravan could never load",
  route_in_flight: "the caravan is mid-flight — wait for it to come home",
  route_needs_a_wagon: "a route always keeps at least one wagon",
  invalid_amount: "invalid wagon count",
  invalid_resource: "invalid payload resource",
  nothing_transferred: "nothing was transferred",
};

function rejectionToast(action: string, reason: string): void {
  const known = REJECTION_MESSAGES[reason];
  showToast(`Logistics — ${action} failed: ${known ?? reason.replace(/_/g, " ")}`, "error");
}

function setUnavailable(btn: HTMLButtonElement, title: string): void {
  btn.disabled = true;
  btn.style.opacity = "0.4";
  btn.style.cursor = "default";
  btn.title = title;
}

/** Display label for a route endpoint: settlement names as-is, heroes distinctly. */
function endpointLabel(state: GameState, endpoint: TradeRouteEndpoint): string {
  if (endpoint.kind === "settlement") return state.settlements[endpoint.id]?.name ?? "?";
  return `Hero: ${state.heroes[endpoint.id]?.name ?? "?"}`;
}

export interface LogisticsModalOptions {
  parent: HTMLElement;
  getState: () => GameState;
  actions: {
    transferResources: (
      heroId: string,
      settlementId: string,
      direction: "load" | "unload",
      amounts: Partial<Record<WarehouseResource, number>>,
    ) => { ok: boolean; reason: string };
    assignWagons: (
      heroId: string,
      delta: number,
      slot?: "cargo" | "treasury",
    ) => { ok: boolean; reason: string };
    buyWagons: (
      settlementId: string,
      count: number,
      slot?: "cargo" | "treasury",
    ) => { ok: boolean; reason: string };
    createTradeRoute: (
      from: TradeRouteEndpoint,
      to: TradeRouteEndpoint,
      payload: TradeRoutePayload,
      wagons: number,
    ) => { ok: boolean; reason: string };
    updateTradeRoute: (
      routeId: string,
      change: { wagonsDelta?: number; remove?: boolean; resource?: WarehouseResource },
    ) => { ok: boolean; reason: string };
  };
}

/** One-stop logistics modal: selected hero cargo/wagons, settlement stockpile caps, wagon purchases, trade routes. */
export function openLogisticsModal(opts: LogisticsModalOptions): void {
  const modal = openCenteredModal(opts.parent, "Logistics", 460, true, true);

  const render = (): void => {
    const state = opts.getState();
    modal.body.replaceChildren();

    const owned = Object.values(state.settlements).filter((s) => s.ownerId === state.activePlayerId);
    const hero =
      (state.selectedHeroId ? state.heroes[state.selectedHeroId] : undefined) ??
      Object.values(state.heroes).find((h) => h.ownerId === state.activePlayerId);
    const player = state.players.find((p) => p.id === state.activePlayerId);

    const section = (title: string): HTMLDivElement => {
      const el = document.createElement("div");
      el.textContent = title;
      Object.assign(el.style, {
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        opacity: "0.6",
        margin: "10px 0 4px",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        paddingBottom: "2px",
      });
      modal.body.appendChild(el);
      return el;
    };

    // ── Hero ──
    if (hero) {
      section(`Hero — ${hero.name}`);
      const cargo = heroCargo(hero);
      const caps = heroResourceCap(hero);
      const info = document.createElement("div");
      info.style.cssText = "font-size:12px;opacity:0.85;margin-bottom:4px;font-variant-numeric:tabular-nums;";
      info.textContent = `Purse ${hero.gold}/${heroGoldCap(hero)}g · Cargo wagons ${heroWagons(hero)} · Treasury carts ${heroTreasuryWagons(hero)}`;
      modal.body.appendChild(info);
      for (const r of RES) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:3px;font-variant-numeric:tabular-nums;";
        const label = document.createElement("span");
        label.style.flex = "1";
        label.textContent = `${r}: ${cargo[r] ?? 0}/${caps[r]}`;
        row.appendChild(label);
        modal.body.appendChild(row);
      }
      // The two wagon slots (Phase 1 treasury-wagons split): army cargo
      // wagons and treasury carts are independent, each with its own ±1
      // against the matching pool. (These ±1s used to sit on every
      // per-resource row, but they always assigned the same cargo wagons;
      // the split gives each slot one honest row with its pool readout.)
      const wagonRow = (
        label: string,
        count: number,
        poolUnassigned: number,
        slot: "cargo" | "treasury",
      ): void => {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:3px;font-variant-numeric:tabular-nums;";
        const text = document.createElement("span");
        text.style.flex = "1";
        text.textContent = `${label}: ${count} · pool ${poolUnassigned} unassigned`;
        row.appendChild(text);
        for (const [delta, text2] of [
          [-1, "−1"],
          [1, "+1"],
        ] as const) {
          const btn = document.createElement("button");
          btn.textContent = text2;
          styleButton(btn);
          btn.style.fontSize = "10px";
          btn.style.padding = "1px 6px";
          if (delta > 0 && poolUnassigned <= 0) {
            setUnavailable(btn, "no unassigned wagons — buy one below");
          }
          btn.addEventListener("click", () => {
            const result = opts.actions.assignWagons(hero.id, delta, slot);
            if (!result.ok) rejectionToast(delta > 0 ? "wagon assignment" : "wagon return", result.reason);
            setTimeout(render, 30);
          });
          row.appendChild(btn);
        }
        modal.body.appendChild(row);
      };
      if (player) {
        wagonRow("Cargo wagons", heroWagons(hero), playerWagonsUnassigned(player), "cargo");
        wagonRow("Treasury carts", heroTreasuryWagons(hero), playerTreasuryWagonsUnassigned(player), "treasury");
      }
    }

    // ── Wagon pool ──
    if (player) {
      section("Wagon pools");
      const row = document.createElement("div");
      row.style.cssText = "font-size:12px;opacity:0.85;font-variant-numeric:tabular-nums;";
      row.textContent =
        `Cargo: ${playerWagonsOwned(player)} owned · ${playerWagonsUnassigned(player)} unassigned · ` +
        `Treasury: ${playerTreasuryWagonsOwned(player)} owned · ${playerTreasuryWagonsUnassigned(player)} unassigned`;
      modal.body.appendChild(row);
    }

    // ── Settlements ──
    section("Settlement stockpiles");
    for (const s of owned) {
      const caps = settlementResourceCap(s);
      const row = document.createElement("div");
      row.style.cssText =
        "font-size:12px;margin-bottom:4px;font-variant-numeric:tabular-nums;line-height:1.5;";
      const name = document.createElement("div");
      name.textContent = `${s.name} (L${s.level}) — treasury ${s.gold}/${settlementTreasuryCap(s)}g`;
      name.style.fontWeight = "600";
      row.appendChild(name);
      const stock = document.createElement("div");
      stock.textContent = RES.map(
        (r) => `${r}: ${Math.floor(s.warehouse[r] ?? 0)}/${caps[r]}`,
      ).join(" · ");
      stock.style.opacity = "0.8";
      row.appendChild(stock);
      // Per-turn production rates — BOTH halves of the production loop,
      // combined by settlementProductionRates: the warehouseRates() tile
      // rates plus the per-building producers (farmField/farmhouse/granary
      // food, woodcutterHut wood, goldMine gold; in-construction buildings
      // contribute nothing). Gold goes to the treasury, not the warehouse, so
      // it is shown as its own segment; the tile rate map's gold entry is
      // never paid and is deliberately absent.
      const production = settlementProductionRates(s, state.castleSeed);
      const productionParts = production.rates.map((r) => `${r.perTurn} ${r.resource}`);
      if (production.goldPerTurn > 0) productionParts.push(`${production.goldPerTurn} gold (treasury)`);
      const ratesRow = document.createElement("div");
      ratesRow.textContent =
        productionParts.length > 0 ? `+${productionParts.join(", +")}/turn` : "no production";
      ratesRow.style.cssText = "font-size:11px;opacity:0.65;";
      row.appendChild(ratesRow);
      const buyRow = document.createElement("div");
      buyRow.style.cssText = "display:flex;gap:6px;margin-top:3px;align-items:center;";
      for (const [slot, label, title] of [
        ["cargo", "Buy wagon (200g 5w)", "Buys a cargo wagon into the player's unassigned pool"],
        ["treasury", "Buy cart (200g 5w)", "Buys a treasury cart into the player's unassigned cart pool (gold capacity)"],
      ] as const) {
        const buyBtn = document.createElement("button");
        buyBtn.textContent = label;
        buyBtn.title = title;
        styleButton(buyBtn);
        buyBtn.style.fontSize = "10px";
        buyBtn.style.padding = "1px 6px";
        buyBtn.addEventListener("click", () => {
          const result = opts.actions.buyWagons(s.id, 1, slot);
          if (!result.ok) rejectionToast("wagon purchase", result.reason);
          setTimeout(render, 30);
        });
        buyRow.appendChild(buyBtn);
      }
      row.appendChild(buyRow);
      modal.body.appendChild(row);
    }

    // ── Recommendations ──
    // The Phase 5 recommendation engine: food/gold routes into low
    // settlements and heroes. Re-evaluated on every render (so an Accept
    // refreshes the list against the post-create state); each row accepts
    // in one click through the same createTradeRoute path as the manual
    // form, allocating exactly the suggested wagons.
    const recommendations = evaluateTradeNeeds(state, state.activePlayerId, cachedUnitTypes());
    if (recommendations.length > 0) {
      section("Recommended routes");
      const poolFor = (payload: TradeRoutePayload): number =>
        payload.kind === "gold"
          ? (player?.treasuryWagonsUnassigned ?? 0)
          : (player?.wagonsUnassigned ?? 0);
      for (const rec of recommendations) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;font-variant-numeric:tabular-nums;";
        const label = document.createElement("span");
        label.style.flex = "1";
        const payloadText = rec.payload.kind === "gold" ? "gold" : rec.payload.resource;
        label.textContent =
          `${rec.wagons}\u{1F69F} ${payloadText}: ${endpointLabel(state, rec.from)} \u2192 ${endpointLabel(state, rec.to)} — ${rec.reason}`;
        label.title = rec.reason;
        row.appendChild(label);
        const acceptBtn = document.createElement("button");
        acceptBtn.textContent = "Accept";
        styleButton(acceptBtn);
        acceptBtn.style.fontSize = "10px";
        acceptBtn.style.padding = "1px 8px";
        if (poolFor(rec.payload) <= 0) {
          setUnavailable(acceptBtn, "no unassigned wagons — buy one below");
        }
        acceptBtn.addEventListener("click", () => {
          const result = opts.actions.createTradeRoute(rec.from, rec.to, rec.payload, rec.wagons);
          if (!result.ok) rejectionToast("route creation", result.reason);
          setTimeout(render, 30);
        });
        row.appendChild(acceptBtn);
        modal.body.appendChild(row);
      }
      const acceptAll = document.createElement("button");
      acceptAll.textContent = `Accept all (${recommendations.length})`;
      styleButton(acceptAll);
      acceptAll.style.fontSize = "10px";
      acceptAll.style.padding = "1px 8px";
      acceptAll.addEventListener("click", () => {
        // Continues past failures (a mid-list rejection used to silently
        // strand the rest) and summarizes the outcome — created N, failed M
        // with the reasons — instead of breaking on the first rejection.
        let created = 0;
        const failures = new Map<string, number>();
        for (const rec of recommendations) {
          const result = opts.actions.createTradeRoute(rec.from, rec.to, rec.payload, rec.wagons);
          if (result.ok) {
            created++;
          } else {
            failures.set(result.reason, (failures.get(result.reason) ?? 0) + 1);
          }
        }
        const failed = [...failures.values()].reduce((a, b) => a + b, 0);
        const reasonText = [...failures.entries()]
          .map(([reason, count]) => `${count}× ${REJECTION_MESSAGES[reason] ?? reason}`)
          .join("; ");
        if (failed === 0) {
          showToast(`Created ${created} trade route${created === 1 ? "" : "s"}.`, "info");
        } else {
          showToast(
            `Trade routes — created ${created}, failed ${failed}${reasonText ? `: ${reasonText}` : ""}.`,
            created > 0 ? "info" : "error",
          );
        }
        setTimeout(render, 30);
      });
      modal.body.appendChild(acceptAll);
    }

    // ── Trade routes ──
    section("Trade routes");
    const routes = state.tradeRoutes ?? [];
    // U3: a route belongs to its persisted owner when stamped (hydrated
    // routes always carry one) — the old FROM-endpoint-only derivation
    // misfiled a captured origin under the capturer and made a route vanish
    // entirely once its origin hero died. Absent stamp falls back to the
    // FROM endpoint's live owner (legacy rows).
    const playerRoutes = routes.filter((r) => routeOwnerId(r, state) === state.activePlayerId);
    if (playerRoutes.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No routes yet.";
      empty.style.cssText = "font-size:12px;opacity:0.6;";
      modal.body.appendChild(empty);
    }
    for (const route of playerRoutes) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;font-variant-numeric:tabular-nums;";
      const label = document.createElement("span");
      label.style.flex = "1";
      const caravanInfo = route.caravan
        ? route.caravan.phase === "toDestination"
          ? "outbound"
          : "returning"
        : "loading";
      const payloadText = route.payload.kind === "gold" ? "gold" : route.payload.resource;
      label.textContent = `${route.wagons}\u{1F69F} ${payloadText}: ${endpointLabel(state, route.from)} \u2192 ${endpointLabel(state, route.to)} (${caravanInfo})`;
      row.appendChild(label);
      for (const [delta, text] of [
        [-1, "−1"],
        [1, "+1"],
      ] as const) {
        const btn = document.createElement("button");
        btn.textContent = text;
        styleButton(btn);
        btn.style.fontSize = "10px";
        btn.style.padding = "1px 5px";
        btn.addEventListener("click", () => {
          const result = opts.actions.updateTradeRoute(route.id, { wagonsDelta: delta });
          if (!result.ok) rejectionToast("route update", result.reason);
          setTimeout(render, 30);
        });
        row.appendChild(btn);
      }
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "\u2715";
      styleButton(removeBtn);
      removeBtn.style.fontSize = "10px";
      removeBtn.style.padding = "1px 6px";
      removeBtn.title = "Disband this route (wagons return to the pool; cargo aboard is lost)";
      removeBtn.addEventListener("click", () => {
        const result = opts.actions.updateTradeRoute(route.id, { remove: true });
        if (!result.ok) rejectionToast("route removal", result.reason);
        setTimeout(render, 30);
      });
      row.appendChild(removeBtn);
      modal.body.appendChild(row);
    }

    // ── Create route ──
    // Endpoints can be any same-owner pair of owned settlements and owned
    // heroes ("treasure wagons trade route between him and a city"), so the
    // row appears as soon as two endpoint candidates exist at all -- a lone
    // settlement plus a lone hero is a legal route.
    const ownedHeroes = Object.values(state.heroes).filter((h) => h.ownerId === state.activePlayerId);
    if (owned.length + ownedHeroes.length >= 2) {
      const createRow = document.createElement("div");
      createRow.style.cssText = "display:flex;gap:6px;margin-top:4px;align-items:center;";
      const fromSel = document.createElement("select") as HTMLSelectElement;
      styleInput(fromSel as unknown as HTMLInputElement);
      fromSel.style.flex = "1.2";
      const toSel = document.createElement("select") as HTMLSelectElement;
      styleInput(toSel as unknown as HTMLInputElement);
      toSel.style.flex = "1.2";
      // Option values carry the endpoint kind ("s:<id>" / "h:<id>") so the
      // two id namespaces cannot collide in the select.
      for (const sel of [fromSel, toSel]) {
        for (const s of owned) {
          const opt = document.createElement("option");
          opt.value = `s:${s.id}`;
          opt.textContent = s.name;
          sel.appendChild(opt);
        }
        for (const h of ownedHeroes) {
          const opt = document.createElement("option");
          opt.value = `h:${h.id}`;
          opt.textContent = `Hero: ${h.name}`;
          sel.appendChild(opt);
        }
      }
      // Payload: "gold" is a treasure caravan; each resource is a cargo caravan.
      const payloadSel = document.createElement("select") as HTMLSelectElement;
      styleInput(payloadSel as unknown as HTMLInputElement);
      payloadSel.style.flex = "0.9";
      for (const [value, text] of [
        ["wood", "wood"],
        ["stone", "stone"],
        ["iron", "iron"],
        ["arcane", "arcane"],
        ["food", "food"],
        ["gold", "gold (treasure)"],
      ] as const) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        payloadSel.appendChild(opt);
      }
      const wagonInput = document.createElement("input");
      styleInput(wagonInput);
      wagonInput.type = "number";
      wagonInput.min = "1";
      wagonInput.value = "1";
      wagonInput.style.width = "52px";
      const createBtn = document.createElement("button");
      createBtn.textContent = "Create";
      styleButton(createBtn);
      // U4: the engine rejects an over-pool create (not_enough_wagons_unassigned)
      // rather than clamping, so the button pre-disables to match and says why.
      const updateCreateAvailability = (): void => {
        const isGold = payloadSel.value === "gold";
        const pool = isGold
          ? (player?.treasuryWagonsUnassigned ?? 0)
          : (player?.wagonsUnassigned ?? 0);
        const wanted = Math.max(1, Math.floor(Number(wagonInput.value) || 1));
        if (wanted > pool) {
          setUnavailable(
            createBtn,
            `needs ${wanted} unassigned ${isGold ? "carts" : "wagons"} — the pool has ${pool} (buy more below)`,
          );
        } else {
          createBtn.disabled = false;
          createBtn.style.opacity = "1";
          createBtn.style.cursor = "pointer";
          createBtn.title = "";
        }
      };
      wagonInput.addEventListener("input", updateCreateAvailability);
      payloadSel.addEventListener("change", updateCreateAvailability);
      createBtn.addEventListener("click", () => {
        const parseEndpoint = (value: string): TradeRouteEndpoint | null => {
          if (value.startsWith("s:")) return { kind: "settlement", id: value.slice(2) };
          if (value.startsWith("h:")) return { kind: "hero", id: value.slice(2) };
          return null;
        };
        const from = parseEndpoint(fromSel.value);
        const to = parseEndpoint(toSel.value);
        if (!from || !to) return;
        if (from.kind === to.kind && from.id === to.id) return;
        const payload: TradeRoutePayload =
          payloadSel.value === "gold"
            ? { kind: "gold" }
            : { kind: "resource", resource: payloadSel.value as WarehouseResource };
        const wagons = Math.max(1, Math.floor(Number(wagonInput.value) || 1));
        const result = opts.actions.createTradeRoute(from, to, payload, wagons);
        if (!result.ok) rejectionToast("route creation", result.reason);
        setTimeout(render, 30);
      });
      createRow.append(fromSel, toSel, payloadSel, wagonInput, createBtn);
      updateCreateAvailability();
      modal.body.appendChild(createRow);
    }

    const hint = document.createElement("div");
    hint.textContent =
      "Cargo caravans carry one resource (wagons\u00d750); treasure caravans carry gold (wagons\u00d7500). They walk 4 tiles/day, re-path daily to reach a moving hero endpoint, and wait (never lose cargo) when the destination is full. A route whose origin is lost or captured goes dormant: it bills nothing and never deserts, and resumes if you retake it. When a route's last wagon deserts, the route disbands and returns what fits at the origin — the rest is lost. Removing a route manually also loses its aboard cargo.";
    hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;line-height:1.4;";
    modal.body.appendChild(hint);
  };

  render();
}
