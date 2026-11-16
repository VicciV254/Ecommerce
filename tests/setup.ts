import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom models <dialog> state but not its methods; native modality is verified in browser tests.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}
if (typeof HTMLDialogElement.prototype.close !== "function") {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

// jsdom does no layout, so sizes never change and observers have nothing to report; browser tests cover resizing.
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Nor does it scroll elements; scrolling (the gallery stage) is checked in browser tests.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollTo() {};
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  // Per-tab state (sign-in merge notes, checkout drafts) never carries from one test into the next.
  sessionStorage.clear();
});
