let cached: boolean | undefined;
export function prefersReducedMotion(): boolean {
  if (cached === undefined) {
    cached =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return cached;
}
