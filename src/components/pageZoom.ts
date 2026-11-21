import { useEffect, useState } from "react";

/** Above this visual-viewport scale the page counts as pinch-zoomed. */
const ZOOMED_SCALE = 1.01;

/**
 * True while the page itself is pinch-zoomed, so a finger panning it never swipes a gallery stage or a carousel's
 * slides: those stop taking swipes until the page is back at 100%.
 */
export function usePageZoomed() {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setZoomed(viewport.scale > ZOOMED_SCALE);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  return zoomed;
}
