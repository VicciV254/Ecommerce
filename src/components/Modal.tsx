import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PLACEMENTS = {
  center: "items-center justify-center p-4",
  end: "items-stretch justify-end p-0",
  /** Full-height sheet on phones; a centred dialog from 768px. */
  sheet: "items-stretch justify-center p-0 md:items-center md:p-4",
} as const;

/** Elements that can be Tab stops, including native disclosure summaries. */
const TAB_STOP_SELECTOR = "a[href], button, input, select, textarea, summary, [tabindex]";

export function ModalDialog({
  open, onClose, label, placement = "center", dismissAt, children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  placement?: keyof typeof PLACEMENTS;
  dismissAt?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissAt) return;
    const media = window.matchMedia(dismissAt);
    const dismiss = () => { if (media.matches) onClose(); };
    dismiss();
    media.addEventListener("change", dismiss);
    return () => media.removeEventListener("change", dismiss);
  }, [open, dismissAt, onClose]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`modal-frame fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent text-inherit backdrop:bg-black/50 open:flex ${PLACEMENTS[placement]}`}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" || event.defaultPrevented ||
          !(event.target instanceof Element) || event.target.closest("dialog") !== event.currentTarget
        ) return;
        const dialog = event.currentTarget;
        const focused = event.target;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR))
          .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") &&
            element.closest("dialog") === dialog && element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility === "visible");
        if (!controls.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        // Wrap only past the last stop in the direction of travel; focus may also sit on the dialog or a region holding its controls.
        const ahead = event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
        if (controls.some((control) => focused.compareDocumentPosition(control) & ahead)) return;
        event.preventDefault();
        (event.shiftKey ? controls[controls.length - 1] : controls[0]).focus();
      }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropPress.current) onClose();
        backdropPress.current = false;
      }}
    >
      {children}
    </dialog>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  size = "md",
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  size?: "md" | "lg";
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  const widthCls = size === "lg" ? "max-w-xl" : "max-w-md";
  return (
    <ModalDialog open={open} onClose={onCancel} label={title}>
      <div className={`relative w-full ${widthCls} animate-fade-in rounded-lg bg-white p-6 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain`}>
        <h3 className="font-display text-lg uppercase tracking-wider text-brand-primary">{title}</h3>
        {message && <p className="mt-2 text-sm text-gray-500">{message}</p>}
        {children}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-sm border border-light-gray py-2.5 text-xs font-bold uppercase tracking-wider text-charcoal transition-colors hover:bg-off-white"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-sm py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 ${
              tone === "danger" ? "bg-error hover:bg-red-700" : "bg-brand-primary hover:bg-brand-secondary hover:text-brand-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

export function Toast({ open, message }: { open: boolean; message: string }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const dialogs = document.querySelectorAll<HTMLElement>("dialog.modal-frame[open]");
      const focusedDialog = document.activeElement?.closest<HTMLElement>("dialog.modal-frame[open]");
      setContainer(focusedDialog ?? dialogs[dialogs.length - 1] ?? document.body);
    };
    update();
    // A modal makes background live regions inert; keep feedback in its active layer.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [open]);
  if (!open || !container) return null;
  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-6 left-1/2 z-[110] -translate-x-1/2 animate-fade-in">
      <div className="flex items-center gap-2 rounded-sm bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-xl">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4 text-success">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        {message}
      </div>
    </div>,
    container,
  );
}
