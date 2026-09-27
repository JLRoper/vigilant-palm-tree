import type { GameState, WarehouseResource } from "@heroes/contracts";
import {
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  heroWagons,
  playerWagonsOwned,
  playerWagonsUnassigned,
  settlementResourceCap,
  settlementTreasuryCap,
} from "@heroes/engine";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";

const RES: WarehouseResource[] = ["wood", "stone", "iron", "arcane", "food"];

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
    assignWagons: (heroId: string, delta: number) => { ok: boolean; reason: string };
    buyWagons: (settlementId: string, count: number) => { ok: boolean; reason: string };
    createTradeRoute: (
      fromId: string,
      toId: string,
      resource: WarehouseResource,
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
      info.textContent = `Purse ${hero.gold}/${heroGoldCap(hero)}g · Wagons ${heroWagons(hero)}`;
      modal.body.appendChild(info);
      for (const r of RES) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:3px;font-variant-numeric:tabular-nums;";
        const label = document.createElement("span");
        label.style.flex = "1";
        label.textContent = `${r}: ${cargo[r] ?? 0}/${caps[r]}`;
        row.appendChild(label);
        for (const [delta, text] of [
          [-1, "−1"],
          [1, "+1"],
        ] as const) {
          const btn = document.createElement("button");
          btn.textContent = text;
          styleButton(btn);
          btn.style.fontSize = "10px";
          btn.style.padding = "1px 6px";
          btn.addEventListener("click", () => {
            opts.actions.assignWagons(hero.id, delta);
            setTimeout(render, 30);
          });
          row.appendChild(btn);
        }
        modal.body.appendChild(row);
      }
    }

    // ── Wagon pool ──
    if (player) {
      section("Wagon pool");
      const row = document.createElement("div");
      row.style.cssText = "font-size:12px;opacity:0.85;font-variant-numeric:tabular-nums;";
      row.textContent = `${playerWagonsOwned(player)} owned · ${playerWagonsUnassigned(player)} unassigned`;
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
      const buyRow = document.createElement("div");
      buyRow.style.cssText = "display:flex;gap:6px;margin-top:3px;align-items:center;";
      const buyBtn = document.createElement("button");
      buyBtn.textContent = "Buy wagon (200g 5w)";
      styleButton(buyBtn);
      buyBtn.style.fontSize = "10px";
      buyBtn.style.padding = "1px 6px";
      buyBtn.addEventListener("click", () => {
        opts.actions.buyWagons(s.id, 1);
        setTimeout(render, 30);
      });
      buyRow.appendChild(buyBtn);
      row.appendChild(buyRow);
      modal.body.appendChild(row);
    }

    // ── Trade routes ──
    section("Trade routes");
    const routes = state.tradeRoutes ?? [];
    const playerRoutes = routes.filter((r) => {
      const from = state.settlements[r.fromSettlementId];
      return from?.ownerId === state.activePlayerId;
    });
    if (playerRoutes.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No routes yet.";
      empty.style.cssText = "font-size:12px;opacity:0.6;";
      modal.body.appendChild(empty);
    }
    for (const route of playerRoutes) {
      const from = state.settlements[route.fromSettlementId];
      const to = state.settlements[route.toSettlementId];
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
      label.textContent = `${route.wagons}\u{1F69F} ${route.resource}: ${from?.name ?? "?"} \u2192 ${to?.name ?? "?"} (${caravanInfo})`;
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
    if (owned.length >= 2) {
      const createRow = document.createElement("div");
      createRow.style.cssText = "display:flex;gap:6px;margin-top:4px;align-items:center;";
      const fromSel = document.createElement("select") as HTMLSelectElement;
      styleInput(fromSel as unknown as HTMLInputElement);
      fromSel.style.flex = "1.2";
      const toSel = document.createElement("select") as HTMLSelectElement;
      styleInput(toSel as unknown as HTMLInputElement);
      toSel.style.flex = "1.2";
      const resSel = document.createElement("select") as HTMLSelectElement;
      styleInput(resSel as unknown as HTMLInputElement);
      resSel.style.flex = "0.9";
      for (const s of owned) {
        for (const sel of [fromSel, toSel]) {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.name;
          sel.appendChild(opt);
        }
      }
      for (const r of RES) {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        resSel.appendChild(opt);
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
        const fromId = fromSel.value;
        const toId = toSel.value;
        if (fromId === toId) return;
        const wagons = Math.max(1, Math.floor(Number(wagonInput.value) || 1));
        opts.actions.createTradeRoute(fromId, toId, resSel.value as WarehouseResource, wagons);
        setTimeout(render, 30);
      });
      createRow.append(fromSel, toSel, resSel, wagonInput, createBtn);
      modal.body.appendChild(createRow);
    }

    const hint = document.createElement("div");
    hint.textContent =
      "Caravans load wagons×50 at the origin, walk 4 tiles/day, and wait (never lose cargo) when a warehouse is full.";
    hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;line-height:1.4;";
    modal.body.appendChild(hint);
  };

  render();
}
