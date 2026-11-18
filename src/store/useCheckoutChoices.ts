import { useEffect } from "react";
import type { Address, User } from "../api/auth";
import type { CatalogDelivery } from "../api/catalog";
import type { DeliveryMethod } from "../api/orders";
import { useCatalog } from "./CatalogContext";
import { useStore } from "./StoreContext";

/** The saved method while it is offered; otherwise (Store pickup, now turned off) the first offered one. */
function offeredMethod(saved: DeliveryMethod, delivery: readonly CatalogDelivery[] | null): DeliveryMethod {
  if (!delivery?.length || delivery.some((option) => option.method === saved)) return saved;
  return delivery[0].method;
}

/**
 * The customer's address, delivery and coupon choices, persisted with their cart so the cart and
 * checkout quote the same thing. With no saved choice the default (or first) address is used.
 */
export function useCheckoutChoices(user: User) {
  const { state, ownerReady, setCheckoutPreferences, setCouponCode } = useStore();
  const { delivery } = useCatalog();
  const addresses: Address[] = user.addresses ?? [];
  const address = addresses.find((item) => item.id === state.checkout.addressId) ??
    addresses.find((item) => item.isDefault) ?? addresses[0] ?? null;
  const saved = state.checkout.deliveryMethod;
  const deliveryMethod = offeredMethod(saved, delivery);
  // The corrected method is the one quoted from the first render, and it replaces the saved one once this owner's
  // choices are loaded (after a sign-in's guest-cart merge too).
  useEffect(() => {
    if (ownerReady && deliveryMethod !== saved) setCheckoutPreferences({ deliveryMethod });
  }, [ownerReady, deliveryMethod, saved, setCheckoutPreferences]);
  return {
    addresses,
    address,
    deliveryMethod,
    couponCode: state.couponCode,
    chooseAddress: (addressId: string) => setCheckoutPreferences({ addressId }),
    chooseDelivery: (method: DeliveryMethod) => setCheckoutPreferences({ deliveryMethod: method }),
    applyCoupon: (couponCode: string) => setCouponCode(couponCode),
    removeCoupon: () => setCouponCode(null),
  };
}
