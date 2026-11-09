export type AppTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "dbdesigner.theme.v1";

const THEME_EXPORT_BACKGROUNDS: Record<AppTheme, string> = {
  // Deben coincidir con el fondo del lienzo (--color-bg-diagram-gradient-end) de cada tema.
  dark: "#111214",
  light: "#f6f5f1",
};

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  return value === "dark" || value === "light";
}

export function getStoredTheme(): AppTheme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isAppTheme(stored)) return stored;
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function getActiveTheme(): AppTheme {
  const current = document.documentElement.dataset.theme;
  return isAppTheme(current) ? current : "dark";
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function toggleTheme(): AppTheme {
  const nextTheme: AppTheme = getActiveTheme() === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  return nextTheme;
}

export function getExportBackgroundColor(theme: AppTheme = getActiveTheme()) {
  return THEME_EXPORT_BACKGROUNDS[theme];
}

export function themeToggleLabel(theme: AppTheme) {
  return theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
}

