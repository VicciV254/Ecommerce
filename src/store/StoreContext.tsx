import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogProduct } from "../api/catalog";
import type { DeliveryMethod } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import { STORAGE_NAMESPACE, isRecord, readStoredJson, shopperStateKey, writeStoredJson } from "../utils/storage";
import { mergeGuestCart, type MergeOutcome } from "./cartModel";
import { clearGuestMerge, pendingGuestMerge } from "./guestMerge";
import {
  isDeliveryMethod,
  isOrderIntent,
  normalizeCouponCode,
  subtractOrderedItems,
  type OrderIntent,
} from "./checkoutModel";

/** A cart line names one sellable SKU; labels and prices always come from the catalog API. */
export type CartLine = {
  productId: string;
  variantId: string;
  quantity: number;
};

/** Address and delivery choices kept with the cart, so checkout quotes what the cart showed. */
export type CheckoutPreferences = {
  addressId: string | null;
  deliveryMethod: DeliveryMethod;
};

type PersonalState = {
  cart: CartLine[];
  wishlist: string[];
  /** Normalized coupon the customer entered; only checkout quotes decide whether it applies. */
  couponCode: string | null;
  checkout: CheckoutPreferences;
  /** The one order submission whose outcome must be resolved before another can start. */
  pendingOrder: OrderIntent | null;
  /** Recent orders already removed from the cart: a bounded guard, not a receipt store. */
  acknowledgedOrderIds: string[];
};

type State = PersonalState & {
  /** Account whose data the personal fields hold; persisted only while it is still current. */
  personalOwner: string | null;
};

/** Actions from asynchronous checkout work name their account and are ignored once it is no longer current. */
type Owned = { owner: string | null };

type Action =
  | { type: "ADD"; line: CartLine }
  | { type: "REMOVE"; index: number }
  | { type: "QUANTITY"; index: number; quantity: number }
  | { type: "CLEAR_CART" }
  | { type: "TOGGLE_WISH"; productId: string }
  | { type: "SET_PERSONAL"; owner: string | null; personal: PersonalState }
  /** The owner's state as stored: another tab changed it, or a merge has just written it. */
  | ({ type: "RELOAD"; personal: PersonalState } & Owned)
  /** Undo of a removal: the line returns at its old position, or joins a line for the same SKU added since. */
  | ({ type: "RESTORE"; line: CartLine; index: number } & Owned)
  | ({ type: "SET_COUPON"; couponCode: string | null } & Owned)
  | ({ type: "SET_CHECKOUT"; preferences: Partial<CheckoutPreferences> } & Owned)
  | ({ type: "BEGIN_ORDER"; intent: OrderIntent } & Owned)
  | ({ type: "END_ORDER"; idempotencyKey: string } & Owned)
  | ({ type: "ACKNOWLEDGE_ORDER"; orderId: string; items: CartLine[]; idempotencyKey: string } & Owned);

const MAX_ACKNOWLEDGED_ORDERS = 20;
const DEFAULT_CHECKOUT: CheckoutPreferences = { addressId: null, deliveryMethod: "STANDARD" };
/** Web Lock that lets one tab at a time merge a guest cart. */
const GUEST_MERGE_LOCK = `${STORAGE_NAMESPACE}:guest-merge`;

function isCartLine(value: unknown): value is CartLine {
  return isRecord(value) && typeof value.productId === "string" && value.productId !== "" &&
    typeof value.variantId === "string" && value.variantId !== "" &&
    Number.isInteger(value.quantity) && Number(value.quantity) > 0;
}

const isId = (value: unknown): value is string => typeof value === "string" && value !== "";

function loadPersonal(owner: string | null): PersonalState {
  const stored = readStoredJson(shopperStateKey(owner));
  if (!isRecord(stored)) {
    return { cart: [], wishlist: [], couponCode: null, checkout: DEFAULT_CHECKOUT, pendingOrder: null, acknowledgedOrderIds: [] };
  }
  const checkout = isRecord(stored.checkout) ? stored.checkout : {};
  return {
    cart: Array.isArray(stored.cart) ? stored.cart.filter(isCartLine) : [],
    wishlist: Array.isArray(stored.wishlist) ? [...new Set(stored.wishlist.filter(isId))] : [],
    couponCode: typeof stored.couponCode === "string" ? normalizeCouponCode(stored.couponCode) : null,
    checkout: {
      addressId: isId(checkout.addressId) ? checkout.addressId : null,
      deliveryMethod: isDeliveryMethod(checkout.deliveryMethod) ? checkout.deliveryMethod : DEFAULT_CHECKOUT.deliveryMethod,
    },
    pendingOrder: isOrderIntent(stored.pendingOrder) ? stored.pendingOrder : null,
    acknowledgedOrderIds: Array.isArray(stored.acknowledgedOrderIds)
      ? stored.acknowledgedOrderIds.filter(isId).slice(-MAX_ACKNOWLEDGED_ORDERS)
      : [],
  };
}

function storedPersonal(state: PersonalState): PersonalState {
  const { cart, wishlist, couponCode, checkout, pendingOrder, acknowledgedOrderIds } = state;
  return { cart, wishlist, couponCode, checkout, pendingOrder, acknowledgedOrderIds };
}

function wholeQuantity(quantity: number) {
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
}

function ownedReducer(state: State, action: Exclude<Action, { type: "ADD" | "REMOVE" | "QUANTITY" | "CLEAR_CART" | "TOGGLE_WISH" | "SET_PERSONAL" }>): State {
  if (action.owner !== state.personalOwner) return state;
  switch (action.type) {
    case "RELOAD":
      return { personalOwner: state.personalOwner, ...action.personal };
    case "RESTORE": {
      const quantity = wholeQuantity(action.line.quantity);
      const existing = state.cart.findIndex(
        (line) => line.productId === action.line.productId && line.variantId === action.line.variantId,
      );
      const cart = [...state.cart];
      if (existing >= 0) cart[existing] = { ...cart[existing], quantity: cart[existing].quantity + quantity };
      else cart.splice(Math.min(Math.max(0, action.index), cart.length), 0, { ...action.line, quantity });
      return { ...state, cart };
    }
    case "SET_COUPON":
      return { ...state, couponCode: action.couponCode };
    case "SET_CHECKOUT":
      return { ...state, checkout: { ...state.checkout, ...action.preferences } };
    case "BEGIN_ORDER":
      return state.pendingOrder ? state : { ...state, pendingOrder: action.intent };
    case "END_ORDER":
      return state.pendingOrder?.idempotencyKey === action.idempotencyKey ? { ...state, pendingOrder: null } : state;
    case "ACKNOWLEDGE_ORDER": {
      const pendingOrder = state.pendingOrder?.idempotencyKey === action.idempotencyKey ? null : state.pendingOrder;
      if (state.acknowledgedOrderIds.includes(action.orderId)) {
        return pendingOrder === state.pendingOrder ? state : { ...state, pendingOrder };
      }
      const cart = subtractOrderedItems(state.cart, action.items);
      return {
        ...state,
        cart,
        pendingOrder,
        couponCode: cart.length ? state.couponCode : null,
        acknowledgedOrderIds: [...state.acknowledgedOrderIds, action.orderId].slice(-MAX_ACKNOWLEDGED_ORDERS),
      };
    }
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD": {
      const quantity = wholeQuantity(action.line.quantity);
      const index = state.cart.findIndex(
        (line) => line.productId === action.line.productId && line.variantId === action.line.variantId,
      );
      if (index < 0) return { ...state, cart: [...state.cart, { ...action.line, quantity }] };
      const cart = [...state.cart];
      cart[index] = { ...cart[index], quantity: cart[index].quantity + quantity };
      return { ...state, cart };
    }
    case "REMOVE":
      return { ...state, cart: state.cart.filter((_, index) => index !== action.index) };
    case "QUANTITY": {
      if (!state.cart[action.index]) return state;
      const cart = [...state.cart];
      cart[action.index] = { ...cart[action.index], quantity: wholeQuantity(action.quantity) };
      return { ...state, cart };
    }
    case "CLEAR_CART":
      return { ...state, cart: [] };
    case "TOGGLE_WISH":
      return {
        ...state,
        wishlist: state.wishlist.includes(action.productId)
          ? state.wishlist.filter((id) => id !== action.productId)
          : [...state.wishlist, action.productId],
      };
    case "SET_PERSONAL":
      return { personalOwner: action.owner, ...action.personal };
    default:
      return ownedReducer(state, action);
  }
}

type StoreValue = {
  state: State;
  addToCart: (line: CartLine) => void;
  removeFromCart: (index: number) => void;
  /** Undoes a removal made while `owner` was current; ignored once another owner's cart is shown. */
  restoreLine: (line: CartLine, index: number, owner: string | null) => void;
  setQuantity: (index: number, quantity: number) => void;
  clearCart: () => void;
  toggleWish: (productId: string) => void;
  setCouponCode: (couponCode: string | null) => void;
  setCheckoutPreferences: (preferences: Partial<CheckoutPreferences>) => void;
  /**
   * Records the order intent and writes it to storage before returning `true`; the caller sends the
   * request only after that. `false` means another intent is unresolved or the browser could not save it.
   */
  beginOrder: (intent: OrderIntent) => boolean;
  /** Forgets an intent the server definitely refused or that ended without holding items. */
  endOrder: (idempotencyKey: string) => void;
  /** Removes a verified order's items from the cart once, keeping later additions, and ends its intent. */
  acknowledgeOrder: (orderId: string, items: CartLine[], idempotencyKey: string) => void;
  /**
   * False while the provider still holds the previous owner's data after a sign-in change, or while a guest cart
   * waits to be merged: cart views show nothing (or a loading state) rather than the wrong lines.
   */
  ownerReady: boolean;
  /** True from a sign-in this tab made from a guest session until the guest cart has been merged. */
  mergePending: boolean;
  /**
   * Merges the stored guest cart into the stored cart of the account this tab signed in, against the loaded catalog,
   * clears the guest cart and resolves to what changed. Resolves to `null` (and changes nothing) unless this tab has a
   * merge pending for the current owner.
   */
  completeGuestMerge: (productsById: ReadonlyMap<string, CatalogProduct>) => Promise<MergeOutcome | null>;
  /** Units across the cart; 0 until `ownerReady`. */
  cartCount: number;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [state, dispatch] = useReducer(reducer, owner, (initialOwner): State => ({
    personalOwner: initialOwner,
    ...loadPersonal(initialOwner),
  }));
  const latest = useRef(state);
  /** The owner as of the last owner-change effect: the one whose state this tab now loads and saves. */
  const seenOwner = useRef(owner);
  const [pendingMerge, setPendingMerge] = useState(() => pendingGuestMerge(owner));
  /** Mirrors `pendingMerge` synchronously, so a merge can never run twice for one sign-in. */
  const pendingRef = useRef(pendingMerge);

  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    const previous = seenOwner.current;
    seenOwner.current = owner;
    if (previous === owner) return;
    // Only a sign-in this tab made from a guest session brings the guest cart along. A sign-in learned from another
    // tab, an account switch and a sign-out never move lines.
    const merging = previous === null ? pendingGuestMerge(owner) : null;
    if (merging === null) clearGuestMerge();
    pendingRef.current = merging;
    setPendingMerge(merging);
    dispatch({ type: "SET_PERSONAL", owner, personal: loadPersonal(owner) });
  }, [owner]);

  useEffect(() => {
    // Another tab changed this owner's state: take its version, so this tab never saves older state over it.
    const key = shopperStateKey(owner);
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== key)) return;
      dispatch({ type: "RELOAD", owner, personal: loadPersonal(owner) });
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [owner]);

  useEffect(() => {
    // An account switch renders once with the previous owner's data; never save it under the new key.
    if (state.personalOwner !== owner) return;
    const key = shopperStateKey(owner);
    const saved = JSON.stringify(storedPersonal(state));
    // Writing what storage already holds would echo another tab's change back to it.
    if (localStorage.getItem(key) !== saved) localStorage.setItem(key, saved);
  }, [state, owner]);

  const completeGuestMerge = useCallback(async (productsById: ReadonlyMap<string, CatalogProduct>) => {
    if (owner === null || pendingRef.current !== owner || latest.current.personalOwner !== owner) return null;
    pendingRef.current = null;
    // One read-modify-write of both stored carts, one tab at a time: lines other tabs added to the account are kept,
    // and a guest cart already merged elsewhere is empty by now. Nothing moves once this tab has left the account.
    const merge = () => {
      if (seenOwner.current !== owner) return null;
      const account = loadPersonal(owner);
      const guest = loadPersonal(null);
      const outcome = mergeGuestCart(account.cart, guest.cart, productsById);
      const merged: PersonalState = { ...account, cart: outcome.cart };
      writeStoredJson(shopperStateKey(owner), storedPersonal(merged));
      writeStoredJson(shopperStateKey(null), storedPersonal({ ...guest, cart: [] }));
      return { outcome, merged };
    };
    // Web Locks are missing in older browsers; one tab merging alone needs no lock.
    const locks: LockManager | undefined = navigator.locks;
    const result = locks ? await locks.request(GUEST_MERGE_LOCK, merge) : merge();
    clearGuestMerge(owner);
    setPendingMerge((pending) => (pending === owner ? null : pending));
    if (!result) return null;
    dispatch({ type: "RELOAD", owner, personal: result.merged });
    return result.outcome;
  }, [owner]);

  const addToCart = useCallback((line: CartLine) => dispatch({ type: "ADD", line }), []);
  const removeFromCart = useCallback((index: number) => dispatch({ type: "REMOVE", index }), []);
  const restoreLine = useCallback(
    (line: CartLine, index: number, lineOwner: string | null) => dispatch({ type: "RESTORE", owner: lineOwner, line, index }),
    [],
  );
  const setQuantity = useCallback((index: number, quantity: number) => dispatch({ type: "QUANTITY", index, quantity }), []);
  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const toggleWish = useCallback((productId: string) => dispatch({ type: "TOGGLE_WISH", productId }), []);
  const setCouponCode = useCallback((couponCode: string | null) => dispatch({ type: "SET_COUPON", owner, couponCode }), [owner]);
  const setCheckoutPreferences = useCallback(
    (preferences: Partial<CheckoutPreferences>) => dispatch({ type: "SET_CHECKOUT", owner, preferences }),
    [owner],
  );
  const beginOrder = useCallback((intent: OrderIntent) => {
    const current = latest.current;
    if (current.personalOwner !== owner || current.pendingOrder) return false;
    // Durable before sending: a lost response is then resolved with this key instead of creating another order.
    try {
      writeStoredJson(shopperStateKey(owner), storedPersonal({ ...current, pendingOrder: intent }));
    } catch {
      return false;
    }
    if (loadPersonal(owner).pendingOrder?.idempotencyKey !== intent.idempotencyKey) return false;
    dispatch({ type: "BEGIN_ORDER", owner, intent });
    return true;
  }, [owner]);
  const endOrder = useCallback((idempotencyKey: string) => dispatch({ type: "END_ORDER", owner, idempotencyKey }), [owner]);
  const acknowledgeOrder = useCallback(
    (orderId: string, items: CartLine[], idempotencyKey: string) =>
      dispatch({ type: "ACKNOWLEDGE_ORDER", owner, orderId, items, idempotencyKey }),
    [owner],
  );

  const mergePending = pendingMerge !== null && pendingMerge === owner;
  const ownerReady = state.personalOwner === owner && !mergePending;
  const value = useMemo<StoreValue>(() => ({
    state,
    addToCart,
    removeFromCart,
    restoreLine,
    setQuantity,
    clearCart,
    toggleWish,
    setCouponCode,
    setCheckoutPreferences,
    beginOrder,
    endOrder,
    acknowledgeOrder,
    ownerReady,
    mergePending,
    completeGuestMerge,
    cartCount: ownerReady ? state.cart.reduce((sum, line) => sum + line.quantity, 0) : 0,
  }), [
    state, addToCart, removeFromCart, restoreLine, setQuantity, clearCart, toggleWish,
    setCouponCode, setCheckoutPreferences, beginOrder, endOrder, acknowledgeOrder,
    ownerReady, mergePending, completeGuestMerge,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
}
