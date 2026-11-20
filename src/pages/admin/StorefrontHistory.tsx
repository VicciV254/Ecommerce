import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { catalogAdminAPI, type StorefrontRevision } from "../../api/catalog";
import type { Pagination } from "../../api/orders";
import { ConfirmModal } from "../../components/Modal";
import { parseRevisionPage } from "../../store/storefrontModel";
import { formatNairobiDateTime } from "../../utils/nairobiDate";
import { useStorefrontDraft } from "./StorefrontDraft";

type History =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; revisions: StorefrontRevision[]; pagination: Pagination };
/** The "Show more" request: none running, running, or failed. */
type More = "idle" | "loading" | "error";

const buttonClass =
  "min-h-11 rounded-sm border border-brand-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-brand-primary";

async function fetchPage(page: number) {
  const { data } = await catalogAdminAPI.getStorefrontRevisions(page);
  const parsed = parseRevisionPage(data);
  if (!parsed) throw new Error("Unexpected publication history response");
  return parsed;
}

/** "17 Nov 2026, 14:05 by bob", or "… (publisher not recorded)", as the confirmation quotes it. */
const publishedWhen = (revision: StorefrontRevision) =>
  `${formatNairobiDateTime(revision.publishedAt)}${revision.publishedBy ? ` by ${revision.publishedBy}` : " (publisher not recorded)"}`;

function LoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
      <span>Couldn't load the publication history.</span>
      <button type="button" onClick={onRetry} className="min-h-11 font-bold underline">Try again</button>
    </div>
  );
}

/**
 * The storefront's publication history, under the editor's status panel and closed until opened: each published
 * version with when and by whom, the live one marked. Writers can copy a version back into the draft, after
 * confirming; shoppers see it only once it is published again. `onRestoreSettled` runs after each restore attempt.
 */
export function StorefrontHistory({ canWrite, onRestoreSettled }: { canWrite: boolean; onRestoreSettled: () => void }) {
  const { load, dirty, busy, historyToken, restore } = useStorefrontDraft();
  const headingId = useId();
  const regionId = useId();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [more, setMore] = useState<More>("idle");
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState<StorefrontRevision | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  /** Counts first-page loads, so a "Show more" answer for an older list is dropped. */
  const generation = useRef(0);

  // Opening loads the first page; so do Try again and each restore (the editor reloads entirely after a publish).
  useEffect(() => {
    if (!open) return;
    let current = true;
    generation.current += 1;
    setHistory({ status: "loading" });
    setMore("idle");
    fetchPage(1)
      .then((page) => { if (current) setHistory({ status: "ready", ...page }); })
      .catch(() => { if (current) setHistory({ status: "error" }); });
    return () => { current = false; };
  }, [open, attempt, historyToken]);

  const showMore = async () => {
    if (history.status !== "ready" || more === "loading") return;
    const started = generation.current;
    setMore("loading");
    try {
      const next = await fetchPage(history.pagination.page + 1);
      if (started !== generation.current) return;
      setHistory((current) => {
        if (current.status !== "ready") return current;
        const known = new Set(current.revisions.map((item) => item.version));
        return { status: "ready", revisions: [...current.revisions, ...next.revisions.filter((item) => !known.has(item.version))], pagination: next.pagination };
      });
      setMore("idle");
    } catch {
      if (started === generation.current) setMore("error");
    }
  };

  const draft = load.status === "ready" ? load.draft : null;
  const blocked = dirty || busy !== "";
  const confirmRestore = async () => {
    const revision = confirming;
    if (!revision) return;
    // Closed first, so focus is back on the page before the restore moves it.
    flushSync(() => setConfirming(null));
    setRestoring(revision.version);
    await restore(revision.version);
    setRestoring(null);
    onRestoreSettled();
  };

  let body: ReactNode;
  if (history.status === "loading") body = <p role="status" className="text-sm text-gray-600">Loading the publication history…</p>;
  else if (history.status === "error") body = <LoadFailure onRetry={() => setAttempt((value) => value + 1)} />;
  else if (!history.revisions.length) body = <p className="text-sm text-gray-600">Nothing has been published yet.</p>;
  else {
    const hasMore = history.pagination.page < history.pagination.pages;
    body = (
      <>
        {canWrite && dirty && <p id={reasonId} className="mb-3 text-sm font-semibold text-navy-900">Save or discard your changes before restoring.</p>}
        <ul className="divide-y divide-light-gray">
          {history.revisions.map((revision) => (
            <li key={revision.version} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
                Version {revision.version}
                {revision.live && <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">Live</span>}
              </p>
              <p className="min-w-0 text-sm text-gray-600 [overflow-wrap:break-word] md:flex-1">
                {formatNairobiDateTime(revision.publishedAt)} · {revision.publishedBy ?? "publisher not recorded"}
              </p>
              {canWrite && (
                <button
                  type="button"
                  aria-label={`Restore to draft: version ${revision.version}`}
                  aria-disabled={blocked || undefined}
                  aria-describedby={dirty ? reasonId : undefined}
                  onClick={() => { if (!blocked) setConfirming(revision); }}
                  className={`${buttonClass} w-full md:w-auto`}
                >
                  {restoring === revision.version ? "Restoring…" : "Restore to draft"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {more === "error" && <div className="mt-3"><LoadFailure onRetry={() => void showMore()} /></div>}
        {hasMore && more !== "error" && (
          <button type="button" aria-disabled={more === "loading" || undefined} onClick={() => void showMore()} className={`${buttonClass} mt-3 w-full md:w-auto`}>
            {more === "loading" ? "Loading more…" : "Show more"}
          </button>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="@container rounded-lg bg-white shadow-sm">
      <h3 id={headingId}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.15em] text-brand-primary sm:px-6 @max-[12rem]:px-3"
        >
          Publication history
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`size-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </h3>
      {/* Narrower padding where the panel is under 12rem at the current text size, so "Publication" fits its line. */}
      <div id={regionId} hidden={!open} className="border-t border-light-gray px-5 pb-5 pt-4 sm:px-6 @max-[12rem]:px-3">
        {open && body}
      </div>
      {confirming && draft && (
        <ConfirmModal
          open
          title={`Restore version ${confirming.version} to the draft?`}
          message={`The draft will match version ${confirming.version}, published ${publishedWhen(confirming)}. Shoppers keep seeing the live version until you publish.`}
          confirmLabel="Restore to draft"
          cancelLabel="Cancel"
          onConfirm={() => void confirmRestore()}
          onCancel={() => setConfirming(null)}
        >
          {draft.version > draft.publishedVersion && (
            <p className="mt-2 font-semibold text-navy-900">The draft has changes that aren't published. Restoring replaces them.</p>
          )}
        </ConfirmModal>
      )}
    </section>
  );
}
