import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { useAuth } from "../contexts/AuthContext";
import { isRecord, readStoredJson, shopperStateKey, writeStoredJson } from "../utils/storage";

/** A cart line names one sellable SKU; labels and prices always come from the catalog API. */
export type CartLine = {
  productId: string;
  variantId: string;
  quantity: number;
};

type PersonalState = {
  cart: CartLine[];
  wishlist: string[];
};

type State = PersonalState & {
  /** Account whose data `cart`/`wishlist` hold; persisted only while it is still current. */
  personalOwner: string | null;
};

type Action =
  | { type: "ADD"; line: CartLine }
  | { type: "REMOVE"; index: number }
  | { type: "QUANTITY"; index: number; quantity: number }
  | { type: "CLEAR_CART" }
  | { type: "TOGGLE_WISH"; productId: string }
  | { type: "SET_PERSONAL"; owner: string | null; personal: PersonalState };

function isCartLine(value: unknown): value is CartLine {
  return isRecord(value) && typeof value.productId === "string" && value.productId !== "" &&
    typeof value.variantId === "string" && value.variantId !== "" &&
    Number.isInteger(value.quantity) && Number(value.quantity) > 0;
}

function loadPersonal(owner: string | null): PersonalState {
  const stored = readStoredJson(shopperStateKey(owner));
  if (!isRecord(stored)) return { cart: [], wishlist: [] };
  return {
    cart: Array.isArray(stored.cart) ? stored.cart.filter(isCartLine) : [],
    wishlist: Array.isArray(stored.wishlist)
      ? [...new Set(stored.wishlist.filter((id): id is string => typeof id === "string" && id !== ""))]
      : [],
  };
}

function wholeQuantity(quantity: number) {
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
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
      return state;
  }
}

type StoreValue = {
  state: State;
  addToCart: (line: CartLine) => void;
  removeFromCart: (index: number) => void;
  setQuantity: (index: number, quantity: number) => void;
  clearCart: () => void;
  toggleWish: (productId: string) => void;
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

  useEffect(() => {
    dispatch({ type: "SET_PERSONAL", owner, personal: loadPersonal(owner) });
  }, [owner]);

  useEffect(() => {
    // An account switch renders once with the previous owner's data; never save it under the new key.
    if (state.personalOwner !== owner) return;
    writeStoredJson(shopperStateKey(owner), { cart: state.cart, wishlist: state.wishlist });
  }, [state.cart, state.wishlist, state.personalOwner, owner]);

  const addToCart = useCallback((line: CartLine) => dispatch({ type: "ADD", line }), []);
  const removeFromCart = useCallback((index: number) => dispatch({ type: "REMOVE", index }), []);
  const setQuantity = useCallback((index: number, quantity: number) => dispatch({ type: "QUANTITY", index, quantity }), []);
  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const toggleWish = useCallback((productId: string) => dispatch({ type: "TOGGLE_WISH", productId }), []);

  const value = useMemo<StoreValue>(() => ({
    state,
    addToCart,
    removeFromCart,
    setQuantity,
    clearCart,
    toggleWish,
    cartCount: state.cart.reduce((sum, line) => sum + line.quantity, 0),
  }), [state, addToCart, removeFromCart, setQuantity, clearCart, toggleWish]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
}
