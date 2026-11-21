import { InfoPage, infoParagraph } from "../components/InfoPage";
import { ErrorPanel, LoadingPanel } from "../components/ui";
import type { CatalogDelivery } from "../api/catalog";
import { usePageReady } from "../components/pageReady";
import { useCatalog } from "../store/CatalogContext";
import { DELIVERY_LABELS } from "../store/checkoutModel";
import { DELIVERY_PROMISES, STORE_FACTS, deliveryCoverage } from "../store/storeFacts";
import { formatKES } from "../utils/format";

const factLabel = "text-sm font-semibold text-muted";

/** One offered method: where it delivers, its fee (and when it is free) and how long it takes. */
function DeliveryOption({ option }: { option: CatalogDelivery }) {
  const promise = DELIVERY_PROMISES[option.method];
  return (
    <li className="min-w-0 rounded-lg border border-divider bg-surface p-5 shadow-card">
      <h2 className="type-h3 text-navy-900">{DELIVERY_LABELS[option.method]}</h2>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className={factLabel}>Where</dt>
          <dd>{deliveryCoverage(option.counties)}</dd>
        </div>
        <div>
          <dt className={factLabel}>Fee</dt>
          <dd>{formatKES(option.fee)}</dd>
          {/* The server's rule: free when the discounted items subtotal is at least `freeAbove`. */}
          {option.freeAbove !== null && (
            <dd className="mt-1">
              Free when the items subtotal after discounts, before VAT and delivery, is {formatKES(option.freeAbove)} or more.
            </dd>
          )}
        </div>
        {promise && (
          <div>
            <dt className={factLabel}>Delivery time</dt>
            <dd>{promise}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/** The delivery options new orders can use, from the catalog's delivery facts (the same ones checkout offers). */
export default function Delivery() {
  const { status, error, delivery, reload } = useCatalog();
  usePageReady(status !== "loading");
  let options;
  if (delivery) {
    options = <ul className="grid gap-4 sm:grid-cols-2">{delivery.map((option) => <DeliveryOption key={option.method} option={option} />)}</ul>;
  } else if (status === "loading") {
    options = <LoadingPanel label="Loading the delivery options…" />;
  } else {
    options = <ErrorPanel title="Delivery options are unavailable" message={error ?? "The catalog could not be loaded."} onRetry={reload} />;
  }

  return (
    <InfoPage
      title="Delivery"
      note={<p>{STORE_FACTS.demonstration} This page shows the delivery options the store is set up with.</p>}
    >
      {options}
      <p className="mt-6">Working days are Monday to Friday, except public holidays in Kenya.</p>
      <p className={infoParagraph}>
        The delivery fee is shown in the total at checkout, before an order is reserved. VAT (16%) is added to items, not to
        the delivery fee.
      </p>
      {delivery && !delivery.some(({ method }) => method === "STORE_PICKUP") && <p className={infoParagraph}>Pickup isn't offered.</p>}
    </InfoPage>
  );
}
