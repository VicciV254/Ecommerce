import type { ReactNode } from "react";

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onCancel} />
      <div className={`relative w-full ${widthCls} animate-fade-in rounded-lg bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <h3 className="font-display text-lg uppercase tracking-wider text-brand-primary">{title}</h3>
        {message && <p className="mt-2 text-sm text-gray-500">{message}</p>}
        {children}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-sm border border-light-gray py-2.5 text-xs font-bold uppercase tracking-wider text-charcoal transition-colors hover:bg-off-white"
          >
            {cancelLabel}
          </button>
          <button
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
    </div>
  );
}

/** Lightweight toast for success messages. */
export function Toast({ open, message }: { open: boolean; message: string }) {
  if (!open) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[110] -translate-x-1/2 animate-fade-in">
      <div className="flex items-center gap-2 rounded-sm bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-xl">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4 text-success">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        {message}
      </div>
    </div>
  );
}
