import { PRODUCTS, getProduct, type Product } from "./products";

const PX = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;

/* ---------- Runway slideshow (distinct editorial/runway images) ---------- */
export const RUNWAY_SLIDES = [
  { id: "rw-1", img: PX(14801145), label: "Gold Sequin Eveningwear" },
  { id: "rw-2", img: PX(19837894), label: "Statement Red" },
  { id: "rw-3", img: PX(15322315), label: "Modern Check" },
  { id: "rw-4", img: PX(15662459), label: "Silver Fringe" },
  { id: "rw-5", img: PX(29616264), label: "Dark Tailoring" },
  { id: "rw-6", img: PX(11188303), label: "Backlit Blue" },
  { id: "rw-7", img: PX(15491377), label: "Feathered Gown" },
  { id: "rw-8", img: PX(16234533), label: "Urban Crop" },
  { id: "rw-9", img: PX(14604107), label: "Embellished Gown" },
  { id: "rw-10", img: PX(18339352), label: "White Cloak" },
];

/* ---------- Behind the scenes (YouTube-linked) ---------- */
export const BTS_CLIPS = [
  { title: "Runway Prep", image: PX(15322315), youtube: "https://www.youtube.com/watch?v=oV74Najm6Nc" },
  { title: "Backstage", image: PX(29616264), youtube: "https://www.youtube.com/watch?v=B3z3z3Z9bZc" },
  { title: "Designer Interviews", image: PX(14801145), youtube: "https://www.youtube.com/watch?v=2N0TB3qq5gE" },
  { title: "Model Casting", image: PX(15662459), youtube: "https://www.youtube.com/watch?v=hN1S2H2nDss" },
  { title: "Style Decisions", image: PX(16234533), youtube: "https://www.youtube.com/watch?v=YqeW9_5kURI" },
  { title: "Fitting Sessions", image: PX(15491377), youtube: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
  { title: "Makeup & Hair", image: PX(11188303), youtube: "https://www.youtube.com/watch?v=oHg5SJYRHA0" },
  { title: "Final Rehearsal", image: PX(18339352), youtube: "https://www.youtube.com/watch?v=ScMzIvxBSi4" },
];

export const YT_HOME = "https://www.youtube.com";

export const SHOWROOM_STATS = [
  { value: "12+", label: "Brands" },
  { value: "45+", label: "Models" },
  { value: "8", label: "Events Yearly" },
  { value: "500+", label: "Attendees / Show" },
];

export type FashionEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  location: string;
  details: string;
  features: string[];
  dressCode?: string;
  tickets: { type: string; price: number | null }[];
  cta: string;
};

export const EVENTS: FashionEvent[] = [
  { id: "summer-launch", date: "2026-03-20", time: "7:00 PM", title: "Summer Collection 2026 Launch", location: "Fashion Showroom, 3rd Floor", details: "VIP Preview: 6:00 PM · Doors Open: 6:30 PM", features: ["15 Top Designers", "Champagne Bar", "Live DJ"], dressCode: "Smart Casual", tickets: [{ type: "VIP", price: 5000 }, { type: "General", price: 2500 }], cta: "Book Now" },
  { id: "masterclass", date: "2026-03-25", time: "10:00 AM", title: 'Fashion Masterclass: "Style Your Wardrobe"', location: "Fashion Showroom, 3rd Floor", details: "Led by Celebrity Stylist Maria K. · Includes styling kit", features: ["Hands-on Session", "Styling Kit Included"], tickets: [{ type: "Standard", price: 1500 }], cta: "Book Now" },
  { id: "fw-preview", date: "2026-04-05", time: "6:00 PM", title: "Fall/Winter Collection Preview", location: "Fashion Showroom, 3rd Floor", details: "An exclusive first look at the FW26 line.", features: ["Live Music", "Canapés", "Designer Meet & Greet"], dressCode: "Cocktail", tickets: [{ type: "By Invitation", price: null }], cta: "Request Invitation" },
];

/* ---------- Designers (each assigned 6 products per category via designerId) ---------- */
export type Designer = {
  id: string;
  name: string;
  specialty: string;
  location: string;
  image: string;
  spotlightTitle: string;
  spotlightText: string;
};

export const DESIGNERS: Designer[] = [
  {
    id: "amina", name: "Amina Designs", specialty: "Kitenge Couture & Resort", location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863797948-pasted-1782863794772.png",
    spotlightTitle: "Amina Designs: Blending Tradition with Modernity",
    spotlightText: "Amina Mohamed fuses heritage Ankara and kitenge craft with contemporary silhouettes, leading our Resort 2026 line with vibrant, coast-ready pieces for the whole family.",
  },
  {
    id: "kamau", name: "Kamau Studio", specialty: "Modern Tailoring & Summer", location: "Nairobi",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863651902-pasted-1782863648177.png",
    spotlightTitle: "Kamau Studio: The Art of Effortless Tailoring",
    spotlightText: "Known for clean lines and breathable fabrics, Kamau Studio defines our Summer 2026 essentials — relaxed tailoring that moves from boardroom to beach.",
  },
  {
    id: "fatma", name: "Fatma Collective", specialty: "Luxe Evening & Outerwear", location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863924527-pasted-1782863922363.png",
    spotlightTitle: "Fatma Collective: Drama After Dark",
    spotlightText: "Fatma Collective brings structured outerwear and statement evening looks to our Fall/Winter 2026 collection — rich textures, bold confidence.",
  },
  {
    id: "omar", name: "Omar Fashion", specialty: "Street Style & Denim", location: "Mombasa",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782862623421-pasted-1782862527863.png",
    spotlightTitle: "Omar Fashion: Streetwear with Soul",
    spotlightText: "Omar's edit champions everyday street style — denim, graphic tees and easy layering that keeps Mombasa's youth looking sharp season-round.",
  },
];

export function designerProducts(designerId: string, catalog: Product[] = PRODUCTS) {
  return catalog.filter((p) => p.designerId === designerId);
}

/* ---------- Stylists & services ---------- */
export const STYLISTS = [
  { id: "mariam", name: "Mariam K.", experience: "10 years", specialty: "Women's Fashion", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782862626064-pasted-1782862570187.png" },
  { id: "james", name: "James M.", experience: "8 years", specialty: "Men's Fashion", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782862627576-pasted-1782862620397.png" },
  { id: "sarah", name: "Sarah W.", experience: "6 years", specialty: "Accessories", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782862624713-pasted-1782862542049.png" },
  { id: "david", name: "David O.", experience: "5 years", specialty: "Formal Wear", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863159706-pasted-1782863156959.png" },
];

export const STYLING_SERVICES = [
  { name: "Wardrobe Styling", price: 2500, unit: "1-hr consultation" },
  { name: "Personal Shopping", price: 1500, unit: "1-hr guided" },
  { name: "Style Analysis", price: 1000, unit: "30-min assessment" },
  { name: "Shopping Assistant", price: 800, unit: "per hour" },
];

export const WORKSHOPS = [
  { id: "w1", title: "The Art of Kitenge Styling", date: "2026-03-15", time: "10AM – 12PM", instructor: "Mariam K.", price: 1500 },
  { id: "w2", title: "Sartorial Elegance for Men", date: "2026-03-22", time: "2PM – 4PM", instructor: "James M.", price: 1500 },
  { id: "w3", title: "Accessorizing Like a Pro", date: "2026-03-29", time: "11AM – 1PM", instructor: "Sarah W.", price: 1500 },
];

/* ---------- Community & blog ---------- */
export const COMMUNITY_POSTS = [
  { id: "p1", user: "Jane M.", avatar: PX(20453359), content: "Loved the Summer Collection! Can't wait for the next show!", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863387107-images.jpg", likes: 45, comments: 12 },
  { id: "p2", user: "David O.", avatar: PX(27897903), content: "Styling tips from today's workshop — learned so much!", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863524308-pasted-1782863521924.png", likes: 32, comments: 8 },
  { id: "p3", user: "Fatma K.", avatar: PX(3209624), content: "Proud to showcase my Kitenge designs at the showroom!", image: PX(36990983), likes: 67, comments: 23 },
];

export const BLOG_POSTS = [
  { id: "b1", title: "Summer Trends 2026: What's Hot in Mombasa", excerpt: "Our fashion director shares the must-have pieces of the season.", date: "March 1, 2026", readTime: "5 min", image: PX(8675179) },
  { id: "b2", title: "How to Style Kitenge: A Modern Guide", excerpt: "Celebrating African fashion with a contemporary twist.", date: "Feb 25, 2026", readTime: "4 min", image: PX(36990983) },
  { id: "b3", title: "Q&A with Our Featured Designer", excerpt: "Behind the vision of Amina Designs.", date: "Feb 20, 2026", readTime: "6 min", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782863797948-pasted-1782863794772.png" },
];



/* ---------- Lookbook outfits: 8 men + 8 women ---------- */
export type Outfit = {
  id: string;
  name: string;
  vibe: string;
  gender: "Men" | "Women";
  productIds: string[];
};

export const OUTFITS: Outfit[] = [
  // MEN (8)
  { id: "m1", name: "The Executive", vibe: "Boardroom Power", gender: "Men", productIds: ["mens-fashion-5", "mens-fashion-16", "footwear-12"] },
  { id: "m2", name: "Summer Ease", vibe: "Coastal Casual", gender: "Men", productIds: ["mens-fashion-1", "mens-fashion-7", "footwear-1"] },
  { id: "m3", name: "Smart Layers", vibe: "Office to Drinks", gender: "Men", productIds: ["mens-fashion-9", "mens-fashion-3", "footwear-14"] },
  { id: "m4", name: "Denim Edit", vibe: "Weekend Cool", gender: "Men", productIds: ["mens-fashion-10", "mens-fashion-4", "footwear-20"] },
  { id: "m5", name: "Winter Warmth", vibe: "Cold Weather Layering", gender: "Men", productIds: ["mens-fashion-11", "mens-fashion-12", "footwear-9"] },
  { id: "m6", name: "Resort Ready", vibe: "Vacation Mode", gender: "Men", productIds: ["mens-fashion-18", "mens-fashion-19", "footwear-6"] },
  { id: "m7", name: "Heritage Pride", vibe: "Traditional Elegance", gender: "Men", productIds: ["mens-fashion-17", "mens-fashion-20", "footwear-17"] },
  { id: "m8", name: "Weekend Polo", vibe: "Relaxed Smart", gender: "Men", productIds: ["mens-fashion-2", "mens-fashion-3", "footwear-24"] },
  // WOMEN (8)
  { id: "w1", name: "Coastal Elegance", vibe: "Breezy & Bright", gender: "Women", productIds: ["womens-fashion-1", "womens-fashion-19", "footwear-2"] },
  { id: "w2", name: "Sundress Day", vibe: "Effortless Summer", gender: "Women", productIds: ["womens-fashion-2", "womens-fashion-20", "footwear-3"] },
  { id: "w3", name: "Office Power", vibe: "Boss Mode", gender: "Women", productIds: ["womens-fashion-9", "womens-fashion-12", "footwear-16"] },
  { id: "w4", name: "Ankara Statement", vibe: "Heritage Glam", gender: "Women", productIds: ["womens-fashion-17", "womens-fashion-21", "footwear-18"] },
  { id: "w5", name: "Cozy Layers", vibe: "Autumn Warmth", gender: "Women", productIds: ["womens-fashion-11", "womens-fashion-10", "footwear-10"] },
  { id: "w6", name: "Resort Glow", vibe: "Beach Club", gender: "Women", productIds: ["womens-fashion-18", "womens-fashion-22", "footwear-21"] },
  { id: "w7", name: "Evening Glamour", vibe: "Red Carpet", gender: "Women", productIds: ["womens-fashion-24", "womens-fashion-21", "footwear-22"] },
  { id: "w8", name: "Casual Chic", vibe: "Day Out", gender: "Women", productIds: ["womens-fashion-3", "womens-fashion-7", "footwear-5"] },
];

export function outfitProducts(o: Outfit, catalog: Product[] = PRODUCTS) {
  return o.productIds.map((id) => getProduct(id, catalog)).filter(Boolean) as Product[];
}

export function outfitTotal(o: Outfit, catalog: Product[] = PRODUCTS) {
  return outfitProducts(o, catalog).reduce((s, p) => s + p.price, 0);
}

/* outfit hero image = first product's image */
export function outfitImage(o: Outfit, catalog: Product[] = PRODUCTS) {
  const first = outfitProducts(o, catalog)[0];
  return first ? first.image : "";
}

export const SECTIONS = [
  { id: "collections", label: "Collections" },
  { id: "runway", label: "Runway" },
  { id: "events", label: "Events" },
  { id: "designers", label: "Designers" },
  { id: "lookbook", label: "Lookbook" },
  { id: "stylists", label: "Stylists" },
  { id: "workshops", label: "Workshops" },
  { id: "community", label: "Community" },
  { id: "journal", label: "Journal" },
];
