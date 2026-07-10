import type { User } from "../contexts/AuthContext";

export type ReceiptItem = {
  id: string;
  productId: string;
  productName: string;
  productPrice: number;
  quantity: number;
  subtotal: number;
  productImage?: string;
  size?: string;
  color?: string;
};

export type ReceiptAddress = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  county: string;
  zip?: string;
};

export type LocalReceipt = {
  id: string;
  orderNumber: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  shippingCost: number;
  total: number;
  status: "PENDING" | "PROCESSING" | "SHIPPED" | "READY_FOR_PICKUP" | "DELIVERED";
  paymentMethod: string;
  paymentStatus: "PENDING" | "PAID";
  deliveryMethod: string;
  address: ReceiptAddress;
  mpesaCheckoutRequestId?: string;
  createdAt: string;
  updatedAt: string;
};

function receiptsKey(user: User) {
  return `nmb-receipts-${user.id}`;
}

export function getReceipts(user: User | null): LocalReceipt[] {
  if (!user) return [];
  try {
    const raw = localStorage.getItem(receiptsKey(user));
    return raw ? (JSON.parse(raw) as LocalReceipt[]) : [];
  } catch {
    return [];
  }
}

export function saveReceipt(user: User, receipt: LocalReceipt) {
  const receipts = [receipt, ...getReceipts(user)];
  localStorage.setItem(receiptsKey(user), JSON.stringify(receipts));
  return receipts;
}

export function findReceiptByOrderNumber(orderNumber: string): LocalReceipt | null {
  const prefix = "nmb-receipts-";
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const receipts = JSON.parse(localStorage.getItem(key) || "[]") as LocalReceipt[];
      const found = receipts.find((receipt) => receipt.orderNumber === orderNumber);
      if (found) return found;
    } catch {
      /* ignore malformed local receipt data */
    }
  }
  return null;
}
