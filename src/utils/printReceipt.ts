import type { User } from "../api/auth";
import type { Order } from "../api/orders";
import { receiptDocument } from "./receiptDocument";

/** Longest wait for the brand fonts; after it the receipt prints in its fallback faces. */
const RECEIPT_FONT_WAIT_MS = 3000;

/** Opens the receipt in its own window and prints it once, after the brand fonts load, fail or time out. */
export function printReceipt(order: Order, user: User | null, brandName: string) {
  const popup = window.open("", "_blank", "width=720,height=900");
  if (!popup) return;
  popup.document.write(receiptDocument(order, user, brandName));
  popup.document.close();
  const loaded = new Promise<void>((resolve) => {
    if (popup.document.readyState === "complete") resolve();
    else popup.addEventListener("load", () => resolve(), { once: true });
  });
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, RECEIPT_FONT_WAIT_MS));
  void Promise.race([loaded.then(() => popup.document.fonts.ready), timeout]).then(() => {
    if (popup.closed) return;
    popup.focus();
    popup.print();
  });
}
