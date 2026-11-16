import { useEffect, useState } from "react";
import { clearAdminSession, readAdminSession, type AdminSession } from "../api/staffSession";
import { navigate, useRoute } from "../router";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";
import { ADMIN_SESSION_KEYS } from "../utils/storage";
import { AdminLogin } from "./admin/AdminLogin";
import { AdminShell } from "./admin/AdminShell";
import { ADMIN_HOME } from "./admin/adminRoutes";
import { landingRoute } from "./admin/permissions";

const SESSION_KEYS: readonly string[] = ADMIN_SESSION_KEYS;
const sameSession = (a: AdminSession | null, b: AdminSession | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.role === b.role && a.username === b.username && a.email === b.email);

/**
 * `#/admin/...`: the staff sign-in, then the admin shell for that staff account. Signed out, no module data is
 * requested; signing in keeps the requested page when the role may open it and otherwise opens its first module.
 */
export default function Admin() {
  const [admin, setAdmin] = useState<AdminSession | null>(readAdminSession);
  const route = useRoute();

  useEffect(() => {
    // The staff session is shared by every tab. When another tab signs out, or in as someone else, follow it: this tab
    // never shows one account while its requests carry another's credentials, and the shell (keyed by account) drops
    // the previous account's unsaved edits and open records.
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && !SESSION_KEYS.includes(event.key))) return;
      const stored = readAdminSession();
      setAdmin((current) => (sameSession(current, stored) ? current : stored));
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  if (!admin) {
    return (
      <SignIn onSignIn={(signedIn) => {
        const landing = landingRoute(signedIn.role, route);
        if (landing) navigate(landing, { replace: true });
        setAdmin(signedIn);
      }} />
    );
  }

  return (
    // A different staff account never sees another's in-memory edits or open records.
    <AdminShell
      key={admin.id}
      admin={admin}
      onSignOut={() => {
        clearAdminSession();
        setAdmin(null);
        navigate(ADMIN_HOME, { replace: true });
      }}
    />
  );
}

function SignIn({ onSignIn }: { onSignIn: (admin: AdminSession) => void }) {
  const { brandName } = useStorefront();
  usePageTitle(`Sign in · Admin · ${brandName}`);
  return <main><AdminLogin onLogin={onSignIn} /></main>;
}
