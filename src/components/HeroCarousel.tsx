import {
  useCallback, useEffect, useRef, useState,
  type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode,
} from "react";
import type { ResolvedCampaign } from "../store/storefrontModel";
import { CampaignArtwork, CampaignCopy } from "./CampaignParts";
import { useAnyModalOpen } from "./modalState";
import { useReducedMotion } from "./motion";
import { usePageZoomed } from "./pageZoom";
import { SampleImageLabel } from "./ui";

/** Each slide shows this long while the carousel rotates. */
const SLIDE_MS = 6000;
/** The next slide's photo is requested this long after a slide shows, so it is ready before its turn. */
const PRELOAD_NEXT_MS = 1000;
/** The shown photo grows to this scale over its 6 s (none under reduced motion). */
const ZOOM_TO = 1.06;
/** A swipe changes slides once it has moved this far, mostly sideways. */
const SWIPE_PX = 40;
/** Photos span the window. */
const SLIDE_SIZES = "100vw";
/** The carousel's least height by width: phones, from 640px and from 1024px; enlarged copy makes it taller. */
const HEIGHTS = "min-h-[440px] sm:min-h-[520px] lg:min-h-[600px]";
/**
 * From 768px the copy and the controls share the left column, over the scrim's dim part (`carousel-scrim`, the same
 * width); below, each sits on its own dim band.
 */
const COLUMN = "md:w-[min(40rem,72%)] md:bg-transparent";
const control = "flex size-[44px] shrink-0 items-center justify-center rounded-full text-white transition-colors duration-(--motion-feedback) hover:bg-white/15";

type Mode = "playing" | "stopped";
type Gesture = { id: number; x: number; y: number };

const icon = (path: ReactNode) => (
  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">{path}</svg>
);
const PAUSE_ICON = icon(<path strokeLinecap="round" d="M9 6v12M15 6v12" />);
const PLAY_ICON = icon(<path strokeLinejoin="round" d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor" />);
const PREVIOUS_ICON = icon(<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />);
const NEXT_ICON = icon(<path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />);

/** Whether focus arrived the way keyboard focus shows (`:focus-visible`), where the browser can tell. */
function focusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** A slide's photo layer, which the clock scales. */
const zoomLayer = (slide: HTMLElement | null | undefined) => slide?.querySelector<HTMLElement>("[data-slide-zoom]") ?? null;

/** The scale the clock last gave a photo layer: 1 if it never zoomed. */
const zoomOf = (layer: HTMLElement | null) => Number(/^scale\((.+)\)$/.exec(layer?.style.transform ?? "")?.[1]) || 1;

/**
 * A slide's photo, positioned against the whole carousel (under the controls too) and clipped there, so its slow zoom
 * never adds overflow; from 768px the scrim's dim column; and the copy. A sample photo's label stays above the copy's
 * band, which covers the top of the photo too once enlarged text makes it tall.
 */
function SlideBody({ resolved, priority, requested, catalogReady }: {
  resolved: ResolvedCampaign;
  priority: boolean;
  requested: boolean;
  catalogReady: boolean;
}) {
  const placeholder = Boolean(resolved.desktop?.isPlaceholder || resolved.mobile?.isPlaceholder);
  return (
    <>
      <div className="absolute inset-0 overflow-clip">
        <div data-slide-zoom="" className="absolute inset-0 [transform:scale(1)]">
          {requested && <CampaignArtwork resolved={resolved} priority={priority} sizes={SLIDE_SIZES} />}
        </div>
        <div className="absolute inset-0 hidden md:block md:carousel-scrim" />
        {placeholder && <SampleImageLabel className="top-2 bottom-auto z-[1]" />}
      </div>
      {/* Phones: the copy at the bottom on a dim band that fades upwards into the photo. */}
      {/* Side padding in px on phones, so enlarged text keeps the room it needs; more room on top under a sample label. */}
      <div className={`relative mt-auto w-full bg-navy-950/85 px-[16px] pb-4 ${placeholder ? "pt-10" : "pt-6"} before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-24 before:bg-gradient-to-t before:from-navy-950/85 before:to-transparent sm:px-[24px] md:mt-0 md:flex md:flex-col md:justify-center md:px-10 md:py-10 md:before:hidden lg:px-12 ${COLUMN}`}>
        <CampaignCopy resolved={resolved} catalogReady={catalogReady} variant="slide" onDark />
      </div>
    </>
  );
}

type CarouselProps = {
  /** The section's heading: the carousel's accessible name. */
  title: string;
  slides: readonly ResolvedCampaign[];
  catalogReady: boolean;
  /** The page's leading section: its first photo loads eagerly with high priority. */
  priority: boolean;
  className?: string;
};

/**
 * The hero carousel (WAI-ARIA APG carousel): full-width slides with their copy over the photo, crossfading every 6 s with
 * a slow zoom, both driven by one clock that also fills the current dot's progress line. Hovering with a mouse, any open
 * dialog, a hidden tab or leaving the screen pauses it, keeping the time shown; keyboard focus coming in, Previous/Next,
 * a dot, a swipe or a tap on a slide stops it until "Play slides". Under reduced motion it starts stopped and never zooms.
 * One slide is a still hero.
 */
export function HeroCarousel({ title, slides, catalogReady, priority, className = "" }: CarouselProps) {
  if (slides.length === 1) {
    return (
      <section aria-label={title} className={`on-navy relative isolate grid grid-cols-1 overflow-clip bg-navy-950 text-white ${HEIGHTS} ${className}`}>
        <div className="col-start-1 row-start-1 flex flex-col md:flex-row">
          <SlideBody resolved={slides[0]} priority={priority} requested catalogReady={catalogReady} />
        </div>
      </section>
    );
  }
  return <RotatingCarousel title={title} slides={slides} catalogReady={catalogReady} priority={priority} className={className} />;
}

function RotatingCarousel({ title, slides, catalogReady, priority, className = "" }: CarouselProps) {
  const count = slides.length;
  const reduce = useReducedMotion();
  const modalOpen = useAnyModalOpen();
  const zoomed = usePageZoomed();
  const region = useRef<HTMLElement>(null);
  const slideElements = useRef<(HTMLDivElement | null)[]>([]);
  /** The current dot's progress line. */
  const bar = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>(() => (reduce ? "stopped" : "playing"));
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [inView, setInView] = useState(true);
  const [requested, setRequested] = useState<ReadonlySet<number>>(() => new Set([0]));
  /**
   * The clock: how long the current slide has shown while rotating, kept across pauses, and when the current run began
   * (null while not running, or once Stop or a new slide has reset it).
   */
  const clock = useRef<{ shown: number; since: number | null }>({ shown: 0, since: null });
  /** The shown photo's scale when its zoom (re)started: 1 for a new slide, where it was frozen after Play. */
  const zoomStart = useRef(1);
  const activeRef = useRef(0);
  /** After Play pressed with the mouse over the carousel, hovering pauses again only once the mouse has left. */
  const hoverSuppressed = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Set<number>());
  const swallowClick = useRef(false);

  const running = mode === "playing" && !hovered && !modalOpen && !hidden && inView;

  const show = useCallback((index: number) => {
    const next = ((index % count) + count) % count;
    activeRef.current = next;
    clock.current = { shown: 0, since: null };
    zoomStart.current = 1;
    // The new slide starts unzoomed; the old one keeps its scale while it fades out.
    zoomLayer(slideElements.current[next])?.style.removeProperty("transform");
    setActive(next);
    setRequested((current) => (current.has(next) ? current : new Set([...current, next])));
  }, [count]);

  const stop = useCallback(() => {
    setMode("stopped");
    clock.current = { shown: 0, since: null };
    bar.current?.style.removeProperty("transform");
  }, []);

  const play = () => {
    zoomStart.current = zoomOf(zoomLayer(slideElements.current[activeRef.current]));
    clock.current = { shown: 0, since: null };
    if (hovered) {
      hoverSuppressed.current = true;
      setHovered(false);
    }
    setMode("playing");
  };

  // One clock: while running, the slide's time runs on from where it was, and at 6 s the next slide shows. The browser
  // animates the progress line and the photo's zoom from that time, off the page's main thread: written frame by frame
  // from script, they kept a phone's main thread busy (measured 97% of the time with the CPU 4x slower, against 1%).
  // Pausing freezes them where they had got to; Stop empties the line and leaves the photo as it was.
  useEffect(() => {
    if (!running) return;
    const from = clock.current.shown;
    const started = performance.now();
    clock.current = { shown: from, since: started };
    const zoomFrom = zoomStart.current;
    const scaleAt = (ms: number) => zoomFrom + (ZOOM_TO - zoomFrom) * (ms / SLIDE_MS);
    const line = bar.current;
    const layer = reduce ? null : zoomLayer(slideElements.current[active]);
    const remaining = SLIDE_MS - from;
    const animations: Animation[] = [];
    const animate = (element: HTMLElement | null, fromTransform: string, toTransform: string) => {
      if (!element || typeof element.animate !== "function") return;
      animations.push(element.animate([{ transform: fromTransform }, { transform: toTransform }], { duration: remaining, fill: "forwards" }));
    };
    animate(line, `scaleX(${from / SLIDE_MS})`, "scaleX(1)");
    animate(layer, `scale(${scaleAt(from)})`, `scale(${ZOOM_TO})`);
    const timer = window.setTimeout(() => show(active + 1), remaining);
    return () => {
      window.clearTimeout(timer);
      const shown = Math.min(from + performance.now() - started, SLIDE_MS);
      if (layer) layer.style.transform = `scale(${scaleAt(shown)})`;
      // Still the same run (a pause, not Stop or a new slide): keep the time, and the line where it was.
      if (clock.current.since === started) {
        clock.current = { shown, since: null };
        if (line) line.style.transform = `scaleX(${shown / SLIDE_MS})`;
      }
      for (const animation of animations) animation.cancel();
    };
  }, [running, active, reduce, show]);

  // Turning on reduced motion stops the rotation.
  useEffect(() => {
    if (reduce) stop();
  }, [reduce, stop]);

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const element = region.current;
    if (!element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The next slide's photo is requested a second after a slide shows, while the carousel is on screen.
  useEffect(() => {
    if (!inView) return;
    const timer = window.setTimeout(() => {
      const next = (active + 1) % count;
      setRequested((current) => (current.has(next) ? current : new Set([...current, next])));
    }, PRELOAD_NEXT_MS);
    return () => window.clearTimeout(timer);
  }, [active, count, inView]);

  const choose = (index: number) => {
    stop();
    show(index);
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const from = event.relatedTarget;
    if (from instanceof Node && event.currentTarget.contains(from)) return;
    if (focusVisible(event.target)) stop();
  };
  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && !hoverSuppressed.current) setHovered(true);
  };
  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    hoverSuppressed.current = false;
    setHovered(false);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (event.pointerType === "mouse" || zoomed) return;
    pointers.current.add(event.pointerId);
    // A second finger makes it a pinch, not a swipe.
    gesture.current = pointers.current.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  };
  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const started = gesture.current;
    if (!started || started.id !== event.pointerId) return;
    gesture.current = null;
    if (event.type !== "pointerup") return;
    const dx = event.clientX - started.x;
    const dy = event.clientY - started.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
    swallowClick.current = true;
    choose(activeRef.current + (dx < 0 ? 1 : -1));
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    // The click that ends a swipe must not follow the slide's link.
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onSlideClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("a")) return;
    stop();
  };

  return (
    <section
      ref={region}
      aria-roledescription="carousel"
      aria-label={title}
      onFocus={onFocus}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={`on-navy relative isolate grid grid-cols-1 grid-rows-[1fr_auto] overflow-clip bg-navy-950 text-white ${HEIGHTS} ${className}`}
    >
      {/* First in the Tab order, shown under the slides. */}
      <div className={`relative z-10 col-start-1 row-start-2 flex flex-wrap items-center justify-between bg-navy-950/85 px-2 pb-2 sm:px-4 md:px-8 lg:px-10 ${COLUMN}`}>
        <div className="flex flex-wrap items-center">
          <button type="button" aria-label={mode === "playing" ? "Pause slides" : "Play slides"} onClick={mode === "playing" ? stop : play} className={control}>
            {mode === "playing" ? PAUSE_ICON : PLAY_ICON}
          </button>
          {slides.map((slide, index) => (
            <button
              key={slide.campaign.id}
              type="button"
              aria-label={`Slide ${index + 1}: ${slide.campaign.title}`}
              aria-current={index === active ? "true" : undefined}
              onClick={() => choose(index)}
              className="group flex size-[44px] shrink-0 items-center justify-center rounded-full"
            >
              {/* The current slide's pill and the others' dots are separate shapes, so nothing changes size between slides. */}
              {index === active ? (
                <span key="current" aria-hidden="true" className="relative h-2.5 w-8 overflow-hidden rounded-full border border-white/80 bg-white/35">
                  <span ref={bar} className="absolute inset-0 origin-left bg-gold-400 [transform:scaleX(0)]" />
                </span>
              ) : (
                <span key="other" aria-hidden="true" className="size-2.5 rounded-full border border-white/80 bg-white/60 group-hover:bg-white" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <button type="button" aria-label="Previous slide" onClick={() => choose(active - 1)} className={control}>{PREVIOUS_ICON}</button>
          <button type="button" aria-label="Next slide" onClick={() => choose(active + 1)} className={control}>{NEXT_ICON}</button>
        </div>
      </div>
      <div
        aria-live={mode === "playing" ? "off" : "polite"}
        onPointerDown={onPointerDown}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={onClickCapture}
        onClick={onSlideClick}
        className={`col-start-1 row-start-1 grid grid-cols-1 ${zoomed ? "touch-auto" : "touch-pan-y touch-pinch-zoom"}`}
      >
        {slides.map((slide, index) => {
          const current = index === active;
          return (
            <div
              key={slide.campaign.id}
              ref={(element) => { slideElements.current[index] = element; }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${count}`}
              aria-hidden={current ? undefined : true}
              inert={!current}
              // The incoming slide fades in over the outgoing one, which stays opaque underneath until it is covered.
              className={`col-start-1 row-start-1 flex flex-col transition-opacity md:flex-row ${
                current ? "z-[1] opacity-100 duration-700 ease-out" : "z-0 opacity-0 duration-0 motion-safe:delay-700"
              }`}
            >
              <SlideBody
                resolved={slide}
                priority={priority && index === 0}
                requested={requested.has(index)}
                catalogReady={catalogReady}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
