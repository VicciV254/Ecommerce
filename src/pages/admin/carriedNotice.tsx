import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { navigate, useRoute } from "../../router";

/** A notice for the place a staff member is sent to, shown there until they move on. */
type Carried = { to: string; message: string; arrived: boolean };
type CarriedNoticeValue = { carried: Carried | null; carry: (to: string, message: string) => void };

const CarriedNoticeContext = createContext<CarriedNoticeValue | null>(null);

/**
 * Lets one admin place correct the address to another and say why there, as a module does for its own bad record ids
 * (the product preview sends an unknown product to the products list with "That product wasn't found.").
 */
export function CarriedNoticeProvider({ children }: { children: ReactNode }) {
  const route = useRoute();
  const [carried, setCarried] = useState<Carried | null>(null);
  // The address is replaced only once the notice is stored, so the place it opens can never miss it; any later move ends it.
  // Updates apply only to the notice this effect saw: a newer one carried in the same commit (a child's effects run
  // first) must not be ended by the previous notice's route change.
  useEffect(() => {
    if (!carried) return;
    const update = (next: Carried | null) => setCarried((latest) => (latest === carried ? next : latest));
    if (carried.arrived) {
      if (route !== carried.to) update(null);
    } else if (route === carried.to) {
      update({ ...carried, arrived: true });
    } else {
      navigate(carried.to, { replace: true });
    }
  }, [carried, route]);
  const carry = useCallback((to: string, message: string) => setCarried({ to, message, arrived: false }), []);
  const value = useMemo(() => ({ carried, carry }), [carried, carry]);
  return <CarriedNoticeContext.Provider value={value}>{children}</CarriedNoticeContext.Provider>;
}

/** Replaces the address with `to` and shows `message` there; outside the provider it only replaces the address. */
export function useCarry() {
  const context = useContext(CarriedNoticeContext);
  return context?.carry ?? ((to: string) => navigate(to, { replace: true }));
}

/** The notice carried to the current address, or "". */
export function useCarriedNotice() {
  const context = useContext(CarriedNoticeContext);
  const route = useRoute();
  return context?.carried?.to === route ? context.carried.message : "";
}
