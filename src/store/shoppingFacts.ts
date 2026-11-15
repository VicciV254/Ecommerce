/**
 * Plain statements of how buying works, shared by About and the footer so their wording cannot drift.
 * They describe the approved policy only: no contact details, hours or locations are published yet.
 */
export const SHOPPING_FACTS = {
  vat: "Prices are shown excluding VAT; 16% VAT is added at checkout.",
  delivery: "Choose delivery or pickup at checkout. The fee and VAT appear in your total before you reserve the order.",
  payment: "Pay by M-Pesa, approving the payment in the prompt on your phone.",
} as const;

/** Returns, using the window from the published return policy when the catalog has loaded it. */
export function returnsFact(windowDays: number | null) {
  return windowDays === null
    ? "Each product page shows its return rule and window. Refunds are sent by M-Pesa."
    : `Most items can be returned within ${windowDays} days of delivery or collection; some only if unopened, or if faulty, damaged or wrong. Refunds are sent by M-Pesa.`;
}
