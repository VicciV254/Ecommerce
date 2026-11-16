import { useEffect } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { StoreProvider } from "./store/StoreContext";
import { CatalogProvider } from "./store/CatalogContext";
import { StorefrontProvider } from "./store/StorefrontContext";
import { AuthProvider } from "./contexts/AuthContext";
import { useRoute, parseRoute } from "./router";
import { Header } from "./components/Header";
import { GuestCartMerge } from "./components/GuestCartMerge";
import { MiniCartProvider } from "./components/MiniCart";
import { Footer } from "./components/Footer";
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
import TrackOrder from "./pages/TrackOrder";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Account from "./pages/Account";
import AccountProfile from "./pages/AccountProfile";
import AccountOrders from "./pages/AccountOrders";
import AccountAddresses from "./pages/AccountAddresses";
import VerifyEmail from "./pages/VerifyEmail";

function Router() {
  const route = useRoute();
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
    case "account":
      page = (
        <Account>
          {parts[1] === "orders" ? <AccountOrders /> : parts[1] === "addresses" ? <AccountAddresses /> : <AccountProfile />}
        </Account>
      );
      break;
    case "admin":
      return <Admin />;
    default:
      page = <Home />;
  }

  // One shell for every shopper page, so the header and the guest-cart report persist across page changes.
  // The listing keeps its page across its own URL changes, so focus and scroll survive filtering. Checkout and the
  // account keep theirs across query changes (a checkout step, an order to open), so in-progress state is never lost.
  const pathname = route.split("?")[0] || "/";
  const pageKey = root === "shop" ? "/shop" : root === "checkout" || root === "account" ? pathname : route;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <GuestCartMerge />
      <main key={pageKey} className="flex-1 animate-fade-in">
        {page}
      </main>
      {!isAdmin && <Footer />}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    AOS.init({
      duration: 800,
      easing: "ease-out",
      once: true,
      offset: 50,
      disable: "mobile"
    });
  }, []);

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
