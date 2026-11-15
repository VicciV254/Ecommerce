import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalDialog } from "./Modal";

beforeEach(() => {
  // jsdom lays nothing out; give every element a box so the dialog treats its controls as rendered.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ x: 0, y: 0, width: 10, height: 10 }] as unknown as DOMRectList);
});

/**
 * Presses Tab as a browser does: the dialog sees the key first; if it lets the key through, focus moves to
 * the next control in document order, or leaves the dialog after its last one.
 */
function pressTab({ shift = false } = {}) {
  const from = document.activeElement as HTMLElement;
  if (!fireEvent.keyDown(from, { key: "Tab", shiftKey: shift })) return;
  const stops = Array.from(document.querySelectorAll<HTMLElement>("button, summary"));
  const next = stops[stops.indexOf(from) + (shift ? -1 : 1)];
  if (next) next.focus();
  else from.blur();
}

describe("ModalDialog keyboard focus", () => {
  it("keeps disclosure summaries in the Tab cycle, in both directions", () => {
    render(
      <ModalDialog open label="Receipt Details" onClose={() => {}}>
        <button type="button">Close</button>
        <button type="button">Print Receipt</button>
        <details><summary>Progress</summary><p>Order placed</p></details>
        <details><summary>Refunds</summary><p>Refund sent</p></details>
      </ModalDialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();

    pressTab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Print Receipt" }));
    pressTab();
    expect(document.activeElement).toBe(screen.getByText("Progress"));
    pressTab();
    expect(document.activeElement).toBe(screen.getByText("Refunds"));
    pressTab();
    expect(document.activeElement).toBe(close);
    pressTab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("Refunds"));
  });

  it("wraps Shift+Tab to the last control when focus starts on a region holding every control", () => {
    // Chromium gives a dialog's scrollable wrapper the initial focus when it precedes every control.
    render(
      <ModalDialog open label="Receipt Details" onClose={() => {}}>
        <div data-testid="scroll-region" tabIndex={-1}>
          <button type="button">Close</button>
          <button type="button">Print Receipt</button>
        </div>
      </ModalDialog>,
    );
    screen.getByTestId("scroll-region").focus();

    pressTab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Print Receipt" }));
  });
});
