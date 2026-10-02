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
  settlementResourceCap,
  settlementTreasuryCap,
  warehouseRates,
} from "@heroes/engine";
import { cachedUnitTypes } from "../../data/unitCatalog";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";

const RES: WarehouseResource[] = ["wood", "stone", "iron", "arcane", "food"];

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
          btn.addEventListener("click", () => {
            opts.actions.assignWagons(hero.id, delta, slot);
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
      // Per-turn production rates — the Phase 0 rates surface, restored from
      // warehouseRates() (the same loop production delivers through; never
      // the raw resourceRates map, whose gold entry nothing ever pays).
      const rates = warehouseRates(s.resourceRates);
      const ratesRow = document.createElement("div");
      ratesRow.textContent =
        rates.length > 0
          ? `+${rates.map((r) => `${r.perTurn} ${r.resource}`).join(", +")}/turn`
          : "no warehouse production";
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
          opts.actions.buyWagons(s.id, 1, slot);
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
        acceptBtn.addEventListener("click", () => {
          opts.actions.createTradeRoute(rec.from, rec.to, rec.payload, rec.wagons);
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
        for (const rec of recommendations) {
          const result = opts.actions.createTradeRoute(rec.from, rec.to, rec.payload, rec.wagons);
          if (!result.ok) break;
        }
        setTimeout(render, 30);
      });
      modal.body.appendChild(acceptAll);
    }

    // ── Trade routes ──
    section("Trade routes");
    const routes = state.tradeRoutes ?? [];
    // A route belongs to the active player when its FROM endpoint does --
    // settlement or hero, resolved per kind.
    const playerRoutes = routes.filter((r) => {
      if (r.from.kind === "settlement") {
        return state.settlements[r.from.id]?.ownerId === state.activePlayerId;
      }
      return state.heroes[r.from.id]?.ownerId === state.activePlayerId;
    });
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
          opts.actions.updateTradeRoute(route.id, { wagonsDelta: delta });
          setTimeout(render, 30);
        });
        row.appendChild(btn);
      }
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "\u2715";
      styleButton(removeBtn);
      removeBtn.style.fontSize = "10px";
      removeBtn.style.padding = "1px 6px";
      removeBtn.addEventListener("click", () => {
        opts.actions.updateTradeRoute(route.id, { remove: true });
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
        opts.actions.createTradeRoute(from, to, payload, wagons);
        setTimeout(render, 30);
      });
      createRow.append(fromSel, toSel, payloadSel, wagonInput, createBtn);
      modal.body.appendChild(createRow);
    }

    const hint = document.createElement("div");
    hint.textContent =
      "Cargo caravans carry one resource (wagons\u00d750); treasure caravans carry gold (wagons\u00d7500). They walk 4 tiles/day, re-path daily to reach a moving hero endpoint, and wait (never lose cargo) when the destination is full.";
    hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;line-height:1.4;";
    modal.body.appendChild(hint);
  };

  render();
}
