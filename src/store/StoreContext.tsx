import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { PRODUCTS, CATEGORIES, type Product, type Category } from "../data/products";

export const BASE_DESIGNERS = [
  {
    id: "amina",
    name: "Amina Designs",
    specialty: "Kitenge Couture & Resort",
    location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863797948-pasted-1782863794772.png",
    spotlightTitle: "Amina Designs: Blending Tradition with Modernity",
    spotlightText: "Amina Mohamed fuses heritage Ankara and kitenge craft with contemporary silhouettes, leading our Resort 2026 line with vibrant, coast-ready pieces for the whole family.",
  },
  {
    id: "kamau",
    name: "Kamau Studio",
    specialty: "Modern Tailoring & Summer",
    location: "Nairobi",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863651902-pasted-1782863648177.png",
    spotlightTitle: "Kamau Studio: The Art of Effortless Tailoring",
    spotlightText: "Known for clean lines and breathable fabrics, Kamau Studio defines our Summer 2026 essentials — relaxed tailoring that moves from boardroom to beach.",
  },
  {
    id: "fatma",
    name: "Fatma Collective",
    specialty: "Luxe Evening & Outerwear",
    location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863924527-pasted-1782863922363.png",
    spotlightTitle: "Fatma Collective: Drama After Dark",
    spotlightText: "Fatma Collective brings structured outerwear and statement evening looks to our Fall/Winter 2026 collection — rich textures, bold confidence.",
  },
  {
    id: "omar",
    name: "Omar Fashion",
    specialty: "Street Style & Denim",
    location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782862623421-pasted-1782862527863.png",
    spotlightTitle: "Omar Fashion: Streetwear with Soul",
    spotlightText: "Omar's edit champions everyday street style — denim, graphic tees and easy layering that keeps Mombasa's youth looking sharp season-round.",
  },
];

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

/** Admin-editable data (stock + discounts + products/tags). This is what gets "saved". */
export type AdminData = {
  stock: Record<string, number>;
  discounts: Discount[];
  /** Per-product tag overrides (replaces the base tags when present). */
  tagOverrides: Record<string, string[]>;
  /** Admin-added products. */
  customProducts: Product[];
  /** Full-product overrides for base products (name, price, designer, etc.). */
  productOverrides: Record<string, Partial<Product>>;
  /** Admin-added categories (slug → name). */
  customCategories: { name: string; slug: string; image: string }[];
  /** Category overrides for base or custom categories. */
  categoryOverrides: Record<string, Partial<Category>>;
  /** Admin-added designers (id, name + showroom spotlight info). */
  customDesigners: CustomDesigner[];
  /** Designer overrides for base or custom designers. */
  designerOverrides: Record<string, Partial<CustomDesigner>>;
  /** Hidden product ids. */
  deletedProductIds: string[];
  /** Hidden category slugs. */
  deletedCategorySlugs: string[];
  /** Hidden designer ids. */
  deletedDesignerIds: string[];
};

export type CustomDesigner = {
  id: string;
  name: string;
  specialty?: string;
  location?: string;
  image?: string;
  spotlightTitle?: string;
  spotlightText?: string;
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

const initialAdmin: AdminData = {
  stock: initialStock,
  discounts: [],
  tagOverrides: {},
  customProducts: [],
  productOverrides: {},
  customCategories: [],
  categoryOverrides: {},
  customDesigners: [],
  designerOverrides: {},
  deletedProductIds: [],
  deletedCategorySlugs: [],
  deletedDesignerIds: [],
};

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
          tagOverrides: parsed.admin?.tagOverrides ?? {},
          customProducts: parsed.admin?.customProducts ?? [],
          productOverrides: parsed.admin?.productOverrides ?? {},
          customCategories: parsed.admin?.customCategories ?? [],
          categoryOverrides: parsed.admin?.categoryOverrides ?? {},
          customDesigners: parsed.admin?.customDesigners ?? [],
          designerOverrides: parsed.admin?.designerOverrides ?? {},
          deletedProductIds: parsed.admin?.deletedProductIds ?? [],
          deletedCategorySlugs: parsed.admin?.deletedCategorySlugs ?? [],
          deletedDesignerIds: parsed.admin?.deletedDesignerIds ?? [],
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
  /** Full catalog: base products + custom products, with tag overrides applied. */
  catalog: Product[];
  /** Base + custom categories. */
  allCategories: { name: string; slug: string; image: string }[];
  /** Base (4) + admin-added designers. */
  allDesigners: CustomDesigner[];
};

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    localStorage.setItem("nmb-store", JSON.stringify(state));
  }, [state]);

  const catalog = useMemo<Product[]>(() => {
    const deletedProductIds = new Set(state.admin.deletedProductIds);
    const deletedCategorySlugs = new Set(state.admin.deletedCategorySlugs);
    const base = [...PRODUCTS, ...state.admin.customProducts]
      .filter((p) => !deletedProductIds.has(p.id) && !deletedCategorySlugs.has(p.categorySlug));

    return base.map((p) => {
      const tagOv = state.admin.tagOverrides[p.id];
      const fullOv = state.admin.productOverrides[p.id];
      let next = p;
      if (fullOv) next = { ...next, ...fullOv };
      if (tagOv) next = { ...next, tags: tagOv };
      return next;
    });
  }, [state.admin.customProducts, state.admin.tagOverrides, state.admin.productOverrides, state.admin.deletedProductIds, state.admin.deletedCategorySlugs]);

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
      catalog,
      allCategories: [...CATEGORIES, ...state.admin.customCategories]
        .filter((c) => !state.admin.deletedCategorySlugs.includes(c.slug))
        .map((c) => {
          const override = state.admin.categoryOverrides[c.slug];
          return override ? { ...c, ...override } : c;
        }),
      allDesigners: [...BASE_DESIGNERS, ...state.admin.customDesigners]
        .filter((d) => !state.admin.deletedDesignerIds.includes(d.id))
        .map((d) => {
          const override = state.admin.designerOverrides[d.id];
          return override ? { ...d, ...override } : d;
        }),
    }),
    [state, catalog]
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
