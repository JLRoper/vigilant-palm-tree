// Central registry for view openers. Each view registers itself at module
// load; cross-navigation calls go through launchView("name") instead of
// importing sibling view files directly. This breaks the dev settings ->
// test battle -> manual arena -> settings menu -> dev settings cycle that
// would otherwise require every view to know about every other view.

type ViewOpener<O = unknown> = (opts?: O) => void;

const registry = new Map<string, ViewOpener<any>>();

export function registerView<O = unknown>(name: string, opener: ViewOpener<O>): void {
  registry.set(name, opener as ViewOpener<unknown>);
}

export function launchView<R = void>(name: string, opts?: unknown): R {
  const opener = registry.get(name);
  if (!opener) {
    console.warn(`[viewLauncher] no view registered for "${name}"`);
    return undefined as R;
  }
  return opener(opts) as R;
}
