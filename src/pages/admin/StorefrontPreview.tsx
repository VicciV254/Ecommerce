import { useEffect, type CSSProperties, type RefObject } from "react";
import { BrandLogo } from "../../components/Brand";
import { StorefrontSections } from "../../components/StorefrontSections";
import { Link } from "../../router";
import { ensureFontStylesheet, themeVariables, type ThemeVariables } from "../../store/storefrontTheme";
import { adminModuleRoute } from "./adminRoutes";
import { useStorefrontDraft } from "./StorefrontDraft";

const PREVIEW_FONT_LINK_ID = "apex-cart-preview-font-link";

/**
 * The storefront draft rendered by the shoppers' own section renderer, across the whole content area, under a banner
 * that says shoppers can't see it. The draft theme applies to this subtree only, and the draft's fonts are removed
 * again when the preview closes.
 */
export function StorefrontPreview({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  const { load, settings, dirty, mediaById, unresolved, reloadDraft } = useStorefrontDraft();
  const fontId = settings?.theme.fontId ?? null;

  useEffect(() => {
    if (fontId === null) return;
    ensureFontStylesheet(fontId, PREVIEW_FONT_LINK_ID);
    return () => document.getElementById(PREVIEW_FONT_LINK_ID)?.remove();
  }, [fontId]);

  const ready = load.status === "ready" && settings;
  const previewStyle: (CSSProperties & ThemeVariables) | undefined = settings
    ? { ...themeVariables(settings.theme), fontFamily: "var(--font-body)" }
    : undefined;

  return (
    // Edge to edge inside the content area: the shell's padding is cancelled so the storefront keeps its own.
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8">
      <div className="on-navy border-b-4 border-gold-400 bg-navy-950 px-4 py-[12px] text-white sm:px-6 lg:px-8 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold leading-7">Draft preview: shoppers can't see this</h1>
            {dirty && <span className="rounded-full bg-gold-400 px-3 text-sm font-semibold leading-6 text-navy-900">Includes unsaved changes</span>}
          </div>
          <Link
            to={adminModuleRoute("storefront")}
            className="inline-flex min-h-[44px] items-center rounded-sm border border-white/70 px-[14px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-white/10"
          >
            Back to editor
          </Link>
        </div>
        {unresolved.length > 0 && (
          <div className="mt-2 text-sm text-on-navy-muted">
            <p className="font-semibold text-white">Unavailable references (shown to shoppers as nothing):</p>
            <ul className="list-inside list-disc">
              {unresolved.map((reference) => <li key={`${reference.label}-${reference.id}`}>{reference.label}: {reference.id}</li>)}
            </ul>
          </div>
        )}
      </div>

      {load.status === "loading" && <p role="status" className="px-4 py-6 text-navy-800 sm:px-6 lg:px-8">Loading the storefront draft…</p>}
      {load.status === "error" && (
        <div role="alert" className="mx-4 my-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-tint p-4 text-sm text-error sm:mx-6 lg:mx-8">
          <span>{load.message}</span>
          <button type="button" onClick={reloadDraft} className="min-h-[44px] font-bold underline">Try again</button>
        </div>
      )}
      {ready && (
        <section aria-label="Draft preview" style={previewStyle} className="bg-off-white text-charcoal">
          <div className="on-navy bg-navy-900 px-4 py-2 sm:px-6 lg:px-8"><BrandLogo name={settings.brand.name} surface="navy" size="sm" /></div>
          <StorefrontSections settings={settings} mediaById={mediaById} showProblems />
        </section>
      )}
    </div>
  );
}
