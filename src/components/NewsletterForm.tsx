import { useEffect, useId, useRef, useState } from "react";
import { describeApiError } from "../api/errors";
import { subscriptionsAPI } from "../api/subscriptions";
import { useAuth } from "../contexts/AuthContext";

const THANKS = "Thank you for subscribing. Every email has a link to unsubscribe.";

/**
 * The promotional-email sign-up, in the footer (on navy) and the welcome dialog (on a light card): an address and
 * Subscribe, which alone subscribes. The thanks replaces the form and takes focus unless focus has moved elsewhere; a
 * refusal is shown under the field in the API's words.
 */
export function NewsletterForm({ tone }: { tone: "navy" | "light" }) {
  const { user, refreshUser } = useAuth();
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const thanks = useRef<HTMLParagraphElement>(null);

  // The confirmation replaces the form, so the focused field or button disappears: put focus on the confirmation instead
  // (which also reads it out), unless focus has already moved somewhere else on the page. Inside a dialog, focus left
  // behind rests on the dialog itself.
  useEffect(() => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || (active instanceof HTMLDialogElement && active.contains(thanks.current));
    if (done && lost) thanks.current?.focus();
  }, [done]);
  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);
    try {
      await subscriptionsAPI.subscribe({ email });
      setDone(true);
      setEmail("");
      // The address may be this account's: reload it, so its email preference shows what is now sent.
      if (user) void refreshUser();
    } catch (reason) {
      setError(describeApiError(reason, "Could not subscribe."));
    } finally {
      setLoading(false);
    }
  };

  const navy = tone === "navy";
  if (done) {
    return (
      <p ref={thanks} tabIndex={-1} role="status" className={navy ? "max-w-md text-center font-semibold text-gold-400 md:text-left" : "font-semibold text-success"}>
        {THANKS}
      </p>
    );
  }
  return (
    /* Side by side only while the form is at least 20rem wide: rem grows with the text size, so at large text or on very
       narrow screens the field and button stack and the field keeps the full width. */
    <div className="@container w-full max-w-md">
      <form onSubmit={handleSubscribe} className="flex flex-col gap-2 @xs:flex-row @xs:gap-0">
        <label htmlFor={emailId} className="sr-only">Email address</label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address"
          disabled={loading}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`min-h-[44px] min-w-0 w-full rounded-sm bg-surface px-4 py-2.5 text-navy-900 placeholder:text-muted disabled:bg-surface-soft @xs:rounded-r-none ${navy ? "" : "border border-control"}`}
        />
        <button
          type="submit"
          disabled={loading}
          className={`min-h-[44px] shrink-0 rounded-sm px-5 text-xs font-bold uppercase tracking-[0.12em] transition-[color,background-color,transform] duration-(--motion-feedback) motion-safe:active:scale-[0.97] disabled:cursor-not-allowed @xs:rounded-l-none ${
            navy ? "bg-gold-500 text-navy-900 hover:bg-gold-400 disabled:bg-on-navy-muted" : "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900 disabled:bg-surface-soft disabled:text-muted"
          }`}
        >
          {loading ? "Subscribing..." : "Subscribe"}
        </button>
      </form>
      {error && (
        <p id={errorId} role="alert" className="mt-2 rounded-sm bg-error-tint px-3 py-2 text-sm font-semibold text-error [overflow-wrap:break-word]">
          {error}
        </p>
      )}
    </div>
  );
}
