import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { adminAPI } from "../../api/admin";
import { parseAttention } from "../../store/orderModel";

/** The shortest time between counts fetched because the window regained focus. */
const FOCUS_REFRESH_MS = 60_000;

/**
 * This staff member's unread attention items, for the navigation. Fetched when the shell loads, when the window regains
 * focus (at most once a minute) and when a module asks (after marking items read); nothing polls. A failed fetch shows
 * no count and no error: the count is null.
 */
export function useUnreadAlerts(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const fetchedAt = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetchedAt.current = Date.now();
    adminAPI.attention.getAll()
      .then(({ data }) => { if (current) setCount(parseAttention(data).filter((item) => !item.read).length); })
      .catch(() => { if (current) setCount(null); });
    return () => { current = false; };
  }, [enabled, request]);
  useEffect(() => {
    if (!enabled) return;
    const regained = () => {
      if (Date.now() - fetchedAt.current >= FOCUS_REFRESH_MS) setRequest((value) => value + 1);
    };
    window.addEventListener("focus", regained);
    return () => window.removeEventListener("focus", regained);
  }, [enabled]);
  const refresh = useCallback(() => setRequest((value) => value + 1), []);
  return { count: enabled ? count : null, refresh };
}

/** Asks the navigation to count unread alerts again; outside the shell it does nothing. */
export const UnreadAlertsRefresh = createContext<() => void>(() => undefined);
export const useRefreshUnreadAlerts = () => useContext(UnreadAlertsRefresh);
