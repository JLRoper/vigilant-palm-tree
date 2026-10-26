// scripts/lib/entry.ts
//
// True when the file whose `import.meta.url` is passed is the process entry
// point. Used so a script can be imported for its exports (scripts/pods.ts
// imports the port allocator and the commit-hash resolver) without running its
// command-line body as a side effect of the import.

import { pathToFileURL } from "node:url";

export function invokedDirectly(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === metaUrl;
  } catch {
    return false;
  }
}
