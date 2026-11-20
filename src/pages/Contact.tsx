import { useId, useRef, useState } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { EmailLink, PhoneLink } from "../components/StoreContacts";
import { Link, useEntryFocus } from "../router";
import { contactAPI } from "../api/contact";
import { describeApiError } from "../api/errors";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";
import { STORE_FACTS } from "../store/storeFacts";

/** The API's minimum lengths, checked here first so the form explains them. */
const NAME_MIN = 2;
const MESSAGE_MIN = 10;
const EMPTY_FORM = { name: "", email: "", phone: "", message: "" };

const label = "mb-1 block text-sm font-semibold text-navy-900";
const field = "w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-navy-900";
const helpLink =
  "inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover";

export default function Contact() {
  const id = useId();
  const { brandName } = useStorefront();
  usePageTitle(`Contact us · ${brandName}`);
  const heading = useRef<HTMLHeadingElement>(null);
  useEntryFocus(heading);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const update = (key: keyof typeof EMPTY_FORM) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await contactAPI.send({ ...form, phone: form.phone || undefined });
      setSent(true);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(describeApiError(err, "Your message could not be sent. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Container className="py-8 md:py-12">
      <Breadcrumb items={[{ label: "Contact" }]} />
      <h1 ref={heading} tabIndex={-1} className="mt-5 type-h1 text-navy-900">Contact us</h1>
      <p className="mt-3 max-w-2xl text-muted">Send us a message about an order, a product or your account.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-start">
        <section aria-labelledby={`${id}-details`} className="rounded-lg border border-divider bg-surface p-5 shadow-card md:p-6">
          <h2 id={`${id}-details`} className="type-h3 text-navy-900">Contact details</h2>
          {/* Label and value side by side from 640px, the label column only as wide as its words. */}
          <dl className="mt-3 grid gap-x-6 sm:grid-cols-[fit-content(50%)_minmax(0,1fr)] sm:items-center">
            <dt className="font-semibold text-navy-900">Email</dt>
            <dd className="min-w-0"><EmailLink className={helpLink} /></dd>
            <dt className="mt-2 font-semibold text-navy-900 sm:mt-0">Phone</dt>
            <dd><PhoneLink className={helpLink} /></dd>
            <dt className="mt-2 font-semibold text-navy-900 sm:mt-0">Hours</dt>
            <dd className="text-navy-800 sm:py-2.5">{STORE_FACTS.hours}</dd>
          </dl>
        </section>
        <section aria-labelledby={`${id}-form`} className="rounded-lg border border-divider bg-surface p-5 shadow-card md:p-6">
          <h2 id={`${id}-form`} className="type-h3 text-navy-900">Or send us a message</h2>
          {sent ? (
            <div role="status" className="mt-4 rounded-md bg-success-tint p-5">
              <p className="font-semibold text-success">✓ Your message has been sent.</p>
              <button type="button" onClick={() => setSent(false)} className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              {error && <p role="alert" className="rounded-sm bg-error-tint p-3 text-sm font-semibold text-error">{error}</p>}
              <div>
                <label htmlFor={`${id}-name`} className={label}>Name</label>
                <input id={`${id}-name`} required minLength={NAME_MIN} autoComplete="name" value={form.name} onChange={update("name")} className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-email`} className={label}>Email</label>
                <input id={`${id}-email`} type="email" required autoComplete="email" value={form.email} onChange={update("email")} className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-phone`} className={label}>Phone (optional)</label>
                <input id={`${id}-phone`} type="tel" autoComplete="tel" value={form.phone} onChange={update("phone")} className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-message`} className={label}>Message</label>
                <textarea
                  id={`${id}-message`}
                  required
                  minLength={MESSAGE_MIN}
                  rows={5}
                  aria-describedby={`${id}-message-hint`}
                  value={form.message}
                  onChange={update("message")}
                  className={field}
                />
                <p id={`${id}-message-hint`} className="mt-1 text-sm text-muted">At least {MESSAGE_MIN} characters.</p>
              </div>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex min-h-[44px] items-center rounded-sm bg-navy-900 px-6 text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted"
              >
                {sending ? "Sending..." : "Send message"}
              </button>
            </form>
          )}
          <p className="mt-4 text-sm text-muted">Messages are emailed to our mailbox.</p>
        </section>

        {/* Beside both cards from 768px. */}
        <section aria-labelledby={`${id}-orders`} className="rounded-lg bg-surface-soft p-5 md:col-start-2 md:row-span-2 md:row-start-1 md:p-6">
          <h2 id={`${id}-orders`} className="type-h3 text-navy-900">About an order?</h2>
          <p className="mt-2 text-navy-800">Include your order number in the message. You can also follow an order yourself:</p>
          <ul className="mt-2">
            <li><Link to="/track" className={helpLink}>Track an order</Link></li>
            <li><Link to="/account/orders" className={helpLink}>Your orders</Link></li>
          </ul>
        </section>
      </div>
    </Container>
  );
}
