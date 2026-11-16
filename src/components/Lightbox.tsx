import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { MediaAsset } from "../api/catalog";
import { zoomSource } from "../store/mediaModel";
import {
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  NO_ZOOM,
  clampZoom,
  fittedSize,
  steppedScale,
  zoomAt,
  type Point,
  type Size,
  type Zoom,
} from "./lightboxZoom";
import { ModalDialog } from "./Modal";
import { SampleImageLabel } from "./ui";

/** A horizontal touch movement this long, at 1×, moves to the neighbouring image. */
const SWIPE_DISTANCE = 48;
/** Taps: a finger that moves less than this and lifts within TAP_MS; two taps within DOUBLE_TAP_MS toggle zoom. */
const TAP_SLOP = 10;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;

const wrap = (index: number, count: number) => ((index % count) + count) % count;

/** Alt text: the image's own, otherwise the product name and position. */
export function imageAlt(image: MediaAsset, name: string, index: number, count: number) {
  return image.alt || `${name}, image ${index + 1} of ${count}`;
}

const toolButton =
  "flex size-[44px] shrink-0 items-center justify-center rounded-full text-white transition-colors duration-(--motion-feedback) hover:bg-white/15 aria-disabled:cursor-not-allowed aria-disabled:text-on-navy-muted aria-disabled:opacity-60";
const sideButton =
  "absolute top-1/2 z-10 flex size-[44px] -translate-y-1/2 items-center justify-center rounded-full border-2 border-navy-900 bg-white text-navy-900 shadow-overlay transition-colors duration-(--motion-feedback) hover:bg-surface-soft";
const icon = (path: string) => (
  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5">
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);
const ICONS = {
  previous: "M15.75 19.5 8.25 12l7.5-7.5",
  next: "m8.25 4.5 7.5 7.5-7.5 7.5",
  zoomIn: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6",
  zoomOut: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6",
  reset: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99",
  close: "M6 18 18 6M6 6l12 12",
};

type Gesture =
  | { kind: "pan"; start: Point; origin: Zoom; startedAt: number; moved: boolean; touch: boolean }
  | { kind: "pinch"; distance: number; midpoint: Point; origin: Zoom };

/**
 * Full-screen image viewer. It loads the large zoom rendition only while open. Zoom (1× to 4×) by buttons, + and −
 * keys, pinch, double-tap or double-click; drag to pan while zoomed; ←/→, swipe or buttons change image; 0 resets.
 * Reduced motion turns off the zoom and image transitions.
 */
export function Lightbox({ name, images, index, onIndexChange, onClose }: {
  name: string;
  images: readonly MediaAsset[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const image = images[index];
  const frame = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [natural, setNatural] = useState<Size | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [gesturing, setGesturing] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  /** Touch and pen double-taps are recognised here; the browser's own double-click then belongs to the mouse only. */
  const lastPointer = useRef<string>("mouse");
  const shown = image?.url;

  // A different image starts unzoomed and loading.
  useLayoutEffect(() => {
    setZoom(NO_ZOOM);
    setNatural(null);
    setStatus("loading");
  }, [shown]);

  const measure = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect();
    const size: Size = { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    const known = natural ?? (image?.width && image.height ? { width: image.width, height: image.height } : null);
    return { rect, size, content: fittedSize(size, known) };
  }, [natural, image]);

  /** A viewport point as an offset from the frame's centre. */
  const fromCentre = useCallback((point: Point): Point => {
    const { rect, size } = measure();
    return { x: point.x - (rect?.left ?? 0) - size.width / 2, y: point.y - (rect?.top ?? 0) - size.height / 2 };
  }, [measure]);

  const zoomTo = useCallback((scale: number, point: Point = { x: 0, y: 0 }) => {
    const { size, content } = measure();
    setZoom((current) => zoomAt(current, scale, point, size, content));
  }, [measure]);

  const step = (direction: 1 | -1) => zoomTo(steppedScale(zoom.scale, direction));
  const reset = () => setZoom(NO_ZOOM);
  const toggleAt = (point: Point) => zoomTo(zoom.scale > MIN_ZOOM ? MIN_ZOOM : DOUBLE_TAP_ZOOM, point);
  const move = (direction: 1 | -1) => {
    if (count > 1) onIndexChange(wrap(index + direction, count));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      "+": () => step(1),
      "=": () => step(1),
      "-": () => step(-1),
      _: () => step(-1),
      "0": reset,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPointer.current = event.pointerType;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture(event.timeStamp, event.pointerType !== "mouse");
  };

  /** `afterPinch`: the finger left on the glass after a pinch pans on, but its lifting is never a tap. */
  const startGesture = (at: number, touch: boolean, afterPinch = false) => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      gesture.current = {
        kind: "pinch",
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        midpoint: fromCentre({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        origin: zoom,
      };
      setGesturing(true);
    } else if (points.length === 1) {
      gesture.current = { kind: "pan", start: points[0], origin: zoom, startedAt: at, moved: afterPinch, touch };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    const { size, content } = measure();
    if (current.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const midpoint = fromCentre({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const scaled = zoomAt(current.origin, current.origin.scale * (Math.hypot(b.x - a.x, b.y - a.y) / current.distance), current.midpoint, size, content);
      // The fingers' midpoint also carries the image along.
      setZoom(clampZoom({ ...scaled, x: scaled.x + midpoint.x - current.midpoint.x, y: scaled.y + midpoint.y - current.midpoint.y }, size, content));
      return;
    }
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) current.moved = true;
    if (current.origin.scale > MIN_ZOOM) {
      setGesturing(true);
      setZoom(clampZoom({ ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy }, size, content));
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (current?.kind === "pan" && event.type === "pointerup") finishPan(current, event);
    if (pointers.current.size) startGesture(event.timeStamp, true, current?.kind === "pinch");
    else {
      gesture.current = null;
      setGesturing(false);
    }
  };

  const finishPan = (pan: Extract<Gesture, { kind: "pan" }>, event: PointerEvent<HTMLDivElement>) => {
    const dx = event.clientX - pan.start.x;
    const dy = event.clientY - pan.start.y;
    if (pan.touch && pan.origin.scale === MIN_ZOOM && Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      move(dx < 0 ? 1 : -1);
      return;
    }
    if (!pan.touch || pan.moved || event.timeStamp - pan.startedAt > TAP_MS) return;
    const point = { x: event.clientX, y: event.clientY };
    const previous = lastTap.current;
    if (previous && event.timeStamp - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      toggleAt(fromCentre(point));
    } else {
      lastTap.current = { at: event.timeStamp, point };
    }
  };

  if (!image) return null;
  const percent = `${Math.round(zoom.scale * 100)}%`;
  return (
    <ModalDialog open label="Image viewer" placement="full" initialFocus={close} onClose={onClose}>
      <div className="on-navy flex h-full w-full flex-col bg-navy-950 text-white" onKeyDown={onKeyDown}>
        {/* Room around the 44px controls for their focus ring (3px outside a 2px gap). */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 pl-4 pr-2">
          <p aria-live="polite" className="text-sm font-semibold">Image {index + 1} of {count}</p>
          <div className="flex flex-wrap items-center justify-end">
            <button type="button" aria-label="Zoom out" aria-disabled={zoom.scale <= MIN_ZOOM} onClick={() => step(-1)} className={toolButton}>{icon(ICONS.zoomOut)}</button>
            <p aria-live="polite" className="min-w-[3.5rem] text-center text-sm tabular-nums text-on-navy-muted">
              <span className="sr-only">Zoom </span>{percent}
            </p>
            <button type="button" aria-label="Zoom in" aria-disabled={zoom.scale >= MAX_ZOOM} onClick={() => step(1)} className={toolButton}>{icon(ICONS.zoomIn)}</button>
            <button type="button" aria-label="Reset zoom" aria-disabled={zoom.scale <= MIN_ZOOM} onClick={reset} className={toolButton}>{icon(ICONS.reset)}</button>
            <button ref={close} type="button" aria-label="Close" onClick={onClose} className={toolButton}>{icon(ICONS.close)}</button>
          </div>
        </div>
        <div ref={frame} className="relative min-h-0 flex-1 overflow-hidden">
          {/* The gesture surface sits under the buttons, so pressing a button never starts a pan, swipe or zoom. */}
          <div
            className="absolute inset-0 cursor-zoom-in touch-none select-none data-[zoomed]:cursor-grab"
            data-zoomed={zoom.scale > MIN_ZOOM ? "" : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onDoubleClick={(event) => {
              if (lastPointer.current === "mouse") toggleAt(fromCentre({ x: event.clientX, y: event.clientY }));
            }}
          >
            {status === "loading" && (
              <p role="status" className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-on-navy-muted">
                <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-gold-400 border-t-transparent" />
                Loading image…
              </p>
            )}
            {status === "failed" ? (
              <p role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm">Image unavailable. Try another image.</p>
            ) : (
              <img
                key={image.url}
                src={zoomSource(image.url)}
                alt={imageAlt(image, name, index, count)}
                draggable={false}
                onLoad={(event) => {
                  setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                  setStatus("loaded");
                }}
                onError={() => setStatus("failed")}
                style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
                className={`absolute inset-0 h-full w-full animate-fade-in object-contain ${gesturing ? "" : "transition-transform duration-(--motion-gallery) ease-out"}`}
              />
            )}
          </div>
          {image.isPlaceholder && <SampleImageLabel />}
          {count > 1 && (
            <>
              <button type="button" aria-label="Previous image" onClick={() => move(-1)} className={`${sideButton} left-2`}>{icon(ICONS.previous)}</button>
              <button type="button" aria-label="Next image" onClick={() => move(1)} className={`${sideButton} right-2`}>{icon(ICONS.next)}</button>
            </>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
