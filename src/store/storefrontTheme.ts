import type { StorefrontSettings, ThemeColors } from "../api/catalog";

export type FontOption = { id: StorefrontSettings["theme"]["fontId"]; display: string; body: string; label: string };

/** Font pairings the storefront API accepts as `theme.fontId`. */
export const FONT_OPTIONS: FontOption[] = [
  { id: "default", display: "Marcellus", body: "Jost", label: "Default (Marcellus + Jost)" },
  { id: "playfair", display: "Playfair Display", body: "Lato", label: "Playfair + Lato" },
  { id: "cormorant", display: "Cormorant Garamond", body: "Montserrat", label: "Cormorant + Montserrat" },
  { id: "cinzel", display: "Cinzel", body: "Raleway", label: "Cinzel + Raleway" },
  { id: "dm-serif", display: "DM Serif Display", body: "DM Sans", label: "DM Serif + DM Sans" },
  { id: "lora", display: "Lora", body: "Open Sans", label: "Lora + Open Sans" },
];

export type ThemeVariables = Record<`--${string}`, string>;

/** Each editable colour, the CSS variable it drives and what it controls. */
export const COLOR_SLOTS: { key: keyof ThemeColors; variable: `--color-${string}`; label: string }[] = [
  { key: "primary", variable: "--color-brand-primary", label: "Text, buttons and footer" },
  { key: "secondary", variable: "--color-brand-secondary", label: "Calls to action and highlights" },
  { key: "accent", variable: "--color-brand-accent", label: "Hover states and sub-labels" },
  { key: "warmBeige", variable: "--color-warm-beige", label: "Section backgrounds" },
  { key: "oceanBlue", variable: "--color-ocean-blue", label: "Links and focus" },
  { key: "oceanBlueDark", variable: "--color-ocean-blue-dark", label: "Darker link shade" },
  { key: "coral", variable: "--color-coral", label: "Badges" },
  { key: "success", variable: "--color-success", label: "Success states" },
  { key: "warning", variable: "--color-warning", label: "Warning states" },
  { key: "error", variable: "--color-error", label: "Error states" },
  { key: "charcoal", variable: "--color-charcoal", label: "Body text" },
  { key: "offWhite", variable: "--color-off-white", label: "Page background" },
  { key: "lightGray", variable: "--color-light-gray", label: "Borders" },
  { key: "lightPink", variable: "--color-light-pink", label: "Header and card surfaces" },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const FONT_LINK_ID = "apex-cart-font-link";

export function isHexColor(value: string) {
  return HEX_COLOR.test(value);
}

export function fontOption(fontId: string) {
  return FONT_OPTIONS.find((option) => option.id === fontId);
}

/** CSS custom properties for a theme; invalid colours are left to the stylesheet defaults. */
export function themeVariables(theme: StorefrontSettings["theme"]): ThemeVariables {
  const variables: ThemeVariables = {};
  for (const slot of COLOR_SLOTS) {
    const value = theme.colors[slot.key];
    if (isHexColor(value)) variables[slot.variable] = value;
  }
  const font = fontOption(theme.fontId);
  if (font && font.id !== "default") {
    variables["--font-display"] = `"${font.display}", serif`;
    variables["--font-body"] = `"${font.body}", sans-serif`;
  }
  return variables;
}

/** Loads a non-default font pairing's stylesheet; the default pair ships with the page. */
export function ensureFontStylesheet(fontId: string, linkId = FONT_LINK_ID) {
  const font = fontOption(fontId);
  const existing = document.getElementById(linkId);
  if (!font || font.id === "default") {
    existing?.remove();
    return;
  }
  const link = existing instanceof HTMLLinkElement ? existing : document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  const families = [font.display, font.body]
    .map((family) => `${family.replace(/ /g, "+")}:wght@300;400;500;600;700`)
    .join("&family=");
  link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
  if (!link.isConnected) document.head.appendChild(link);
}
