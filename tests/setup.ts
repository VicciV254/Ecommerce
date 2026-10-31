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

afterEach(() => {
  cleanup();
  localStorage.clear();
});
