import { useEffect, useRef, useState } from "react";
import { apiStatus } from "../api/errors";
import { subscriptionsAPI } from "../api/subscriptions";
import { primaryActionClass, textLinkClass } from "../components/checkout";
import { Container } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { Link, parseRoute, useEntryFocus, useRoute } from "../router";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";

/** Refusals that mean the link itself is wrong (malformed, or no such subscription); anything else may pass on retry. */
const INVALID_LINK_STATUSES = [400, 404];

type Step = "ready" | "sending" | "done" | "invalid" | "failed";

/**
 * Where an emailed unsubscribe link lands (`#/unsubscribe?token=…`). Nothing happens until the person presses the
 * button, so a mail scanner that opens links cannot unsubscribe anyone. The token is sent, never shown or logged.
 */
export default function Unsubscribe() {
  const { brandName } = useStorefront();
  const { user, refreshUser } = useAuth();
  usePageTitle(`Unsubscribe · ${brandName}`);
  const token = parseRoute(useRoute()).params.get("token") ?? "";
  const [step, setStep] = useState<Step>("ready");
  const heading = useRef<HTMLHeadingElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const invalidAlert = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEntryFocus(heading);

  // Each outcome takes focus where its next step is: the confirmation, the explanation, or the button to try again.
  useEffect(() => {
    if (step === "done") doneHeading.current?.focus();
    else if (step === "invalid") invalidAlert.current?.focus();
    else if (step === "failed") button.current?.focus();
  }, [step]);

  const unsubscribe = async () => {
    setStep("sending");
    try {
      await subscriptionsAPI.unsubscribe({ token });
      setStep("done");
      // The link may be another address's: the account is reloaded as the server has it, never changed here.
      if (user) void refreshUser();
    } catch (error) {
      setStep(INVALID_LINK_STATUSES.includes(apiStatus(error) ?? 0) ? "invalid" : "failed");
    }
  };

  let content;
  if (!token) {
    content = (
      <>
        <p className="mt-3 text-navy-800">This unsubscribe link is incomplete. Open it from the email again, or contact us.</p>
        <Link to="/contact" className={`mt-2 ${textLinkClass}`}>Contact us</Link>
      </>
    );
  } else if (step === "done") {
    content = (
      <div role="status" className="mt-6 rounded-md bg-success-tint p-5">
        <h2 ref={doneHeading} tabIndex={-1} className="type-h3 text-navy-900">You're unsubscribed</h2>
        <p className="mt-2 text-navy-800">
          You won't receive promotional emails from {brandName}. If you have an account, its email preference is now off.
        </p>
        <Link to="/shop" className={`mt-2 ${textLinkClass}`}>Continue shopping</Link>
      </div>
    );
  } else if (step === "invalid") {
    content = (
      <div ref={invalidAlert} tabIndex={-1} role="alert" className="mt-6 rounded-sm bg-error-tint p-3 text-error">
        <p className="font-semibold">This unsubscribe link isn't valid. It may have been copied incompletely.</p>
        <Link to="/contact" className={textLinkClass}>Contact us</Link>
      </div>
    );
  } else {
    content = (
      <>
        <p className="mt-3 text-navy-800">
          You'll stop receiving offers and news by email. Emails about your orders and account aren't affected.
        </p>
        {step === "failed" && (
          <p role="alert" className="mt-4 rounded-sm bg-error-tint p-3 text-sm font-semibold text-error">
            We couldn't unsubscribe you just now. Try again.
          </p>
        )}
        <button
          ref={button}
          type="button"
          onClick={() => void unsubscribe()}
          disabled={step === "sending"}
          className={`mt-6 sm:inline-flex sm:w-auto ${primaryActionClass}`}
        >
          {step === "sending" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      </>
    );
  }

  return (
    <Container className="py-8 md:py-12">
      <div className="max-w-2xl [overflow-wrap:break-word]">
        <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900">Unsubscribe from {brandName} emails</h1>
        {content}
      </div>
    </Container>
  );
}
