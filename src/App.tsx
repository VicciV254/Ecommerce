import { StoreProvider } from "./store/StoreContext";
import { CatalogProvider } from "./store/CatalogContext";
import { StorefrontProvider } from "./store/StorefrontContext";
import { AuthProvider } from "./contexts/AuthContext";
import { useRoute, parseRoute } from "./router";
import { Header } from "./components/Header";
import { DeploymentNotice } from "./components/DeploymentNotice";
import { GuestCartMerge } from "./components/GuestCartMerge";
import { MiniCartProvider } from "./components/MiniCart";
import { Footer } from "./components/Footer";
import { BackToTop } from "./components/BackToTop";
import { WelcomeDialog } from "./components/WelcomeDialog";
import Home from "./pages/Home";
import Shop from "./pages/Shop";
import Departments from "./pages/Departments";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Wishlist from "./pages/Wishlist";
import Admin from "./pages/Admin";
import { ADMIN_PREVIEW_FRAME_ROUTE, routePath } from "./pages/admin/adminRoutes";
import { StorefrontPreviewFrame } from "./pages/admin/StorefrontPreviewFrame";
import TrackOrder from "./pages/TrackOrder";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Account from "./pages/Account";
import AccountProfile from "./pages/AccountProfile";
import AccountOrders from "./pages/AccountOrders";
import AccountAddresses from "./pages/AccountAddresses";
import VerifyEmail from "./pages/VerifyEmail";
import Unsubscribe from "./pages/Unsubscribe";
import Delivery from "./pages/Delivery";
import Returns from "./pages/Returns";
import Faq from "./pages/Faq";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";

/** Pages that keep their place across their own `?section=` changes (see `InfoPage`). */
const SECTIONED_PAGES = new Set(["faq", "privacy", "terms"]);

function Router() {
  const route = useRoute();
  // The draft preview's frame: the storefront alone, outside the admin and the shopper shell (whose `min-h-screen`
  // would stop the frame shrinking to its content).
  if (routePath(route) === ADMIN_PREVIEW_FRAME_ROUTE) return <StorefrontPreviewFrame />;
  const { parts } = parseRoute(route);
  const root = parts[0] ?? "";

  const isAdmin = root === "admin";

  let page: React.ReactNode;
  switch (root) {
    case "":
      page = <Home />;
      break;
    case "shop":
      page = <Shop route={route} />;
      break;
    case "departments":
      page = <Departments />;
      break;
    case "product":
      page = <ProductDetail id={parts[1] ?? ""} />;
      break;
    case "cart":
      page = <Cart />;
      break;
    case "checkout":
      page = <Checkout />;
      break;
    case "about":
      page = <About />;
      break;
    case "contact":
      page = <Contact />;
      break;
    case "wishlist":
      page = <Wishlist />;
      break;
    case "track":
      page = <TrackOrder route={route} />;
      break;
    case "login":
      page = <Login />;
      break;
    case "register":
      page = <Register />;
      break;
    case "verify-email":
      page = <VerifyEmail />;
      break;
    case "unsubscribe":
      page = <Unsubscribe />;
      break;
    case "delivery":
      page = <Delivery />;
      break;
    case "returns":
      page = <Returns />;
      break;
    case "faq":
      page = <Faq />;
      break;
    case "privacy":
      page = <Privacy />;
      break;
    case "terms":
      page = <Terms />;
      break;
    case "account":
      page = (
        <Account>
          {parts[1] === "orders" ? <AccountOrders /> : parts[1] === "addresses" ? <AccountAddresses /> : <AccountProfile />}
        </Account>
      );
      break;
    case "admin":
      return (
        <>
          <DeploymentNotice />
          <Admin />
        </>
      );
    default:
      page = <NotFound />;
  }

  // One shell for every shopper page, so the header and the guest-cart report persist across page changes.
  // The listing keeps its page across its own URL changes, so focus and scroll survive filtering. Checkout and the
  // account keep theirs across query changes (a checkout step, an order to open), so in-progress state is never lost;
  // the long information pages keep theirs across section changes, which scroll and focus within the page.
  const pathname = route.split("?")[0] || "/";
  const pageKey = root === "shop" ? "/shop"
    : root === "checkout" || root === "account" || SECTIONED_PAGES.has(root) ? pathname : route;
  return (
    <div className="flex min-h-screen flex-col">
      <DeploymentNotice />
      <Header />
      <GuestCartMerge />
      <main key={pageKey} className="flex-1 animate-fade-in">
        {page}
      </main>
      {!isAdmin && <Footer />}
      <BackToTop />
      <WelcomeDialog />
    </div>
  );
}

export default function App() {
  return (
    <StorefrontProvider>
      <CatalogProvider>
        <AuthProvider>
          <StoreProvider>
            <MiniCartProvider>
              <Router />
            </MiniCartProvider>
          </StoreProvider>
        </AuthProvider>
      </CatalogProvider>
    </StorefrontProvider>
  );
}
