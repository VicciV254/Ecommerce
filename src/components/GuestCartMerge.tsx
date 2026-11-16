import { useEffect, useState } from "react";
import { Link, parseRoute, useRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { mergeChanged, type MergeEntry, type MergeOutcome } from "../store/cartModel";
import { useStore } from "../store/StoreContext";
import { Container } from "./ui";

/** Pages a sign-in passes through; the notice waits for the page the shopper is returned to. */
const AUTH_PAGES = new Set(["login", "register", "verify-email"]);

type Notice = { outcome: MergeOutcome; owner: string | null; shownOn: string | null };

const label = (entry: MergeEntry) => `${entry.name}${entry.variantLabel ? ` (${entry.variantLabel})` : ""}`;

/**
 * Finishes a guest-cart merge once the catalog is loaded (sign-in only marks it pending), then reports it once, on
 * the page the shopper returns to: what was added, reduced (with the new quantity) or removed, and why. Nothing is
 * shown when nothing merged. The live region is always present, so the report is announced when it appears.
 */
export function GuestCartMerge() {
  const { mergePending, completeGuestMerge, state } = useStore();
  const catalog = useCatalog();
  const route = useRoute();
  const [notice, setNotice] = useState<Notice | null>(null);
  const owner = state.personalOwner;
  const onAuthPage = AUTH_PAGES.has(parseRoute(route).parts[0] ?? "");

  useEffect(() => {
    if (!mergePending || catalog.status !== "ready") return;
    // Not cancelled on cleanup: the merge runs once per sign-in, so its report must arrive even after a re-run.
    void completeGuestMerge(catalog.productsById).then((outcome) => {
      if (outcome && mergeChanged(outcome)) setNotice({ outcome, owner, shownOn: null });
    });
  }, [mergePending, catalog.status, catalog.productsById, completeGuestMerge, owner]);

  // Shown on the first page after sign-in, and gone once the shopper moves on or the account changes.
  useEffect(() => {
    if (!notice) return;
    if (notice.owner !== owner) setNotice(null);
    else if (onAuthPage) return;
    else if (notice.shownOn === null) setNotice({ ...notice, shownOn: route });
    else if (notice.shownOn !== route) setNotice(null);
  }, [notice, owner, route, onAuthPage]);

  const visible = notice && notice.owner === owner && !onAuthPage ? notice.outcome : null;
  return (
    <div role="status">
      {visible && (
        <Container className="pt-4">
          <MergeReport outcome={visible} onDismiss={() => setNotice(null)} />
        </Container>
      )}
    </div>
  );
}

function MergeReport({ outcome, onDismiss }: { outcome: MergeOutcome; onDismiss: () => void }) {
  const { added, reduced, removed } = outcome;
  return (
    <section aria-label="Your guest cart" className="rounded-md border border-ocean-blue/30 bg-info-tint p-4 text-sm text-navy-800">
      <p className="font-semibold text-navy-900">Your guest cart is now combined with your account&apos;s cart.</p>
      {added.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold text-navy-900">Added</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
            {added.map((entry) => <li key={entry.variantId}>{label(entry)}: {entry.requested} added, {entry.quantity} in your cart.</li>)}
          </ul>
        </div>
      )}
      {reduced.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold text-navy-900">Reduced to what is available</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
            {reduced.map((entry) => (
              <li key={entry.variantId}>{label(entry)}: only {entry.quantity} available, so your cart now has {entry.quantity}.</li>
            ))}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold text-navy-900">Not added</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
            {removed.map((entry) => (
              <li key={entry.variantId}>
                {label(entry)}: {entry.reason === "sold-out" ? "sold out." : "no longer available."}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4">
        <Link to="/cart" className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">View cart</Link>
        <button type="button" onClick={onDismiss} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
          Dismiss
        </button>
      </div>
    </section>
  );
}
