import { useCallback, useEffect, useId, useState } from "react";
import { adminAPI, type AttentionItem } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { ATTENTION_TYPE_LABELS, describeStaffFailure } from "../../store/orderCopy";
import { OrderFormatError, parseAttention, parseNotificationReport } from "../../store/orderModel";
import { formatDateTime } from "../../utils/format";
import { Feedback } from "./shared";
import { useRefreshUnreadAlerts } from "./unreadAlerts";

/** Items listed before "Show all"; the rest stay one press away and nothing is hidden for being read. */
const PREVIEW = 5;

type LoadState = { status: "loading" } | { status: "ready"; items: AttentionItem[] } | { status: "error"; message: string };

const SEVERITY: Record<AttentionItem["severity"], { label: string; tone: string }> = {
  high: { label: "High", tone: "bg-error/10 text-error" },
  medium: { label: "Medium", tone: "bg-warning/15 text-warning" },
  low: { label: "Low", tone: "bg-ocean-blue/10 text-ocean-blue" },
};

const smallClass = "min-h-11 rounded-sm border border-light-gray px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-charcoal hover:border-brand-primary hover:text-brand-primary aria-disabled:opacity-50";

/**
 * Open work derived from current records. Marking an item read only changes this staff member's view;
 * the item stays listed until the underlying order, payment, return, refund or email is resolved.
 */
export function AttentionPanel({ canWrite, reloadToken, onOpen }: {
  canWrite: boolean;
  reloadToken: number;
  onOpen: (item: AttentionItem, from: HTMLElement) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const refreshUnread = useRefreshUnreadAlerts();
  const titleId = useId();
  const listId = useId();

  useEffect(() => {
    let current = true;
    adminAPI.attention.getAll()
      .then(({ data }) => { if (current) setState({ status: "ready", items: parseAttention(data) }); })
      .catch((error: unknown) => {
        if (current) {
          setState({
            status: "error",
            message: error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, "The attention list could not be loaded."),
          });
        }
      });
    return () => { current = false; };
  }, [reloadToken, attempt]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const failItem = (key: string, message: string) => setItemErrors((current) => ({ ...current, [key]: message }));

  const markRead = async (item: AttentionItem) => {
    if (busyKey) return;
    setBusyKey(item.key);
    setItemErrors(({ [item.key]: _cleared, ...rest }) => rest);
    try {
      await adminAPI.attention.markRead([item.key]);
      setState((current) => current.status === "ready"
        ? { status: "ready", items: current.items.map((entry) => (entry.key === item.key ? { ...entry, read: true } : entry)) }
        : current);
      setStatus(`Marked read: ${item.title}. It stays listed until the work is done.`);
      // The navigation's unread count follows.
      refreshUnread();
    } catch (error) {
      failItem(item.key, describeApiError(error, "This item could not be marked read."));
    } finally {
      setBusyKey(null);
    }
  };

  const retryEmail = async (item: AttentionItem) => {
    if (busyKey) return;
    setBusyKey(item.key);
    setItemErrors(({ [item.key]: _cleared, ...rest }) => rest);
    try {
      const { data } = await adminAPI.notifications.retry(item.entityId);
      const report = parseNotificationReport(data, item.entityId);
      setStatus(report.status === "SENT"
        ? `Email sent: ${item.title}.`
        : `Email retry recorded for ${item.title}; it has not been sent yet (status ${report.status.toLowerCase()}).`);
      refresh();
    } catch (error) {
      const outcome = error instanceof OrderFormatError
        ? { message: "The retry was sent, but its result could not be read. The list has been refreshed.", reload: true }
        : describeStaffFailure(error, "The email could not be retried.");
      failItem(item.key, outcome.message);
      if (outcome.reload) refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const items = state.status === "ready" ? state.items : [];
  const unread = items.filter((item) => !item.read).length;
  const shown = expanded ? items : items.slice(0, PREVIEW);

  return (
    <section aria-labelledby={titleId} className="rounded-lg bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={titleId} className="font-body text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-brand-primary">Needs attention</h3>
          {state.status === "ready" && (
            <p className="text-xs text-gray-600">{items.length} {items.length === 1 ? "item" : "items"} · {unread} unread</p>
          )}
        </div>
        <button type="button" onClick={refresh} className={smallClass}>Refresh<span className="sr-only"> attention list</span></button>
      </div>
      <p role="status" className={status ? "mt-3 rounded-md bg-off-white p-2 text-xs text-charcoal [overflow-wrap:anywhere]" : "sr-only"}>{status}</p>
      {state.status === "loading" && <p role="status" className="mt-3 text-sm text-gray-600">Loading items that need attention…</p>}
      {state.status === "error" && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          <span>{state.message}</span>
          <button type="button" onClick={refresh} className="min-h-11 font-bold underline">Try again</button>
        </div>
      )}
      {state.status === "ready" && !items.length && <p className="mt-3 text-sm text-gray-600">Nothing needs attention right now.</p>}
      {shown.length > 0 && (
        <ul id={listId} className="mt-3 divide-y divide-light-gray">
          {shown.map((item) => {
            const severity = SEVERITY[item.severity];
            return (
              <li key={item.key} className={`py-3 first:pt-0 last:pb-0 ${item.read ? "opacity-80" : ""}`}>
                <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-wider">
                  <span className={`rounded-full px-2 py-0.5 ${severity.tone}`}>{severity.label}<span className="sr-only"> priority</span></span>
                  <span className="text-gray-600">{ATTENTION_TYPE_LABELS[item.type]}</span>
                  <span className={item.read ? "text-gray-600" : "text-brand-primary"}>{item.read ? "Read" : "New"}</span>
                </div>
                {/* Order, return and refund numbers have no break of their own: they wrap anywhere rather than run past a phone. */}
                <div className="[overflow-wrap:anywhere]">
                  <p className={`mt-1 text-sm ${item.read ? "text-charcoal" : "font-semibold text-brand-primary"}`}>{item.title}</p>
                  <p className="text-xs text-charcoal">{item.detail}</p>
                  <p className="text-[0.6875rem] text-gray-600">Since {formatDateTime(item.since)}{item.orderNumber ? ` · Order ${item.orderNumber}` : ""}</p>
                </div>
                {itemErrors[item.key] && <div className="mt-2"><Feedback message={itemErrors[item.key]} tone="error" /></div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.orderId && (
                    <button type="button" onClick={(event) => onOpen(item, event.currentTarget)} className={smallClass}>
                      Open<span className="sr-only"> {item.title}</span>
                    </button>
                  )}
                  {!item.read && (
                    <button type="button" aria-disabled={busyKey !== null} onClick={() => void markRead(item)} className={smallClass}>
                      Mark read<span className="sr-only"> {item.title}</span>
                    </button>
                  )}
                  {canWrite && item.type === "NOTIFICATION_FAILED" && (
                    <button type="button" aria-disabled={busyKey !== null} onClick={() => void retryEmail(item)} className={smallClass}>
                      Retry email<span className="sr-only"> {item.title}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > PREVIEW && (
        <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)} className={`mt-3 ${smallClass}`}>
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
