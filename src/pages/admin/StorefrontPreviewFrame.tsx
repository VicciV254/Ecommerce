import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BrandLogo } from "../../components/Brand";
import { StorefrontSections } from "../../components/StorefrontSections";
import { Link } from "../../router";
import { usePageTitle, useStorefront } from "../../store/StorefrontContext";
import { ensureFontStylesheet, themeVariables, type ThemeVariables } from "../../store/storefrontTheme";
import { ADMIN_PREVIEW_ROUTE, productPreviewRoute } from "./adminRoutes";
import { PREVIEW_MESSAGES, readDraftMessage, type PreviewDraft } from "./storefrontPreviewModel";

/** The draft's font pairing, kept apart from the published one the storefront provider loads. */
const PREVIEW_FONT_LINK_ID = "apex-cart-preview-font-link";

/**
 * `#/admin/storefront/preview-frame`: the storefront draft that the draft preview posts, alone in this document, so the
 * renderer's media queries and artwork sources see the frame's own width. It needs no sign-in: it asks for nothing of
 * the staff's and shows only what its parent sends. Opened outside a frame, it says what it is.
 */
export function StorefrontPreviewFrame() {
  const parent = window.parent === window ? null : window.parent;
  return parent ? <FramedDraft parent={parent} /> : <OpenedDirectly />;
}

function FramedDraft({ parent }: { parent: Window }) {
  const [draft, setDraft] = useState<PreviewDraft | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase, ahead of each link's own handler (which then does nothing): nothing in the frame navigates.
    const cancelLinks = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
    };
    document.addEventListener("click", cancelLinks, true);
    return () => document.removeEventListener("click", cancelLinks, true);
  }, []);

  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const { origin } = window.location;
    const observer = new ResizeObserver(() => {
      parent.postMessage({ type: PREVIEW_MESSAGES.height, height: element.getBoundingClientRect().height }, origin);
    });
    observer.observe(element);
    const receive = (event: MessageEvent) => {
      const posted = readDraftMessage(event, parent, origin);
      if (posted) setDraft(posted);
    };
    window.addEventListener("message", receive);
    // Listening first, so the draft the parent sends in reply cannot be missed.
    parent.postMessage({ type: PREVIEW_MESSAGES.ready }, origin);
    return () => {
      window.removeEventListener("message", receive);
      observer.disconnect();
    };
  }, [parent]);

  const fontId = draft?.settings.theme.fontId ?? null;
  useEffect(() => {
    if (fontId === null) return;
    ensureFontStylesheet(fontId, PREVIEW_FONT_LINK_ID);
    return () => document.getElementById(PREVIEW_FONT_LINK_ID)?.remove();
  }, [fontId]);

  const mediaById = useMemo(() => new Map((draft?.media ?? []).map((asset) => [asset.id, asset])), [draft]);
  const style: (CSSProperties & ThemeVariables) | undefined = draft
    ? { ...themeVariables(draft.settings.theme), fontFamily: "var(--font-body)" }
    : undefined;

  return (
    // Measured for the parent. Nothing here or above has a viewport-height minimum, so the frame shrinks as well as
    // grows; `flow-root` keeps the children's margins inside the measured box.
    <div ref={content} style={style} className="flow-root bg-off-white text-charcoal">
      {draft && (
        <>
          <div className="on-navy bg-navy-900 px-4 py-2 sm:px-6 lg:px-8"><BrandLogo name={draft.settings.brand.name} surface="navy" size="sm" /></div>
          <StorefrontSections settings={draft.settings} mediaById={mediaById} showProblems productPreviewRoute={productPreviewRoute} />
        </>
      )}
    </div>
  );
}

function OpenedDirectly() {
  const { brandName } = useStorefront();
  usePageTitle(`Draft preview frame · Admin · ${brandName}`);
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-navy-800">
      <h1 className="type-h1 text-navy-900 [overflow-wrap:anywhere]">Draft preview frame</h1>
      <p className="mt-3">This address shows the storefront draft inside the draft preview. On its own, it has nothing to show.</p>
      <Link
        to={ADMIN_PREVIEW_ROUTE}
        className="mt-6 inline-flex min-h-[44px] items-center rounded-sm bg-navy-900 px-[16px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900"
      >
        Open the draft preview
      </Link>
    </main>
  );
}
