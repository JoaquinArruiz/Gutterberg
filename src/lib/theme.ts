import type { ThemePreference } from "./preferences";

/** "system" leaves the attribute off so the prefers-color-scheme media query in index.css decides. */
export function applyTheme(theme: ThemePreference, root: HTMLElement = document.documentElement) {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}
