import { useMemo } from "react";
import { inlineLinkClass } from "../components/checkout";
import { InfoPage, infoList } from "../components/InfoPage";
import { ErrorPanel, LoadingPanel } from "../components/ui";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { DELIVERY_FEE_TERMS } from "../store/orderCopy";
import { returnRuleGroups, type ReturnRuleGroup } from "../store/returnRules";
import { STORE_FACTS, joinNames } from "../store/storeFacts";

const sectionHeading = "mt-10 type-h2 text-navy-900";

/** "Health & Beauty, except Hair Tools". */
const groupText = ({ name, exceptions }: ReturnRuleGroup) => (exceptions.length ? `${name}, except ${joinNames(exceptions)}` : name);

/** One restricted rule and the categories it covers; a rule that covers nothing is left out. */
function RuleLine({ rule, groups }: { rule: string; groups: ReturnRuleGroup[] }) {
  if (!groups.length) return null;
  return (
    <li>
      {rule}
      <ul className="mt-2 list-[circle] space-y-1 pl-5">
        {groups.map((group, index) => <li key={`${group.name}-${index}`}>{groupText(group)}</li>)}
      </ul>
    </li>
  );
}

/** The return rules and refund terms new orders get, from the catalog's return policy and category rules. */
export default function Returns() {
  const { status, error, categories, returnPolicy, demonstrationOrders, reload } = useCatalog();
  const groups = useMemo(() => returnRuleGroups([...categories.byId.values()]), [categories]);

  let terms;
  if (returnPolicy) {
    terms = (
      <>
        <p>
          Customers can ask to return items within {returnPolicy.windowDays} days of delivery, from Your orders, choosing the
          items and a reason.
        </p>
        <h2 className={sectionHeading}>What can be returned</h2>
        <ul className={infoList}>
          <li>Most items: for any reason.</li>
          <RuleLine rule="Only if unopened, or if faulty, damaged or wrong:" groups={groups.UNOPENED_OR_FAULT} />
          <RuleLine rule="Only if faulty, damaged or wrong:" groups={groups.FAULT_ONLY} />
          <li>Each product page shows the rule that applies to it.</li>
        </ul>
        <h2 className={sectionHeading}>Refunds</h2>
        <ul className={infoList}>
          <li>Returns are refunded; exchanges and store credit aren't offered.</li>
          <li>Staff check returned items when they arrive. Accepted items are refunded by M-Pesa, which staff send by hand.</li>
          {demonstrationOrders === true && <li>Refunds of demonstration payments are recorded without moving money.</li>}
          <li>{DELIVERY_FEE_TERMS[returnPolicy.deliveryFeeRefund]}</li>
          <li>Refunds are rounded up to the nearest whole shilling and never exceed what was paid.</li>
          <li>
            Cancelling a paid order before it's dispatched asks for a refund of whatever hasn't already been refunded,
            including delivery. Staff then send it by M-Pesa; cancelling doesn't send money by itself.
          </li>
        </ul>
      </>
    );
  } else if (status === "loading") {
    terms = <LoadingPanel label="Loading the return rules…" />;
  } else {
    terms = <ErrorPanel title="Return rules are unavailable" message={error ?? "The catalog could not be loaded."} onRetry={reload} />;
  }

  return (
    <InfoPage
      title="Returns and refunds"
      note={(
        <p>
          {STORE_FACTS.demonstration} This page shows the return rules the store is set up with for new orders.{" "}
          <Link to="/account/orders" className={inlineLinkClass}>Your orders</Link> shows the rules and deadline saved with
          each order.
        </p>
      )}
    >
      {terms}
    </InfoPage>
  );
}
