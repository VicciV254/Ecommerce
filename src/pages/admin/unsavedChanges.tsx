import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { ConfirmModal } from "../../components/Modal";
import { setNavigationBlocker, useRoute } from "../../router";
import { routePath } from "./adminRoutes";

/** One editor's registration: what it is called, whether it holds unsaved edits, and which routes keep it open. */
type Entry = { label: string; dirty: boolean; keeps: (route: string) => boolean };
type Pending = { labels: string[]; proceed: () => void };

type Registry = {
  set: (id: string, entry: Entry) => void;
  remove: (id: string) => void;
  /** Runs `action` at once, or after the user agrees to discard the dirty editors among `ids` (every editor if omitted). */
  confirm: (action: () => void, ids?: readonly string[]) => void;
};

const RegistryContext = createContext<Registry | null>(null);

/** "Product editor has", "Product editor and Category form have": the dialog names what would be lost. */
function lossMessage(labels: readonly string[]) {
  const names = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0];
  return `${names} ${labels.length > 1 ? "have" : "has"} unsaved changes. Leaving now discards them.`;
}

/**
 * The admin's unsaved-change guard. Editors register with `useUnsavedChanges`; while any is dirty, every way of leaving
 * it asks first in one shared dialog: route changes (links, Back/Forward, typed addresses) through the router's
 * blocker, other exits (sign out, closing a form) through `confirm`, and refresh or closing the tab through the
 * browser's `beforeunload` prompt.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Set while a confirmed exit runs, so its own navigation is not held again. */
  const releasing = useRef(false);

  const recount = useCallback(() => {
    setDirtyCount([...entries.current.values()].filter((entry) => entry.dirty).length);
  }, []);

  const registry = useMemo<Registry>(() => ({
    set: (id, entry) => {
      entries.current.set(id, entry);
      recount();
    },
    remove: (id) => {
      entries.current.delete(id);
      recount();
    },
    confirm: (action, ids) => {
      const labels = [...entries.current.entries()]
        .filter(([id, entry]) => entry.dirty && (!ids || ids.includes(id)))
        .map(([, entry]) => entry.label);
      if (labels.length) setPending({ labels, proceed: action });
      else action();
    },
  }), [recount]);

  const anyDirty = dirtyCount > 0;

  useEffect(() => {
    if (!anyDirty) return;
    return setNavigationBlocker((held) => {
      if (releasing.current) return false;
      const leaving = [...entries.current.values()].filter((entry) => entry.dirty && !entry.keeps(held.to));
      if (!leaving.length) return false;
      // A second attempt while the dialog is open replaces the first: one dialog, the latest destination.
      setPending({ labels: leaving.map((entry) => entry.label), proceed: held.proceed });
      return true;
    });
  }, [anyDirty]);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when a return value is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const discard = () => {
    const held = pending;
    // Closed first, so focus returns to where it was before the exit runs: an editor dialog that then closes can hand
    // focus back to its opener, which this modal would otherwise still make inert.
    flushSync(() => setPending(null));
    if (!held) return;
    releasing.current = true;
    try {
      held.proceed();
    } finally {
      releasing.current = false;
    }
  };

  return (
    <RegistryContext.Provider value={registry}>
      {children}
      <ConfirmModal
        open={Boolean(pending)}
        title="Discard unsaved changes?"
        message={pending ? lossMessage(pending.labels) : undefined}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={discard}
        onCancel={() => setPending(null)}
      />
    </RegistryContext.Provider>
  );
}

/**
 * Registers an editor with the shell's guard. `dirty` must be false for untouched, saved or discarded edits. `keeps`
 * says which routes leave the editor open (by default, any route on the path where it was opened). Outside the
 * provider (isolated module tests) it does nothing and `confirmLeave` runs its action at once.
 */
export function useUnsavedChanges(dirty: boolean, label: string, keeps?: (route: string) => boolean) {
  const registry = useContext(RegistryContext);
  const id = useId();
  const route = useRoute();
  const [home] = useState(() => routePath(route));
  const current = useRef<Entry | null>(null);

  useLayoutEffect(() => {
    const entry: Entry = { label, dirty, keeps: keeps ?? ((to) => routePath(to) === home) };
    current.current = entry;
    registry?.set(id, entry);
  }, [registry, id, label, dirty, keeps, home]);
  useLayoutEffect(() => () => registry?.remove(id), [registry, id]);

  /** Runs `action` (closing this editor, for example) at once, or after the user agrees to discard its changes. */
  const confirmLeave = useCallback((action: () => void) => {
    if (registry) registry.confirm(action, [id]);
    else action();
  }, [registry, id]);

  /** Marks the editor clean straight away, for an exit that follows a successful save in the same step. */
  const release = useCallback(() => {
    if (registry && current.current) registry.set(id, { ...current.current, dirty: false });
  }, [registry, id]);

  return { confirmLeave, release };
}

/** For exits that leave every editor (signing out): runs `action` at once, or after discarding is confirmed. */
export function useLeaveGuard() {
  const registry = useContext(RegistryContext);
  return useCallback((action: () => void) => {
    if (registry) registry.confirm(action);
    else action();
  }, [registry]);
}
