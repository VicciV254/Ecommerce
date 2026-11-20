/** Frames a focused control must hold still before the browser's own focus scroll counts as finished. */
const STILL_FRAMES = 2;
/** A scroll still moving the control after this many frames (a long smooth one) is left to finish undisturbed. */
const MAX_FRAMES = 120;

/** Whether the control's focus ring (outline plus offset) lies wholly inside the room focus may use. */
function ringInRoom(control: HTMLElement) {
  const style = getComputedStyle(control);
  const reach = Math.max(0, (Number.parseFloat(style.outlineOffset) || 0) + (Number.parseFloat(style.outlineWidth) || 0));
  const box = control.getBoundingClientRect();
  // Inside an open dialog the page's sticky chrome is inert and the purchase bar is hidden.
  const inDialog = control.closest("dialog[open]") !== null;
  const top = inDialog ? 0 : Math.max(0, ...[...document.querySelectorAll("[data-sticky-header]")].map((chrome) => chrome.getBoundingClientRect().bottom));
  const bar = inDialog ? undefined : document.querySelector("[data-purchase-bar][data-shown]")?.getBoundingClientRect();
  const bottom = bar && bar.height > 0 ? bar.top : window.innerHeight;
  const right = document.documentElement.clientWidth;
  // A control too large for the room stays where the browser put it.
  if (box.height + 2 * reach > bottom - top || box.width + 2 * reach > right) return true;
  return box.top - reach >= top && box.bottom + reach <= bottom && box.left - reach >= 0 && box.right + reach <= right;
}

/**
 * Keyboard focus ends with the whole focus ring in view: below the sticky header, above the phone purchase bar and
 * inside the window. The root's scroll padding (index.css) marks that room, but not every browser applies it when focus
 * moves: Firefox leaves a partly visible control where it is, and Safari reveals a text field without the padding. Once
 * the browser's own focus scroll has settled, a control still short of the room is brought in with `scrollIntoView`,
 * which applies the padding in every browser. Only focus moved from the keyboard is corrected: a tap or click never
 * scrolls the page. Returns a function that stops it.
 */
export function keepKeyboardFocusInView() {
  let fromKeyboard = false;
  let frame = 0;
  const onKeyDown = () => {
    fromKeyboard = true;
    // Focus moved by this key (its default action, or a handler) arrives within the same task.
    window.setTimeout(() => { fromKeyboard = false; }, 0);
  };
  const onFocusIn = (event: FocusEvent) => {
    window.cancelAnimationFrame(frame);
    const control = event.target;
    if (!fromKeyboard || !(control instanceof HTMLElement) || control.closest("[data-sticky-header], [data-purchase-bar]")) return;
    let last = "";
    let still = 0;
    let frames = 0;
    const settle = () => {
      if (document.activeElement !== control) return;
      const { top, left } = control.getBoundingClientRect();
      still = `${top},${left}` === last ? still + 1 : 0;
      last = `${top},${left}`;
      frames += 1;
      if (still < STILL_FRAMES) {
        if (frames < MAX_FRAMES) frame = window.requestAnimationFrame(settle);
      } else if (!ringInRoom(control)) {
        control.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" as ScrollBehavior });
      }
    };
    frame = window.requestAnimationFrame(settle);
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("focusin", onFocusIn);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("focusin", onFocusIn);
  };
}
