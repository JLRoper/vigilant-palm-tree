// The seat-faction options every New Game surface offers (faction picker,
// landed with The Ashen Court): every registry faction with a shipped
// roster. Data-driven on purpose — a later faction plan filling its
// FACTION_REGISTRY roster makes it appear here with zero UI changes, and
// "neutral" (wild creatures, never a seat choice) is excluded by the same
// rule. The empty-roster placeholder entries the foundation shipped stay
// hidden until their content lands. `banner` is the glob-resolved
// faction-banner-<id>.png URL (absent while a faction has no file).
import type { FactionDef, FactionId } from "@heroes/contracts";
import { FACTION_REGISTRY } from "@heroes/engine";
import { FACTION_BANNERS } from "../../render/assetDescriptors";

export interface SeatFactionChoice {
  id: FactionId;
  def: FactionDef;
  banner: string | undefined;
}

export function seatFactionChoices(): SeatFactionChoice[] {
  return Object.values(FACTION_REGISTRY)
    .filter((f) => f.id !== "neutral" && f.roster.length > 0)
    .map((def) => ({ id: def.id, def, banner: FACTION_BANNERS[def.id] }));
}
