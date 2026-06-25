export type Product = {
  id: string;
  name: string;
  price: number;
  comparePrice?: number;
  category: string;
  categorySlug: string;
  sizes?: string[];
  colors?: string[];
  stock: number;
  maxStock: number;
  rating: number;
  reviews: number;
  image: string;
  bestSeller?: boolean;
  description: string;
  discountPercent?: number;
};

export type Category = {
  name: string;
  slug: string;
  image: string;
};

export const CATEGORIES: Category[] = [
  { name: "Men's Fashion", slug: "mens-fashion", image: "https://plus.unsplash.com/premium_photo-1683140431958-31505d0fd1ff?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTN8fGJsYWNrJTIwbWFuJTIwaW4lMjBmYXNoaW9ufGVufDB8fDB8fHww" },
  { name: "Women's Fashion", slug: "womens-fashion", image: "https://images.unsplash.com/photo-1709810529099-0ce6102692df?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTB8fGJsYWNrJTIwd29tYW4lMjBpbiUyMGZhc2hpb258ZW58MHx8MHx8fDA%3D" },
  { name: "Children's Wear", slug: "childrens-wear", image: "https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Baby & Nursery", slug: "baby-nursery", image: "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Home & Kitchen", slug: "home-kitchen", image: "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Home Decor", slug: "home-decor", image: "https://images.pexels.com/photos/20557234/pexels-photo-20557234.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Electronics", slug: "electronics", image: "https://images.pexels.com/photos/7989741/pexels-photo-7989741.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "School & Office", slug: "school-office", image: "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Footwear", slug: "footwear", image: "https://images.pexels.com/photos/10259873/pexels-photo-10259873.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Outdoor & Leisure", slug: "outdoor-leisure", image: "https://images.pexels.com/photos/20728294/pexels-photo-20728294.jpeg?auto=compress&cs=tinysrgb&w=600" },
];

export const HERO_IMAGES = [
  "https://images.pexels.com/photos/35856106/pexels-photo-35856106.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=1200",
];

/* ---------- Image pools per category ---------- */
const IMG = {
  mens: [
    "https://images.pexels.com/photos/3214788/pexels-photo-3214788.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.unsplash.com/photo-1656453260440-ae7817f559fd?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTJ8fGNsYXNzaWMlMjBuYXZ5JTIwbWVucyUyMGJsYXplcnxlbnwwfHwwfHx8MA%3D%3D",
    "https://images.unsplash.com/photo-1614804478838-bc9c9ad99e64?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTJ8fGNhc3VhbCUyMHNsaW0lMjBmaXQlMjBqZWFucyUyMGZvciUyMGJsYWNrJTIwbWFufGVufDB8fDB8fHww",
    "https://plus.unsplash.com/premium_photo-1770306558686-d263b078357d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dHJhZGl0aW9uYWwlMjB3aGl0ZSUyMGthbnp1fGVufDB8fDB8fHww",
    "https://plus.unsplash.com/premium_photo-1760574614955-967cfc425166?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NXx8bGVhdGhlciUyMGJyb3duJTIwYmVsdHxlbnwwfHwwfHx8MA%3D%3D",
    "https://images.unsplash.com/photo-1720514496161-914011a9ee02?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Y290dG9uJTIwcG9sbyUyMHNoaXJ0fGVufDB8fDB8fHww",
    "https://images.unsplash.com/photo-1493357335960-4583bfa6f8d9?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTB8fGZvcm1hbCUyMGdyZXksJTIwbWVucyUyMHRyb3VzZXJzfGVufDB8fDB8fHww",
    "https://images.unsplash.com/photo-1614693348454-1e0710d21c60?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8ZGVuaW0lMjBqYWNrZXQlMjBtZW58ZW58MHx8MHx8fDA%3D",
    "https://images.pexels.com/photos/19915581/pexels-photo-19915581.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.unsplash.com/photo-1639428288690-90d2afbcddee?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8d292ZW4lMjBtZW5zJTIwdGllJTIwc2V0fGVufDB8fDB8fHww",
  ],
  womens: [
    "https://images.pexels.com/photos/8675179/pexels-photo-8675179.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/36990983/pexels-photo-36990983.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/3209624/pexels-photo-3209624.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9475959/pexels-photo-9475959.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/8281773/pexels-photo-8281773.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/6071513/pexels-photo-6071513.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/18533667/pexels-photo-18533667.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/13055401/pexels-photo-13055401.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20164322/pexels-photo-20164322.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20453359/pexels-photo-20453359.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  kids: [
    "https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/21967197/pexels-photo-21967197.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/5693889/pexels-photo-5693889.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/37305530/pexels-photo-37305530.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9521668/pexels-photo-9521668.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/8435759/pexels-photo-8435759.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/15304383/pexels-photo-15304383.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/13526559/pexels-photo-13526559.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9322333/pexels-photo-9322333.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/37242420/pexels-photo-37242420.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  baby: [
    "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/32299511/pexels-photo-32299511.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/15427723/pexels-photo-15427723.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/34618519/pexels-photo-34618519.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/8125846/pexels-photo-8125846.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/21642995/pexels-photo-21642995.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20387931/pexels-photo-20387931.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/38008350/pexels-photo-38008350.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/35926637/pexels-photo-35926637.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9534281/pexels-photo-9534281.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  kitchen: [
    "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/35828604/pexels-photo-35828604.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/6246099/pexels-photo-6246099.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27569266/pexels-photo-27569266.png?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/16927367/pexels-photo-16927367.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/31557569/pexels-photo-31557569.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/16927363/pexels-photo-16927363.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/13969207/pexels-photo-13969207.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/14207018/pexels-photo-14207018.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/13969211/pexels-photo-13969211.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  decor: [
    "https://images.pexels.com/photos/20557234/pexels-photo-20557234.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/5793641/pexels-photo-5793641.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/32631105/pexels-photo-32631105.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/18375891/pexels-photo-18375891.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/33316045/pexels-photo-33316045.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/11112732/pexels-photo-11112732.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/16805301/pexels-photo-16805301.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27556611/pexels-photo-27556611.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/37936133/pexels-photo-37936133.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/23116038/pexels-photo-23116038.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  electronics: [
    "https://images.pexels.com/photos/7989741/pexels-photo-7989741.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/3394650/pexels-photo-3394650.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/4765366/pexels-photo-4765366.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/4526407/pexels-photo-4526407.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/11120516/pexels-photo-11120516.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/8346916/pexels-photo-8346916.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/18311092/pexels-photo-18311092.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/17984647/pexels-photo-17984647.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/36680544/pexels-photo-36680544.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20321375/pexels-photo-20321375.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  school: [
    "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/29765813/pexels-photo-29765813.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/13583359/pexels-photo-13583359.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/37793421/pexels-photo-37793421.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/29765799/pexels-photo-29765799.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/14759603/pexels-photo-14759603.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/29765807/pexels-photo-29765807.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20140155/pexels-photo-20140155.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/29765795/pexels-photo-29765795.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/29765797/pexels-photo-29765797.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  footwear: [
    "https://images.pexels.com/photos/10259873/pexels-photo-10259873.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27113470/pexels-photo-27113470.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/37305530/pexels-photo-37305530.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27988923/pexels-photo-27988923.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27256470/pexels-photo-27256470.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/4161710/pexels-photo-4161710.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27875070/pexels-photo-27875070.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27988921/pexels-photo-27988921.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/8313383/pexels-photo-8313383.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/27100548/pexels-photo-27100548.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
  outdoor: [
    "https://images.pexels.com/photos/20728294/pexels-photo-20728294.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20728218/pexels-photo-20728218.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/4061694/pexels-photo-4061694.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9558021/pexels-photo-9558021.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/32100113/pexels-photo-32100113.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/17098879/pexels-photo-17098879.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/16778082/pexels-photo-16778082.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/9078472/pexels-photo-9078472.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/28810901/pexels-photo-28810901.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/20811927/pexels-photo-20811927.jpeg?auto=compress&cs=tinysrgb&w=600",
  ],
};

const POOL_MAP: Record<string, string[]> = {
  "mens-fashion": IMG.mens,
  "womens-fashion": IMG.womens,
  "childrens-wear": IMG.kids,
  "baby-nursery": IMG.baby,
  "home-kitchen": IMG.kitchen,
  "home-decor": IMG.decor,
  electronics: IMG.electronics,
  "school-office": IMG.school,
  footwear: IMG.footwear,
  "outdoor-leisure": IMG.outdoor,
};

type Raw = {
  name: string;
  price: number;
  sizes?: string[];
  colors?: string[];
  stock: number;
};

function build(catName: string, catSlug: string, items: Raw[]): Product[] {
  const pool = POOL_MAP[catSlug] ?? IMG.mens;
  return items.map((it, i) => {
    const compare = Math.round((it.price * (1.15 + (i % 3) * 0.1)) / 100) * 100;
    const rating = 3.5 + ((i * 7) % 15) / 10;
    return {
      id: `${catSlug}-${i + 1}`,
      name: it.name,
      price: it.price,
      comparePrice: i % 2 === 0 ? compare : undefined,
      category: catName,
      categorySlug: catSlug,
      sizes: it.sizes,
      colors: it.colors,
      stock: it.stock,
      maxStock: 100,
      rating: Math.min(5, Math.round(rating * 10) / 10),
      reviews: 12 + ((i * 13) % 90),
      image: pool[i % pool.length],
      bestSeller: i < 2,
      description:
        "Quality you can trust from No Maneno Bazaar. Carefully selected to give you the best value for your money — IKO KITU!",
    };
  });
}

const mens = build("Men's Fashion", "mens-fashion", [
  { name: "Premium White Formal Shirt", price: 2500, sizes: ["S", "M", "L", "XL"], colors: ["White", "Blue", "Black"], stock: 87 },
  { name: "Classic Navy Blazer", price: 4500, sizes: ["M", "L", "XL"], colors: ["Navy"], stock: 80 },
  { name: "Casual Slim Fit Jeans", price: 3000, sizes: ["30", "32", "34", "36"], colors: ["Blue", "Black"], stock: 120 },
  { name: "Traditional Kanzu - White", price: 3500, sizes: ["M", "L", "XL", "XXL"], colors: ["White", "Cream"], stock: 60 },
  { name: "Leather Belt - Brown", price: 1500, sizes: ["S", "M", "L"], colors: ["Brown", "Black"], stock: 200 },
  { name: "Cotton Polo Shirt", price: 2200, sizes: ["S", "M", "L", "XL"], colors: ["Red", "Blue", "Green", "Black"], stock: 90 },
  { name: "Formal Trousers - Grey", price: 2800, sizes: ["30", "32", "34", "36", "38"], colors: ["Grey", "Black", "Navy"], stock: 75 },
  { name: "Denim Jacket", price: 4000, sizes: ["M", "L", "XL"], colors: ["Blue", "Black"], stock: 50 },
  { name: "Slim Fit Chinos", price: 2600, sizes: ["30", "32", "34"], colors: ["Khaki", "Navy", "Olive"], stock: 85 },
  { name: "Woven Tie Set", price: 1800, sizes: ["One Size"], colors: ["Various"], stock: 150 },
]);

const women = build("Women's Fashion", "womens-fashion", [
  { name: "Floral Maxi Dress", price: 3800, sizes: ["S", "M", "L", "XL"], colors: ["Pink", "Blue", "Yellow"], stock: 70 },
  { name: "Kitenge Dress - Ankara", price: 4200, sizes: ["S", "M", "L", "XL"], colors: ["Multi-color"], stock: 45 },
  { name: "White Blouse - Lace Detail", price: 2800, sizes: ["S", "M", "L"], colors: ["White", "Cream"], stock: 65 },
  { name: "High Waist Pencil Skirt", price: 2300, sizes: ["S", "M", "L", "XL"], colors: ["Black", "Navy", "Grey"], stock: 80 },
  { name: "Ankara Handbag", price: 3500, sizes: ["One Size"], colors: ["Multi-color"], stock: 40 },
  { name: "Gold Plated Necklace Set", price: 2200, sizes: ["One Size"], colors: ["Gold"], stock: 100 },
  { name: "Leso - Traditional Wrap", price: 1200, sizes: ["One Size"], colors: ["Multi-color"], stock: 200 },
  { name: "Blazer - Women's", price: 4800, sizes: ["S", "M", "L", "XL"], colors: ["Black", "Grey", "Navy"], stock: 55 },
  { name: "Jumpsuit - Casual", price: 3600, sizes: ["S", "M", "L"], colors: ["Black", "Olive", "Navy"], stock: 60 },
  { name: "Scarf - Silk Blend", price: 1800, sizes: ["One Size"], colors: ["Various"], stock: 130 },
]);

const kids = build("Children's Wear", "childrens-wear", [
  { name: "Baby Romper - 0-6 Months", price: 1200, sizes: ["0-3m", "3-6m"], colors: ["Pink", "Blue", "Yellow"], stock: 150 },
  { name: "Toddler T-Shirt Set", price: 1800, sizes: ["2T", "3T", "4T"], colors: ["Various"], stock: 100 },
  { name: "School Uniform - White Shirt", price: 900, sizes: ["S", "M", "L", "XL"], colors: ["White"], stock: 200 },
  { name: "Kids' Sneakers", price: 2200, sizes: ["1", "2", "3", "4", "5"], colors: ["White", "Blue", "Pink"], stock: 3 },
  { name: "Baby Cotton Onesie", price: 800, sizes: ["0-3m", "3-6m", "6-9m"], colors: ["White", "Pastel"], stock: 180 },
  { name: "Kids' Winter Jacket", price: 3200, sizes: ["4T", "5T", "6T", "7T"], colors: ["Red", "Blue", "Grey"], stock: 60 },
  { name: "Children's Swimwear", price: 1500, sizes: ["2-4", "4-6", "6-8"], colors: ["Various"], stock: 90 },
  { name: "Kids' Party Dress", price: 2000, sizes: ["2T", "3T", "4T", "5T"], colors: ["Pink", "Purple", "Red"], stock: 70 },
  { name: "School Bag - Junior", price: 1600, sizes: ["One Size"], colors: ["Blue", "Pink", "Red"], stock: 120 },
  { name: "Baby Socks Set (5 Pack)", price: 500, sizes: ["0-6m", "6-12m"], colors: ["White", "Pastel"], stock: 250 },
]);

const baby = build("Baby & Nursery", "baby-nursery", [
  { name: "Wooden Baby Cot - White", price: 18500, stock: 5 },
  { name: "Baby Walker - Activity", price: 6500, colors: ["Blue", "Pink", "Green"], stock: 45 },
  { name: "Feeding Chair - Adjustable", price: 8500, colors: ["White", "Grey"], stock: 35 },
  { name: "Baby Stroller - Compact", price: 12000, colors: ["Black", "Navy"], stock: 25 },
  { name: "Educational Toys Set", price: 3200, stock: 60 },
  { name: "Baby Play Mat", price: 4500, colors: ["Multi-color"], stock: 50 },
  { name: "Baby Bouncer", price: 5500, colors: ["Blue", "Pink"], stock: 40 },
  { name: "Nursery Bedding Set", price: 3800, colors: ["Pastel", "Multi-color"], stock: 55 },
  { name: "Baby Bath Tub", price: 2800, colors: ["Blue", "Pink", "White"], stock: 70 },
  { name: "Baby Monitor", price: 6800, stock: 30 },
]);

const homeKitchen = build("Home & Kitchen", "home-kitchen", [
  { name: "Stainless Steel Cookware Set", price: 15000, stock: 40 },
  { name: "Kitchen Knife Set - 5 Pieces", price: 4500, stock: 60 },
  { name: "Dinner Set - 12 Pieces", price: 6500, colors: ["White", "Blue", "Gold"], stock: 50 },
  { name: "Glassware Set - 6 Pieces", price: 3200, stock: 70 },
  { name: "Kitchen Scale - Digital", price: 2800, colors: ["White", "Black"], stock: 80 },
  { name: "Non-Stick Frying Pan", price: 3500, sizes: ["10in", "12in"], stock: 90 },
  { name: "Cutlery Set - 24 Pieces", price: 4000, stock: 65 },
  { name: "Cookware Utensil Set", price: 2800, stock: 85 },
  { name: "Electric Kettle", price: 3500, colors: ["White", "Silver", "Black"], stock: 55 },
  { name: "Food Storage Containers Set", price: 2200, stock: 100 },
]);

const decor = build("Home Decor", "home-decor", [
  { name: "Persian Rug - 5x7ft", price: 12000, colors: ["Red", "Blue", "Gold"], stock: 25 },
  { name: "Floor Lamp - Modern", price: 8500, colors: ["Black", "Gold", "Silver"], stock: 30 },
  { name: "Curtain Set - 2 Panels", price: 4500, colors: ["Beige", "Grey", "White"], stock: 60 },
  { name: "Wall Art - African Print", price: 3500, stock: 40 },
  { name: "Decorative Vase", price: 2500, colors: ["Gold", "Black", "White"], stock: 70 },
  { name: "Throw Pillows Set - 2", price: 2800, colors: ["Gold", "Beige", "Blue"], stock: 80 },
  { name: "Cushion Cover Set", price: 1800, colors: ["Multi-color"], stock: 90 },
  { name: "Table Runner - African Print", price: 2200, colors: ["Multi-color"], stock: 55 },
  { name: "Wall Clock - Modern", price: 3800, colors: ["Black", "Gold", "Silver"], stock: 45 },
  { name: "Photo Frame Set - 3 Pieces", price: 1500, colors: ["Black", "Gold", "Silver"], stock: 100 },
]);

const electronics = build("Electronics", "electronics", [
  { name: "Smartphone - 6.5 inch", price: 25000, colors: ["Black", "Blue", "Gold"], stock: 30 },
  { name: "Bluetooth Speaker - Portable", price: 5500, colors: ["Black", "Red", "Blue"], stock: 50 },
  { name: "Power Bank - 20000mAh", price: 3500, colors: ["Black", "White"], stock: 70 },
  { name: "Wireless Earbuds", price: 4500, colors: ["White", "Black"], stock: 60 },
  { name: "LED Desk Lamp", price: 2200, colors: ["White", "Black"], stock: 80 },
  { name: "HDMI Cable - 2m", price: 800, stock: 150 },
  { name: "USB Flash Drive - 128GB", price: 2500, colors: ["Black", "Silver", "Blue"], stock: 100 },
  { name: "Mobile Phone Stand", price: 1200, colors: ["Black", "Silver"], stock: 120 },
  { name: "Smartwatch", price: 8500, colors: ["Black", "Silver", "Gold"], stock: 40 },
  { name: "Laptop Backpack", price: 3800, colors: ["Black", "Grey", "Navy"], stock: 55 },
]);

const school = build("School & Office", "school-office", [
  { name: "Notebook Set - 5 Pack", price: 600, stock: 200 },
  { name: "School Backpack - Medium", price: 2500, colors: ["Blue", "Pink", "Red", "Black"], stock: 90 },
  { name: "Pen Set - 10 Pieces", price: 400, colors: ["Black", "Blue", "Red"], stock: 250 },
  { name: "Whiteboard - 3x2ft", price: 3500, stock: 40 },
  { name: "Desk Organizer", price: 1800, colors: ["Black", "White", "Grey"], stock: 70 },
  { name: "Pencil Case - Large", price: 900, colors: ["Various"], stock: 120 },
  { name: "Marker Set - 12 Colors", price: 700, stock: 150 },
  { name: "Stapler + Staples Set", price: 500, colors: ["Black", "Blue", "Red"], stock: 100 },
  { name: "Calculator - Scientific", price: 1500, colors: ["Black", "White"], stock: 80 },
  { name: "File Organizer - 5 Sections", price: 1200, colors: ["Black", "Blue", "Grey"], stock: 90 },
]);

const footwear = build("Footwear", "footwear", [
  { name: "Men's Leather Loafer", price: 4500, sizes: ["40", "41", "42", "43", "44"], colors: ["Black", "Brown", "Tan"], stock: 60 },
  { name: "Women's Heeled Sandal", price: 3500, sizes: ["36", "37", "38", "39", "40"], colors: ["Black", "Gold", "Silver"], stock: 50 },
  { name: "Kids' School Shoes", price: 2800, sizes: ["1", "2", "3", "4", "5"], colors: ["Black", "Brown"], stock: 80 },
  { name: "Men's Sport Sneakers", price: 5500, sizes: ["40", "41", "42", "43", "44"], colors: ["White", "Black", "Red"], stock: 45 },
  { name: "Women's Flats - Ballet", price: 2500, sizes: ["36", "37", "38", "39"], colors: ["Black", "Nude", "Pink"], stock: 70 },
  { name: "Kids' Sandals", price: 1800, sizes: ["1", "2", "3", "4"], colors: ["Blue", "Pink", "Green"], stock: 90 },
  { name: "Men's Boots - Casual", price: 6500, sizes: ["41", "42", "43", "44"], colors: ["Brown", "Black"], stock: 35 },
  { name: "Women's Wedge Sandals", price: 3200, sizes: ["36", "37", "38", "39"], colors: ["Tan", "Brown", "Black"], stock: 55 },
  { name: "Kids' Sneakers - Light-up", price: 2500, sizes: ["1", "2", "3", "4"], colors: ["Blue", "Pink"], stock: 65 },
  { name: "Men's Formal Oxford", price: 5000, sizes: ["40", "41", "42", "43"], colors: ["Black", "Brown"], stock: 50 },
]);

const outdoor = build("Outdoor & Leisure", "outdoor-leisure", [
  { name: "Mountain Bike - 26 inch", price: 15000, colors: ["Black", "Blue", "Red"], stock: 20 },
  { name: "Kids' Ride-on Car", price: 8500, colors: ["Red", "Blue", "Pink"], stock: 25 },
  { name: "Sports Football - Size 5", price: 2200, colors: ["White/Black", "White/Blue"], stock: 80 },
  { name: "Umbrella - Large", price: 1500, colors: ["Black", "Navy", "Red"], stock: 100 },
  { name: "Camping Chair - Foldable", price: 3200, colors: ["Red", "Blue", "Green"], stock: 45 },
  { name: "Roller Skates - Adjustable", price: 4200, sizes: ["S", "M", "L"], colors: ["Blue", "Pink", "Black"], stock: 40 },
  { name: "Sports Water Bottle", price: 800, colors: ["Various"], stock: 150 },
  { name: "Skipping Rope", price: 500, colors: ["Various"], stock: 200 },
  { name: "Picnic Blanket", price: 2800, colors: ["Red", "Blue", "Green"], stock: 60 },
  { name: "Sports Backpack", price: 3500, colors: ["Black", "Red", "Blue"], stock: 55 },
]);

export const PRODUCTS: Product[] = [
  ...mens, ...women, ...kids, ...baby, ...homeKitchen,
  ...decor, ...electronics, ...school, ...footwear, ...outdoor,
];

export function getProduct(id: string) {
  return PRODUCTS.find((p) => p.id === id);
}

export function stockStatus(stock: number): "in" | "low" | "out" {
  if (stock <= 0) return "out";
  if (stock <= 10) return "low";
  return "in";
}

export const COLOR_MAP: Record<string, string> = {
  White: "#ffffff", Blue: "#2563eb", Black: "#1a1a1a", Navy: "#1e293b",
  Cream: "#f5f0e1", Brown: "#8b5a2b", Red: "#dc2626", Green: "#16a34a",
  Grey: "#6b7280", Gold: "#e8a838", Silver: "#cbd5e1", Khaki: "#c3b091",
  Olive: "#6b7c3b", Pink: "#ec4899", Yellow: "#eab308", Purple: "#9333ea",
  Beige: "#f5ede3", Tan: "#d2a679", Nude: "#e3bc9a", Pastel: "#f8c8dc",
  "Multi-color": "linear-gradient(135deg,#e8a838,#e67e5a,#1a5276)",
  Various: "linear-gradient(135deg,#e8a838,#e67e5a,#1a5276)",
};
