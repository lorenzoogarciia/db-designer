import { applyTheme, getActiveTheme, getStoredTheme, themeToggleLabel, toggleTheme, type AppTheme } from "../lib/theme.ts";
import { icon } from "./icons.ts";

export function wireThemeToggles(): void {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>(".theme-toggle-btn"));
  if (toggles.length === 0) throw new Error("No se encontró el botón de tema");

  function updateThemeToggleButtons(theme: AppTheme = getActiveTheme()) {
    const label = themeToggleLabel(theme);
    // Se muestra el tema al que se cambia: sol en oscuro, luna en claro.
    const markup = icon(theme === "dark" ? "sun" : "moon", 17);
    toggles.forEach((toggle) => {
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
      toggle.innerHTML = markup;
    });
  }

  applyTheme(getStoredTheme());
  updateThemeToggleButtons();
  toggles.forEach((toggle) => toggle.addEventListener("click", () => updateThemeToggleButtons(toggleTheme())));
}
