export type CollectionId = "summer-2026" | "fall-winter-2026" | "resort-2026";

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
  image: string; // card / overview pic
  main_image: string; // hero
  gallery_images: string[]; // up to 4 detail pics
  bestSeller?: boolean;
  description: string;
  discountPercent?: number;
  tags: string[];
  collection?: CollectionId;
  designerId?: string;
  custom?: boolean;
};

export type Category = {
  name: string;
  slug: string;
  image: string;
};

export const COLLECTIONS_META: { id: CollectionId; name: string; season: string; theme: string }[] = [
  { id: "summer-2026", name: "Summer 2026", season: "Summer", theme: "Coastal Brights" },
  { id: "fall-winter-2026", name: "Fall/Winter 2026", season: "Fall/Winter", theme: "Layered Warmth" },
  { id: "resort-2026", name: "Resort 2026", season: "Resort", theme: "Vacation Ready" },
];

export const CATEGORIES: Category[] = [
  { name: "Men's Fashion", slug: "mens-fashion", image: "https://plus.unsplash.com/premium_photo-1683140431958-31505d0fd1ff?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTN8fGJsYWNrJTIwbWFuJTIwaW4lMjBmYXNoaW9ufGVufDB8fDB8fHww" },
  { name: "Women's Fashion", slug: "womens-fashion", image: "https://images.unsplash.com/photo-1709810529099-0ce6102692df?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTB8fGJsYWNrJTIwd29tYW4lMjBpbiUyMGZhc2hpb258ZW58MHx8MHx8fDA%3D" },
  { name: "Footwear", slug: "footwear", image: "https://images.pexels.com/photos/10259873/pexels-photo-10259873.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Children's Wear", slug: "childrens-wear", image: "https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Baby & Nursery", slug: "baby-nursery", image: "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Home & Kitchen", slug: "home-kitchen", image: "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Home Decor", slug: "home-decor", image: "https://images.pexels.com/photos/20557234/pexels-photo-20557234.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Electronics", slug: "electronics", image: "https://images.pexels.com/photos/7989741/pexels-photo-7989741.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "School & Office", slug: "school-office", image: "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=600" },
  { name: "Outdoor & Leisure", slug: "outdoor-leisure", image: "https://images.pexels.com/photos/20728294/pexels-photo-20728294.jpeg?auto=compress&cs=tinysrgb&w=600" },
];

export const HERO_IMAGES = [
  "/images/hero-banner.jpg",
  "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=1200",
];

/* ------------------------------------------------------------------
   NAME-BASED IMAGE OVERRIDES (hosted studio product photos).
   Every product uses these images for the card, hero, and gallery.
   ------------------------------------------------------------------ */
const NAME_IMAGES: Record<string, string> = {
  // ============ MEN'S FASHION ============
  "Linen Short-Sleeve Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852150714-pasted-1782852147201.png",
  "Cotton Polo Shirt": "https://images.unsplash.com/photo-1720514496161-914011a9ee02?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Y290dG9uJTIwcG9sbyUyMHNoaXJ0fGVufDB8fDB8fHww",
  "Slim Fit Chinos": "https://my-image-host.victor-f6f.workers.dev/api/img/1782738604894-pasted-1782738591918.png",
  "Casual Slim Fit Jeans": "https://my-image-host.victor-f6f.workers.dev/api/img/1782741365306-pasted-1782741361322.png",
  "Premium White Formal Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782740975705-pasted-1782740971669.png",
  "Linen Blazer - Beige": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852244268-pasted-1782852241259.png",
  "Cotton Tailored Shorts": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852416597-pasted-1782852414008.png",
  "Graphic Print T-Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852485074-pasted-1782852482870.png",
  "Classic Navy Blazer": "https://my-image-host.victor-f6f.workers.dev/api/img/1782741163654-pasted-1782741042509.png",
  "Denim Jacket": "https://images.unsplash.com/photo-1614693348454-1e0710d21c60?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8ZGVuaW0lMjBqYWNrZXQlMjBtZW58ZW58MHx8MHx8fDA%3D",
  "Wool Overcoat": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852554520-pasted-1782852552213.png",
  "Knit Crew Sweater": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852629511-pasted-1782852626497.png",
  "Flannel Check Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852700541-pasted-1782852698290.png",
  "Corduroy Trousers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852765850-pasted-1782852763233.png",
  "Leather Biker Jacket": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852837836-pasted-1782852835609.png",
  "Formal Trousers - Grey": "https://my-image-host.victor-f6f.workers.dev/api/img/1782739903590-pasted-1782739898633.png",
  "Traditional Kanzu - White": "https://plus.unsplash.com/premium_photo-1770306558686-d263b078357d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dHJhZGl0aW9uYWwlMjB3aGl0ZSUyMGthbnp1fGVufDB8fDB8fHww",
  "Hawaiian Print Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782852908802-pasted-1782852905241.png",
  "Linen Drawstring Trousers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782853039434-pasted-1782853036929.png",
  "Leather Belt - Brown": "https://my-image-host.victor-f6f.workers.dev/api/img/1782741462155-pasted-1782741458348.png",
  "Woven Tie Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782741531050-pasted-1782741521462.png",
  "Safari Short-Sleeve Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782853126843-pasted-1782853124676.png",
  "Boat Neck Striped Tee": "https://my-image-host.victor-f6f.workers.dev/api/img/1782853310909-pasted-1782853308246.png",
  "Cotton Henley": "https://my-image-host.victor-f6f.workers.dev/api/img/1782853375957-pasted-1782853372802.png",

  // ============ WOMEN'S FASHION ============
  "Floral Maxi Dress": "https://my-image-host.victor-f6f.workers.dev/api/img/1782743843751-pasted-1782743837615.png",
  "Off-Shoulder Sundress": "https://my-image-host.victor-f6f.workers.dev/api/img/1782853995150-pasted-1782853991707.png",
  "Linen Blouse": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854052255-pasted-1782854048710.png",
  "High Waist Shorts": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854126094-pasted-1782854122845.png",
  "Wrap Mini Dress": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854238719-pasted-1782854235933.png",
  "Cotton Crop Top": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854312779-pasted-1782854309909.png",
  "Pleated Midi Skirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854388398-pasted-1782854384091.png",
  "Strappy Camisole Top": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854504447-pasted-1782854502256.png",
  "Women's Wool Blazer": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854571812-pasted-1782854569668.png",
  "Knit Turtleneck Sweater": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854681018-pasted-1782854678823.png",
  "Belted Trench Coat": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854757617-pasted-1782854753868.png",
  "High Waist Pencil Skirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782739162910-pasted-1782739159048.png",
  "Cashmere Cardigan": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854845128-pasted-1782854839898.png",
  "Wide Leg Trousers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854922389-pasted-1782854919388.png",
  "Quilted Puffer Jacket": "https://my-image-host.victor-f6f.workers.dev/api/img/1782854989445-pasted-1782854987252.png",
  "Long-Sleeve Silk Blouse": "https://my-image-host.victor-f6f.workers.dev/api/img/1782855081537-pasted-1782855078561.png",
  "Kitenge Dress - Ankara": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748463846-pasted-1782748459489.png",
  "Kaftan Beach Cover-up": "https://my-image-host.victor-f6f.workers.dev/api/img/1782855159209-pasted-1782855156768.png",
  "Silk Blend Scarf": "https://my-image-host.victor-f6f.workers.dev/api/img/1782744203501-pasted-1782744199007.png",
  "Ankara Handbag": "https://my-image-host.victor-f6f.workers.dev/api/img/1782740039313-pasted-1782740034398.png",
  "Gold Plated Necklace Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782740735330-pasted-1782740730292.png",
  "Leso - Traditional Wrap": "https://my-image-host.victor-f6f.workers.dev/api/img/1782740822949-pasted-1782740818106.png",
  "Linen Jumpsuit": "https://my-image-host.victor-f6f.workers.dev/api/img/1782744140929-pasted-1782744136483.png",
  "Beaded Halter Dress": "https://my-image-host.victor-f6f.workers.dev/api/img/1782855617177-pasted-1782855614450.png",

  // ============ CHILDREN'S WEAR ============
  "Baby Romper - 0-6 Months": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746010567-pasted-1782746003790.png",
  "Toddler T-Shirt Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745087250-pasted-1782745080367.png",
  "School Uniform - White Shirt": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745184559-pasted-1782745180523.png",
  "Kids' Sneakers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745271226-pasted-1782745258138.png",
  "Baby Cotton Onesie": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745391272-pasted-1782745385197.png",
  "Kids' Winter Jacket": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745657860-pasted-1782745441557.png",
  "Children's Swimwear": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745659409-pasted-1782745515623.png",
  "Kids' Party Dress": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745661097-pasted-1782745592759.png",
  "School Bag - Junior": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745662785-pasted-1782745653779.png",
  "Baby Socks Set (5 Pack)": "https://my-image-host.victor-f6f.workers.dev/api/img/1782745829048-pasted-1782745824579.png",
  "Kids' Pyjama Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858787784-pasted-1782858750160.png",
  "Toddler Beanie Hat": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858795834-pasted-1782858793481.png",

  // ============ BABY & NURSERY ============
  "Wooden Baby Cot - White": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746238678-pasted-1782746126848.png",
  "Baby Walker - Activity": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746239516-pasted-1782746165935.png",
  "Feeding Chair - Adjustable": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746241118-pasted-1782746192347.png",
  "Baby Stroller - Compact": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746242627-pasted-1782746228333.png",
  "Educational Toys Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746459611-pasted-1782746324943.png",
  "Baby Play Mat": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746461205-pasted-1782746370740.png",
  "Baby Bouncer": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746463047-pasted-1782746400163.png",
  "Nursery Bedding Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746464752-pasted-1782746455448.png",
  "Baby Bath Tub": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746666818-pasted-1782746621904.png",
  "Baby Monitor": "https://my-image-host.victor-f6f.workers.dev/api/img/1782746667997-pasted-1782746662677.png",
  "Baby Highchair": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859034620-pasted-1782859031364.png",
  "Baby Diaper Bag": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859096182-pasted-1782859093532.png",

  // ============ HOME & KITCHEN ============
  "Stainless Steel Cookware Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782747917449-pasted-1782747726790.png",
  "Kitchen Knife Set - 5 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782747919507-pasted-1782747787890.png",
  "Dinner Set - 12 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782747921374-pasted-1782747817757.png",
  "Glassware Set - 6 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782747922927-pasted-1782747878428.png",
  "Kitchen Scale - Digital": "https://my-image-host.victor-f6f.workers.dev/api/img/1782747924732-pasted-1782747912534.png",
  "Non-Stick Frying Pan": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748306677-pasted-1782748137241.png",
  "Cutlery Set - 24 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748308639-pasted-1782748176183.png",
  "Cookware Utensil Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748310353-pasted-1782748224926.png",
  "Electric Kettle": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748312313-pasted-1782748269505.png",
  "Food Storage Containers Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782748313806-pasted-1782748301354.png",
  "Blender - 1.5L": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859179723-pasted-1782859177247.png",
  "Wooden Chopping Board Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859248629-pasted-1782859246026.png",

  // ============ HOME DECOR ============
  "Persian Rug - 5x7ft": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749159535-pasted-1782749008137.png",
  "Floor Lamp - Modern": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749160964-pasted-1782749040241.png",
  "Curtain Set - 2 Panels": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749162676-pasted-1782749075151.png",
  "Wall Art - African Print": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749163643-pasted-1782749100341.png",
  "Decorative Vase": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749164943-pasted-1782749154793.png",
  "Throw Pillows Set - 2": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749553251-pasted-1782749361825.png",
  "Cushion Cover Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749557510-pasted-1782749390442.png",
  "Table Runner - African Print": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749558323-pasted-1782749426082.png",
  "Wall Clock - Modern": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749560248-pasted-1782749476250.png",
  "Photo Frame Set - 3 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782749561007-pasted-1782749548998.png",
  "Scented Candle Set - 3 Pack": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859326493-pasted-1782859323905.png",
  "Macrame Wall Hanging": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859446858-pasted-1782859440912.png",

  // ============ ELECTRONICS ============
  "Smartphone - 6.5 inch": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750948314-pasted-1782750918286.png",
  "Bluetooth Speaker - Portable": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750385643-pasted-1782750106021.png",
  "Power Bank - 20000mAh": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750384243-pasted-1782750069060.png",
  "Wireless Earbuds": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750800552-pasted-1782750795738.png",
  "LED Desk Lamp": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755109053-pasted-1782755096543.png",
  "HDMI Cable - 2m": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750388087-pasted-1782750180024.png",
  "USB Flash Drive - 128GB": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750389701-pasted-1782750247754.png",
  "Mobile Phone Stand": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750391337-pasted-1782750279376.png",
  "Smartwatch": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750395879-pasted-1782750329361.png",
  "Laptop Backpack": "https://my-image-host.victor-f6f.workers.dev/api/img/1782750397299-pasted-1782750376019.png",
  "Wireless Mouse": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859565921-pasted-1782859563689.png",
  "Bluetooth Keyboard": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859664336-pasted-1782859660500.png",

  // ============ SCHOOL & OFFICE ============
  "Notebook Set - 5 Pack": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755821771-pasted-1782755435721.png",
  "School Backpack - Medium": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755823423-pasted-1782755476164.png",
  "Pen Set - 10 Pieces": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755825505-pasted-1782755521107.png",
  "Whiteboard - 3x2ft": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755831887-pasted-1782755583990.png",
  "Desk Organizer": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755835477-pasted-1782755610724.png",
  "Pencil Case - Large": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755837521-pasted-1782755649473.png",
  "Marker Set - 12 Colors": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755839796-pasted-1782755699156.png",
  "Stapler + Staples Set": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755845902-pasted-1782755741019.png",
  "Calculator - Scientific": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755847666-pasted-1782755772402.png",
  "File Organizer - 5 Sections": "https://my-image-host.victor-f6f.workers.dev/api/img/1782755849864-pasted-1782755815294.png",
  "Sticky Notes Pack - 8 Pads": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859781666-pasted-1782859777707.png",
  "Desk Lamp - LED Adjustable": "https://my-image-host.victor-f6f.workers.dev/api/img/1782859971953-pasted-1782859969520.png",

  // ============ FOOTWEAR ============
  "Men's Canvas Sneakers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782855812414-pasted-1782855808555.png",
  "Women's Strappy Sandal": "https://my-image-host.victor-f6f.workers.dev/api/img/1782855891302-pasted-1782855888780.png",
  "Espadrille Flats": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856009415-pasted-1782856006181.png",
  "Slide Sandals": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856075113-pasted-1782856072484.png",
  "Women's Ballet Flats": "https://my-image-host.victor-f6f.workers.dev/api/img/1782756838772-pasted-1782756657520.png",
  "Men's Boat Shoes": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856290407-pasted-1782856288057.png",
  "Flip Flops": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856389650-pasted-1782856386708.png",
  "Wedge Sandals": "https://my-image-host.victor-f6f.workers.dev/api/img/1782756843661-pasted-1782756779634.png",
  "Men's Leather Boots": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856777414-pasted-1782856774830.png",
  "Women's Ankle Boots": "https://my-image-host.victor-f6f.workers.dev/api/img/1782856851487-pasted-1782856849406.png",
  "Chelsea Boots": "https://my-image-host.victor-f6f.workers.dev/api/img/1782857049165-pasted-1782857047023.png",
  "Men's Oxford Shoes": "https://my-image-host.victor-f6f.workers.dev/api/img/1782857108685-pasted-1782857106018.png",
  "Men's Leather Loafer": "https://my-image-host.victor-f6f.workers.dev/api/img/1782756834191-pasted-1782756391183.png",
  "Women's Heeled Sandal": "https://my-image-host.victor-f6f.workers.dev/api/img/1782756835375-pasted-1782756500804.png",
  "Beaded Flat Sandals": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858025928-pasted-1782858023409.png",
  "Men's Sport Sneakers": "https://my-image-host.victor-f6f.workers.dev/api/img/1782756837542-pasted-1782756627517.png",
  "Raffia Mules": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858131176-pasted-1782858128870.png",
  "Metallic Flat Sandals": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858209221-pasted-1782858205238.png",
  "Canvas Slip-Ons": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858298325-pasted-1782858295491.png",
  "Men's Driving Moccasins": "https://my-image-host.victor-f6f.workers.dev/api/img/1782858351360-pasted-1782858347156.png",

  // ============ OUTDOOR & LEISURE ============
  "Mountain Bike - 26 inch": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757759507-pasted-1782757268190.png",
  "Kids' Ride-on Car": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757761395-pasted-1782757301510.png",
  "Sports Football - Size 5": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757762723-pasted-1782757330831.png",
  "Umbrella - Large": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757766641-pasted-1782757373343.png",
  "Camping Chair - Foldable": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757770285-pasted-1782757412132.png",
  "Roller Skates - Adjustable": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757771915-pasted-1782757449020.png",
  "Sports Water Bottle": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757774034-pasted-1782757501852.png",
  "Skipping Rope": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757775663-pasted-1782757542579.png",
  "Picnic Blanket": "https://my-image-host.victor-f6f.workers.dev/api/img/1782758721311-pasted-1782758716662.png",
  "Sports Backpack": "https://my-image-host.victor-f6f.workers.dev/api/img/1782757779588-pasted-1782757750768.png",
  "Yoga Mat - Premium": "https://my-image-host.victor-f6f.workers.dev/api/img/1782860072393-pasted-1782860069859.png",
  "Insulated Cooler Bag": "https://my-image-host.victor-f6f.workers.dev/api/img/1782860136811-pasted-1782860133811.png",
};

function describe(name: string, catName: string, tags: string[]): string {
  const tagText = tags.slice(0, 4).join(", ");
  return `${name} — a standout piece in our ${catName} range at No Maneno Bazaar. Thoughtfully selected for quality, comfort and everyday value${tagText ? ` (${tagText})` : ""}. Photographed in studio so you see exactly what you get. IKO KITU!`;
}

type Raw = {
  name: string;
  price: number;
  tags: string[];
  collection?: CollectionId;
  designerId?: string;
  sizes?: string[];
  colors?: string[];
  stock: number;
};

function build(catName: string, catSlug: string, items: Raw[]): Product[] {
  return items.map((it, i) => {
    const compare = Math.round((it.price * (1.15 + (i % 3) * 0.1)) / 100) * 100;
    const rating = 3.5 + ((i * 7) % 15) / 10;
    const img = NAME_IMAGES[it.name] || "https://via.placeholder.com/700x700?text=No+Image";
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
      image: img,
      main_image: img,
      gallery_images: [img, img, img],
      bestSeller: i < 2,
      description: describe(it.name, catName, it.tags),
      tags: it.tags,
      collection: it.collection,
      designerId: it.designerId,
    };
  });
}

/* ============================================================
   MEN'S FASHION — 24 products (8 Summer / 8 Fall / 8 Resort)
   Designers: amina, kamau, fatma, omar (6 each)
   ============================================================ */
const mens = build("Men's Fashion", "mens-fashion", [
  // Summer (0-7)
  { name: "Linen Short-Sleeve Shirt", price: 2400, tags: ["shirt", "linen", "casual", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L","XL"], colors: ["White","Blue","Beige"], stock: 90 },
  { name: "Cotton Polo Shirt", price: 2200, tags: ["shirt", "polo", "cotton", "casual"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L","XL"], colors: ["Red","Blue","Green","Black"], stock: 90 },
  { name: "Slim Fit Chinos", price: 2600, tags: ["trousers", "chinos", "pants", "casual"], collection: "summer-2026", designerId: "kamau", sizes: ["30","32","34"], colors: ["Khaki","Navy","Olive"], stock: 85 },
  { name: "Casual Slim Fit Jeans", price: 3000, tags: ["jeans", "denim", "pants", "trousers", "casual"], collection: "summer-2026", designerId: "kamau", sizes: ["30","32","34","36"], colors: ["Blue","Black"], stock: 120 },
  { name: "Premium White Formal Shirt", price: 2500, tags: ["shirt", "formal", "cotton", "office"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L","XL"], colors: ["White","Blue","Black"], stock: 87 },
  { name: "Linen Blazer - Beige", price: 4800, tags: ["blazer", "jacket", "linen", "formal", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["M","L","XL"], colors: ["Beige","White"], stock: 50 },
  { name: "Cotton Tailored Shorts", price: 1900, tags: ["shorts", "cotton", "casual", "summer"], collection: "summer-2026", designerId: "omar", sizes: ["30","32","34","36"], colors: ["Khaki","Navy","Stone"], stock: 95 },
  { name: "Graphic Print T-Shirt", price: 1500, tags: ["t-shirt", "tshirt", "shirt", "casual", "summer"], collection: "summer-2026", designerId: "omar", sizes: ["S","M","L","XL"], colors: ["White","Black","Grey"], stock: 140 },
  // Fall/Winter (8-15)
  { name: "Classic Navy Blazer", price: 4500, tags: ["blazer", "jacket", "formal", "wool", "office"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["M","L","XL"], colors: ["Navy"], stock: 80 },
  { name: "Denim Jacket", price: 4000, tags: ["jacket", "denim", "casual"], collection: "fall-winter-2026", designerId: "omar", sizes: ["M","L","XL"], colors: ["Blue","Black"], stock: 50 },
  { name: "Wool Overcoat", price: 7500, tags: ["coat", "overcoat", "jacket", "wool", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["M","L","XL"], colors: ["Charcoal","Camel","Black"], stock: 35 },
  { name: "Knit Crew Sweater", price: 3200, tags: ["sweater", "knit", "jumper", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L","XL"], colors: ["Grey","Navy","Burgundy"], stock: 70 },
  { name: "Flannel Check Shirt", price: 2700, tags: ["shirt", "flannel", "check", "casual", "winter"], collection: "fall-winter-2026", designerId: "omar", sizes: ["S","M","L","XL"], colors: ["Red","Green","Blue"], stock: 85 },
  { name: "Corduroy Trousers", price: 3100, tags: ["trousers", "corduroy", "pants", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["30","32","34","36"], colors: ["Brown","Olive","Rust"], stock: 60 },
  { name: "Leather Biker Jacket", price: 8900, tags: ["jacket", "leather", "biker", "winter"], collection: "fall-winter-2026", designerId: "omar", sizes: ["M","L","XL"], colors: ["Black","Brown"], stock: 30 },
  { name: "Formal Trousers - Grey", price: 2800, tags: ["trousers", "formal", "pants", "office"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["30","32","34","36","38"], colors: ["Grey","Black","Navy"], stock: 75 },
  // Resort (16-23)
  { name: "Traditional Kanzu - White", price: 3500, tags: ["kanzu", "robe", "traditional", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["M","L","XL","XXL"], colors: ["White","Cream"], stock: 60 },
  { name: "Hawaiian Print Shirt", price: 2300, tags: ["shirt", "hawaiian", "print", "resort", "casual"], collection: "resort-2026", designerId: "amina", sizes: ["S","M","L","XL"], colors: ["Multi-color"], stock: 80 },
  { name: "Linen Drawstring Trousers", price: 2500, tags: ["trousers", "linen", "pants", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["S","M","L","XL"], colors: ["White","Beige","Sand"], stock: 70 },
  { name: "Leather Belt - Brown", price: 1500, tags: ["belt", "leather", "accessory"], collection: "resort-2026", designerId: "amina", sizes: ["S","M","L"], colors: ["Brown","Black"], stock: 200 },
  { name: "Woven Tie Set", price: 1800, tags: ["tie", "accessory", "formal"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Various"], stock: 150 },
  { name: "Safari Short-Sleeve Shirt", price: 2600, tags: ["shirt", "safari", "resort", "casual"], collection: "resort-2026", designerId: "amina", sizes: ["S","M","L","XL"], colors: ["Khaki","Olive","Sand"], stock: 65 },
  { name: "Boat Neck Striped Tee", price: 1600, tags: ["t-shirt", "tshirt", "shirt", "stripe", "resort"], collection: "resort-2026", designerId: "omar", sizes: ["S","M","L","XL"], colors: ["Navy/White","Red/White"], stock: 100 },
  { name: "Cotton Henley", price: 1900, tags: ["henley", "shirt", "cotton", "casual", "resort"], collection: "resort-2026", designerId: "omar", sizes: ["S","M","L","XL"], colors: ["White","Grey","Navy"], stock: 90 },
]);

/* ============================================================
   WOMEN'S FASHION — 24 products
   ============================================================ */
const women = build("Women's Fashion", "womens-fashion", [
  // Summer (0-7)
  { name: "Floral Maxi Dress", price: 3800, tags: ["dress", "maxi", "floral", "summer"], collection: "summer-2026", designerId: "amina", sizes: ["S","M","L","XL"], colors: ["Pink","Blue","Yellow"], stock: 70 },
  { name: "Off-Shoulder Sundress", price: 3200, tags: ["dress", "sundress", "summer", "casual"], collection: "summer-2026", designerId: "amina", sizes: ["S","M","L"], colors: ["White","Coral","Sky"], stock: 65 },
  { name: "Linen Blouse", price: 2600, tags: ["blouse", "shirt", "linen", "top", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L","XL"], colors: ["White","Beige","Mint"], stock: 80 },
  { name: "High Waist Shorts", price: 2100, tags: ["shorts", "summer", "casual"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L"], colors: ["Denim","White","Khaki"], stock: 90 },
  { name: "Wrap Mini Dress", price: 3400, tags: ["dress", "wrap", "mini", "summer"], collection: "summer-2026", designerId: "amina", sizes: ["S","M","L"], colors: ["Red","Black","Green"], stock: 60 },
  { name: "Cotton Crop Top", price: 1400, tags: ["top", "crop", "tshirt", "casual", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L"], colors: ["White","Black","Pink"], stock: 120 },
  { name: "Pleated Midi Skirt", price: 2900, tags: ["skirt", "midi", "pleated", "summer"], collection: "summer-2026", designerId: "fatma", sizes: ["S","M","L","XL"], colors: ["Blush","Navy","Mustard"], stock: 70 },
  { name: "Strappy Camisole Top", price: 1600, tags: ["top", "camisole", "cami", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["S","M","L"], colors: ["Black","Ivory","Rose"], stock: 100 },
  // Fall/Winter (8-15)
  { name: "Women's Wool Blazer", price: 4800, tags: ["blazer", "jacket", "wool", "formal", "office"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L","XL"], colors: ["Black","Grey","Navy"], stock: 55 },
  { name: "Knit Turtleneck Sweater", price: 3000, tags: ["sweater", "turtleneck", "knit", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L","XL"], colors: ["Cream","Camel","Black"], stock: 75 },
  { name: "Belted Trench Coat", price: 6500, tags: ["coat", "trench", "jacket", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L"], colors: ["Beige","Black"], stock: 40 },
  { name: "High Waist Pencil Skirt", price: 2300, tags: ["skirt", "pencil", "formal", "office"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L","XL"], colors: ["Black","Navy","Grey"], stock: 80 },
  { name: "Cashmere Cardigan", price: 4200, tags: ["cardigan", "sweater", "cashmere", "knit", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L"], colors: ["Grey","Blush","Camel"], stock: 50 },
  { name: "Wide Leg Trousers", price: 3100, tags: ["trousers", "pants", "wide-leg", "office"], collection: "fall-winter-2026", designerId: "kamau", sizes: ["S","M","L","XL"], colors: ["Black","Taupe","Navy"], stock: 65 },
  { name: "Quilted Puffer Jacket", price: 5500, tags: ["jacket", "puffer", "quilted", "winter"], collection: "fall-winter-2026", designerId: "omar", sizes: ["S","M","L","XL"], colors: ["Black","Olive","Berry"], stock: 45 },
  { name: "Long-Sleeve Silk Blouse", price: 3300, tags: ["blouse", "shirt", "silk", "top", "office"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["S","M","L"], colors: ["Ivory","Emerald","Wine"], stock: 60 },
  // Resort (16-23)
  { name: "Kitenge Dress - Ankara", price: 4200, tags: ["dress", "kitenge", "ankara", "african", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["S","M","L","XL"], colors: ["Multi-color"], stock: 45 },
  { name: "Kaftan Beach Cover-up", price: 2400, tags: ["kaftan", "coverup", "beach", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Turquoise","Coral","White"], stock: 80 },
  { name: "Silk Blend Scarf", price: 1800, tags: ["scarf", "accessory", "silk", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Various"], stock: 130 },
  { name: "Ankara Handbag", price: 3500, tags: ["handbag", "bag", "ankara", "accessory", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Multi-color"], stock: 40 },
  { name: "Gold Plated Necklace Set", price: 2200, tags: ["necklace", "jewelry", "gold", "accessory", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Gold"], stock: 100 },
  { name: "Leso - Traditional Wrap", price: 1200, tags: ["leso", "kanga", "wrap", "traditional", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["One Size"], colors: ["Multi-color"], stock: 200 },
  { name: "Linen Jumpsuit", price: 3600, tags: ["jumpsuit", "linen", "resort", "casual"], collection: "resort-2026", designerId: "omar", sizes: ["S","M","L"], colors: ["Black","Olive","Sand"], stock: 60 },
  { name: "Beaded Halter Dress", price: 4500, tags: ["dress", "beaded", "halter", "evening", "resort"], collection: "resort-2026", designerId: "fatma", sizes: ["S","M","L"], colors: ["Gold","Black","Emerald"], stock: 40 },
]);

/* ============================================================
   FOOTWEAR — 24 products
   ============================================================ */
const footwear = build("Footwear", "footwear", [
  // Summer (0-7)
  { name: "Men's Canvas Sneakers", price: 3200, tags: ["sneakers", "shoes", "canvas", "casual", "men"], collection: "summer-2026", designerId: "kamau", sizes: ["40","41","42","43","44"], colors: ["White","Navy","Black"], stock: 70 },
  { name: "Women's Strappy Sandal", price: 2800, tags: ["sandal", "shoes", "strappy", "women", "summer"], collection: "summer-2026", designerId: "amina", sizes: ["36","37","38","39","40"], colors: ["Tan","Black","Gold"], stock: 65 },
  { name: "Espadrille Flats", price: 2400, tags: ["espadrille", "shoes", "flats", "summer"], collection: "summer-2026", designerId: "amina", sizes: ["36","37","38","39"], colors: ["Natural","Navy","Red"], stock: 80 },
  { name: "Slide Sandals", price: 1600, tags: ["sandal", "slide", "shoes", "casual", "summer"], collection: "summer-2026", designerId: "omar", sizes: ["38","40","42","44"], colors: ["Black","White","Tan"], stock: 110 },
  { name: "Women's Ballet Flats", price: 2500, tags: ["flats", "shoes", "ballet", "women"], collection: "summer-2026", designerId: "amina", sizes: ["36","37","38","39"], colors: ["Black","Nude","Pink"], stock: 70 },
  { name: "Men's Boat Shoes", price: 3600, tags: ["boat", "shoes", "loafer", "men", "summer"], collection: "summer-2026", designerId: "kamau", sizes: ["40","41","42","43","44"], colors: ["Brown","Navy"], stock: 55 },
  { name: "Flip Flops", price: 800, tags: ["flipflop", "sandal", "shoes", "casual", "summer"], collection: "summer-2026", designerId: "omar", sizes: ["38","40","42","44"], colors: ["Black","Blue","Green"], stock: 200 },
  { name: "Wedge Sandals", price: 3000, tags: ["wedge", "sandal", "shoes", "heels", "women"], collection: "summer-2026", designerId: "amina", sizes: ["36","37","38","39"], colors: ["Tan","Brown","Black"], stock: 55 },
  // Fall/Winter (8-15)
  { name: "Men's Leather Boots", price: 6500, tags: ["boots", "shoes", "leather", "men", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["41","42","43","44"], colors: ["Brown","Black"], stock: 35 },
  { name: "Women's Ankle Boots", price: 4800, tags: ["boots", "ankle", "shoes", "women", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["36","37","38","39","40"], colors: ["Black","Tan","Burgundy"], stock: 45 },
  { name: "Chelsea Boots", price: 5500, tags: ["boots", "chelsea", "shoes", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["40","41","42","43","44"], colors: ["Black","Brown"], stock: 40 },
  { name: "Men's Oxford Shoes", price: 5000, tags: ["oxford", "shoes", "formal", "leather", "men"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["40","41","42","43"], colors: ["Black","Brown"], stock: 50 },
  { name: "Women's Knee High Boots", price: 6200, tags: ["boots", "knee-high", "shoes", "women", "winter"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["36","37","38","39"], colors: ["Black","Tan"], stock: 30 },
  { name: "Suede Loafers", price: 4400, tags: ["loafer", "shoes", "suede", "men"], collection: "fall-winter-2026", designerId: "kamau", sizes: ["40","41","42","43","44"], colors: ["Grey","Navy","Tan"], stock: 50 },
  { name: "Hiking Boots", price: 5800, tags: ["boots", "hiking", "shoes", "outdoor", "winter"], collection: "fall-winter-2026", designerId: "omar", sizes: ["40","41","42","43","44"], colors: ["Brown","Black","Olive"], stock: 45 },
  { name: "Women's Block Heel Boots", price: 5200, tags: ["boots", "heels", "block-heel", "shoes", "women"], collection: "fall-winter-2026", designerId: "fatma", sizes: ["36","37","38","39"], colors: ["Black","Camel"], stock: 40 },
  // Resort (16-23)
  { name: "Men's Leather Loafer", price: 4500, tags: ["loafer", "shoes", "leather", "men", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["40","41","42","43","44"], colors: ["Black","Brown","Tan"], stock: 60 },
  { name: "Women's Heeled Sandal", price: 3500, tags: ["sandal", "heels", "shoes", "women", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["36","37","38","39","40"], colors: ["Black","Gold","Silver"], stock: 50 },
  { name: "Beaded Flat Sandals", price: 2600, tags: ["sandal", "beaded", "flats", "shoes", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["36","37","38","39"], colors: ["Gold","Multi-color"], stock: 70 },
  { name: "Men's Sport Sneakers", price: 5500, tags: ["sneakers", "sport", "shoes", "men"], collection: "resort-2026", designerId: "omar", sizes: ["40","41","42","43","44"], colors: ["White","Black","Red"], stock: 45 },
  { name: "Raffia Mules", price: 2900, tags: ["mules", "raffia", "shoes", "women", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["36","37","38","39"], colors: ["Natural","Black"], stock: 60 },
  { name: "Metallic Flat Sandals", price: 2700, tags: ["sandal", "metallic", "flats", "shoes", "resort"], collection: "resort-2026", designerId: "amina", sizes: ["36","37","38","39","40"], colors: ["Gold","Silver","Rose"], stock: 65 },
  { name: "Canvas Slip-Ons", price: 2200, tags: ["slip-on", "sneakers", "canvas", "shoes", "resort"], collection: "resort-2026", designerId: "omar", sizes: ["40","41","42","43","44"], colors: ["White","Navy","Stripe"], stock: 80 },
  { name: "Men's Driving Moccasins", price: 4100, tags: ["moccasin", "loafer", "shoes", "leather", "men", "resort"], collection: "resort-2026", designerId: "kamau", sizes: ["40","41","42","43","44"], colors: ["Tan","Navy","Brown"], stock: 50 },
]);

/* ============================================================
   OTHER CATEGORIES — 10 each (with tags)
   ============================================================ */
const kids = build("Children's Wear", "childrens-wear", [
  { name: "Baby Romper - 0-6 Months", price: 1200, tags: ["romper", "baby", "kids"], sizes: ["0-3m","3-6m"], colors: ["Pink","Blue","Yellow"], stock: 150 },
  { name: "Toddler T-Shirt Set", price: 1800, tags: ["t-shirt","tshirt","shirt","kids","set"], sizes: ["2T","3T","4T"], colors: ["Various"], stock: 100 },
  { name: "School Uniform - White Shirt", price: 900, tags: ["shirt","uniform","school","kids"], sizes: ["S","M","L","XL"], colors: ["White"], stock: 200 },
  { name: "Kids' Sneakers", price: 2200, tags: ["sneakers","shoes","kids"], sizes: ["1","2","3","4","5"], colors: ["White","Blue","Pink"], stock: 3 },
  { name: "Baby Cotton Onesie", price: 800, tags: ["onesie","baby","kids"], sizes: ["0-3m","3-6m","6-9m"], colors: ["White","Pastel"], stock: 180 },
  { name: "Kids' Winter Jacket", price: 3200, tags: ["jacket","coat","kids","winter"], sizes: ["4T","5T","6T","7T"], colors: ["Red","Blue","Grey"], stock: 60 },
  { name: "Children's Swimwear", price: 1500, tags: ["swimwear","kids","beach"], sizes: ["2-4","4-6","6-8"], colors: ["Various"], stock: 90 },
  { name: "Kids' Party Dress", price: 2000, tags: ["dress","party","kids"], sizes: ["2T","3T","4T","5T"], colors: ["Pink","Purple","Red"], stock: 70 },
  { name: "School Bag - Junior", price: 1600, tags: ["bag","backpack","school","kids"], sizes: ["One Size"], colors: ["Blue","Pink","Red"], stock: 120 },
  { name: "Baby Socks Set (5 Pack)", price: 500, tags: ["socks","baby","kids","set"], sizes: ["0-6m","6-12m"], colors: ["White","Pastel"], stock: 250 },
  { name: "Kids' Pyjama Set", price: 1400, tags: ["pyjama","sleepwear","kids","set"], sizes: ["2T","3T","4T","5T"], colors: ["Blue","Pink","Yellow"], stock: 110 },
  { name: "Toddler Beanie Hat", price: 600, tags: ["hat","beanie","kids","winter"], sizes: ["One Size"], colors: ["Red","Grey","Pink"], stock: 140 },
]);

const baby = build("Baby & Nursery", "baby-nursery", [
  { name: "Wooden Baby Cot - White", price: 18500, tags: ["cot","crib","nursery","furniture"], stock: 5 },
  { name: "Baby Walker - Activity", price: 6500, tags: ["walker","baby","activity"], colors: ["Blue","Pink","Green"], stock: 45 },
  { name: "Feeding Chair - Adjustable", price: 8500, tags: ["chair","feeding","baby","furniture"], colors: ["White","Grey"], stock: 35 },
  { name: "Baby Stroller - Compact", price: 12000, tags: ["stroller","pram","baby"], colors: ["Black","Navy"], stock: 25 },
  { name: "Educational Toys Set", price: 3200, tags: ["toys","educational","baby","set"], stock: 60 },
  { name: "Baby Play Mat", price: 4500, tags: ["mat","playmat","baby"], colors: ["Multi-color"], stock: 50 },
  { name: "Baby Bouncer", price: 5500, tags: ["bouncer","baby"], colors: ["Blue","Pink"], stock: 40 },
  { name: "Nursery Bedding Set", price: 3800, tags: ["bedding","nursery","set","baby"], colors: ["Pastel","Multi-color"], stock: 55 },
  { name: "Baby Bath Tub", price: 2800, tags: ["bath","tub","baby"], colors: ["Blue","Pink","White"], stock: 70 },
  { name: "Baby Monitor", price: 6800, tags: ["monitor","baby","electronics"], stock: 30 },
  { name: "Baby Highchair", price: 7200, tags: ["highchair","chair","feeding","baby","furniture"], colors: ["White","Grey"], stock: 28 },
  { name: "Baby Diaper Bag", price: 3400, tags: ["bag","diaper","baby","accessory"], colors: ["Grey","Navy","Pink"], stock: 50 },
]);

const homeKitchen = build("Home & Kitchen", "home-kitchen", [
  { name: "Stainless Steel Cookware Set", price: 15000, tags: ["cookware","pots","kitchen","set"], stock: 40 },
  { name: "Kitchen Knife Set - 5 Pieces", price: 4500, tags: ["knife","knives","kitchen","set"], stock: 60 },
  { name: "Dinner Set - 12 Pieces", price: 6500, tags: ["dinner","plates","kitchen","set"], colors: ["White","Blue","Gold"], stock: 50 },
  { name: "Glassware Set - 6 Pieces", price: 3200, tags: ["glass","glassware","kitchen","set"], stock: 70 },
  { name: "Kitchen Scale - Digital", price: 2800, tags: ["scale","kitchen","digital"], colors: ["White","Black"], stock: 80 },
  { name: "Non-Stick Frying Pan", price: 3500, tags: ["pan","frying","kitchen","cookware"], sizes: ["10in","12in"], stock: 90 },
  { name: "Cutlery Set - 24 Pieces", price: 4000, tags: ["cutlery","forks","kitchen","set"], stock: 65 },
  { name: "Cookware Utensil Set", price: 2800, tags: ["utensil","kitchen","set"], stock: 85 },
  { name: "Electric Kettle", price: 3500, tags: ["kettle","electric","kitchen"], colors: ["White","Silver","Black"], stock: 55 },
  { name: "Food Storage Containers Set", price: 2200, tags: ["containers","storage","kitchen","set"], stock: 100 },
  { name: "Blender - 1.5L", price: 4800, tags: ["blender","appliance","kitchen"], colors: ["Black","White"], stock: 45 },
  { name: "Wooden Chopping Board Set", price: 1800, tags: ["chopping","board","wood","kitchen","set"], stock: 70 },
]);

const decor = build("Home Decor", "home-decor", [
  { name: "Persian Rug - 5x7ft", price: 12000, tags: ["rug","carpet","decor"], colors: ["Red","Blue","Gold"], stock: 25 },
  { name: "Floor Lamp - Modern", price: 8500, tags: ["lamp","light","decor"], colors: ["Black","Gold","Silver"], stock: 30 },
  { name: "Curtain Set - 2 Panels", price: 4500, tags: ["curtain","decor","set"], colors: ["Beige","Grey","White"], stock: 60 },
  { name: "Wall Art - African Print", price: 3500, tags: ["art","wall","decor","african"], stock: 40 },
  { name: "Decorative Vase", price: 2500, tags: ["vase","decor"], colors: ["Gold","Black","White"], stock: 70 },
  { name: "Throw Pillows Set - 2", price: 2800, tags: ["pillow","cushion","decor","set"], colors: ["Gold","Beige","Blue"], stock: 80 },
  { name: "Cushion Cover Set", price: 1800, tags: ["cushion","cover","decor","set"], colors: ["Multi-color"], stock: 90 },
  { name: "Table Runner - African Print", price: 2200, tags: ["table","runner","decor","african"], colors: ["Multi-color"], stock: 55 },
  { name: "Wall Clock - Modern", price: 3800, tags: ["clock","wall","decor"], colors: ["Black","Gold","Silver"], stock: 45 },
  { name: "Photo Frame Set - 3 Pieces", price: 1500, tags: ["frame","photo","decor","set"], colors: ["Black","Gold","Silver"], stock: 100 },
  { name: "Scented Candle Set - 3 Pack", price: 2400, tags: ["candle","scented","decor","set"], colors: ["Various"], stock: 80 },
  { name: "Macrame Wall Hanging", price: 2900, tags: ["macrame","wall","decor","boho"], colors: ["Natural","Cream"], stock: 50 },
]);

const electronics = build("Electronics", "electronics", [
  { name: "Smartphone - 6.5 inch", price: 25000, tags: ["phone","smartphone","mobile","electronics"], colors: ["Black","Blue","Gold"], stock: 30 },
  { name: "Bluetooth Speaker - Portable", price: 5500, tags: ["speaker","bluetooth","audio","electronics"], colors: ["Black","Red","Blue"], stock: 50 },
  { name: "Power Bank - 20000mAh", price: 3500, tags: ["powerbank","charger","electronics"], colors: ["Black","White"], stock: 70 },
  { name: "Wireless Earbuds", price: 4500, tags: ["earbuds","headphones","audio","electronics"], colors: ["White","Black"], stock: 60 },
  { name: "LED Desk Lamp", price: 2200, tags: ["lamp","led","desk","electronics"], colors: ["White","Black"], stock: 80 },
  { name: "HDMI Cable - 2m", price: 800, tags: ["cable","hdmi","electronics"], stock: 150 },
  { name: "USB Flash Drive - 128GB", price: 2500, tags: ["usb","flash","storage","electronics"], colors: ["Black","Silver","Blue"], stock: 100 },
  { name: "Mobile Phone Stand", price: 1200, tags: ["stand","phone","accessory","electronics"], colors: ["Black","Silver"], stock: 120 },
  { name: "Smartwatch", price: 8500, tags: ["watch","smartwatch","wearable","electronics"], colors: ["Black","Silver","Gold"], stock: 40 },
  { name: "Laptop Backpack", price: 3800, tags: ["backpack","bag","laptop","electronics"], colors: ["Black","Grey","Navy"], stock: 55 },
  { name: "Wireless Mouse", price: 1500, tags: ["mouse","wireless","computer","electronics"], colors: ["Black","White"], stock: 90 },
  { name: "Bluetooth Keyboard", price: 3200, tags: ["keyboard","bluetooth","computer","electronics"], colors: ["Black","Silver"], stock: 60 },
]);

const school = build("School & Office", "school-office", [
  { name: "Notebook Set - 5 Pack", price: 600, tags: ["notebook","stationery","school","set"], stock: 200 },
  { name: "School Backpack - Medium", price: 2500, tags: ["backpack","bag","school"], colors: ["Blue","Pink","Red","Black"], stock: 90 },
  { name: "Pen Set - 10 Pieces", price: 400, tags: ["pen","stationery","school","set"], colors: ["Black","Blue","Red"], stock: 250 },
  { name: "Whiteboard - 3x2ft", price: 3500, tags: ["whiteboard","office","school"], stock: 40 },
  { name: "Desk Organizer", price: 1800, tags: ["organizer","desk","office"], colors: ["Black","White","Grey"], stock: 70 },
  { name: "Pencil Case - Large", price: 900, tags: ["pencil","case","stationery","school"], colors: ["Various"], stock: 120 },
  { name: "Marker Set - 12 Colors", price: 700, tags: ["marker","stationery","school","set"], stock: 150 },
  { name: "Stapler + Staples Set", price: 500, tags: ["stapler","office","set"], colors: ["Black","Blue","Red"], stock: 100 },
  { name: "Calculator - Scientific", price: 1500, tags: ["calculator","office","school"], colors: ["Black","White"], stock: 80 },
  { name: "File Organizer - 5 Sections", price: 1200, tags: ["file","organizer","office"], colors: ["Black","Blue","Grey"], stock: 90 },
  { name: "Sticky Notes Pack - 8 Pads", price: 350, tags: ["sticky","notes","stationery","office","set"], colors: ["Various"], stock: 200 },
  { name: "Desk Lamp - LED Adjustable", price: 2400, tags: ["lamp","desk","led","office"], colors: ["White","Black","Silver"], stock: 65 },
]);

const outdoor = build("Outdoor & Leisure", "outdoor-leisure", [
  { name: "Mountain Bike - 26 inch", price: 15000, tags: ["bike","bicycle","outdoor"], colors: ["Black","Blue","Red"], stock: 20 },
  { name: "Kids' Ride-on Car", price: 8500, tags: ["car","ride-on","kids","outdoor"], colors: ["Red","Blue","Pink"], stock: 25 },
  { name: "Sports Football - Size 5", price: 2200, tags: ["football","ball","sports","outdoor"], colors: ["White/Black","White/Blue"], stock: 80 },
  { name: "Umbrella - Large", price: 1500, tags: ["umbrella","outdoor"], colors: ["Black","Navy","Red"], stock: 100 },
  { name: "Camping Chair - Foldable", price: 3200, tags: ["chair","camping","outdoor"], colors: ["Red","Blue","Green"], stock: 45 },
  { name: "Roller Skates - Adjustable", price: 4200, tags: ["skates","roller","outdoor"], sizes: ["S","M","L"], colors: ["Blue","Pink","Black"], stock: 40 },
  { name: "Sports Water Bottle", price: 800, tags: ["bottle","water","sports","outdoor"], colors: ["Various"], stock: 150 },
  { name: "Skipping Rope", price: 500, tags: ["rope","skipping","fitness","outdoor"], colors: ["Various"], stock: 200 },
  { name: "Picnic Blanket", price: 2800, tags: ["blanket","picnic","outdoor"], colors: ["Red","Blue","Green"], stock: 60 },
  { name: "Sports Backpack", price: 3500, tags: ["backpack","bag","sports","outdoor"], colors: ["Black","Red","Blue"], stock: 55 },
  { name: "Yoga Mat - Premium", price: 1800, tags: ["yoga","mat","fitness","outdoor"], colors: ["Purple","Pink","Black","Blue"], stock: 80 },
  { name: "Insulated Cooler Bag", price: 2600, tags: ["cooler","bag","picnic","outdoor"], colors: ["Black","Red","Navy"], stock: 50 },
]);

export const PRODUCTS: Product[] = [
  ...mens, ...women, ...kids, ...baby, ...homeKitchen,
  ...decor, ...electronics, ...school, ...footwear, ...outdoor,
];

export function getProduct(id: string, extra: Product[] = []) {
  return [...PRODUCTS, ...extra].find((p) => p.id === id);
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
  Coral: "#e67e5a", Sky: "#7dd3fc", Mint: "#a7f3d0", Stone: "#d6d3d1",
  Sand: "#e6d2a8", Camel: "#c19a6b", Charcoal: "#36454f", Burgundy: "#800020",
  Rust: "#b7410e", Taupe: "#b8a99a", Berry: "#9c2542", Wine: "#722f37",
  Emerald: "#046307", Ivory: "#fffff0", Blush: "#de98a8", Mustard: "#e1ad01",
  Rose: "#ff66cc", Natural: "#e8dcc4", Denim: "#3b5998",
  "Multi-color": "linear-gradient(135deg,#e8a838,#e67e5a,#1a5276)",
  Various: "linear-gradient(135deg,#e8a838,#e67e5a,#1a5276)",
  "Navy/White": "linear-gradient(135deg,#1e293b 50%,#ffffff 50%)",
  "Red/White": "linear-gradient(135deg,#dc2626 50%,#ffffff 50%)",
  "White/Black": "linear-gradient(135deg,#ffffff 50%,#1a1a1a 50%)",
  "White/Blue": "linear-gradient(135deg,#ffffff 50%,#2563eb 50%)",
  Stripe: "linear-gradient(90deg,#1e293b 25%,#fff 25%,#fff 50%,#1e293b 50%,#1e293b 75%,#fff 75%)",
};
