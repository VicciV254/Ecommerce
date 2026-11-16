import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Link, useRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { cartEstimate, cartLineViews } from "../store/cartModel";
import { CHECKOUT_SIGN_IN } from "../store/returnTo";
import { useStore } from "../store/StoreContext";
import { CartEstimateSummary, CartLines, useCartUndo } from "./CartLines";
import { ModalDialog } from "./Modal";

type MiniCartValue = {
  /** Opens the drawer; `message` reports the add that opened it. */
  open: (options?: { message?: string }) => void;
  isOpen: boolean;
};

const MiniCartContext = createContext<MiniCartValue | null>(null);

/**
 * The header's cart drawer, opened by the cart button and after an Add from the product page or a card. It closes
 * when the page changes or the signed-in owner changes, so it never shows another owner's lines.
 */
export function MiniCartProvider({ children }: { children: ReactNode }) {
  const [openWith, setOpenWith] = useState<{ message: string | null } | null>(null);
  const route = useRoute();
  const { state } = useStore();
  const close = useCallback(() => setOpenWith(null), []);

  useEffect(() => { setOpenWith(null); }, [route, state.personalOwner]);

  const value = useMemo<MiniCartValue>(() => ({
    open: (options) => setOpenWith({ message: options?.message ?? null }),
    isOpen: openWith !== null,
  }), [openWith]);

  return (
    <MiniCartContext.Provider value={value}>
      {children}
      {openWith && <MiniCartDrawer message={openWith.message} onClose={close} />}
    </MiniCartContext.Provider>
  );
}

/** The drawer's opener; `null` outside the provider (surfaces rendered on their own in unit tests). */
export function useMiniCart() {
  return useContext(MiniCartContext);
}

const primaryLink =
  "flex min-h-[44px] w-full items-center justify-center rounded-sm bg-navy-900 px-5 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900";
const secondaryLink =
  "flex min-h-[44px] w-full items-center justify-center rounded-sm border border-navy-900 px-5 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";

function MiniCartDrawer({ message, onClose }: { message: string | null; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, ownerReady, cartCount: count } = useStore();
  const { user } = useAuth();
  const catalog = useCatalog();
  const undo = useCartUndo();
  const [announced, setAnnounced] = useState("");
  const views = ownerReady && catalog.status === "ready" ? cartLineViews(state.cart, catalog.productsById) : [];
  const estimate = cartEstimate(views);

  // Filled after the status region exists, so the add result is announced rather than read only on discovery.
  useEffect(() => { setAnnounced(message ?? ""); }, [message]);

  let body: ReactNode;
  if (!ownerReady || catalog.status === "loading") {
    body = <p role="status" className="py-8 text-center text-sm text-muted">{ownerReady ? "Loading current prices…" : "Loading your cart…"}</p>;
  } else if (catalog.status === "error") {
    body = (
      <div role="alert" className="py-8 text-center text-sm text-navy-800">
        <p className="font-semibold text-navy-900">Cart prices could not be loaded.</p>
        <p className="mt-1">{catalog.error} Your cart is unchanged.</p>
        <button type="button" onClick={catalog.reload} className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
          Try again
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <CartLines views={views} undo={undo} label="Items in your cart" onNavigate={onClose} />
        {!views.length && (
          <div className="py-8 text-center">
            <p className="font-semibold text-navy-900">Your cart is empty.</p>
            <button type="button" onClick={onClose} className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
              Continue shopping
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <ModalDialog open label="Your cart" placement="end" initialFocus={heading} onClose={onClose}>
      <div className="on-light flex h-full w-full flex-col bg-surface text-navy-800 shadow-overlay animate-fade-in md:w-[400px] xl:w-[440px]">
        {/* py-2 leaves room for the close button's focus ring. */}
        <div className="flex items-center justify-between gap-3 border-b border-divider py-2 pl-5 pr-2">
          <h2 ref={heading} tabIndex={-1} className="type-h3 min-w-0 text-navy-900">
            Your cart{count > 0 && <>{" "}<span className="ml-1 text-base font-normal text-muted">({count} {count === 1 ? "item" : "items"})</span></>}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close cart" className="flex size-[44px] shrink-0 items-center justify-center rounded-full text-navy-900 hover:bg-surface-soft">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p role="status" className={announced ? "border-b border-divider bg-success-tint px-5 py-3 text-sm font-semibold text-success" : "sr-only"}>{announced}</p>
        <div className="focus-scroll-room min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{body}</div>
        {views.length > 0 && (
          <div className="space-y-3 border-t border-divider px-5 py-4">
            <CartEstimateSummary estimate={estimate} pendingFees />
            <Link to={user ? "/checkout" : CHECKOUT_SIGN_IN} onClick={onClose} className={primaryLink}>Checkout</Link>
            {!user && <p className="text-center text-xs text-muted">You will sign in first; your cart comes with you.</p>}
            <Link to="/cart" onClick={onClose} className={secondaryLink}>View cart</Link>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
