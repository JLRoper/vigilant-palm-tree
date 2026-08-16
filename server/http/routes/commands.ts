import { Router } from "express";
import type { Command } from "@heroes/contracts";
import { handleCommand, makeDefaultCommandHandlerDeps } from "../../app/commandHandler";

const deps = makeDefaultCommandHandlerDeps();

function isTile(v: unknown): v is { q: number; r: number } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { q: unknown }).q === "number" &&
    typeof (v as { r: unknown }).r === "number"
  );
}

function parseCommand(body: unknown): Command | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.actor !== "number") return null;

  if (b.kind === "MoveHero") {
    if (
      typeof b.heroId !== "string" ||
      !isTile(b.fromTile) ||
      !isTile(b.toTile) ||
      typeof b.cost !== "number" ||
      (b.trailExtension !== undefined &&
        (!Array.isArray(b.trailExtension) || !b.trailExtension.every(isTile)))
    ) {
      return null;
    }
    return {
      kind: "MoveHero",
      actor: b.actor,
      heroId: b.heroId,
      fromTile: b.fromTile,
      toTile: b.toTile,
      cost: b.cost,
      trailExtension: b.trailExtension as { q: number; r: number }[] | undefined,
    };
  }

  if (b.kind === "TransferGold") {
    if (
      typeof b.heroId !== "string" ||
      typeof b.settlementId !== "string" ||
      (b.direction !== "deposit" && b.direction !== "withdraw")
    ) {
      return null;
    }
    return {
      kind: "TransferGold",
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
      direction: b.direction,
    };
  }

  return null;
}

// mergeParams so this router, mounted at /games/:name/commands in
// server/routes.ts, can read the parent route's :name param.
export const commandsRouter = Router({ mergeParams: true });

commandsRouter.post<{ name: string }>("/", async (req, res) => {
  const name = req.params.name;
  const command = parseCommand(req.body);
  if (!command) {
    res.status(400).json({ error: "invalid command payload" });
    return;
  }
  try {
    const result = await handleCommand(deps, name, command);
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason });
      return;
    }
    res.json({ hero: result.hero, settlement: result.settlement });
  } catch (err) {
    console.error("[api] POST /games/:name/commands threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
