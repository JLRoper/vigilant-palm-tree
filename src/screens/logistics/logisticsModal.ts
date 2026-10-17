import type { GameState, TradeRouteEndpoint, TradeRoutePayload, TradeRouteState, WarehouseResource } from "@heroes/contracts";
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
import { bus } from "../../core/eventBus";
import { viewSeat } from "../../state/viewSeat";
import { cachedUnitTypes } from "../../data/unitCatalog";
import {
  CARAVAN_SPRITES,
  CASTLE_ALT2_DESCRIPTORS,
  CASTLE_ALT3_DESCRIPTORS,
  CASTLE_ALT_DESCRIPTORS,
  CASTLE_DESCRIPTORS,
  HERO_PLAYER_DESCRIPTORS,
  HORSE_VARIANT_DESCRIPTORS,
  castleKey,
} from "../../render/assetDescriptors";
import { showToast } from "../shared/toast";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";
import { STORAGE_GAUGE_SHEET } from "./storageGaugeAssets";
import {
  formatStorageAmount,
  formatStoragePercentage,
  getEndpointStorage,
  getRouteProgress,
  getRouteTooltipText,
  getStorageMeterState,
  STORAGE_GAUGE_FRAME_COUNT,
  STORAGE_GAUGE_HEIGHT,
} from "./routeVisualization";

const RES: WarehouseResource[] = ["wood", "stone", "iron", "arcane", "food"];
const CASTLE_MAP_DESCRIPTORS = {
  ...CASTLE_DESCRIPTORS,
  ...CASTLE_ALT_DESCRIPTORS,
  ...CASTLE_ALT2_DESCRIPTORS,
  ...CASTLE_ALT3_DESCRIPTORS,
};

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

function routeEndpointArtwork(state: GameState, endpoint: TradeRouteEndpoint): {
  name: string;
  kind: string;
  image: string;
} {
  if (endpoint.kind === "hero") {
    const hero = state.heroes[endpoint.id];
    const variant = hero?.horseVariant ?? "hero";
    const image =
      variant === "hero"
        ? HERO_PLAYER_DESCRIPTORS["hero.player.s"].url
        : HORSE_VARIANT_DESCRIPTORS[variant]?.[`horse.${variant}.s`]?.url;
    return {
      name: hero?.name ?? "Missing hero",
      kind: "Hero",
      image: image ?? HERO_PLAYER_DESCRIPTORS["hero.player.s"].url!,
    };
  }
  const settlement = state.settlements[endpoint.id];
  const level = settlement?.level ?? 1;
  const image = CASTLE_MAP_DESCRIPTORS[
    castleKey(level, settlement?.castleVariant ?? 0)
  ]?.url;
  return {
    name: settlement?.name ?? "Missing settlement",
    kind: "Settlement",
    image: image ?? CASTLE_DESCRIPTORS[`castle.${level}`].url!,
  };
}

function routeEndpointPanel(
  state: GameState,
  endpoint: TradeRouteEndpoint,
  payload: TradeRoutePayload,
  side: "source" | "destination",
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.style.cssText = "display:flex;min-width:0;flex-direction:column;align-items:center;";

  const artwork = routeEndpointArtwork(state, endpoint);
  const image = document.createElement("img");
  image.src = artwork.image;
  image.alt = `${artwork.kind}: ${artwork.name}`;
  image.loading = "lazy";
  image.style.cssText =
    "width:34px;height:34px;flex:none;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55));";

  const storage = getEndpointStorage(state, endpoint, payload);
  const imageAndMeter = document.createElement("div");
  imageAndMeter.style.cssText = `display:flex;width:100%;height:${STORAGE_GAUGE_HEIGHT}px;align-items:center;justify-content:center;gap:3px;`;
  if (storage) {
    const meterState = getStorageMeterState(storage.amount, storage.capacity);
    const meter = document.createElement("div");
    meter.style.cssText =
      `width:18px;height:${STORAGE_GAUGE_HEIGHT}px;flex:none;background-image:url("${STORAGE_GAUGE_SHEET}");` +
      `background-size:${STORAGE_GAUGE_FRAME_COUNT * 100}% 100%;background-position:${(meterState.frameIndex / (STORAGE_GAUGE_FRAME_COUNT - 1)) * 100}% 0;background-repeat:no-repeat;`;
    const percentText = formatStoragePercentage(meterState.percentage);
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(Math.round(meterState.fillPercentage)));
    meter.setAttribute(
      "aria-valuetext",
      `${meterState.percentage === null ? "No capacity" : `${percentText} full`}; ${formatStorageAmount(storage.amount)} of ${formatStorageAmount(storage.capacity)} ${storage.resourceName} in ${storage.storeName}`,
    );
    meter.setAttribute("aria-label", `${storage.storeName} ${storage.resourceName}`);

    if (side === "source") imageAndMeter.append(image, meter);
    else imageAndMeter.append(meter, image);
  } else {
    imageAndMeter.appendChild(image);
  }
  panel.appendChild(imageAndMeter);
  return panel;
}

function routeJourneyPanel(state: GameState, route: TradeRouteState): HTMLDivElement {
  const panel = document.createElement("div");
  panel.style.cssText = "min-width:0;display:flex;align-items:center;";
  const progress = getRouteProgress(route, state);
  const label = progress.waitingAtDestination
    ? "Waiting for destination space"
    : progress.direction === "loading"
      ? "Loading at source"
      : progress.direction === "outbound"
        ? "To destination"
        : "Returning home";

  const track = document.createElement("div");
  track.style.cssText =
    "flex:1;min-width:0;position:relative;height:4px;margin:12px 11px;border-radius:999px;background:#263347;";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(Math.round(progress.legPercentage)));
  track.setAttribute("aria-label", `${label} progress`);
  track.setAttribute("aria-valuetext", `${label}: ${formatStoragePercentage(progress.legPercentage)}`);

  const fill = document.createElement("div");
  fill.style.cssText = "position:absolute;top:0;height:100%;border-radius:999px;background:linear-gradient(90deg,#6acb91,#85d9ce);";
  if (progress.direction === "returning") {
    fill.style.left = `${progress.positionPercentage}%`;
    fill.style.width = `${100 - progress.positionPercentage}%`;
  } else {
    fill.style.left = "0";
    fill.style.width = `${progress.positionPercentage}%`;
  }
  track.appendChild(fill);

  const marker = document.createElement("img");
  marker.src = CARAVAN_SPRITES[route.payload.kind];
  marker.alt = "";
  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText =
    `position:absolute;left:${progress.positionPercentage}%;top:50%;width:22px;height:22px;max-width:none;object-fit:contain;transform:translate(-50%,-50%);`;
  track.appendChild(marker);
  panel.appendChild(track);
  return panel;
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
  let detachRouteRefresh = (): void => {};
  const modal = openCenteredModal(opts.parent, "Logistics", 660, true, true, () => detachRouteRefresh());
  modal.root.style.width = "min(660px, calc(100vw - 48px))";
  modal.root.style.maxWidth = "calc(100vw - 48px)";

  // Persistent create-form controls, held across renders so an automatic
  // refresh (state:committed / turn:ended / resync) can preserve the user's
  // in-progress draft and keyboard focus instead of resetting the selectors.
  let fromSel: HTMLSelectElement | null = null;
  let toSel: HTMLSelectElement | null = null;
  let payloadSel: HTMLSelectElement | null = null;
  let wagonInput: HTMLInputElement | null = null;

  const render = (): void => {
    const state = opts.getState();
    // The panel is tied to the VIEWING seat, not the active player: a
    // spectator (or any seat whose turn it isn't) still sees and manages
    // their own routes, pools, and recommendations.
    const localSeat = viewSeat();
    const draft = {
      from: fromSel?.value ?? "",
      to: toSel?.value ?? "",
      payload: payloadSel?.value ?? "",
      wagons: wagonInput?.value ?? "",
      focusedField:
        (document.activeElement as HTMLElement | null)?.dataset?.field ??
        (document.activeElement as HTMLElement | null)?.dataset?.focus ??
        null,
    };
    modal.body.replaceChildren();

    const owned = Object.values(state.settlements).filter((s) => s.ownerId === localSeat);
    const hero =
      (state.selectedHeroId ? state.heroes[state.selectedHeroId] : undefined) ??
      Object.values(state.heroes).find((h) => h.ownerId === localSeat);
    const player = state.players.find((p) => p.id === localSeat);

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
          btn.dataset.focus = `hero-wagon-${slot}-${delta > 0 ? "plus" : "minus"}`;
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
      const production = settlementProductionRates(s, state.castleSeed, state.heroes);
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
        buyBtn.dataset.focus = `buy-wagon-${s.id}-${slot}`;
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
    const recommendations = evaluateTradeNeeds(state, localSeat, cachedUnitTypes());
    if (recommendations.length > 0) {
      section("Recommended routes");
      const poolFor = (payload: TradeRoutePayload): number =>
        payload.kind === "gold"
          ? (player?.treasuryWagonsUnassigned ?? 0)
          : (player?.wagonsUnassigned ?? 0);
      for (const [i, rec] of recommendations.entries()) {
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
        acceptBtn.dataset.focus = `rec-accept-${i}`;
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
      acceptAll.dataset.focus = "rec-accept-all";
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
    const playerRoutes = routes.filter((r) => routeOwnerId(r, state) === localSeat);
    if (playerRoutes.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No routes yet.";
      empty.style.cssText = "font-size:12px;opacity:0.6;";
      modal.body.appendChild(empty);
    }
    for (const route of playerRoutes) {
      const routeDetails = getRouteTooltipText(state, route);
      const row = document.createElement("div");
      row.style.cssText =
        "margin-bottom:6px;padding:6px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:linear-gradient(115deg,rgba(28,39,55,0.72),rgba(15,22,33,0.7));font-variant-numeric:tabular-nums;cursor:help;";
      row.title = routeDetails;
      row.tabIndex = 0;
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", routeDetails);
      row.dataset.focus = `route-${route.id}`;
      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0;min-height:18px;";
      const label = document.createElement("span");
      label.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;";
      const payloadText = route.payload.kind === "gold" ? "gold" : route.payload.resource;
      label.textContent = `${route.wagons}x ${payloadText}`;
      header.appendChild(label);
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;flex:none;align-items:center;gap:4px;";
      for (const [delta, text] of [
        [-1, "−1"],
        [1, "+1"],
      ] as const) {
        const btn = document.createElement("button");
        btn.textContent = text;
        styleButton(btn);
        btn.style.fontSize = "10px";
        btn.style.padding = "1px 5px";
        btn.dataset.focus = `route-${route.id}-${delta > 0 ? "plus" : "minus"}`;
        btn.addEventListener("click", () => {
          const result = opts.actions.updateTradeRoute(route.id, { wagonsDelta: delta });
          if (!result.ok) rejectionToast("route update", result.reason);
          setTimeout(render, 30);
        });
        controls.appendChild(btn);
      }
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "\u2715";
      styleButton(removeBtn);
      removeBtn.style.fontSize = "10px";
      removeBtn.style.padding = "1px 6px";
      removeBtn.dataset.focus = `route-${route.id}-remove`;
      removeBtn.title = "Disband this route (wagons return to the pool; cargo aboard is lost)";
      removeBtn.addEventListener("click", () => {
        const result = opts.actions.updateTradeRoute(route.id, { remove: true });
        if (!result.ok) rejectionToast("route removal", result.reason);
        setTimeout(render, 30);
      });
      controls.appendChild(removeBtn);
      header.appendChild(controls);

      const routeVisual = document.createElement("div");
      routeVisual.style.cssText =
        "display:grid;grid-template-columns:minmax(56px,0.8fr) minmax(72px,1.4fr) minmax(56px,0.8fr);align-items:center;gap:4px;margin-top:4px;";
      routeVisual.append(
        routeEndpointPanel(state, route.from, route.payload, "source"),
        routeJourneyPanel(state, route),
        routeEndpointPanel(state, route.to, route.payload, "destination"),
      );
      row.append(header, routeVisual);
      // A native title never opens on keyboard focus; give the details a
      // visible tooltip on hover AND focus, linked via aria-describedby.
      const detailsTip = document.createElement("div");
      detailsTip.id = `route-tip-${route.id}`;
      detailsTip.textContent = routeDetails;
      detailsTip.style.cssText =
        "display:none;margin-top:4px;padding:6px 8px;border-radius:6px;background:rgba(10,16,26,0.95);border:1px solid rgba(255,255,255,0.18);font-size:10px;line-height:1.5;white-space:pre-line;max-width:520px;";
      row.setAttribute("aria-describedby", detailsTip.id);
      // Show while EITHER trigger is active: leaving the pointer must not
      // hide the tip the keyboard still owns, and blur must not hide it
      // while the pointer still hovers.
      let tipHovering = false;
      let tipFocused = false;
      const refreshTip = (): void => {
        detailsTip.style.display = tipHovering || tipFocused ? "block" : "none";
      };
      row.addEventListener("mouseenter", () => {
        tipHovering = true;
        refreshTip();
      });
      row.addEventListener("mouseleave", () => {
        tipHovering = false;
        refreshTip();
      });
      row.addEventListener("focus", () => {
        tipFocused = true;
        refreshTip();
      });
      row.addEventListener("blur", () => {
        tipFocused = false;
        refreshTip();
      });
      row.appendChild(detailsTip);
      modal.body.appendChild(row);
    }

    // ── Create route ──
    // Endpoints can be any same-owner pair of owned settlements and owned
    // heroes ("treasure wagons trade route between him and a city"), so the
    // row appears as soon as two endpoint candidates exist at all -- a lone
    // settlement plus a lone hero is a legal route.
    const ownedHeroes = Object.values(state.heroes).filter((h) => h.ownerId === localSeat);
    if (owned.length + ownedHeroes.length >= 2) {
      const createRow = document.createElement("div");
      createRow.style.cssText = "display:flex;gap:6px;margin-top:4px;align-items:center;";
      fromSel = document.createElement("select") as HTMLSelectElement;
      styleInput(fromSel as unknown as HTMLInputElement);
      fromSel.style.flex = "1.2";
      fromSel.dataset.field = "from";
      toSel = document.createElement("select") as HTMLSelectElement;
      styleInput(toSel as unknown as HTMLInputElement);
      toSel.style.flex = "1.2";
      toSel.dataset.field = "to";
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
      payloadSel = document.createElement("select") as HTMLSelectElement;
      styleInput(payloadSel as unknown as HTMLInputElement);
      payloadSel.style.flex = "0.9";
      payloadSel.dataset.field = "payload";
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
      wagonInput = document.createElement("input");
      styleInput(wagonInput);
      wagonInput.type = "number";
      wagonInput.min = "1";
      wagonInput.value = "1";
      wagonInput.style.width = "52px";
      wagonInput.dataset.field = "wagons";
      // Local non-null aliases: the event closures below capture these
      // consts, so strict null-checking narrows them even though the
      // closure-scoped variables (held across renders for draft
      // preservation) stay mutable and nullable.
      const fromSelect = fromSel;
      const toSelect = toSel;
      const payloadSelect = payloadSel;
      const wagonsInput = wagonInput;
      const createBtn = document.createElement("button");
      createBtn.textContent = "Create";
      createBtn.dataset.focus = "create-submit";
      styleButton(createBtn);
      // U4: the engine rejects an over-pool create (not_enough_wagons_unassigned)
      // rather than clamping, so the button pre-disables to match and says why.
      const updateCreateAvailability = (): void => {
        const isGold = payloadSelect.value === "gold";
        const pool = isGold
          ? (player?.treasuryWagonsUnassigned ?? 0)
          : (player?.wagonsUnassigned ?? 0);
        const wanted = Math.max(1, Math.floor(Number(wagonsInput.value) || 1));
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
        const from = parseEndpoint(fromSelect.value);
        const to = parseEndpoint(toSelect.value);
        if (!from || !to) return;
        if (from.kind === to.kind && from.id === to.id) return;
        const payload: TradeRoutePayload =
          payloadSelect.value === "gold"
            ? { kind: "gold" }
            : { kind: "resource", resource: payloadSelect.value as WarehouseResource };
        const wagons = Math.max(1, Math.floor(Number(wagonsInput.value) || 1));
        const result = opts.actions.createTradeRoute(from, to, payload, wagons);
        if (!result.ok) rejectionToast("route creation", result.reason);
        setTimeout(render, 30);
      });
      createRow.append(fromSel, toSel, payloadSel, wagonInput, createBtn);
      // Restore the user's in-progress draft across automatic refreshes, then
      // re-derive button availability from the restored values.
      if (draft.from) fromSel.value = draft.from;
      if (draft.to) toSel.value = draft.to;
      if (draft.payload) payloadSel.value = draft.payload;
      if (draft.wagons) wagonInput.value = draft.wagons;
      updateCreateAvailability();
      // Attach the freshly built row to the live modal body BEFORE the focus
      // lookup, or querySelector cannot find the replacement controls.
      modal.body.appendChild(createRow);
    }

    const hint = document.createElement("div");
    hint.textContent =
      "Cargo caravans carry one resource (wagons\u00d750); treasure caravans carry gold (wagons\u00d7500). They walk 7 tiles/day, re-path daily to reach a moving hero endpoint, and wait (never lose cargo) when the destination is full. A route whose origin is lost or captured goes dormant: it bills nothing and never deserts, and resumes if you retake it. When a route's last wagon deserts, the route disbands and returns what fits at the origin — the rest is lost. Removing a route manually also loses its aboard cargo.";
    hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;line-height:1.4;";
    modal.body.appendChild(hint);

    // Restore keyboard focus across the automatic refresh: route rows and
    // their controls carry stable data-focus ids, the create form carries
    // data-field. If the focused element no longer exists (route removed),
    // focus simply falls back to the modal -- a graceful no-op.
    if (draft.focusedField) {
      const el =
        modal.body.querySelector<HTMLElement>(`[data-field="${draft.focusedField}"]`) ??
        modal.body.querySelector<HTMLElement>(`[data-focus="${draft.focusedField}"]`);
      if (el) el.focus();
    }
  };

  render();
  bus.on("round:changed", render);
  bus.on("mp:resynced", render);
  // The caravan advances at every turn end, while round:changed only fires
  // when a round WRAPS -- turn:ended covers the local human/AI end-turn merge.
  // state:committed covers local command commits AND the garrisonEventBridge's
  // state adoption (GameStateManager.replaceState emits it after the fresh
  // state is installed), so remote route changes re-render from the live
  // state instead of the pre-adoption snapshot the transport notifications
  // would expose. mp:resynced stays as the boundary safety net.
  bus.on("turn:ended", render);
  bus.on("state:committed", render);
  detachRouteRefresh = () => {
    bus.off("round:changed", render);
    bus.off("mp:resynced", render);
    bus.off("turn:ended", render);
    bus.off("state:committed", render);
  };
}
