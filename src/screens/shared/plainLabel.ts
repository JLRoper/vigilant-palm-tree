/**
 * The plain, emoji-free name of a command control (playthrough ledger #21).
 *
 * Every toolbar and palette button in this UI wears an emoji prefix — `⛺ Found
 * Settlement`, `▶ End Turn`, `⚒ Build` — because the prefix is the icon. That
 * makes an exact match on the visible text impossible for a driver:
 * `textContent.trim() === "Build"` never lands, and a probe falls back to a
 * fuzzy `hasText` that also matches unrelated rows.
 *
 * Each such control therefore ALSO carries its plain name on `data-label`,
 * which a driver can match exactly (`button[data-label="Build"]`) whatever the
 * emoji is. The visible text is untouched: this is an extra handle, not a
 * relabel.
 */

/** `⛺ Found Settlement` -> `Found Settlement`; an already-plain label is returned as-is. */
export function plainLabel(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/**
 * Stamp `data-label` on a control. `plain` overrides the stripped text, for a
 * control whose whole text IS the icon (the gear button reads only `⚙`).
 * Nothing is stamped when the plain name would be empty — a hook that matches
 * every icon-only control would be worse than none.
 */
export function stampPlainLabel(el: Element, text: string, plain?: string): void {
  const value = (plain ?? plainLabel(text)).trim();
  if (value) el.setAttribute("data-label", value);
}
