import type { ReactNode } from "react";
import { useStorefront } from "../store/StorefrontContext";
import { BrandLogo } from "./Brand";

/** Shared form styling for the sign-in, registration, verification and staff sign-in screens. */
export const authStyles = {
  label: "mb-1 block text-sm font-semibold text-navy-900",
  field: "block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-navy-900 placeholder:text-muted",
  submit:
    "flex min-h-[44px] w-full items-center justify-center rounded-sm bg-navy-900 px-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted",
  link: "font-semibold text-link underline underline-offset-4 hover:text-link-hover",
  error: "rounded-md bg-error-tint p-3 text-sm text-error",
  success: "rounded-md bg-success-tint p-3 text-sm font-medium text-success",
} as const;

/** One frame for every sign-in step: a navy band with the stacked lockup, then the form on white, at most 448px wide. */
export function AuthLayout({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const { brandName } = useStorefront();
  return (
    <div className="flex justify-center px-4 py-8 md:py-12">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-surface shadow-overlay">
        <div className="on-navy flex justify-center bg-navy-900 px-6 py-6 md:py-8">
          <BrandLogo name={brandName} surface="navy" layout="stacked" size="lg" />
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="type-h1 text-center text-navy-900">{title}</h1>
          {intro && <div className="mt-2 text-center text-muted">{intro}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
