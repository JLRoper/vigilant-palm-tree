import type { ErrorRequestHandler } from "express";

// Global error-handling middleware (#98). Registered last in server/index.ts's
// middleware chain so it catches anything that reaches it: any route without
// its own try/catch (server/routes.ts has several -- GET /health, GET /games,
// GET /games/:name, GET /games/:name/validate, PATCH /games/:name, DELETE
// /games/:name, POST+GET /games/:name/events, GET /games/:name/tiles) lets a
// thrown/rejected error propagate here instead. Express 5's router
// auto-forwards a rejected async handler's promise to next(err) even with no
// local try/catch, which is what lets it reach this far instead of crashing
// the process outright.
//
// Without this, that error falls through to Express's own default
// finalhandler, which renders an HTML page containing the full server-side
// stack trace whenever app.get('env') isn't "production" -- true by default
// since NODE_ENV is otherwise never set (see docker/Dockerfile and
// .env.example's own NODE_ENV additions for the other half of #98's fix).
// This middleware normalizes any such error to the same
// { error: "internal", message } JSON shape every route with a manual
// try/catch already returns (e.g. server/http/routes/commands.ts), instead
// of leaking internal implementation detail (file paths, line numbers) to
// any caller.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(`[api] unhandled error on ${req.method} ${req.originalUrl}:`, err);
  // A route could theoretically throw after already writing part of a
  // response (e.g. mid-stream). Express's own default error handler would
  // just close the socket in that case -- defer to next(err) instead of
  // calling res.status/json a second time, which would throw its own
  // "Cannot set headers after they are sent" error.
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({
    error: "internal",
    message: err instanceof Error ? err.message : String(err),
  });
};
