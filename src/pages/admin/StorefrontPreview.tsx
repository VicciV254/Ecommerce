import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MediaAsset, StorefrontSettings } from "../../api/catalog";
import { Link, navigate, useRoute } from "../../router";
import {
  ADMIN_PREVIEW_FRAME_ROUTE,
  PREVIEW_DEVICES,
  adminModuleRoute,
  draftPreviewRoute,
  parsePreviewDevice,
  type PreviewDevice,
  type PreviewDeviceId,
} from "./adminRoutes";
import { useStorefrontDraft } from "./StorefrontDraft";
import { PREVIEW_MESSAGES, previewPercent, readFrameMessage } from "./storefrontPreviewModel";

/** How long the frame has to report ready before the preview offers to reload it. */
const FRAME_LOAD_TIMEOUT_MS = 15_000;

/**
 * The storefront draft at a true phone, tablet or desktop width (`?device=`, phone by default), under a banner that
 * says shoppers can't see it. The shoppers' renderer runs in a same-origin frame whose viewport is the device width, so
 * its media queries and artwork sources behave as on that device; a frame wider than the space is only scaled down for
 * display. The draft's theme and fonts stay inside the frame.
 */
export function StorefrontPreview({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  const route = useRoute();
  const { device, invalid } = useMemo(() => parsePreviewDevice(route), [route]);
  const correction = invalid ? draftPreviewRoute(device) : null;
  useEffect(() => {
    if (correction !== null) navigate(correction, { replace: true });
  }, [correction]);
  const { load, settings, dirty, media, unresolved, reloadDraft } = useStorefrontDraft();
  // The parsed device is always one of the listed ones.
  const shown = PREVIEW_DEVICES.find((option) => option.id === device)!;

  return (
    // Edge to edge inside the content area: the shell's padding is cancelled, so a phone-width admin shows the phone
    // preview at full size.
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8">
      <div className="on-navy border-b-4 border-gold-400 bg-navy-950 px-4 py-[12px] text-white sm:px-6 lg:px-8 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold leading-7">Draft preview: shoppers can't see this</h1>
            {dirty && <span className="rounded-full bg-gold-400 px-3 text-sm font-semibold leading-6 text-navy-900">Includes unsaved changes</span>}
          </div>
          <Link
            to={adminModuleRoute("storefront")}
            className="inline-flex min-h-[44px] items-center rounded-sm border border-white/70 px-[14px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-white/10"
          >
            Back to editor
          </Link>
        </div>
        <p className="mt-1 text-sm text-on-navy-muted">Links don't open from the preview; buying and wishlists are off.</p>
        {unresolved.length > 0 && (
          <div className="mt-2 text-sm text-on-navy-muted">
            <p className="font-semibold text-white">Unavailable references (shown to shoppers as nothing):</p>
            <ul className="list-inside list-disc">
              {unresolved.map((reference) => <li key={`${reference.label}-${reference.id}`}>{reference.label}: {reference.id}</li>)}
            </ul>
          </div>
        )}
      </div>

      <DeviceChoice current={device} />

      {load.status === "loading" && <p role="status" className="px-4 py-6 text-navy-800 sm:px-6 lg:px-8">Loading the storefront draft…</p>}
      {load.status === "error" && (
        <div role="alert" className="mx-4 my-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-tint p-4 text-sm text-error sm:mx-6 lg:mx-8">
          <span>{load.message}</span>
          <button type="button" onClick={reloadDraft} className="min-h-[44px] font-bold underline">Try again</button>
        </div>
      )}
      {load.status === "ready" && settings && <PreviewStage device={shown} settings={settings} media={media} />}
    </div>
  );
}

/** Three 44px buttons choosing the width; each replaces the address, so Back still leaves the preview. */
function DeviceChoice({ current }: { current: PreviewDeviceId }) {
  const labelId = useId();
  return (
    <div className="@container px-4 pt-4 sm:px-6 lg:px-8">
      <p id={labelId} className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600">Preview width</p>
      <div role="group" aria-labelledby={labelId} className="grid max-w-xl grid-cols-1 gap-2 @min-[20rem]:grid-cols-3">
        {PREVIEW_DEVICES.map((option) => {
          const chosen = option.id === current;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={chosen}
              onClick={() => navigate(draftPreviewRoute(option.id), { replace: true })}
              className={`min-h-[44px] min-w-0 rounded-sm border px-[12px] py-[6px] text-center transition-colors duration-(--motion-feedback) ${
                chosen ? "border-navy-900 bg-navy-900 text-white" : "border-control bg-surface text-navy-900 hover:bg-surface-soft"
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>{" "}
              <span className="block text-xs">{option.width} px</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The frame at the device's width, scaled down when the space is narrower, with its loading and failure states. */
function PreviewStage({ device, settings, media }: { device: PreviewDevice; settings: StorefrontSettings; media: MediaAsset[] }) {
  const stage = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // This document's own address at the frame route: same origin, and the same app.
  const [src] = useState(() => new URL(`#${ADMIN_PREVIEW_FRAME_ROUTE}`, window.location.href).href);
  /** Each "Reload the preview" mounts a new frame. */
  const [attempt, setAttempt] = useState(0);
  const [readyReports, setReadyReports] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [height, setHeight] = useState(0);
  const [available, setAvailable] = useState(0);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    // Measured before the first paint, so a wide frame never shows unscaled.
    setAvailable(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const report = readFrameMessage(event, frame.current?.contentWindow ?? null, window.location.origin);
      if (report?.type === "ready") setReadyReports((count) => count + 1);
      else if (report) setHeight(report.height);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const ready = readyReports > 0;
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setTimedOut(true), FRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, attempt]);

  // Every frame that reports ready gets the draft (a frame the browser reloaded included), and again on each change.
  useEffect(() => {
    if (readyReports === 0) return;
    frame.current?.contentWindow?.postMessage({ type: PREVIEW_MESSAGES.draft, settings, media }, window.location.origin);
  }, [readyReports, settings, media]);

  const reload = () => {
    setAttempt((value) => value + 1);
    setReadyReports(0);
    setTimedOut(false);
    setHeight(0);
  };

  const percent = previewPercent(available, device.width);
  const scale = percent / 100;
  return (
    <section ref={stage} aria-label="Draft preview" className="mt-4 bg-surface-soft py-4">
      {!ready && (timedOut ? (
        <div role="alert" className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-tint p-4 text-sm text-error sm:mx-6 lg:mx-8">
          <span>The preview didn't load.</span>
          <button type="button" onClick={reload} className="min-h-[44px] font-bold underline">Reload the preview</button>
        </div>
      ) : (
        <p role="status" className="px-4 pb-4 text-navy-800 sm:px-6 lg:px-8">Loading the preview…</p>
      ))}
      {percent < 100 && <p className="px-4 pb-3 text-sm text-navy-800 sm:px-6 lg:px-8">Shown at {percent}% of actual size</p>}
      {/* Takes the scaled size in the layout; the frame inside keeps the device width as its viewport. */}
      <div
        className={`mx-auto max-w-full overflow-hidden ${height > 0 ? "shadow-card" : ""}`}
        style={{ width: device.width * scale, height: height * scale }}
      >
        <iframe
          key={attempt}
          ref={frame}
          src={src}
          title={`Storefront draft at ${device.label.toLowerCase()} width (${device.width} px)`}
          sandbox="allow-scripts allow-same-origin"
          className="block origin-top-left border-0"
          style={{ width: device.width, height, transform: percent < 100 ? `scale(${scale})` : undefined }}
        />
      </div>
    </section>
  );
}
