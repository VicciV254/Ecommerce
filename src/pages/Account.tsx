import type { ReactNode } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { Link, navigate, useLocation } from "../router";
import { loginRoute } from "../store/returnTo";

const NAV_ITEMS = [
  { path: "/account/profile", label: "Profile" },
  { path: "/account/orders", label: "Orders" },
  { path: "/account/addresses", label: "Addresses" },
] as const;

/** The account's own page for a path; the bare `/account` shows the profile. */
function currentItem(pathname: string) {
  return NAV_ITEMS.find((item) => pathname.startsWith(item.path)) ?? NAV_ITEMS[0];
}

const tabClass =
  "inline-flex min-h-[44px] w-full items-center rounded-sm px-[16px] text-sm font-semibold transition-colors duration-(--motion-feedback) [overflow-wrap:anywhere] xl:px-[12px]";

/**
 * The account frame. Phones and tablets get a compact row of page tabs above the content; from 1280px the same links
 * form a 224px column with the account holder's name. The current page is marked, and each page brings its own H1.
 */
export default function Account({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  if (!user) {
    return (
      <Container className="py-12">
        <section aria-labelledby="account-signed-out" className="mx-auto max-w-md rounded-lg bg-surface p-6 text-center shadow-card sm:p-8">
          <h1 id="account-signed-out" className="type-h1 text-navy-900">Your account</h1>
          <p className="mt-3 text-navy-800">Please sign in to view your account.</p>
          <Link
            to={loginRoute(pathname)}
            className="mx-auto mt-6 flex min-h-[48px] max-w-xs items-center justify-center rounded-sm bg-navy-900 px-5 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900"
          >
            Sign in
          </Link>
        </section>
      </Container>
    );
  }

  const current = currentItem(pathname);
  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={[{ label: "Account", to: "/account/profile" }, { label: current.label }]} />
      <div className="mt-4 xl:grid xl:grid-cols-[224px_minmax(0,1fr)] xl:items-start xl:gap-8">
        <nav aria-label="Account" className="rounded-lg bg-surface p-[8px] shadow-card xl:p-[16px]">
          <div className="hidden border-b border-divider px-1 pb-4 xl:block [overflow-wrap:anywhere]">
            {user.profileImage ? (
              <img src={user.profileImage} alt="" className="size-14 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-surface-soft text-xl font-semibold text-navy-900">
                {user.firstName?.[0] ?? "A"}
              </span>
            )}
            <p className="mt-2 font-semibold text-navy-900">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-muted">{user.email}</p>
          </div>
          <ul className="flex flex-wrap gap-1 xl:mt-3 xl:flex-col">
            {NAV_ITEMS.map((item) => {
              const active = item === current;
              return (
                <li key={item.path} className="min-w-0 flex-auto">
                  <Link
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={`${tabClass} justify-center xl:justify-start ${active ? "bg-navy-900 text-white" : "text-navy-900 hover:bg-surface-soft"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex justify-end border-t border-divider pt-1 xl:mt-3 xl:block xl:pt-3">
            <button
              type="button"
              onClick={() => { logout(); navigate("/login"); }}
              className={`${tabClass} w-auto text-error hover:bg-error-tint xl:w-full`}
            >
              Logout
            </button>
          </div>
        </nav>
        <div className="mt-6 min-w-0 xl:mt-0">{children}</div>
      </div>
    </Container>
  );
}
