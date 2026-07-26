import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Men's Fashion", slug: "mens-fashion", headerImage: "https://plus.unsplash.com/premium_photo-1683140431958-31505d0fd1ff?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTN8fGJsYWNrJTIwbWFuJTIwaW4lMjBmYXNoaW9ufGVufDB8fDB8fHww", order: 1 },
  { name: "Women's Fashion", slug: "womens-fashion", headerImage: "https://images.unsplash.com/photo-1709810529099-0ce6102692df?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTB8fGJsYWNrJTIwd29tYW4lMjBpbiUyMGZhc2hpb258ZW58MHx8MHx8fDA%3D", order: 2 },
  { name: "Footwear", slug: "footwear", headerImage: "https://images.pexels.com/photos/10259873/pexels-photo-10259873.jpeg?auto=compress&cs=tinysrgb&w=600", order: 3 },
  { name: "Children's Wear", slug: "childrens-wear", headerImage: "https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&w=600", order: 4 },
  { name: "Baby & Nursery", slug: "baby-nursery", headerImage: "https://images.pexels.com/photos/20387764/pexels-photo-20387764.jpeg?auto=compress&cs=tinysrgb&w=600", order: 5 },
  { name: "Home & Kitchen", slug: "home-kitchen", headerImage: "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600", order: 6 },
  { name: "Home Decor", slug: "home-decor", headerImage: "https://images.pexels.com/photos/20557234/pexels-photo-20557234.jpeg?auto=compress&cs=tinysrgb&w=600", order: 7 },
  { name: "Electronics", slug: "electronics", headerImage: "https://images.pexels.com/photos/7989741/pexels-photo-7989741.jpeg?auto=compress&cs=tinysrgb&w=600", order: 8 },
  { name: "School & Office", slug: "school-office", headerImage: "https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=600", order: 9 },
  { name: "Outdoor & Leisure", slug: "outdoor-leisure", headerImage: "https://images.pexels.com/photos/20728294/pexels-photo-20728294.jpeg?auto=compress&cs=tinysrgb&w=600", order: 10 },
];

const DESIGNERS = [
  { designerId: "kamau", fullName: "James Kamau", specialty: "Men's Casual & Formal Wear", location: "Nairobi", spotlightHeading: "Modern Kenyan Elegance", spotlightText: "James brings contemporary style to traditional Kenyan fashion, creating pieces that bridge the gap between heritage and modernity." },
  { designerId: "omar", fullName: "Fatima Omar", specialty: "Women's Contemporary Fashion", location: "Mombasa", spotlightHeading: "Coastal Chic", spotlightText: "Inspired by the vibrant colors and patterns of the Kenyan coast, Fatima's designs celebrate femininity and cultural heritage." },
  { designerId: "fatma", fullName: "Amina Fatma", specialty: "Traditional & Cultural Wear", location: "Mombasa", spotlightHeading: "Heritage Weaver", spotlightText: "Amina preserves traditional Kenyan textile techniques while creating modern, wearable pieces that honor our cultural legacy." },
  { designerId: "amina", fullName: "Zainab Amina", specialty: "Resort & Beach Wear", location: "Mombasa", spotlightHeading: "Beach Luxury", spotlightText: "Zainab's resort collections capture the essence of Kenyan beach life with flowing fabrics and relaxed elegance." },
];

const PRODUCTS = [
  { name: "Linen Short-Sleeve Shirt", price: 2400, categorySlug: "mens-fashion", tags: ["shirt", "linen", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852150714-pasted-1782852147201.png", designerId: "kamau" },
  { name: "Cotton Polo Shirt", price: 2200, categorySlug: "mens-fashion", tags: ["shirt", "polo", "cotton", "casual"], image: "https://images.unsplash.com/photo-1720514496161-914011a9ee02?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Y290dG9uJTIwcG9sbyUyMHNoaXJ0fGVufDB8fDB8fHww", designerId: "kamau" },
  { name: "Slim Fit Chinos", price: 2600, categorySlug: "mens-fashion", tags: ["trousers", "chinos", "pants", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782738604894-pasted-1782738591918.png", designerId: "kamau" },
  { name: "Casual Slim Fit Jeans", price: 3000, categorySlug: "mens-fashion", tags: ["jeans", "denim", "pants", "trousers", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782741365306-pasted-1782741361322.png", designerId: "kamau" },
  { name: "Premium White Formal Shirt", price: 2500, categorySlug: "mens-fashion", tags: ["shirt", "formal", "cotton", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782740975705-pasted-1782740971669.png", designerId: "kamau" },
  { name: "Linen Blazer - Beige", price: 4800, categorySlug: "mens-fashion", tags: ["blazer", "jacket", "linen", "formal", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852244268-pasted-1782852241259.png", designerId: "kamau" },
  { name: "Cotton Tailored Shorts", price: 1900, categorySlug: "mens-fashion", tags: ["shorts", "cotton", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852416597-pasted-1782852414008.png", designerId: "omar" },
  { name: "Graphic Print T-Shirt", price: 1500, categorySlug: "mens-fashion", tags: ["t-shirt", "tshirt", "shirt", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852485074-pasted-1782852482870.png", designerId: "omar" },
  { name: "Classic Navy Blazer", price: 4500, categorySlug: "mens-fashion", tags: ["blazer", "jacket", "formal", "wool", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782741163654-pasted-1782741042509.png", designerId: "fatma" },
  { name: "Denim Jacket", price: 4000, categorySlug: "mens-fashion", tags: ["jacket", "denim", "casual"], image: "https://images.unsplash.com/photo-1614693348454-1e0710d21c60?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8ZGVuaW0lMjBqYWNrZXQlMjBtZW58ZW58MHx8MHx8fDA%3D", designerId: "omar" },
  { name: "Wool Overcoat", price: 7500, categorySlug: "mens-fashion", tags: ["coat", "overcoat", "jacket", "wool", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852554520-pasted-1782852552213.png", designerId: "fatma" },
  { name: "Knit Crew Sweater", price: 3200, categorySlug: "mens-fashion", tags: ["sweater", "knit", "jumper", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852629511-pasted-1782852626497.png", designerId: "fatma" },
  { name: "Flannel Check Shirt", price: 2700, categorySlug: "mens-fashion", tags: ["shirt", "flannel", "check", "casual", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852700541-pasted-1782852698290.png", designerId: "omar" },
  { name: "Corduroy Trousers", price: 3100, categorySlug: "mens-fashion", tags: ["trousers", "corduroy", "pants", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852765850-pasted-1782852763233.png", designerId: "fatma" },
  { name: "Leather Biker Jacket", price: 8900, categorySlug: "mens-fashion", tags: ["jacket", "leather", "biker", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852837836-pasted-1782852835609.png", designerId: "omar" },
  { name: "Formal Trousers - Grey", price: 2800, categorySlug: "mens-fashion", tags: ["trousers", "formal", "pants", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782739903590-pasted-1782739898633.png", designerId: "fatma" },
  { name: "Traditional Kanzu - White", price: 3500, categorySlug: "mens-fashion", tags: ["kanzu", "robe", "traditional", "resort"], image: "https://plus.unsplash.com/premium_photo-1770306558686-d263b078357d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dHJhZGl0aW9uYWwlMjB3aGl0ZSUyMGthbnp1fGVufDB8fDB8fHww", designerId: "amina" },
  { name: "Hawaiian Print Shirt", price: 2300, categorySlug: "mens-fashion", tags: ["shirt", "hawaiian", "print", "resort", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782852908802-pasted-1782852905241.png", designerId: "amina" },
  { name: "Linen Drawstring Trousers", price: 2500, categorySlug: "mens-fashion", tags: ["trousers", "linen", "pants", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782853039434-pasted-1782853036929.png", designerId: "amina" },
  { name: "Leather Belt - Brown", price: 1500, categorySlug: "mens-fashion", tags: ["belt", "leather", "accessory"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782741462155-pasted-1782741458348.png", designerId: "amina" },
  { name: "Woven Tie Set", price: 1800, categorySlug: "mens-fashion", tags: ["tie", "accessory", "formal"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782741531050-pasted-1782741521462.png", designerId: "amina" },
  { name: "Safari Short-Sleeve Shirt", price: 2600, categorySlug: "mens-fashion", tags: ["shirt", "safari", "resort", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782853126843-pasted-1782853124676.png", designerId: "amina" },
  { name: "Boat Neck Striped Tee", price: 1600, categorySlug: "mens-fashion", tags: ["t-shirt", "tshirt", "shirt", "stripe", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782853310909-pasted-1782853308246.png", designerId: "omar" },
  { name: "Cotton Henley", price: 1900, categorySlug: "mens-fashion", tags: ["henley", "shirt", "cotton", "casual", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782853375957-pasted-1782853372802.png", designerId: "omar" },
  { name: "Floral Maxi Dress", price: 3800, categorySlug: "womens-fashion", tags: ["dress", "maxi", "floral", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782743843751-pasted-1782743837615.png", designerId: "amina" },
  { name: "Off-Shoulder Sundress", price: 3200, categorySlug: "womens-fashion", tags: ["dress", "sundress", "summer", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782853995150-pasted-1782853991707.png", designerId: "amina" },
  { name: "Linen Blouse", price: 2600, categorySlug: "womens-fashion", tags: ["blouse", "shirt", "linen", "top", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854052255-pasted-1782854048710.png", designerId: "kamau" },
  { name: "High Waist Shorts", price: 2100, categorySlug: "womens-fashion", tags: ["shorts", "summer", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854126094-pasted-1782854122845.png", designerId: "kamau" },
  { name: "Wrap Mini Dress", price: 3400, categorySlug: "womens-fashion", tags: ["dress", "wrap", "mini", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854238719-pasted-1782854235933.png", designerId: "amina" },
  { name: "Cotton Crop Top", price: 1400, categorySlug: "womens-fashion", tags: ["top", "crop", "tshirt", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854312779-pasted-1782854309909.png", designerId: "kamau" },
  { name: "Pleated Midi Skirt", price: 2900, categorySlug: "womens-fashion", tags: ["skirt", "midi", "pleated", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854388398-pasted-1782854384091.png", designerId: "fatma" },
  { name: "Strappy Camisole Top", price: 1600, categorySlug: "womens-fashion", tags: ["top", "camisole", "cami", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854504447-pasted-1782854502256.png", designerId: "kamau" },
  { name: "Women's Wool Blazer", price: 4800, categorySlug: "womens-fashion", tags: ["blazer", "jacket", "wool", "formal", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854571812-pasted-1782854569668.png", designerId: "fatma" },
  { name: "Knit Turtleneck Sweater", price: 3000, categorySlug: "womens-fashion", tags: ["sweater", "turtleneck", "knit", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854681018-pasted-1782854678823.png", designerId: "fatma" },
  { name: "Belted Trench Coat", price: 6500, categorySlug: "womens-fashion", tags: ["coat", "trench", "jacket", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854757617-pasted-1782854753868.png", designerId: "fatma" },
  { name: "High Waist Pencil Skirt", price: 2300, categorySlug: "womens-fashion", tags: ["skirt", "pencil", "formal", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782739162910-pasted-1782739159048.png", designerId: "fatma" },
  { name: "Cashmere Cardigan", price: 4200, categorySlug: "womens-fashion", tags: ["cardigan", "sweater", "cashmere", "knit", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854845128-pasted-1782854839898.png", designerId: "fatma" },
  { name: "Wide Leg Trousers", price: 3100, categorySlug: "womens-fashion", tags: ["trousers", "pants", "wide-leg", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854922389-pasted-1782854919388.png", designerId: "kamau" },
  { name: "Quilted Puffer Jacket", price: 5500, categorySlug: "womens-fashion", tags: ["jacket", "puffer", "quilted", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782854989445-pasted-1782854987252.png", designerId: "omar" },
  { name: "Long-Sleeve Silk Blouse", price: 3300, categorySlug: "womens-fashion", tags: ["blouse", "shirt", "silk", "top", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782855081537-pasted-1782855078561.png", designerId: "fatma" },
  { name: "Kitenge Dress - Ankara", price: 4200, categorySlug: "womens-fashion", tags: ["dress", "kitenge", "ankara", "african", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748463846-pasted-1782748459489.png", designerId: "amina" },
  { name: "Kaftan Beach Cover-up", price: 2400, categorySlug: "womens-fashion", tags: ["kaftan", "coverup", "beach", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782855159209-pasted-1782855156768.png", designerId: "amina" },
  { name: "Silk Blend Scarf", price: 1800, categorySlug: "womens-fashion", tags: ["scarf", "accessory", "silk", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782744203501-pasted-1782744199007.png", designerId: "amina" },
  { name: "Ankara Handbag", price: 3500, categorySlug: "womens-fashion", tags: ["handbag", "bag", "ankara", "accessory", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782740039313-pasted-1782740034398.png", designerId: "amina" },
  { name: "Gold Plated Necklace Set", price: 2200, categorySlug: "womens-fashion", tags: ["necklace", "jewelry", "gold", "accessory", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782740735330-pasted-1782740730292.png", designerId: "amina" },
  { name: "Leso - Traditional Wrap", price: 1200, categorySlug: "womens-fashion", tags: ["leso", "kanga", "wrap", "traditional", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782740822949-pasted-1782740818106.png", designerId: "amina" },
  { name: "Linen Jumpsuit", price: 3600, categorySlug: "womens-fashion", tags: ["jumpsuit", "linen", "resort", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782744140929-pasted-1782744136483.png", designerId: "omar" },
  { name: "Beaded Halter Dress", price: 4500, categorySlug: "womens-fashion", tags: ["dress", "beaded", "halter", "evening", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782855617177-pasted-1782855614450.png", designerId: "fatma" },
  { name: "Men's Canvas Sneakers", price: 3200, categorySlug: "footwear", tags: ["sneakers", "shoes", "canvas", "casual", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782855812414-pasted-1782855808555.png", designerId: "kamau" },
  { name: "Women's Strappy Sandal", price: 2800, categorySlug: "footwear", tags: ["sandal", "shoes", "strappy", "women", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782855891302-pasted-1782855888780.png", designerId: "amina" },
  { name: "Espadrille Flats", price: 2400, categorySlug: "footwear", tags: ["espadrille", "shoes", "flats", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856009415-pasted-1782856006181.png", designerId: "amina" },
  { name: "Slide Sandals", price: 1600, categorySlug: "footwear", tags: ["sandal", "slide", "shoes", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856075113-pasted-1782856072484.png", designerId: "omar" },
  { name: "Women's Ballet Flats", price: 2500, categorySlug: "footwear", tags: ["flats", "shoes", "ballet", "women"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782756838772-pasted-1782756657520.png", designerId: "amina" },
  { name: "Men's Boat Shoes", price: 3600, categorySlug: "footwear", tags: ["boat", "shoes", "loafer", "men", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856290407-pasted-1782856288057.png", designerId: "kamau" },
  { name: "Flip Flops", price: 800, categorySlug: "footwear", tags: ["flipflop", "sandal", "shoes", "casual", "summer"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856389650-pasted-1782856386708.png", designerId: "omar" },
  { name: "Wedge Sandals", price: 3000, categorySlug: "footwear", tags: ["wedge", "sandal", "shoes", "heels", "women"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782756843661-pasted-1782756779634.png", designerId: "amina" },
  { name: "Men's Leather Boots", price: 6500, categorySlug: "footwear", tags: ["boots", "shoes", "leather", "men", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856777414-pasted-1782856774830.png", designerId: "fatma" },
  { name: "Women's Ankle Boots", price: 4800, categorySlug: "footwear", tags: ["boots", "ankle", "shoes", "women", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782856851487-pasted-1782856849406.png", designerId: "fatma" },
  { name: "Chelsea Boots", price: 5500, categorySlug: "footwear", tags: ["boots", "chelsea", "shoes", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857049165-pasted-1782857047023.png", designerId: "fatma" },
  { name: "Men's Oxford Shoes", price: 5000, categorySlug: "footwear", tags: ["oxford", "shoes", "formal", "leather", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857108685-pasted-1782857106018.png", designerId: "fatma" },
  { name: "Women's Knee High Boots", price: 6200, categorySlug: "footwear", tags: ["boots", "knee-high", "shoes", "women", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857173439-pasted-1782857169955.png", designerId: "fatma" },
  { name: "Suede Loafers", price: 4400, categorySlug: "footwear", tags: ["loafer", "shoes", "suede", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857245704-pasted-1782857242839.png", designerId: "kamau" },
  { name: "Hiking Boots", price: 5800, categorySlug: "footwear", tags: ["boots", "hiking", "shoes", "outdoor", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857337482-pasted-1782857333956.png", designerId: "omar" },
  { name: "Women's Block Heel Boots", price: 5200, categorySlug: "footwear", tags: ["boots", "heels", "block-heel", "shoes", "women"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782857466199-pasted-1782857464166.png", designerId: "fatma" },
  { name: "Men's Leather Loafer", price: 4500, categorySlug: "footwear", tags: ["loafer", "shoes", "leather", "men", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782756834191-pasted-1782756391183.png", designerId: "amina" },
  { name: "Women's Heeled Sandal", price: 3500, categorySlug: "footwear", tags: ["sandal", "heels", "shoes", "women", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782756835375-pasted-1782756500804.png", designerId: "amina" },
  { name: "Beaded Flat Sandals", price: 2600, categorySlug: "footwear", tags: ["sandal", "beaded", "flats", "shoes", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858025928-pasted-1782858023409.png", designerId: "amina" },
  { name: "Men's Sport Sneakers", price: 5500, categorySlug: "footwear", tags: ["sneakers", "sport", "shoes", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782756837542-pasted-1782756627517.png", designerId: "omar" },
  { name: "Raffia Mules", price: 2900, categorySlug: "footwear", tags: ["mules", "raffia", "shoes", "women", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858131176-pasted-1782858128870.png", designerId: "amina" },
  { name: "Metallic Flat Sandals", price: 2700, categorySlug: "footwear", tags: ["sandal", "metallic", "flats", "shoes", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858209221-pasted-1782858205238.png", designerId: "amina" },
  { name: "Canvas Slip-Ons", price: 2200, categorySlug: "footwear", tags: ["slip-on", "sneakers", "canvas", "shoes", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858298325-pasted-1782858295491.png", designerId: "omar" },
  { name: "Men's Driving Moccasins", price: 4100, categorySlug: "footwear", tags: ["moccasin", "loafer", "shoes", "leather", "men", "resort"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858351360-pasted-1782858347156.png", designerId: "kamau" },
  { name: "Baby Romper - 0-6 Months", price: 1200, categorySlug: "childrens-wear", tags: ["romper", "baby", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746010567-pasted-1782746003790.png" },
  { name: "Toddler T-Shirt Set", price: 1800, categorySlug: "childrens-wear", tags: ["t-shirt", "tshirt", "shirt", "kids", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745087250-pasted-1782745080367.png" },
  { name: "School Uniform - White Shirt", price: 900, categorySlug: "childrens-wear", tags: ["shirt", "uniform", "school", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745184559-pasted-1782745180523.png" },
  { name: "Kids' Sneakers", price: 2200, categorySlug: "childrens-wear", tags: ["sneakers", "shoes", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745271226-pasted-1782745258138.png" },
  { name: "Baby Cotton Onesie", price: 800, categorySlug: "childrens-wear", tags: ["onesie", "baby", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745391272-pasted-1782745385197.png" },
  { name: "Kids' Winter Jacket", price: 3200, categorySlug: "childrens-wear", tags: ["jacket", "coat", "kids", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745657860-pasted-1782745441557.png" },
  { name: "Children's Swimwear", price: 1500, categorySlug: "childrens-wear", tags: ["swimwear", "kids", "beach"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745659409-pasted-1782745515623.png" },
  { name: "Kids' Party Dress", price: 2000, categorySlug: "childrens-wear", tags: ["dress", "party", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745661097-pasted-1782745592759.png" },
  { name: "School Bag - Junior", price: 1600, categorySlug: "childrens-wear", tags: ["bag", "backpack", "school", "kids"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745662785-pasted-1782745653779.png" },
  { name: "Baby Socks Set (5 Pack)", price: 500, categorySlug: "childrens-wear", tags: ["socks", "baby", "kids", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782745829048-pasted-1782745824579.png" },
  { name: "Kids' Pyjama Set", price: 1400, categorySlug: "childrens-wear", tags: ["pyjama", "sleepwear", "kids", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858787784-pasted-1782858750160.png" },
  { name: "Toddler Beanie Hat", price: 600, categorySlug: "childrens-wear", tags: ["hat", "beanie", "kids", "winter"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782858795834-pasted-1782858793481.png" },
  { name: "Wooden Baby Cot - White", price: 18500, categorySlug: "baby-nursery", tags: ["cot", "crib", "nursery", "furniture"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746238678-pasted-1782746126848.png" },
  { name: "Baby Walker - Activity", price: 6500, categorySlug: "baby-nursery", tags: ["walker", "baby", "activity"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746239516-pasted-1782746165935.png" },
  { name: "Feeding Chair - Adjustable", price: 8500, categorySlug: "baby-nursery", tags: ["chair", "feeding", "baby", "furniture"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746241118-pasted-1782746192347.png" },
  { name: "Baby Stroller - Compact", price: 12000, categorySlug: "baby-nursery", tags: ["stroller", "pram", "baby"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746242627-pasted-1782746228333.png" },
  { name: "Educational Toys Set", price: 3200, categorySlug: "baby-nursery", tags: ["toys", "educational", "baby", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746459611-pasted-1782746324943.png" },
  { name: "Baby Play Mat", price: 4500, categorySlug: "baby-nursery", tags: ["mat", "playmat", "baby"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746461205-pasted-1782746370740.png" },
  { name: "Baby Bouncer", price: 5500, categorySlug: "baby-nursery", tags: ["bouncer", "baby"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746463047-pasted-1782746400163.png" },
  { name: "Nursery Bedding Set", price: 3800, categorySlug: "baby-nursery", tags: ["bedding", "nursery", "set", "baby"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746464752-pasted-1782746455448.png" },
  { name: "Baby Bath Tub", price: 2800, categorySlug: "baby-nursery", tags: ["bath", "tub", "baby"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746666818-pasted-1782746621904.png" },
  { name: "Baby Monitor", price: 6800, categorySlug: "baby-nursery", tags: ["monitor", "baby", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782746667997-pasted-1782746662677.png" },
  { name: "Baby Highchair", price: 7200, categorySlug: "baby-nursery", tags: ["highchair", "chair", "feeding", "baby", "furniture"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859034620-pasted-1782859031364.png" },
  { name: "Baby Diaper Bag", price: 3400, categorySlug: "baby-nursery", tags: ["bag", "diaper", "baby", "accessory"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859096182-pasted-1782859093532.png" },
  { name: "Stainless Steel Cookware Set", price: 15000, categorySlug: "home-kitchen", tags: ["cookware", "pots", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782747917449-pasted-1782747726790.png" },
  { name: "Kitchen Knife Set - 5 Pieces", price: 4500, categorySlug: "home-kitchen", tags: ["knife", "knives", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782747919507-pasted-1782747787890.png" },
  { name: "Dinner Set - 12 Pieces", price: 6500, categorySlug: "home-kitchen", tags: ["dinner", "plates", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782747921374-pasted-1782747817757.png" },
  { name: "Glassware Set - 6 Pieces", price: 3200, categorySlug: "home-kitchen", tags: ["glass", "glassware", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782747922927-pasted-1782747878428.png" },
  { name: "Kitchen Scale - Digital", price: 2800, categorySlug: "home-kitchen", tags: ["scale", "kitchen", "digital"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782747924732-pasted-1782747912534.png" },
  { name: "Non-Stick Frying Pan", price: 3500, categorySlug: "home-kitchen", tags: ["pan", "frying", "kitchen", "cookware"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748306677-pasted-1782748137241.png" },
  { name: "Cutlery Set - 24 Pieces", price: 4000, categorySlug: "home-kitchen", tags: ["cutlery", "forks", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748308639-pasted-1782748176183.png" },
  { name: "Cookware Utensil Set", price: 2800, categorySlug: "home-kitchen", tags: ["utensil", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748310353-pasted-1782748224926.png" },
  { name: "Electric Kettle", price: 3500, categorySlug: "home-kitchen", tags: ["kettle", "electric", "kitchen"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748312313-pasted-1782748269505.png" },
  { name: "Food Storage Containers Set", price: 2200, categorySlug: "home-kitchen", tags: ["containers", "storage", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782748313806-pasted-1782748301354.png" },
  { name: "Blender - 1.5L", price: 4800, categorySlug: "home-kitchen", tags: ["blender", "appliance", "kitchen"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859179723-pasted-1782859177247.png" },
  { name: "Wooden Chopping Board Set", price: 1800, categorySlug: "home-kitchen", tags: ["chopping", "board", "wood", "kitchen", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859248629-pasted-1782859246026.png" },
  { name: "Persian Rug - 5x7ft", price: 12000, categorySlug: "home-decor", tags: ["rug", "carpet", "decor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749159535-pasted-1782749008137.png" },
  { name: "Floor Lamp - Modern", price: 8500, categorySlug: "home-decor", tags: ["lamp", "light", "decor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749160964-pasted-1782749040241.png" },
  { name: "Curtain Set - 2 Panels", price: 4500, categorySlug: "home-decor", tags: ["curtain", "decor", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749162676-pasted-1782749075151.png" },
  { name: "Wall Art - African Print", price: 3500, categorySlug: "home-decor", tags: ["art", "wall", "decor", "african"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749163643-pasted-1782749100341.png" },
  { name: "Decorative Vase", price: 2500, categorySlug: "home-decor", tags: ["vase", "decor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749164943-pasted-1782749154793.png" },
  { name: "Throw Pillows Set - 2", price: 2800, categorySlug: "home-decor", tags: ["pillow", "cushion", "decor", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749553251-pasted-1782749361825.png" },
  { name: "Cushion Cover Set", price: 1800, categorySlug: "home-decor", tags: ["cushion", "cover", "decor", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749557510-pasted-1782749390442.png" },
  { name: "Table Runner - African Print", price: 2200, categorySlug: "home-decor", tags: ["table", "runner", "decor", "african"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749558323-pasted-1782749426082.png" },
  { name: "Wall Clock - Modern", price: 3800, categorySlug: "home-decor", tags: ["clock", "wall", "decor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749560248-pasted-1782749476250.png" },
  { name: "Photo Frame Set - 3 Pieces", price: 1500, categorySlug: "home-decor", tags: ["frame", "photo", "decor", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782749561007-pasted-1782749548998.png" },
  { name: "Scented Candle Set - 3 Pack", price: 2400, categorySlug: "home-decor", tags: ["candle", "scented", "decor", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859326493-pasted-1782859323905.png" },
  { name: "Macrame Wall Hanging", price: 2900, categorySlug: "home-decor", tags: ["macrame", "wall", "decor", "boho"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859446858-pasted-1782859440912.png" },
  { name: "Smartphone - 6.5 inch", price: 25000, categorySlug: "electronics", tags: ["phone", "smartphone", "mobile", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750948314-pasted-1782750918286.png" },
  { name: "Bluetooth Speaker - Portable", price: 5500, categorySlug: "electronics", tags: ["speaker", "bluetooth", "audio", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750385643-pasted-1782750106021.png" },
  { name: "Power Bank - 20000mAh", price: 3500, categorySlug: "electronics", tags: ["powerbank", "charger", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750384243-pasted-1782750069060.png" },
  { name: "Wireless Earbuds", price: 4500, categorySlug: "electronics", tags: ["earbuds", "headphones", "audio", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750800552-pasted-1782750795738.png" },
  { name: "LED Desk Lamp", price: 2200, categorySlug: "electronics", tags: ["lamp", "led", "desk", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755109053-pasted-1782755096543.png" },
  { name: "HDMI Cable - 2m", price: 800, categorySlug: "electronics", tags: ["cable", "hdmi", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750388087-pasted-1782750180024.png" },
  { name: "USB Flash Drive - 128GB", price: 2500, categorySlug: "electronics", tags: ["usb", "flash", "storage", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750389701-pasted-1782750247754.png" },
  { name: "Mobile Phone Stand", price: 1200, categorySlug: "electronics", tags: ["stand", "phone", "accessory", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750391337-pasted-1782750279376.png" },
  { name: "Smartwatch", price: 8500, categorySlug: "electronics", tags: ["watch", "smartwatch", "wearable", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750395879-pasted-1782750329361.png" },
  { name: "Laptop Backpack", price: 3800, categorySlug: "electronics", tags: ["backpack", "bag", "laptop", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782750397299-pasted-1782750376019.png" },
  { name: "Wireless Mouse", price: 1500, categorySlug: "electronics", tags: ["mouse", "wireless", "computer", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859565921-pasted-1782859563689.png" },
  { name: "Bluetooth Keyboard", price: 3200, categorySlug: "electronics", tags: ["keyboard", "bluetooth", "computer", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859664336-pasted-1782859660500.png" },
  { name: "Notebook Set - 5 Pack", price: 600, categorySlug: "school-office", tags: ["notebook", "stationery", "school", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755821771-pasted-1782755435721.png" },
  { name: "School Backpack - Medium", price: 2500, categorySlug: "school-office", tags: ["backpack", "bag", "school"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755823423-pasted-1782755476164.png" },
  { name: "Pen Set - 10 Pieces", price: 400, categorySlug: "school-office", tags: ["pen", "stationery", "school", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755825505-pasted-1782755521107.png" },
  { name: "Whiteboard - 3x2ft", price: 3500, categorySlug: "school-office", tags: ["whiteboard", "office", "school"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755831887-pasted-1782755583990.png" },
  { name: "Desk Organizer", price: 1800, categorySlug: "school-office", tags: ["organizer", "desk", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755835477-pasted-1782755610724.png" },
  { name: "Pencil Case - Large", price: 900, categorySlug: "school-office", tags: ["pencil", "case", "stationery", "school"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755837521-pasted-1782755649473.png" },
  { name: "Marker Set - 12 Colors", price: 700, categorySlug: "school-office", tags: ["marker", "stationery", "school", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755839796-pasted-1782755699156.png" },
  { name: "Stapler + Staples Set", price: 500, categorySlug: "school-office", tags: ["stapler", "office", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755845902-pasted-1782755741019.png" },
  { name: "Calculator - Scientific", price: 1500, categorySlug: "school-office", tags: ["calculator", "office", "school"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755847666-pasted-1782755772402.png" },
  { name: "File Organizer - 5 Sections", price: 1200, categorySlug: "school-office", tags: ["file", "organizer", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782755849864-pasted-1782755815294.png" },
  { name: "Sticky Notes Pack - 8 Pads", price: 350, categorySlug: "school-office", tags: ["sticky", "notes", "stationery", "office", "set"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859781666-pasted-1782859777707.png" },
  { name: "Desk Lamp - LED Adjustable", price: 2400, categorySlug: "school-office", tags: ["lamp", "desk", "led", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782859971953-pasted-1782859969520.png" },
  { name: "Mountain Bike - 26 inch", price: 15000, categorySlug: "outdoor-leisure", tags: ["bike", "bicycle", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757759507-pasted-1782757268190.png" },
  { name: "Kids' Ride-on Car", price: 8500, categorySlug: "outdoor-leisure", tags: ["car", "ride-on", "kids", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757761395-pasted-1782757301510.png" },
  { name: "Sports Football - Size 5", price: 2200, categorySlug: "outdoor-leisure", tags: ["football", "ball", "sports", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757762723-pasted-1782757330831.png" },
  { name: "Umbrella - Large", price: 1500, categorySlug: "outdoor-leisure", tags: ["umbrella", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757766641-pasted-1782757373343.png" },
  { name: "Camping Chair - Foldable", price: 3200, categorySlug: "outdoor-leisure", tags: ["chair", "camping", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757770285-pasted-1782757412132.png" },
  { name: "Roller Skates - Adjustable", price: 4200, categorySlug: "outdoor-leisure", tags: ["skates", "roller", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757771915-pasted-1782757449020.png" },
  { name: "Sports Water Bottle", price: 800, categorySlug: "outdoor-leisure", tags: ["bottle", "water", "sports", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757774034-pasted-1782757501852.png" },
  { name: "Skipping Rope", price: 500, categorySlug: "outdoor-leisure", tags: ["rope", "skipping", "fitness", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757775663-pasted-1782757542579.png" },
  { name: "Picnic Blanket", price: 2800, categorySlug: "outdoor-leisure", tags: ["blanket", "picnic", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782758721311-pasted-1782758716662.png" },
  { name: "Sports Backpack", price: 3500, categorySlug: "outdoor-leisure", tags: ["backpack", "bag", "sports", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782757779588-pasted-1782757750768.png" },
  { name: "Yoga Mat - Premium", price: 1800, categorySlug: "outdoor-leisure", tags: ["yoga", "mat", "fitness", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782860072393-pasted-1782860069859.png" },
  { name: "Insulated Cooler Bag", price: 2600, categorySlug: "outdoor-leisure", tags: ["cooler", "bag", "picnic", "outdoor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/vicciv254/ecormerce/1782860136811-pasted-1782860133811.png" },
];

function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function describe(name, catName, tags) {
  const tagText = tags.slice(0, 4).join(", ");
  return `${name} — a standout piece in our ${catName} range at No Maneno Bazaar. Thoughtfully selected for quality, comfort and everyday value${tagText ? ` (${tagText})` : ""}. Photographed in studio so you see exactly what you get. IKO KITU!`;
}

async function main() {
  console.log('🌱 Starting database seed...');

  console.log('🗑️  Clearing existing data...');
  await prisma.orderItem.deleteMany();
  await prisma.trackingEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.wishlist.deleteMany();
  await prisma.review.deleteMany();
  await prisma.stockLog.deleteMany();
  await prisma.restockHistory.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.product.deleteMany();
  await prisma.designer.deleteMany();
  await prisma.category.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.address.deleteMany();
  await prisma.user.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.admin.deleteMany();

  console.log('✅ Existing data cleared');

  console.log('📁 Creating categories...');
  const categoryMap = {};
  for (const cat of CATEGORIES) {
    const category = await prisma.category.create({
      data: cat,
    });
    categoryMap[cat.slug] = category.id;
    console.log(`  ✓ Created category: ${cat.name}`);
  }

  console.log('👨‍🎨 Creating designers...');
  const designerMap = {};
  for (const des of DESIGNERS) {
    const designer = await prisma.designer.create({
      data: des,
    });
    designerMap[des.designerId] = designer.id;
    console.log(`  ✓ Created designer: ${des.fullName}`);
  }

  console.log('🛍️  Creating products...');
  for (const prod of PRODUCTS) {
    const categoryId = categoryMap[prod.categorySlug];
    const designerId = prod.designerId ? designerMap[prod.designerId] : null;
    const categoryName = CATEGORIES.find(c => c.slug === prod.categorySlug)?.name || prod.categorySlug;

    const product = await prisma.product.create({
      data: {
        name: prod.name,
        slug: generateSlug(prod.name),
        price: prod.price,
        description: describe(prod.name, categoryName, prod.tags),
        categoryId,
        designerId,
        tags: prod.tags,
        isActive: true,
        images: {
          create: [
            {
              url: prod.image,
              alt: prod.name,
              isMain: true,
              order: 0,
            },
          ],
        },
        stock: {
          create: {
            quantity: 100,
            maxStock: 100,
            minThreshold: 10,
            status: 'IN_STOCK',
          },
        },
      },
    });
    console.log(`  ✓ Created product: ${prod.name}`);
  }

  console.log('🔐 Creating initial admin...');
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.admin.create({
    data: {
      email: process.env.ADMIN_EMAIL || 'admin@nomanenobazaar.com',
      username: process.env.ADMIN_USERNAME || 'admin',
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`  ✓ Created admin: ${admin.email} (password: admin123)`);

  console.log('✨ Database seed completed successfully!');
  console.log('\n📝 Summary:');
  console.log(`  - ${CATEGORIES.length} categories`);
  console.log(`  - ${DESIGNERS.length} designers`);
  console.log(`  - ${PRODUCTS.length} products`);
  console.log(`  - 1 admin account`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
