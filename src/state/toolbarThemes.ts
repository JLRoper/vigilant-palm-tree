export interface ToolbarThemeTokens {
  "--tb-bg-top": string;
  "--tb-bg-bottom": string;
  "--tb-strip": string;
  "--tb-surface": string;
  "--tb-surface-hover": string;
  "--tb-border": string;
  "--tb-border-hover": string;
  "--tb-text": string;
  "--tb-text-muted": string;
  "--tb-text-dim": string;
  "--tb-accent": string;
  "--tb-accent-light": string;
  "--tb-accent-ink": string;
  "--tb-menu-bg": string;
  "--tb-divider": string;
  "--tb-font": string;
  "--tb-radius-control": string;
  "--tb-radius-chip": string;
  "--tb-radius-kbd": string;
  "--tb-radius-menu": string;
  "--tb-radius-menu-item": string;
  "--tb-shadow-control": string;
  "--tb-shadow-ready": string;
  "--tb-shadow-header": string;
}

interface ToolbarThemeDefinition {
  label: string;
  tokens: ToolbarThemeTokens;
}

export const TOOLBAR_THEMES = {
  modern: {
    label: "Modern",
    tokens: {
      "--tb-bg-top": "#1b2334",
      "--tb-bg-bottom": "#121826",
      "--tb-strip": "#10151f",
      "--tb-surface": "rgba(255, 255, 255, 0.045)",
      "--tb-surface-hover": "rgba(255, 255, 255, 0.1)",
      "--tb-border": "rgba(148, 163, 184, 0.22)",
      "--tb-border-hover": "rgba(148, 163, 184, 0.4)",
      "--tb-text": "#e9eef8",
      "--tb-text-muted": "#9aa7bd",
      "--tb-text-dim": "#b6c0d4",
      "--tb-accent": "#f2b93c",
      "--tb-accent-light": "#ffd479",
      "--tb-accent-ink": "#241a05",
      "--tb-menu-bg": "rgba(20, 26, 40, 0.98)",
      "--tb-divider": "rgba(148, 163, 184, 0.18)",
      "--tb-font": "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
      "--tb-radius-control": "8px",
      "--tb-radius-chip": "999px",
      "--tb-radius-kbd": "4px",
      "--tb-radius-menu": "12px",
      "--tb-radius-menu-item": "7px",
      "--tb-shadow-control": "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
      "--tb-shadow-ready": "inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 2px 8px rgba(0, 0, 0, 0.35), 0 0 0 3px rgba(242, 185, 60, 0.16)",
      "--tb-shadow-header": "0 10px 28px rgba(0, 0, 0, 0.45)",
    },
  },
  "classic-blue": {
    label: "Classic Blue",
    tokens: {
      "--tb-bg-top": "#1c2f57",
      "--tb-bg-bottom": "#142145",
      "--tb-strip": "#101a35",
      "--tb-surface": "rgba(241, 228, 195, 0.08)",
      "--tb-surface-hover": "rgba(241, 228, 195, 0.16)",
      "--tb-border": "rgba(201, 162, 39, 0.4)",
      "--tb-border-hover": "rgba(233, 207, 125, 0.7)",
      "--tb-text": "#f1e4c3",
      "--tb-text-muted": "#c2b58f",
      "--tb-text-dim": "#e9cf7d",
      "--tb-accent": "#c9a227",
      "--tb-accent-light": "#e9cf7d",
      "--tb-accent-ink": "#142145",
      "--tb-menu-bg": "rgba(20, 33, 69, 0.98)",
      "--tb-divider": "rgba(233, 207, 125, 0.25)",
      "--tb-font": "Georgia, Cambria, \"Times New Roman\", serif",
      "--tb-radius-control": "4px",
      "--tb-radius-chip": "4px",
      "--tb-radius-kbd": "2px",
      "--tb-radius-menu": "4px",
      "--tb-radius-menu-item": "3px",
      "--tb-shadow-control": "none",
      "--tb-shadow-ready": "none",
      "--tb-shadow-header": "none",
    },
  },
} as const satisfies Record<string, ToolbarThemeDefinition>;

export type ToolbarStyle = keyof typeof TOOLBAR_THEMES;

export const DEFAULT_TOOLBAR_STYLE: ToolbarStyle = "modern";

export function isToolbarStyle(value: unknown): value is ToolbarStyle {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOOLBAR_THEMES, value);
}

export function clampToolbarStyle(value: unknown): ToolbarStyle {
  return isToolbarStyle(value) ? value : DEFAULT_TOOLBAR_STYLE;
}

export function toolbarStyleOptions(): readonly ToolbarStyle[] {
  return Object.keys(TOOLBAR_THEMES) as ToolbarStyle[];
}
