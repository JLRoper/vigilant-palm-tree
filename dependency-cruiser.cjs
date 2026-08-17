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
      name: "no-http-or-app-into-persistence-except-commandhandler",
      severity: "error",
      comment:
        "server/http/ and server/app/ (other than commandHandler.ts itself) must never import server/persistence/repositories/* directly -- everything goes through commandHandler.ts's own repo calls. Mirrors no-core-value-import-from-siblings' shape. Plan: plan/2026-08-16-phase-3-parallel-dev-plan.md (Track 3.A/3.B boundary).",
      from: {
        path: "^server/(http|app)/",
        pathNot: "^server/app/commandHandler\\.ts$",
      },
      to: { path: "^server/persistence/repositories/" },
    },
    {
      name: "paint2d-cannot-import-asset-descriptors",
      severity: "error",
      comment:
        "paint2d/ must stay pure-importable from node:test (no Vite ?url asset-loader coupling). The forbidden set is the same one revision note 4 nailed: every file known to transitively pull in src/render/assetDescriptors.ts's ~100 ?url PNG imports, or src/render/sprites.ts (which imports the *Key helpers from assetDescriptors), or the cityBuildingDraw.ts barrel (which imports buildingKey). Settings state is a value-import singleton with a cleanup lifecycle, so its value form is also forbidden. The default-deps builder at src/render/paint2dDefaults.ts and the skybox module at src/render/skybox.ts are the *only* files in the painter project allowed to touch these -- they live outside paint2d/.",
      from: { path: "^src/render/scene/paint2d/" },
      to: {
        path: "^src/render/(assetDescriptors|assets|sprites|cityRenderer|cityBuildingDraw|cityBuildingDraw/spots)\\.(ts|$)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "paint2d-cannot-value-import-state",
      severity: "error",
      comment:
        "paint2d/ must not read the state/settings singleton directly -- settings() has a subscribe cleanup lifecycle, and paint2d/ should depend on injected getters instead. Type-only imports of types from src/state/settings.ts are fine (HorseVariant, ResourceStyle, etc.).",
      from: { path: "^src/render/scene/paint2d/" },
      to: {
        path: "^src/state/settings\\.(ts|$)",
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
      mainFields: ["module", "main", "types", "typings"],
    },
    skipAnalysisNotInRules: true,
    tsPreCompilationDeps: true,
  },
};
