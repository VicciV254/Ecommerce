import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Categories from frontend
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

// Designers from frontend
const DESIGNERS = [
  { designerId: "kamau", fullName: "James Kamau", specialty: "Men's Casual & Formal Wear", location: "Nairobi", spotlightHeading: "Modern Kenyan Elegance", spotlightText: "James brings contemporary style to traditional Kenyan fashion, creating pieces that bridge the gap between heritage and modernity." },
  { designerId: "omar", fullName: "Fatima Omar", specialty: "Women's Contemporary Fashion", location: "Mombasa", spotlightHeading: "Coastal Chic", spotlightText: "Inspired by the vibrant colors and patterns of the Kenyan coast, Fatima's designs celebrate femininity and cultural heritage." },
  { designerId: "fatma", fullName: "Amina Fatma", specialty: "Traditional & Cultural Wear", location: "Mombasa", spotlightHeading: "Heritage Weaver", spotlightText: "Amina preserves traditional Kenyan textile techniques while creating modern, wearable pieces that honor our cultural legacy." },
  { designerId: "amina", fullName: "Zainab Amina", specialty: "Resort & Beach Wear", location: "Mombasa", spotlightHeading: "Beach Luxury", spotlightText: "Zainab's resort collections capture the essence of Kenyan beach life with flowing fabrics and relaxed elegance." },
];

// Product data - simplified version for seeding
// This would normally be imported from the frontend products.ts
const PRODUCTS = [
  // Men's Fashion
  { name: "Linen Short-Sleeve Shirt", price: 2400, categorySlug: "mens-fashion", tags: ["shirt", "linen", "casual", "summer"], designerId: "kamau", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782852150714-pasted-1782852147201.png" },
  { name: "Cotton Polo Shirt", price: 2200, categorySlug: "mens-fashion", tags: ["shirt", "polo", "cotton", "casual"], designerId: "kamau", image: "https://images.unsplash.com/photo-1720514496161-914011a9ee02?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8Y290dG9uJTIwcG9sbyUyMHNoaXJ0fGVufDB8fDB8fHww" },
  { name: "Slim Fit Chinos", price: 2600, categorySlug: "mens-fashion", tags: ["trousers", "chinos", "pants", "casual"], designerId: "kamau", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782738604894-pasted-1782738591918.png" },
  { name: "Casual Slim Fit Jeans", price: 3000, categorySlug: "mens-fashion", tags: ["jeans", "denim", "pants", "trousers", "casual"], designerId: "kamau", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782741365306-pasted-1782741361322.png" },
  { name: "Premium White Formal Shirt", price: 2500, categorySlug: "mens-fashion", tags: ["shirt", "formal", "cotton", "office"], designerId: "kamau", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782740975705-pasted-1782740971669.png" },
  { name: "Classic Navy Blazer", price: 4500, categorySlug: "mens-fashion", tags: ["blazer", "jacket", "formal", "wool", "office"], designerId: "fatma", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782741163654-pasted-1782741042509.png" },
  { name: "Traditional Kanzu - White", price: 3500, categorySlug: "mens-fashion", tags: ["kanzu", "robe", "traditional", "resort"], designerId: "amina", image: "https://plus.unsplash.com/premium_photo-1770306558686-d263b078357d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dHJhZGl0aW9uYWwlMjB3aGl0ZSUyMGthbnp1fGVufDB8fDB8fHww" },
  
  // Women's Fashion
  { name: "Floral Maxi Dress", price: 3500, categorySlug: "womens-fashion", tags: ["dress", "maxi", "floral", "summer"], designerId: "omar", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782743843751-pasted-1782743837615.png" },
  { name: "Kitenge Dress - Ankara", price: 4200, categorySlug: "womens-fashion", tags: ["dress", "ankara", "kitenge", "traditional"], designerId: "fatma", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782748463846-pasted-1782748459489.png" },
  { name: "White Blouse - Lace Detail", price: 2800, categorySlug: "womens-fashion", tags: ["blouse", "lace", "formal", "elegant"], designerId: "omar", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782738944063-pasted-1782738939063.png" },
  { name: "High Waist Pencil Skirt", price: 2200, categorySlug: "womens-fashion", tags: ["skirt", "pencil", "formal", "office"], designerId: "omar", image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782739162910-pasted-1782739159048.png" },
  
  // Footwear
  { name: "Men's Canvas Sneakers", price: 2800, categorySlug: "footwear", tags: ["sneakers", "canvas", "casual", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782855812414-pasted-1782855808555.png" },
  { name: "Women's Strappy Sandal", price: 2200, categorySlug: "footwear", tags: ["sandals", "strappy", "casual", "women"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782855891302-pasted-1782855888780.png" },
  { name: "Men's Leather Boots", price: 5500, categorySlug: "footwear", tags: ["boots", "leather", "formal", "men"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782856777414-pasted-1782856774830.png" },
  { name: "Women's Ballet Flats", price: 2400, categorySlug: "footwear", tags: ["flats", "ballet", "casual", "women"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782756838772-pasted-1782756657520.png" },
  
  // Children's Wear
  { name: "Baby Romper - 0-6 Months", price: 1200, categorySlug: "childrens-wear", tags: ["romper", "baby", "cotton", "comfortable"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782746010567-pasted-1782746003790.png" },
  { name: "Toddler T-Shirt Set", price: 1500, categorySlug: "childrens-wear", tags: ["t-shirt", "toddler", "cotton", "casual"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782745087250-pasted-1782745080367.png" },
  { name: "Kids' Sneakers", price: 2800, categorySlug: "childrens-wear", tags: ["sneakers", "kids", "casual", "comfortable"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782745271226-pasted-1782745258138.png" },
  
  // Home & Kitchen
  { name: "Stainless Steel Cookware Set", price: 8500, categorySlug: "home-kitchen", tags: ["cookware", "stainless", "kitchen", "essential"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782747917449-pasted-1782747726790.png" },
  { name: "Kitchen Knife Set - 5 Pieces", price: 3200, categorySlug: "home-kitchen", tags: ["knives", "kitchen", "essential", "stainless"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782747919507-pasted-1782747787890.png" },
  { name: "Electric Kettle", price: 2800, categorySlug: "home-kitchen", tags: ["kettle", "electric", "kitchen", "essential"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782748312313-pasted-1782748269505.png" },
  
  // Home Decor
  { name: "Persian Rug - 5x7ft", price: 12000, categorySlug: "home-decor", tags: ["rug", "persian", "decor", "floor"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782749159535-pasted-1782749008137.png" },
  { name: "Floor Lamp - Modern", price: 4500, categorySlug: "home-decor", tags: ["lamp", "floor", "modern", "lighting"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782749160964-pasted-1782749040241.png" },
  { name: "Wall Art - African Print", price: 3500, categorySlug: "home-decor", tags: ["art", "wall", "african", "print"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782749163643-pasted-1782749100341.png" },
  
  // Electronics
  { name: "Smartphone - 6.5 inch", price: 35000, categorySlug: "electronics", tags: ["smartphone", "phone", "electronics", "mobile"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782750948314-pasted-1782750918286.png" },
  { name: "Bluetooth Speaker - Portable", price: 4500, categorySlug: "electronics", tags: ["speaker", "bluetooth", "portable", "audio"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782750385643-pasted-1782750106021.png" },
  { name: "Power Bank - 20000mAh", price: 3200, categorySlug: "electronics", tags: ["power bank", "charger", "portable", "electronics"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782750384243-pasted-1782750069060.png" },
  
  // School & Office
  { name: "Notebook Set - 5 Pack", price: 800, categorySlug: "school-office", tags: ["notebook", "stationery", "school", "office"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782755821771-pasted-1782755435721.png" },
  { name: "School Backpack - Medium", price: 2500, categorySlug: "school-office", tags: ["backpack", "school", "bag", "portable"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782755823423-pasted-1782755476164.png" },
  { name: "Pen Set - 10 Pieces", price: 500, categorySlug: "school-office", tags: ["pens", "stationery", "office", "essential"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782755825505-pasted-1782755521107.png" },
  
  // Outdoor & Leisure
  { name: "Mountain Bike - 26 inch", price: 25000, categorySlug: "outdoor-leisure", tags: ["bike", "mountain", "outdoor", "sports"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782757759507-pasted-1782757268190.png" },
  { name: "Sports Football - Size 5", price: 1500, categorySlug: "outdoor-leisure", tags: ["football", "sports", "outdoor", "ball"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782757762723-pasted-1782757330831.png" },
  { name: "Yoga Mat - Premium", price: 2200, categorySlug: "outdoor-leisure", tags: ["yoga", "mat", "fitness", "exercise"], image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782860072393-pasted-1782860069859.png" },
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

  // Clear existing data
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
  await prisma.user.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.admin.deleteMany();

  console.log('✅ Existing data cleared');

  // Create categories
  console.log('📁 Creating categories...');
  const categoryMap = {};
  for (const cat of CATEGORIES) {
    const category = await prisma.category.create({
      data: cat,
    });
    categoryMap[cat.slug] = category.id;
    console.log(`  ✓ Created category: ${cat.name}`);
  }

  // Create designers
  console.log('👨‍🎨 Creating designers...');
  const designerMap = {};
  for (const des of DESIGNERS) {
    const designer = await prisma.designer.create({
      data: des,
    });
    designerMap[des.designerId] = designer.id;
    console.log(`  ✓ Created designer: ${des.fullName}`);
  }

  // Create products
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

  // Create initial admin
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
