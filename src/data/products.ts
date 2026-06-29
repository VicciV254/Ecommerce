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
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782740975705-pasted-1782740971669.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782741163654-pasted-1782741042509.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782741365306-pasted-1782741361322.png",
    "https://plus.unsplash.com/premium_photo-1770306558686-d263b078357d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dHJhZGl0aW9uYWwlMjB3aGl0ZSUyMGthbnp1fGVufDB8fDB8fHww",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782741462155-pasted-1782741458348.png",
    "https://images.unsplash.com/photo-1720514496161-914011a9ee02?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Y290dG9uJTIwcG9sbyUyMHNoaXJ0fGVufDB8fDB8fHww",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782739903590-pasted-1782739898633.png",
    "https://images.unsplash.com/photo-1614693348454-1e0710d21c60?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8ZGVuaW0lMjBqYWNrZXQlMjBtZW58ZW58MHx8MHx8fDA%3D",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782738604894-pasted-1782738591918.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782741531050-pasted-1782741521462.png",
  ],
  womens: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782743843751-pasted-1782743837615.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748463846-pasted-1782748459489.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782738944063-pasted-1782738939063.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782739162910-pasted-1782739159048.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782740039313-pasted-1782740034398.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782740735330-pasted-1782740730292.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782740822949-pasted-1782740818106.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782743934713-pasted-1782743927276.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782744140929-pasted-1782744136483.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782744203501-pasted-1782744199007.png",
  ],
  kids: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746010567-pasted-1782746003790.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745087250-pasted-1782745080367.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745184559-pasted-1782745180523.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745271226-pasted-1782745258138.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745391272-pasted-1782745385197.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745657860-pasted-1782745441557.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745659409-pasted-1782745515623.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745661097-pasted-1782745592759.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745662785-pasted-1782745653779.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782745829048-pasted-1782745824579.png",
  ],
  baby: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746238678-pasted-1782746126848.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746239516-pasted-1782746165935.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746241118-pasted-1782746192347.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746242627-pasted-1782746228333.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746459611-pasted-1782746324943.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746461205-pasted-1782746370740.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746463047-pasted-1782746400163.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746464752-pasted-1782746455448.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746666818-pasted-1782746621904.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782746667997-pasted-1782746662677.png",
  ],
  kitchen: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782747917449-pasted-1782747726790.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782747919507-pasted-1782747787890.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782747921374-pasted-1782747817757.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782747922927-pasted-1782747878428.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782747924732-pasted-1782747912534.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748306677-pasted-1782748137241.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748308639-pasted-1782748176183.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748310353-pasted-1782748224926.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748312313-pasted-1782748269505.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782748313806-pasted-1782748301354.png",
  ],
  decor: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749159535-pasted-1782749008137.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749160964-pasted-1782749040241.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749162676-pasted-1782749075151.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749163643-pasted-1782749100341.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749164943-pasted-1782749154793.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749553251-pasted-1782749361825.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749557510-pasted-1782749390442.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749558323-pasted-1782749426082.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749560248-pasted-1782749476250.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782749561007-pasted-1782749548998.png",
  ],
  electronics: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750948314-pasted-1782750918286.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750385643-pasted-1782750106021.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750384243-pasted-1782750069060.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750800552-pasted-1782750795738.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755109053-pasted-1782755096543.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750388087-pasted-1782750180024.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750389701-pasted-1782750247754.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750391337-pasted-1782750279376.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750395879-pasted-1782750329361.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782750397299-pasted-1782750376019.png",
  ],
  school: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755821771-pasted-1782755435721.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755823423-pasted-1782755476164.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755825505-pasted-1782755521107.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755831887-pasted-1782755583990.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755835477-pasted-1782755610724.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755837521-pasted-1782755649473.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755839796-pasted-1782755699156.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755845902-pasted-1782755741019.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755847666-pasted-1782755772402.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782755849864-pasted-1782755815294.png",
  ],
  footwear: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756834191-pasted-1782756391183.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756835375-pasted-1782756500804.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756836516-pasted-1782756587693.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756837542-pasted-1782756627517.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756838772-pasted-1782756657520.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756840711-pasted-1782756691846.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756842540-pasted-1782756728131.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756843661-pasted-1782756779634.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756845474-pasted-1782756823764.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782756881408-pasted-1782756877267.png",
  ],
  outdoor: [
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757759507-pasted-1782757268190.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757761395-pasted-1782757301510.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757762723-pasted-1782757330831.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757766641-pasted-1782757373343.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757770285-pasted-1782757412132.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757771915-pasted-1782757449020.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757774034-pasted-1782757501852.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757775663-pasted-1782757542579.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782758721311-pasted-1782758716662.png",
    "https://my-image-host.victor-f6f.workers.dev/api/img/1782757779588-pasted-1782757750768.png",
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
