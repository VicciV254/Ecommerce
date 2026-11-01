import type { Address, User } from "../api/auth";
import type { DeliveryMethod } from "../api/orders";
import { useStore } from "./StoreContext";

/**
 * The customer's address, delivery and coupon choices, persisted with their cart so the cart and
 * checkout quote the same thing. With no saved choice the default (or first) address is used.
 */
export function useCheckoutChoices(user: User) {
  const { state, setCheckoutPreferences, setCouponCode } = useStore();
  const addresses: Address[] = user.addresses ?? [];
  const address = addresses.find((item) => item.id === state.checkout.addressId) ??
    addresses.find((item) => item.isDefault) ?? addresses[0] ?? null;
  return {
    addresses,
    address,
    deliveryMethod: state.checkout.deliveryMethod,
    couponCode: state.couponCode,
    chooseAddress: (addressId: string) => setCheckoutPreferences({ addressId }),
    chooseDelivery: (deliveryMethod: DeliveryMethod) => setCheckoutPreferences({ deliveryMethod }),
    applyCoupon: (couponCode: string) => setCouponCode(couponCode),
    removeCoupon: () => setCouponCode(null),
  };
}
