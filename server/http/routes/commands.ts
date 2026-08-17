import { Router, type Request } from "express";
import { mulberry32 } from "@heroes/engine";
import type { Command } from "@heroes/contracts";
import { handleCommand } from "../../app/commandHandler";
import { liveEventRepo, liveGameRepo } from "../../app/liveRepos";

// POST /api/games/:name/commands -- mounted with the :name param already
// bound by routes.ts's router.use("/games/:name/commands", commandsRouter).
// Existing convention everywhere else in server/routes.ts is :name, not
// :id (2026-08-16-parallel-dev-phases-3-5.md's :id is not what's actually
// used anywhere in this codebase).
export const commandsRouter = Router();

function isAxial(v: unknown): v is { q: number; r: number } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { q: unknown }).q === "number" &&
    typeof (v as { r: unknown }).r === "number"
  );
}

// Real per-field validation, not just a `kind` check -- a malformed
// MoveHero/TransferGold body (missing/mistyped field) is rejected as a
// clean 400 here instead of reaching handleCommand and failing with an
// unrelated runtime TypeError.
function parseCommand(body: unknown, gameName: string): Command | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.actor !== "number") return null;

  if (b.kind === "MoveHero") {
    if (
      typeof b.heroId !== "string" ||
      !isAxial(b.fromTile) ||
      !isAxial(b.toTile) ||
      typeof b.cost !== "number" ||
      (b.trail !== undefined && (!Array.isArray(b.trail) || !b.trail.every(isAxial)))
    ) {
      return null;
    }
    return {
      kind: "MoveHero",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      fromTile: b.fromTile,
      toTile: b.toTile,
      cost: b.cost,
      trail: b.trail as { q: number; r: number }[] | undefined,
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
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
      direction: b.direction,
    };
  }

  return null;
}

// req.params is typed explicitly here because this router is mounted by
// routes.ts on a path that carries :name ("/games/:name/commands") --
// Express's own typings only see this router's own "/" pattern, not its
// parent's, so :name has to be annotated by hand or it types as {}.
commandsRouter.post("/", async (req: Request<{ name: string }>, res) => {
  const gameName = req.params.name;
  const command = parseCommand(req.body, gameName);
  if (!command) {
    res.status(400).json({ error: "invalid command" });
    return;
  }
  try {
    const result = await handleCommand(command, {
      gameRepo: liveGameRepo,
      eventRepo: liveEventRepo,
      // Week 1's two commands (MoveHero, TransferGold) don't read ctx.rng
      // or ctx.catalog at all -- neither startMove nor transferGold takes
      // an EngineCtx parameter. This is an inert placeholder until a real
      // consumer (e.g. Week 3+'s ResolveBattle) needs one; seeding it from
      // Date.now() here is fine precisely because nothing reads it yet.
      ctx: { rng: mulberry32(Date.now() >>> 0), catalog: { unitTypes: [] } },
    });
    if (!result.ok) {
      const status = result.reason === "forbidden_not_your_turn" ? 403 : 409;
      res.status(status).json({ error: result.reason });
      return;
    }
    // Not returning a `version` field yet (ROADMAP's exit criteria mentions
    // one) -- no version/optimistic-concurrency column exists on `games`
    // today, and inventing one is its own decision, not a Week-1 given.
    res.json({ events: result.events, hero: result.hero, settlement: result.settlement });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("game not found:")) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    console.error("[api] POST /games/:name/commands threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
