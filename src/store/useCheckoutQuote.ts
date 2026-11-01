import { isCancel } from "axios";
import { useCallback, useEffect, useState } from "react";
import { checkoutAPI, type Quote, type QuoteRequest } from "../api/orders";
import {
  CheckoutFormatError,
  describeQuoteFailure,
  parseQuote,
  quoteMatchesRequest,
  quoteTimeLeft,
  requestSignature,
} from "./checkoutModel";

/** Pause after a cart or choice change before asking the server for a new quote. */
export const QUOTE_DEBOUNCE_MS = 300;
/** Longest delay `setTimeout` honours. */
const MAX_TIMER_MS = 2_147_483_647;

type QuoteResult = { attempt: number } & (
  | { status: "ready"; quote: Quote }
  | { status: "error"; code?: string; message: string }
);

export type CheckoutQuote = {
  status: "idle" | "loading" | "ready" | "error";
  /** Identity of the current request; `null` when nothing can be quoted yet. */
  signature: string | null;
  /** The server quote for exactly the current request. */
  quote: Quote | null;
  /** The earlier quote for the same request while (or after) `refresh` replaces it. */
  replaced: Quote | null;
  error: { code?: string; message: string } | null;
  /** This browser's timer reached the quote's expiry; the server remains the authority. */
  expired: boolean;
  /** Asks for a new quote for the same request. */
  refresh: () => void;
};

/**
 * Server quote for the current cart and choices. Results for an older request, attempt or
 * unmounted owner are discarded, so a slow response can never replace a newer total.
 */
export function useCheckoutQuote(request: QuoteRequest | null): CheckoutQuote {
  const signature = request ? requestSignature(request) : null;
  // Each new signature or refresh is a new attempt; a result only counts for the attempt that asked for it.
  const [current, setCurrent] = useState<{ signature: string | null; attempt: number; replaced: Quote | null }>(
    { signature, attempt: 0, replaced: null },
  );
  if (current.signature !== signature) setCurrent({ signature, attempt: current.attempt + 1, replaced: null });
  const attempt = current.signature === signature ? current.attempt : current.attempt + 1;
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [expiredQuoteId, setExpiredQuoteId] = useState<string | null>(null);

  useEffect(() => {
    if (signature === null) return;
    let live = true;
    const input: QuoteRequest = JSON.parse(signature);
    const timer = window.setTimeout(() => {
      checkoutAPI.createQuote(input)
        .then(({ data }) => {
          const quote = parseQuote(data);
          if (!quoteMatchesRequest(quote, input)) throw new CheckoutFormatError("quote does not match the cart");
          if (live) setResult({ attempt, status: "ready", quote });
        })
        .catch((error: unknown) => {
          if (live && !isCancel(error)) setResult({ attempt, status: "error", ...describeQuoteFailure(error) });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [signature, attempt]);

  const latest = signature !== null && result?.attempt === attempt ? result : null;
  const quote = latest?.status === "ready" ? latest.quote : null;

  useEffect(() => {
    if (!quote) return;
    const left = quoteTimeLeft(quote);
    // A clock running ahead of the server's must not expire a quote the server has just issued, and
    // delays beyond the timer limit would fire at once instead of never.
    if (left <= 0 || left > MAX_TIMER_MS) return;
    const timer = window.setTimeout(() => setExpiredQuoteId(quote.id), left);
    return () => window.clearTimeout(timer);
  }, [quote]);

  const refresh = useCallback(() => {
    setCurrent((value) => ({ ...value, attempt: value.attempt + 1, replaced: quote ?? value.replaced }));
  }, [quote]);

  return {
    status: signature === null ? "idle" : latest?.status ?? "loading",
    signature,
    quote,
    replaced: current.signature === signature ? current.replaced : null,
    error: latest?.status === "error" ? { code: latest.code, message: latest.message } : null,
    expired: quote !== null && quote.id === expiredQuoteId,
    refresh,
  };
}
