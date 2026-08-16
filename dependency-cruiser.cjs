/** @type {import('dependency-cruiser').IConfiguration} */
// Documented exceptions (scoped out of the error rules via pathNot on the
// `from` side; tracked as follow-up plans in
// plan/2026-08-09-bloat-scalability-review.md):
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
      name: "no-render-into-systems-or-screens",
      severity: "error",
      from: { path: "^src/render" },
      to: { path: "^src/(systems|screens)/" },
    },
    {
      name: "no-state-value-import-from-render-or-screens",
      severity: "error",
      from: { path: "^src/state" },
      to: {
        path: "^src/(render|screens)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-screens-into-managers",
      severity: "error",
      from: { path: "^src/screens" },
      to: {
        path: "^src/managers/",
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
      name: "no-entities-value-from-render-or-screens",
      severity: "error",
      from: { path: "^src/entities" },
      to: {
        path: "^src/(render|screens)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "contracts-is-a-leaf",
      severity: "error",
      comment:
        "@heroes/contracts is the wire: zero dependencies on engine, client, or server code.",
      from: { path: "^packages/contracts" },
      to: { path: "^(packages/engine|src/|server/)" },
    },
    {
      name: "engine-depends-on-contracts-only",
      severity: "error",
      comment:
        "@heroes/engine is pure rules: may depend on @heroes/contracts only, never on client (src/) or server code.",
      from: { path: "^packages/engine" },
      to: { path: "^(src/|server/)" },
    },
    {
      name: "no-repo-import-outside-commandHandler",
      severity: "error",
      comment:
        "server/http/ and server/app/ (other than commandHandler.ts itself) must not import repositories directly — everything goes through commandHandler's own repo calls, not ad-hoc repo imports scattered through route/app files.",
      from: {
        path: "^server/(http|app)/",
        pathNot: "^server/app/commandHandler\\.ts$",
      },
      to: { path: "^server/persistence/repositories/" },
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
