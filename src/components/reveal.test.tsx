import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealRow } from "./reveal";
import { Reveal } from "./ui";

/*
 * Scroll reveals ("pop-in"): one shared IntersectionObserver. Something is hidden only if its first report finds it
 * wholly below the window, and it shows once its top comes into view; nothing on the first screen, nothing above a
 * restored scroll position, nothing under reduced motion and nothing without IntersectionObserver is ever hidden.
 */
type Report = { isIntersecting: boolean; top: number };
const observers: FakeObserver[] = [];
class FakeObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit = {}) {
    observers.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
}
const observer = () => observers.at(-1)!;
function report(entries: [Element, Report][]) {
  act(() => observer().callback(entries.map(([target, { isIntersecting, top }]) => ({
    target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: { top, bottom: top + 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: top } as DOMRectReadOnly,
  }) as IntersectionObserverEntry), observer() as unknown as IntersectionObserver));
}
const BELOW = { isIntersecting: false, top: window.innerHeight + 40 };
const IN_VIEW = { isIntersecting: true, top: 100 };

const media = { reduce: false, listeners: new Set<(event: { matches: boolean }) => void>() };
const reveal = (testId: string) => screen.getByTestId(testId);
const shown = (element: HTMLElement) => element.getAttribute("data-reveal") !== "hidden";

beforeEach(() => {
  observers.length = 0;
  media.reduce = false;
  media.listeners.clear();
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("reduce") ? media.reduce : false, media: query,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => media.listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

describe("Reveal", () => {
  it("watches with one shared observer: a threshold of 0, the bottom tenth of the window left out", () => {
    render(<><Reveal data-testid="a">A</Reveal><Reveal data-testid="b">B</Reveal></>);
    expect(observers).toHaveLength(1);
    expect(observer().options).toMatchObject({ threshold: 0, rootMargin: "0px 0px -10% 0px" });
    expect([...observer().targets]).toEqual([reveal("a"), reveal("b")]);
  });

  it("leaves the first screen alone, including the strip under the observed area and anything above the window", () => {
    render(<><Reveal data-testid="top">Top</Reveal><Reveal data-testid="edge">Edge</Reveal><Reveal data-testid="above">Above</Reveal></>);
    report([
      [reveal("top"), IN_VIEW],
      [reveal("edge"), { isIntersecting: false, top: window.innerHeight - 30 }],
      [reveal("above"), { isIntersecting: false, top: -900 }],
    ]);
    expect(["top", "edge", "above"].map((id) => reveal(id).getAttribute("data-reveal"))).toEqual(["shown", "shown", "shown"]);
    expect(observer().targets.size).toBe(0);
  });

  it("hides what starts wholly below the window and shows it once its top comes into view, for good", () => {
    const { rerender } = render(<Reveal data-testid="later" className="pt-4">Later</Reveal>);
    expect(shown(reveal("later"))).toBe(true);
    report([[reveal("later"), BELOW]]);
    expect(reveal("later").getAttribute("data-reveal")).toBe("hidden");
    report([[reveal("later"), IN_VIEW]]);
    expect(reveal("later").getAttribute("data-reveal")).toBe("shown");
    expect(observer().targets.size).toBe(0);
    rerender(<Reveal data-testid="later" className="pt-8">Later, re-rendered</Reveal>);
    expect(reveal("later").getAttribute("data-reveal")).toBe("shown");
  });

  it("uses a small scale instead of a rise inside scrolling rows, so a hidden card never adds overflow", () => {
    render(<Reveal data-testid="card" variant="scale">Card</Reveal>);
    expect(reveal("card").getAttribute("data-reveal-variant")).toBe("scale");
  });

  it("staggers what shows together by order, 60 ms apart and 300 ms at most", () => {
    const ids = Array.from({ length: 8 }, (_, index) => `card-${index}`);
    render(<>{ids.map((id) => <Reveal key={id} data-testid={id} stagger>{id}</Reveal>)}<Reveal data-testid="plain">Plain</Reveal></>);
    report([...ids, "plain"].map((id) => [reveal(id), BELOW]));
    report([...ids, "plain"].map((id) => [reveal(id), IN_VIEW]));
    expect(ids.map((id) => reveal(id).style.getPropertyValue("--reveal-delay"))).toEqual(["0ms", "60ms", "120ms", "180ms", "240ms", "300ms", "300ms", "300ms"]);
    expect(reveal("plain").style.getPropertyValue("--reveal-delay")).toBe("");
  });

  it("shows a hidden element at once, with no delay, when focus moves inside it", () => {
    render(<Reveal data-testid="later" stagger><button type="button">Inside</button></Reveal>);
    report([[reveal("later"), BELOW]]);
    act(() => screen.getByRole("button", { name: "Inside" }).focus());
    expect(reveal("later").getAttribute("data-reveal")).toBe("shown");
    expect(reveal("later").hasAttribute("data-reveal-instant")).toBe(true);
    expect(reveal("later").style.getPropertyValue("--reveal-delay")).toBe("");
    expect(observer().targets.size).toBe(0);
  });

  it("never hides anything under reduced motion, or where IntersectionObserver is missing", () => {
    media.reduce = true;
    const { unmount } = render(<Reveal data-testid="still">Still</Reveal>);
    expect(observers).toHaveLength(0);
    expect(reveal("still").hasAttribute("data-reveal")).toBe(false);
    unmount();
    media.reduce = false;
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    render(<Reveal data-testid="plain">Plain</Reveal>);
    expect(reveal("plain").hasAttribute("data-reveal")).toBe(false);
  });

  it("shows everything at once when the shopper turns on reduced motion", () => {
    render(<><Reveal data-testid="a">A</Reveal><Reveal data-testid="b">B</Reveal></>);
    report([[reveal("a"), BELOW], [reveal("b"), BELOW]]);
    act(() => { media.reduce = true; for (const listener of media.listeners) listener({ matches: true }); });
    expect([reveal("a"), reveal("b")].map((element) => element.getAttribute("data-reveal"))).toEqual(["shown", "shown"]);
    expect(observer().targets.size).toBe(0);
  });

  it("stops watching an element that leaves the page", () => {
    const { unmount } = render(<Reveal data-testid="gone">Gone</Reveal>);
    const element = reveal("gone");
    unmount();
    expect(observer().targets.has(element)).toBe(false);
  });
});

describe("rows that scroll sideways", () => {
  /** A scrolling row as the rails build it: each item is a scroll-snap point holding one card. */
  function Row({ count = 8 }: { count?: number }) {
    const ref = useRevealRow<HTMLUListElement>();
    return (
      <ul ref={ref} aria-label="Row">
        {Array.from({ length: count }, (_, index) => <li key={index}><div data-testid={`card-${index}`}>Card {index}</div></li>)}
      </ul>
    );
  }
  const items = () => screen.getAllByRole("listitem");
  const cards = () => items().map((item) => item.firstElementChild as HTMLElement);

  it("hides every card of a row below the window, with a slight grow, and shows them all, staggered, when the row arrives", () => {
    render(<Row />);
    const row = screen.getByRole("list", { name: "Row" });
    expect([...observer().targets]).toEqual([row]);
    report([[row, BELOW]]);
    expect(cards().map((card) => [card.getAttribute("data-reveal"), card.getAttribute("data-reveal-variant")])).toEqual(
      Array.from({ length: 8 }, () => ["hidden", "scale"]),
    );
    // The items are the row's snap points: shrinking one moves its point and the row re-snaps off its start (Previous
    // appears; a long heading takes another line), so only the cards inside them hide and grow.
    expect(items().map((item) => item.hasAttribute("data-reveal"))).toEqual(Array.from({ length: 8 }, () => false));
    report([[row, IN_VIEW]]);
    expect(cards().map((card) => card.getAttribute("data-reveal"))).toEqual(Array.from({ length: 8 }, () => "shown"));
    expect(cards().map((card) => card.style.getPropertyValue("--reveal-delay"))).toEqual(["0ms", "60ms", "120ms", "180ms", "240ms", "300ms", "300ms", "300ms"]);
    expect(items().map((item) => item.hasAttribute("data-reveal"))).toEqual(Array.from({ length: 8 }, () => false));
    expect(observer().targets.size).toBe(0);
  });

  it("leaves a row already on screen alone, and shows a focused card at once", () => {
    const { unmount } = render(<Row count={3} />);
    report([[screen.getByRole("list", { name: "Row" }), IN_VIEW]]);
    expect(cards().map((card) => card.hasAttribute("data-reveal"))).toEqual([false, false, false]);
    unmount();
    render(<Row count={3} />);
    const row = screen.getByRole("list", { name: "Row" });
    report([[row, BELOW]]);
    act(() => { cards()[2].tabIndex = -1; cards()[2].focus(); });
    expect(cards().map((card) => card.getAttribute("data-reveal"))).toEqual(["hidden", "hidden", "shown"]);
    report([[row, IN_VIEW]]);
    expect(cards().map((card) => card.getAttribute("data-reveal"))).toEqual(["shown", "shown", "shown"]);
  });
});
