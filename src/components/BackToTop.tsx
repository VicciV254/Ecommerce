import { useEffect, useRef, useState } from "react";

/** A movement of the page smaller than this never counts as a change of direction (jitter, small corrections). */
const DIRECTION_SLACK = 8;

/** The page's scroll position, kept within the page: the bounce past either end is not a movement. */
function pagePosition() {
  const end = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(Math.max(window.scrollY, 0), end);
}

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * "Back to top" on the shopper pages. It appears only while the shopper scrolls up more than a screen from the top,
 * and leaves when they scroll down or come within a screen of the top. It stays while it has focus, steps aside for
 * keyboard focus it would cover, floats above the phone purchase bar (index.css) and is out of reach while hidden.
 * A mouse or keyboard focus reveals its label; its white edge and gold focus keep it distinct over the navy footer.
 * It takes the page to the top, smoothly or at once with reduced motion, and focus to the first control in the site
 * header, so the next Tab starts from the top.
 */
export function BackToTop() {
  const button = useRef<HTMLButtonElement>(null);
  /** What scrolling asks for. */
  const wanted = useRef(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let anchor = pagePosition();
    let frame = 0;
    let pending = false;
    const show = (value: boolean) => {
      wanted.current = value;
      setShown(value || document.activeElement === button.current);
    };
    const update = () => {
      const position = pagePosition();
      if (position <= window.innerHeight) {
        anchor = position;
        show(false);
      } else if (position <= anchor - DIRECTION_SLACK) {
        anchor = position;
        show(true);
      } else if (position >= anchor + DIRECTION_SLACK) {
        anchor = position;
        show(false);
      }
    };
    const onScroll = () => {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(() => {
        pending = false;
        update();
      });
    };
    const onFocusIn = (event: FocusEvent) => {
      const own = button.current;
      const target = event.target;
      if (!own || !wanted.current || !(target instanceof Element) || own.contains(target)) return;
      if (overlaps(own.getBoundingClientRect(), target.getBoundingClientRect())) show(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const toTop = () => {
    // "auto" follows the page's scroll-behavior: smooth, or at once when the shopper prefers reduced motion.
    window.scrollTo({ top: 0, behavior: "auto" });
    document.querySelector<HTMLElement>("[data-site-header] a[href], [data-site-header] button")?.focus({ preventScroll: true });
  };

  return (
    <button
      ref={button}
      type="button"
      data-back-to-top
      data-shown={shown ? "" : undefined}
      onClick={toTop}
      onBlur={() => setShown(wanted.current)}
      className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex max-w-[48px] flex-row-reverse items-center overflow-hidden rounded-full border-2 border-white bg-navy-900 text-white shadow-overlay transition-[opacity,translate,visibility,max-width,bottom,background-color,color] duration-(--motion-overlay) ease-out hover:max-w-[min(16rem,calc(100vw-2rem))] hover:bg-gold-500 hover:text-navy-900 focus-visible:max-w-[min(16rem,calc(100vw-2rem))] focus-visible:bg-gold-500 focus-visible:text-navy-900 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:right-6 ${
        shown ? "visible translate-y-0 opacity-100" : "invisible translate-y-3 opacity-0"
      }`}
    >
      <span aria-hidden="true" className="flex size-[44px] shrink-0 items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
        </svg>
      </span>
      {/* Clipped until a mouse or keyboard focus opens the button; always its accessible name. */}
      <span className="whitespace-nowrap pl-4 text-sm font-semibold leading-tight">Back to top</span>
    </button>
  );
}
