import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { DeliveryMethod } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import { isRecord, readStoredJson, shopperStateKey, writeStoredJson } from "../utils/storage";
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
  | ({ type: "SET_COUPON"; couponCode: string | null } & Owned)
  | ({ type: "SET_CHECKOUT"; preferences: Partial<CheckoutPreferences> } & Owned)
  | ({ type: "BEGIN_ORDER"; intent: OrderIntent } & Owned)
  | ({ type: "END_ORDER"; idempotencyKey: string } & Owned)
  | ({ type: "ACKNOWLEDGE_ORDER"; orderId: string; items: CartLine[]; idempotencyKey: string } & Owned);

const MAX_ACKNOWLEDGED_ORDERS = 20;
const DEFAULT_CHECKOUT: CheckoutPreferences = { addressId: null, deliveryMethod: "STANDARD" };

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

  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    dispatch({ type: "SET_PERSONAL", owner, personal: loadPersonal(owner) });
  }, [owner]);

  useEffect(() => {
    // An account switch renders once with the previous owner's data; never save it under the new key.
    if (state.personalOwner !== owner) return;
    writeStoredJson(shopperStateKey(owner), storedPersonal(state));
  }, [state, owner]);

  const addToCart = useCallback((line: CartLine) => dispatch({ type: "ADD", line }), []);
  const removeFromCart = useCallback((index: number) => dispatch({ type: "REMOVE", index }), []);
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

  const value = useMemo<StoreValue>(() => ({
    state,
    addToCart,
    removeFromCart,
    setQuantity,
    clearCart,
    toggleWish,
    setCouponCode,
    setCheckoutPreferences,
    beginOrder,
    endOrder,
    acknowledgeOrder,
    cartCount: state.cart.reduce((sum, line) => sum + line.quantity, 0),
  }), [
    state, addToCart, removeFromCart, setQuantity, clearCart, toggleWish,
    setCouponCode, setCheckoutPreferences, beginOrder, endOrder, acknowledgeOrder,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
}
