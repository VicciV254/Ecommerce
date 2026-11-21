import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { MediaAsset, PublishedStorefront } from "../api/catalog";
import { Link, parseRoute, useRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { STORE_FACTS } from "../store/storeFacts";
import { useStorefront } from "../store/StorefrontContext";
import { STORAGE_KEYS } from "../utils/storage";
import { ModalDialog } from "./Modal";
import { useAnyModalOpen } from "./modalState";
import { NewsletterForm } from "./NewsletterForm";
import { usePageIsReady } from "./pageReady";
import { ResponsiveImage } from "./ui";

/** The welcome opens this long after the page's own content is ready. */
const OPEN_AFTER_MS = 2000;
/** Browsing pages, by first path segment, where a first visit is welcomed; never checkout, account, legal or staff pages. */
const WELCOME_PAGES: ReadonlySet<string> = new Set(["", "shop", "departments", "product", "about", "contact", "delivery", "returns", "faq"]);
/** From this width the dialog shows a photo beside its text (Tailwind `md`). */
const PHOTO_QUERY = "(min-width: 48rem)";
/** The photo panel's width in the dialog. */
const PHOTO_SIZES = "18rem";

const welcomes = (route: string) => WELCOME_PAGES.has(parseRoute(route).parts[0] ?? "");

/** Whether this browser hasn't been welcomed yet; a mark that can't be read counts as welcomed. */
function firstVisit() {
  try {
    return localStorage.getItem(STORAGE_KEYS.welcomeShown) === null;
  } catch {
    return false;
  }
}

/** Records the welcome as shown; false when the browser won't keep the mark, and then it isn't shown at all. */
function markShown() {
  try {
    localStorage.setItem(STORAGE_KEYS.welcomeShown, "true");
    return true;
  } catch {
    return false;
  }
}

/** Focus goes back where it was only while the shopper is still on a welcomed page; otherwise that page's own applies. */
const returnsFocus = () => welcomes(window.location.hash.replace(/^#/, "") || "/");

/** The hero's first photo: of the first shown campaign, or the first slide of the first shown carousel. */
function heroPhoto(storefront: PublishedStorefront | null, mediaById: ReadonlyMap<string, MediaAsset>) {
  if (!storefront) return null;
  const { sections, campaigns } = storefront.settings;
  for (const section of sections) {
    if (!section.enabled) continue;
    const ids = section.type === "carousel" ? section.campaignIds ?? [] : section.type === "campaign" && section.campaignId ? [section.campaignId] : [];
    const campaign = ids.map((id) => campaigns.find((item) => item.id === id)).find(Boolean);
    if (campaign) return campaign.desktopMediaId ? mediaById.get(campaign.desktopMediaId) ?? null : null;
  }
  return null;
}

/**
 * The welcome for a first visit: once per browser (the mark is set as it opens), about 2 s after a browsing page's own
 * content is ready, and only while no other dialog is open. Reaching a page that isn't welcomed closes it. Focus starts
 * on its heading, never the email field, so no phone keyboard pops up; nothing subscribes but its Subscribe button.
 */
export function WelcomeDialog() {
  const route = useRoute();
  const pageReady = usePageIsReady();
  const modalOpen = useAnyModalOpen();
  const { brandName, storefront, mediaById } = useStorefront();
  const { mode } = useCatalog();
  const [stage, setStage] = useState<"waiting" | "open" | "done">(() => (firstVisit() ? "waiting" : "done"));
  const [photo, setPhoto] = useState<MediaAsset | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const welcomed = welcomes(route);

  const openNow = useEffectEvent(() => {
    if (!markShown()) {
      setStage("done");
      return;
    }
    // Decided once, as it opens: phones never get (or download) the photo.
    setPhoto(window.matchMedia?.(PHOTO_QUERY).matches ? heroPhoto(storefront, mediaById) : null);
    setStage("open");
  });
  useEffect(() => {
    if (stage !== "waiting" || !welcomed || !pageReady || modalOpen) return;
    const timer = window.setTimeout(openNow, OPEN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [stage, welcomed, pageReady, modalOpen]);

  // Leaving for a page that isn't welcomed (its Privacy link, Back) closes it for good.
  useEffect(() => {
    if (stage === "open" && !welcomed) setStage("done");
  }, [stage, welcomed]);

  const close = useCallback(() => setStage("done"), []);
  const open = stage === "open" && welcomed;
  if (!open) return null;
  return (
    <ModalDialog open label={`Welcome to ${brandName}`} placement="center" initialFocus={heading} returnFocus={returnsFocus} onClose={close}>
      <div className={`on-light relative w-full max-h-[calc(100dvh-2rem)] max-w-md animate-fade-in overflow-y-auto overscroll-contain rounded-2xl bg-surface text-navy-800 shadow-overlay [overflow-wrap:break-word] ${
        photo ? "md:grid md:max-w-3xl md:grid-cols-[18rem_minmax(0,1fr)]" : ""
      }`}>
        {photo && (
          <div className="relative min-h-full bg-surface-warm">
            <ResponsiveImage url={photo.url} preset="card" sizes={PHOTO_SIZES} alt="" width={photo.width} height={photo.height} className="absolute inset-0 h-full w-full object-cover" />
          </div>
        )}
        {/* Side padding in px: with enlarged text, rem padding would leave a phone too little width for the heading's words. */}
        <div className="p-[20px] sm:p-8">
          {/* The close button sits beside the heading, never over it or its focus ring, whatever the text size. */}
          <div className="flex items-start gap-[12px]">
            <h2 ref={heading} tabIndex={-1} className="type-h2 min-w-0 flex-1 text-navy-900">Welcome to {brandName}</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="-mr-[12px] -mt-[12px] flex size-[44px] shrink-0 items-center justify-center rounded-full text-navy-900 hover:bg-surface-soft"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="mt-2">Browse the departments, compare products and save the ones you like to your wishlist.</p>
          {mode === "demo" && (
            <p className="mt-3 rounded-md border border-ocean-blue/30 bg-ocean-blue/10 px-3 py-2 text-sm text-ocean-blue-dark">{STORE_FACTS.demonstration}</p>
          )}
          <h3 className="type-h3 mt-6 text-navy-900">Stay updated</h3>
          <p className="mb-3 mt-1 text-sm">Subscribe for offers and new arrivals.</p>
          <NewsletterForm tone="light" />
          <p className="mt-3 text-sm text-muted">
            Only Subscribe signs you up. <Link to="/privacy" className="font-semibold text-link underline underline-offset-4 hover:text-link-hover">Privacy notice</Link>
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-sm bg-navy-900 px-6 text-sm font-semibold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900"
          >
            Start browsing
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
