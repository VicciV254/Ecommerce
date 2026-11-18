import { STORE_FACTS } from "../store/storeFacts";

/** The store's email as a mail link; it may break anywhere, so a long address never widens a narrow column. */
export function EmailLink({ className }: { className: string }) {
  return <a href={`mailto:${STORE_FACTS.email}`} className={`${className} [overflow-wrap:anywhere]`}>{STORE_FACTS.email}</a>;
}

/** The store's phone number as a call link; at large text sizes on narrow screens it may wrap at its spaces. */
export function PhoneLink({ className }: { className: string }) {
  return <a href={`tel:${STORE_FACTS.phone.tel}`} className={className}>{STORE_FACTS.phone.display}</a>;
}
