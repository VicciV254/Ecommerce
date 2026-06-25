import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { PRODUCTS, type Product } from "../data/products";

export type CartItem = {
  productId: string;
  qty: number;
  size?: string;
  color?: string;
};

export type Discount = {
  id: string;
  name: string;
  scope: "all" | "category" | "products";
  categorySlug?: string;
  productIds: string[];
  percent: number;
  startDate: string; // ISO date
  endDate: string; // ISO date
};

/** Admin-editable data (stock + discounts). This is what gets "saved". */
export type AdminData = {
  stock: Record<string, number>;
  discounts: Discount[];
};

type State = {
  cart: CartItem[];
  wishlist: string[];
  /** The persisted/committed admin data — what customers see. */
  admin: AdminData;
};

type Action =
  | { type: "ADD"; item: CartItem }
  | { type: "REMOVE"; index: number }
  | { type: "QTY"; index: number; qty: number }
  | { type: "CLEAR_CART" }
  | { type: "TOGGLE_WISH"; id: string }
  | { type: "COMMIT_ADMIN"; data: AdminData };

const initialStock: Record<string, number> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, p.stock])
);

const initialAdmin: AdminData = { stock: initialStock, discounts: [] };

function load(): State {
  try {
    const raw = localStorage.getItem("nmb-store");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cart: parsed.cart ?? [],
        wishlist: parsed.wishlist ?? [],
        admin: {
          stock: { ...initialStock, ...(parsed.admin?.stock ?? {}) },
          discounts: parsed.admin?.discounts ?? [],
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { cart: [], wishlist: [], admin: initialAdmin };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD": {
      const idx = state.cart.findIndex(
        (c) =>
          c.productId === action.item.productId &&
          c.size === action.item.size &&
          c.color === action.item.color
      );
      if (idx >= 0) {
        const cart = [...state.cart];
        cart[idx] = { ...cart[idx], qty: cart[idx].qty + action.item.qty };
        return { ...state, cart };
      }
      return { ...state, cart: [...state.cart, action.item] };
    }
    case "REMOVE":
      return { ...state, cart: state.cart.filter((_, i) => i !== action.index) };
    case "QTY": {
      const cart = [...state.cart];
      cart[action.index] = { ...cart[action.index], qty: Math.max(1, action.qty) };
      return { ...state, cart };
    }
    case "CLEAR_CART":
      return { ...state, cart: [] };
    case "TOGGLE_WISH":
      return {
        ...state,
        wishlist: state.wishlist.includes(action.id)
          ? state.wishlist.filter((w) => w !== action.id)
          : [...state.wishlist, action.id],
      };
    case "COMMIT_ADMIN":
      return { ...state, admin: action.data };
    default:
      return state;
  }
}

/* ---------- Discount helpers ---------- */
export function isDiscountActive(d: Discount, now = new Date()): boolean {
  const start = new Date(d.startDate);
  const end = new Date(d.endDate);
  end.setHours(23, 59, 59, 999);
  return now >= start && now <= end;
}

export function discountAppliesTo(d: Discount, p: Product): boolean {
  if (d.scope === "all") return true;
  if (d.scope === "category") return p.categorySlug === d.categorySlug;
  return d.productIds.includes(p.id);
}

/** Returns best active discount percent for a product. */
export function bestDiscountPercent(p: Product, discounts: Discount[]): number {
  let best = 0;
  for (const d of discounts) {
    if (isDiscountActive(d) && discountAppliesTo(d, p)) {
      best = Math.max(best, d.percent);
    }
  }
  return best;
}

type Ctx = {
  state: State;
  addToCart: (item: CartItem) => void;
  removeFromCart: (index: number) => void;
  setQty: (index: number, qty: number) => void;
  clearCart: () => void;
  toggleWish: (id: string) => void;
  commitAdmin: (data: AdminData) => void;
  cartCount: number;
  /** Returns product with current stock AND active discount applied. */
  productWithStock: (p: Product) => Product;
};

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    localStorage.setItem("nmb-store", JSON.stringify(state));
  }, [state]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      addToCart: (item) => dispatch({ type: "ADD", item }),
      removeFromCart: (index) => dispatch({ type: "REMOVE", index }),
      setQty: (index, qty) => dispatch({ type: "QTY", index, qty }),
      clearCart: () => dispatch({ type: "CLEAR_CART" }),
      toggleWish: (id) => dispatch({ type: "TOGGLE_WISH", id }),
      commitAdmin: (data) => dispatch({ type: "COMMIT_ADMIN", data }),
      cartCount: state.cart.reduce((s, c) => s + c.qty, 0),
      productWithStock: (p) => {
        const stock = state.admin.stock[p.id] ?? p.stock;
        const pct = bestDiscountPercent(p, state.admin.discounts);
        if (pct > 0) {
          const discountedPrice = Math.round((p.price * (1 - pct / 100)) / 10) * 10;
          return {
            ...p,
            stock,
            comparePrice: p.price,
            price: discountedPrice,
            discountPercent: pct,
          } as Product & { discountPercent: number };
        }
        return { ...p, stock };
      },
    }),
    [state]
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function formatKES(n: number) {
  return "KES " + n.toLocaleString("en-KE");
}
