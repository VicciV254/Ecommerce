import { StoreProvider } from "./store/StoreContext";
import { useRoute, parseRoute } from "./router";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { Shop } from "./pages/Shop";
import { ProductDetail } from "./pages/ProductDetail";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { About } from "./pages/About";
import { Contact } from "./pages/Contact";
import { Wishlist } from "./pages/Wishlist";
import { Admin } from "./pages/Admin";
import { TrackOrder } from "./pages/TrackOrder";

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
    case "admin":
      return <Admin />;
    default:
      page = <Home />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main key={route} className="flex-1 animate-fade-in">
        {page}
      </main>
      {!isAdmin && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
