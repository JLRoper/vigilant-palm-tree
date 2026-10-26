/** Types for tools/resolve-tool-entry.mjs (consumed from TS test/tooling files). */
export declare function toolEntry(pkg: string): string;
export declare function nodeToolCommand(pkg: string, args?: string[]): { cmd: string; args: string[] };
export declare function resolveNpxInvocation(
  cmd: string,
  args: string[],
): { cmd: string; args: string[] } | null;
