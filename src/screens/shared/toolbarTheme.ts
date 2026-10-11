import { settings, subscribeSettings, type GameSettings } from "../../state/settings";
import { TOOLBAR_THEMES, type ToolbarStyle } from "../../state/toolbarThemes";

export interface CssVariableTarget {
  setProperty(property: string, value: string): void;
}

export function applyToolbarTheme(style: ToolbarStyle, target: CssVariableTarget): void {
  const tokens = TOOLBAR_THEMES[style].tokens;
  for (const property of Object.keys(tokens) as Array<keyof typeof tokens>) {
    target.setProperty(property, tokens[property]);
  }
}

export function attachToolbarTheme(
  target: CssVariableTarget = document.documentElement.style,
): () => void {
  let appliedStyle: ToolbarStyle | undefined;
  const apply = (next: GameSettings): void => {
    if (next.toolbarStyle === appliedStyle) return;
    appliedStyle = next.toolbarStyle;
    applyToolbarTheme(appliedStyle, target);
  };

  apply(settings());
  return subscribeSettings(apply);
}
