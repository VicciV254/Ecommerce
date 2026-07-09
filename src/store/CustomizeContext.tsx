import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { settingsAPI } from "../api/settings";

export type FontOption = {
  id: string;
  display: string;
  body: string;
  label: string;
};

export type ColorPreset = {
  id: string;
  name: string;
  primary: string;    // text, buttons, footer
  secondary: string;  // CTAs, badges, highlights
  accent: string;     // hover states, sub-labels
  warmBeige: string;  // section backgrounds
  oceanBlue: string;  // links, accents
  oceanBlueDark: string; // darker ocean blue
  coral: string;      // highlights, badges
  success: string;    // success states
  warning: string;    // warning states
  error: string;      // error states
  charcoal: string;   // text color
  offWhite: string;   // page background
  lightGray: string;  // borders
  lightPink: string;  // header, cards, review boxes
};

/** Legend that explains what each color slot controls. */
export const COLOR_SLOT_LEGEND: { key: keyof ColorPreset; label: string }[] = [
  { key: "primary",   label: "Text, Buttons & Footer" },
  { key: "secondary", label: "CTAs, Badges & Highlights" },
  { key: "accent",    label: "Hover States & Sub-labels" },
  { key: "warmBeige", label: "Section Backgrounds" },
  { key: "oceanBlue", label: "Links & Accents" },
  { key: "oceanBlueDark", label: "Darker Ocean Blue" },
  { key: "coral",     label: "Highlights & Badges" },
  { key: "success",   label: "Success States" },
  { key: "warning",   label: "Warning States" },
  { key: "error",     label: "Error States" },
  { key: "charcoal",  label: "Text Color" },
  { key: "offWhite",  label: "Page Background" },
  { key: "lightGray", label: "Borders" },
  { key: "lightPink", label: "Header, Cards & Review Boxes" },
];

export const FONT_OPTIONS: FontOption[] = [
  { id: "default", display: "Marcellus", body: "Jost", label: "Default (Marcellus + Jost)" },
  { id: "playfair", display: "Playfair Display", body: "Lato", label: "Playfair + Lato" },
  { id: "cormorant", display: "Cormorant Garamond", body: "Montserrat", label: "Cormorant + Montserrat" },
  { id: "cinzel", display: "Cinzel", body: "Raleway", label: "Cinzel + Raleway" },
  { id: "dm-serif", display: "DM Serif Display", body: "DM Sans", label: "DM Serif + DM Sans" },
  { id: "lora", display: "Lora", body: "Open Sans", label: "Lora + Open Sans" },
];

export const DEFAULT_COLORS: ColorPreset = {
  id: "default",
  name: "Classic Gold (Default)",
  primary: "#1a1a1a",
  secondary: "#e8a838",
  accent: "#b8915c",
  warmBeige: "#F8E0E5",
  oceanBlue: "#1a5276",
  oceanBlueDark: "#154360",
  coral: "#E96078",
  success: "#27ae60",
  warning: "#f39c12",
  error: "#e74c3c",
  charcoal: "#2c3e50",
  offWhite: "#faf8f5",
  lightGray: "#e8e8e8",
  lightPink: "#FAD4DC",
};

export const COLOR_PRESETS: ColorPreset[] = [
  DEFAULT_COLORS,
  { id: "ocean",    name: "Ocean Blue",       primary: "#0f172a", secondary: "#38bdf8", accent: "#0ea5e9", warmBeige: "#e0f2fe", oceanBlue: "#0284c7", oceanBlueDark: "#0369a1", coral: "#0ea5e9", success: "#22c55e", warning: "#eab308", error: "#ef4444", charcoal: "#334155", offWhite: "#f0f9ff", lightGray: "#e0f2fe", lightPink: "#bae6fd" },
  { id: "rose",     name: "Rose Garden",      primary: "#1c1917", secondary: "#e11d48", accent: "#be123c", warmBeige: "#ffe4e6", oceanBlue: "#9f1239", oceanBlueDark: "#881337", coral: "#e11d48", success: "#16a34a", warning: "#ca8a04", error: "#dc2626", charcoal: "#292524", offWhite: "#fff1f2", lightGray: "#ffe4e6", lightPink: "#fecdd3" },
  { id: "emerald",  name: "Emerald Forest",   primary: "#14532d", secondary: "#22c55e", accent: "#16a34a", warmBeige: "#dcfce7", oceanBlue: "#15803d", oceanBlueDark: "#166534", coral: "#16a34a", success: "#16a34a", warning: "#ca8a04", error: "#dc2626", charcoal: "#14532d", offWhite: "#f0fdf4", lightGray: "#dcfce7", lightPink: "#bbf7d0" },
  { id: "midnight", name: "Midnight Purple",  primary: "#1e1b4b", secondary: "#a78bfa", accent: "#8b5cf6", warmBeige: "#ede9fe", oceanBlue: "#6366f1", oceanBlueDark: "#4f46e5", coral: "#8b5cf6", success: "#22c55e", warning: "#eab308", error: "#ef4444", charcoal: "#1e1b4b", offWhite: "#f5f3ff", lightGray: "#ede9fe", lightPink: "#ddd6fe" },
];

type CustomizeCtx = {
  fontId: string;
  colorId: string;
  colors: ColorPreset;        // currently applied colors
  customColors: ColorPreset;  // editable custom preset
  setFont: (id: string) => void;
  setColorPreset: (id: string) => void;
  setCustomColor: (key: keyof ColorPreset, value: string) => void;
  resetAll: () => void;
};

const Ctx = createContext<CustomizeCtx | null>(null);

/* ---------------- Side effects: inject font link + CSS variables ---------------- */

function ensureFontLink(): HTMLLinkElement {
  let link = document.getElementById("nmb-font-link") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "nmb-font-link";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  return link;
}

function applyFont(opt: FontOption) {
  const link = ensureFontLink();
  const families = [opt.display, opt.body]
    .map((f) => f.trim().replace(/ /g, "+") + ":wght@300;400;500;600;700")
    .join("&family=");
  link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
  document.documentElement.style.setProperty("--font-display", `"${opt.display}", serif`);
  document.documentElement.style.setProperty("--font-body", `"${opt.body}", sans-serif`);
}

function applyColors(p: ColorPreset) {
  const r = document.documentElement.style;
  r.setProperty("--color-brand-primary", p.primary);
  r.setProperty("--color-brand-secondary", p.secondary);
  r.setProperty("--color-brand-accent", p.accent);
  r.setProperty("--color-warm-beige", p.warmBeige);
  r.setProperty("--color-ocean-blue", p.oceanBlue);
  r.setProperty("--color-ocean-blue-dark", p.oceanBlueDark);
  r.setProperty("--color-coral", p.coral);
  r.setProperty("--color-success", p.success);
  r.setProperty("--color-warning", p.warning);
  r.setProperty("--color-error", p.error);
  r.setProperty("--color-charcoal", p.charcoal);
  r.setProperty("--color-off-white", p.offWhite);
  r.setProperty("--color-light-gray", p.lightGray);
  r.setProperty("--color-light-pink", p.lightPink);
}

function clearOverrides() {
  const r = document.documentElement.style;
  [
    "--font-display",
    "--font-body",
    "--color-brand-primary",
    "--color-brand-secondary",
    "--color-brand-accent",
    "--color-warm-beige",
    "--color-ocean-blue",
    "--color-ocean-blue-dark",
    "--color-coral",
    "--color-success",
    "--color-warning",
    "--color-error",
    "--color-charcoal",
    "--color-off-white",
    "--color-light-gray",
    "--color-light-pink",
  ].forEach((k) => r.removeProperty(k));
  const link = document.getElementById("nmb-font-link");
  if (link) link.remove();
}

/* ---------------- Provider ---------------- */

export function CustomizeProvider({ children }: { children: ReactNode }) {
  const [fontId, setFontIdState] = useState<string>(() => localStorage.getItem("nmb-font") ?? "default");
  const [colorId, setColorIdState] = useState<string>(() => localStorage.getItem("nmb-colors") ?? "default");
  const [customColors, setCustomColorsState] = useState<ColorPreset>(() => {
    const raw = localStorage.getItem("nmb-colors-custom");
    return raw ? JSON.parse(raw) : { ...DEFAULT_COLORS, id: "custom", name: "Custom" };
  });

  useEffect(() => {
    settingsAPI.getTheme()
      .then(({ data }) => {
        if (!data) return;
        setFontIdState(data.fontId ?? "default");
        setColorIdState(data.colorId ?? "default");
        if (data.customColors) setCustomColorsState(data.customColors);
      })
      .catch(() => undefined);
  }, []);

  const colors = useMemo<ColorPreset>(() => {
    if (colorId === "custom") return customColors;
    return COLOR_PRESETS.find((p) => p.id === colorId) ?? DEFAULT_COLORS;
  }, [colorId, customColors]);

  /* On mount + whenever font / colors change, push to the document */
  useEffect(() => {
    if (fontId === "default") {
      // Don't inject a Google Fonts link for the default — the index.html one is enough
      document.documentElement.style.removeProperty("--font-display");
      document.documentElement.style.removeProperty("--font-body");
      const link = document.getElementById("nmb-font-link");
      if (link) link.remove();
    } else {
      const opt = FONT_OPTIONS.find((o) => o.id === fontId);
      if (opt) applyFont(opt);
    }
  }, [fontId]);

  useEffect(() => {
    if (colorId === "default") {
      // Strip overrides so the @theme defaults apply
      const r = document.documentElement.style;
      ["--color-brand-primary","--color-brand-secondary","--color-brand-accent","--color-warm-beige","--color-ocean-blue","--color-ocean-blue-dark","--color-coral","--color-success","--color-warning","--color-error","--color-charcoal","--color-off-white","--color-light-gray","--color-light-pink"].forEach((k) => r.removeProperty(k));
    } else {
      applyColors(colors);
    }
  }, [colorId, colors]);

  const setFont = useCallback((id: string) => {
    setFontIdState(id);
    localStorage.setItem("nmb-font", id);
    settingsAPI.publishTheme({ fontId: id, colorId, customColors }).catch(() => undefined);
  }, [colorId, customColors]);

  const setColorPreset = useCallback((id: string) => {
    setColorIdState(id);
    localStorage.setItem("nmb-colors", id);
    settingsAPI.publishTheme({ fontId, colorId: id, customColors }).catch(() => undefined);
  }, [fontId, customColors]);

  const setCustomColor = useCallback((key: keyof ColorPreset, value: string) => {
    setCustomColorsState((cur) => {
      const next = { ...cur, [key]: value };
      localStorage.setItem("nmb-colors-custom", JSON.stringify(next));
      settingsAPI.publishTheme({ fontId, colorId: "custom", customColors: next }).catch(() => undefined);
      return next;
    });
    setColorIdState("custom");
  }, [fontId]);

  const resetAll = useCallback(() => {
    setFontIdState("default");
    setColorIdState("default");
    localStorage.removeItem("nmb-font");
    localStorage.removeItem("nmb-colors");
    clearOverrides();
    settingsAPI.publishTheme({ fontId: "default", colorId: "default", customColors: { ...DEFAULT_COLORS, id: "custom", name: "Custom" } }).catch(() => undefined);
  }, []);

  const value = useMemo<CustomizeCtx>(
    () => ({ fontId, colorId, colors, customColors, setFont, setColorPreset, setCustomColor, resetAll }),
    [fontId, colorId, colors, customColors, setFont, setColorPreset, setCustomColor, resetAll]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomize() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCustomize must be used within CustomizeProvider");
  return ctx;
}
