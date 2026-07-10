import { useState } from "react";
import { Link } from "../router";
import { Container } from "./ui";
import { useStore } from "../store/StoreContext";
import { subscriptionsAPI } from "../api/subscriptions";
import toast from "react-hot-toast";

export function Footer() {
  const { allCategories } = useStore();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      await subscriptionsAPI.subscribe({ email });
      setDone(true);
      setEmail("");
      toast.success("Successfully subscribed!");
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to subscribe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <footer className="mt-20 bg-brand-primary text-white">
      {/* Newsletter */}
      <div className="border-b border-white/10">
        <Container className="flex flex-col items-center justify-between gap-5 py-10 md:flex-row">
          <div className="text-center md:text-left">
            <h4 className="font-display text-lg tracking-wider">Stay Updated</h4>
            <p className="mt-0.5 text-xs text-gray-400">Subscribe for exclusive offers and new arrivals</p>
          </div>
          {done ? (
            <p className="text-xs font-semibold text-brand-secondary">✓ Thank you for subscribing!</p>
          ) : (
            <form
              onSubmit={handleSubscribe}
              className="flex w-full max-w-md"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                disabled={loading}
                className="w-full rounded-l-sm bg-white/10 px-4 py-3 text-xs text-white placeholder-gray-400 outline-none transition-colors focus:bg-white/15 disabled:opacity-50"
              />
              <button 
                type="submit"
                disabled={loading}
                className="rounded-r-sm bg-brand-secondary px-6 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary transition-colors hover:bg-white disabled:opacity-50"
              >
                {loading ? "Subscribing..." : "Subscribe"}
              </button>
            </form>
          )}
        </Container>
      </div>

      <Container className="py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary">Quick Links</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              <li><Link to="/shop" className="transition-colors hover:text-white">Shop All</Link></li>
              <li><Link to="/about" className="transition-colors hover:text-white">About Us</Link></li>
              <li><Link to="/contact" className="transition-colors hover:text-white">Contact</Link></li>
              <li><Link to="/wishlist" className="transition-colors hover:text-white">Wishlist</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary">Categories</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              {allCategories.slice(0, 6).map((c) => (
                <li key={c.slug}>
                  <Link to={`/shop?cat=${c.slug}`} className="transition-colors hover:text-white">{c.name}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary">Customer Service</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              <li><a href="#/contact" className="transition-colors hover:text-white">Delivery Info</a></li>
              <li><a href="#/contact" className="transition-colors hover:text-white">Returns</a></li>
              <li><a href="#/contact" className="transition-colors hover:text-white">FAQ</a></li>
              <li><Link to="/track" className="transition-colors hover:text-white">Track Order</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary">Contact</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              <li>+254 720 784379</li>
              <li>info@nomanenobazaar.com</li>
              <li>Digo Road, Mombasa CBD</li>
              <li>Mon–Sat: 9AM – 6:30PM</li>
              <li>Sunday: 10AM – 5PM</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 md:flex-row">
          <Link to="/" className="flex items-center gap-2">
            <div className="rounded-sm bg-white p-1.5">
              <img src="/images/logo.png" alt="No Maneno Bazaar" className="h-8 w-auto" />
            </div>
          </Link>
          <div className="text-center">
            <p className="text-[10px] tracking-wider text-gray-500">
              © 2026 No Maneno Bazaar. All rights reserved. &nbsp;·&nbsp; Privacy Policy &nbsp;·&nbsp; Terms
            </p>
            <Link to="/admin" className="mt-1 inline-block text-[9px] tracking-wider text-gray-600 transition-colors hover:text-brand-secondary">
              Staff Portal
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
