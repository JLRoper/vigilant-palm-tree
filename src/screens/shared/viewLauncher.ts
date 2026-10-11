// Central registry for view openers. Each view registers itself at module
// load; cross-navigation calls go through launchView("name") instead of
// importing sibling view files directly. This breaks the dev settings ->
// test battle -> manual arena -> settings menu -> dev settings cycle that
// would otherwise require every view to know about every other view.
// Deferred views (battle arena, dev surfaces, lobby) instead self-register
// when their loader fires: registerLazyView(name, loader) records the
// module loader, and the async openView(name) awaits it and then launches.
// That keeps those heavy modules out of the entry chunk while preserving the
// "a module registers itself at load" convention on both paths.

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

const lazyRegistry = new Map<string, () => Promise<unknown>>();

export function registerLazyView(name: string, loader: () => Promise<unknown>): void {
  lazyRegistry.set(name, loader);
}

async function ensureView(name: string): Promise<ViewOpener<any> | undefined> {
  const existing = registry.get(name);
  if (existing) return existing;
  const loader = lazyRegistry.get(name);
  if (!loader) return undefined;
  await loader();
  return registry.get(name);
}

export async function openView<R = void>(name: string, opts?: unknown): Promise<R> {
  const opener = await ensureView(name);
  if (!opener) {
    console.warn(`[viewLauncher] no view registered for "${name}"`);
    return undefined as R;
  }
  return opener(opts) as R;
}
