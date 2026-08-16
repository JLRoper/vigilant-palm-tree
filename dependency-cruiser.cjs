/** @type {import('dependency-cruiser').IConfiguration} */
// Documented exceptions (scoped out of the error rules via pathNot on the
// `from` side; tracked as follow-up plans in
// plan/2026-08-09-bloat-scalability-review.md):
//   - shared/gameState.ts → src/state/gameState.ts (tradeResources,
//     applyEndOfTurnDetailed, AutoTradeTransfer re-exported as a stepping stone
//     until full extraction to shared/turns/ lands — R9).
//   - server/routes.ts → src/game/initState.ts (makeInitialStatePayload is the
//     map-gen + castle-placement + economy-init orchestrator; full extraction
//     to shared/map/initState is R11).
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependency — none allowed.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-core-value-import-from-siblings",
      severity: "error",
      comment:
        "core/ is leaf-only: value imports from sibling layers are forbidden. import type is allowed.",
      from: { path: "^src/core" },
      to: {
        path: "^src/(?!core/|debug/|data/|shared/|game/|players/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-render-into-systems-or-views",
      severity: "error",
      from: { path: "^src/render" },
      to: { path: "^src/(systems|views)/" },
    },
    {
      name: "no-state-value-import-from-render-or-views",
      severity: "error",
      from: { path: "^src/state" },
      to: {
        path: "^src/(render|views)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-views-into-managers",
      severity: "error",
      from: { path: "^src/views" },
      to: {
        path: "^src/managers/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-shared-from-src-or-server",
      severity: "error",
      from: { path: "^shared", pathNot: "^shared/gameState\\.ts$" },
      to: {
        path: "^(src/|server/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-server-from-src",
      severity: "error",
      from: { path: "^server", pathNot: "^server/routes\\.ts$" },
      to: {
        path: "^src/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-entities-value-from-render-or-views",
      severity: "error",
      from: { path: "^src/entities" },
      to: {
        path: "^src/(render|views)/",
        dependencyTypesNot: ["type-only"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".d.ts"],
      mainFields: ["module", "main", "types", "typings"],
    },
    skipAnalysisNotInRules: true,
    tsPreCompilationDeps: true,
  },
};
