import { useEffect, useState } from "react";
import { describeApiError } from "../../api/errors";
import type { Pagination } from "../../api/orders";
import { OrderFormatError } from "../../store/orderModel";

/** A list request's state: loading, the answer, or a message saying why it failed. */
export type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function describeListError(error: unknown, fallback: string) {
  return error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, fallback);
}

/** A page kept in the address instead of in the list: the current page, and how to move to another (with a replace). */
export type PageControl = { page: number; onPage: (page: number) => void };

/**
 * Loads one page whenever the request (a memoized `load`), page or reload token changes; superseded answers
 * are dropped. A page past the end (the list shrank) is replaced by the last page that exists. The page is the
 * list's own unless `control` keeps it in the address.
 */
export function usePage<T extends { pagination: Pagination }>(load: (page: number) => Promise<T>, reloadToken: number, fallback: string, control?: PageControl) {
  const [ownPage, setOwnPage] = useState(1);
  const page = control ? control.page : ownPage;
  const setPage = control ? control.onPage : setOwnPage;
  const [loaded, setLoaded] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    load(page)
      .then((data) => { if (current) setLoaded({ status: "ready", data }); })
      .catch((error: unknown) => { if (current) setLoaded({ status: "error", message: describeListError(error, fallback) }); });
    return () => { current = false; };
  }, [load, page, attempt, reloadToken, fallback]);
  const last = loaded.status === "ready" ? Math.max(1, loaded.data.pagination.pages) : null;
  const pastEnd = last !== null && page > last;
  useEffect(() => {
    if (pastEnd && last !== null) setPage(last);
  }, [pastEnd, last, setPage]);
  // A page past the end, whether still asked for or still the answer on screen after the move back, reads as loading
  // until the last page arrives, never as an empty list.
  const showsPastEnd = loaded.status === "ready" && loaded.data.pagination.page > Math.max(1, loaded.data.pagination.pages);
  const state: LoadState<T> = pastEnd || showsPastEnd ? { status: "loading" } : loaded;
  return { setPage, state, setState: setLoaded, retry: () => setAttempt((value) => value + 1) };
}
