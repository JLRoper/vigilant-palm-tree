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

const VALID_KINDS = new Set(["MoveHero", "TransferGold"]);

function isValidCommandBody(body: unknown): body is Omit<Command, "gameName"> {
  if (!body || typeof body !== "object") return false;
  const kind = (body as { kind?: unknown }).kind;
  return typeof kind === "string" && VALID_KINDS.has(kind);
}

// req.params is typed explicitly here because this router is mounted by
// routes.ts on a path that carries :name ("/games/:name/commands") --
// Express's own typings only see this router's own "/" pattern, not its
// parent's, so :name has to be annotated by hand or it types as {}.
commandsRouter.post("/", async (req: Request<{ name: string }>, res) => {
  const gameName = req.params.name;
  const body = req.body ?? {};
  if (!isValidCommandBody(body)) {
    res.status(400).json({ error: "invalid command" });
    return;
  }
  const command = { ...body, gameName } as Command;
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
      res.status(409).json({ error: result.reason });
      return;
    }
    // Not returning a `version` field yet (ROADMAP's exit criteria mentions
    // one) -- no version/optimistic-concurrency column exists on `games`
    // today, and inventing one is its own decision, not a Week-1 given.
    res.json({ events: result.events });
  } catch (err) {
    console.error("[api] POST /games/:name/commands threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
