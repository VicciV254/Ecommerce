import taxonomy from './taxonomy.json' with { type: 'json' };
import { departmentPhotos, galleryPhotos } from './placeholderMedia.js';

const rootAttributes = {
  'phones-tablets': ['Brand', 'Model', 'Storage', 'Connectivity'],
  'tvs-audio': ['Brand', 'Model', 'Dimensions', 'Connectivity'],
  appliances: ['Brand', 'Model', 'Capacity', 'Power'],
  'health-beauty': ['Brand', 'Size', 'Ingredients', 'Usage'],
  'home-office': ['Material', 'Dimensions', 'Care'],
  fashion: ['Brand', 'Material', 'Care'],
  computing: ['Brand', 'Model', 'Processor', 'Memory', 'Storage'],
  gaming: ['Brand', 'Platform', 'Compatibility'],
  supermarket: ['Brand', 'Weight', 'Ingredients'],
  'baby-products': ['Brand', 'Age range', 'Material', 'Care'],
  'sporting-goods': ['Brand', 'Material', 'Dimensions'],
  automobile: ['Brand', 'Compatibility', 'Material'],
  'garden-outdoors': ['Material', 'Dimensions', 'Care'],
  'books-movies-music': ['Format', 'Language', 'Edition'],
};

export function buildDemoCatalog() {
  const nodes = taxonomy.categories;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const parentIds = new Set(nodes.map((item) => item.parentId).filter(Boolean));
  const leaves = nodes.filter((item) => !parentIds.has(item.id));
  const rootOf = (node) => {
    let current = node;
    while (current.parentId) current = byId.get(current.parentId);
    return current;
  };
  // Each department alternates between its own photos, so neighbouring products differ.
  const seen = new Map();
  const photoFor = (node) => {
    const department = rootOf(node).slug;
    const photos = departmentPhotos[department];
    if (!photos?.length) throw new Error(`No placeholder photos for department ${department}`);
    const index = seen.get(department) ?? 0;
    seen.set(department, index + 1);
    const { width, height, ...photo } = photos[index % photos.length];
    return { ...photo, width, height };
  };
  const categories = nodes.map((node) => ({
    ...node, headerImage: (node.parentId ? photoFor(node) : departmentPhotos[node.slug]?.[0] ?? photoFor(node)).url, isActive: true,
    attributeKeys: node.parentId ? [] : rootAttributes[node.slug] ?? ['Brand', 'Material', 'Dimensions'],
  }));
  const featuredRoots = new Set();
  const products = leaves.map((leaf, index) => {
    const root = rootOf(leaf);
    const isFeatured = !featuredRoots.has(root.id);
    featuredRoots.add(root.id);
    return {
      id: `apex-demo-${leaf.slug}`, slug: `demo-${leaf.slug}`, name: `Demo ${leaf.name}`,
      description: `Development sample for ${leaf.name}. Images, prices and stock are placeholders, not a commercial offer. Customize through the catalog; demo records cannot enter live checkout.`,
      price: 1000 + (index % 40) * 250, categoryId: leaf.id,
      designerId: 'apex-demo-studio', tags: ['demo', root.slug],
      collection: 'demo-catalog',
      specifications: Object.fromEntries((rootAttributes[root.slug] ?? ['Brand', 'Material']).slice(0, 3).map((key) => [key, 'Demo specification'])),
      isActive: true, isFeatured, isDemo: true,
    };
  });
  const varied = products.find((product) => rootOf(byId.get(product.categoryId)).slug === 'fashion');
  const variants = products.flatMap((product) => product.id === varied?.id ? [
    { id: `${product.id}-medium`, productId: product.id, sku: `DEMO-${byId.get(product.categoryId).slug}-M`.toUpperCase(), attributes: { size: 'M', color: 'Navy' }, price: null, isActive: true },
    { id: `${product.id}-large`, productId: product.id, sku: `DEMO-${byId.get(product.categoryId).slug}-L`.toUpperCase(), attributes: { size: 'L', color: 'Gold' }, price: product.price + 250, isActive: true },
  ] : [{
    id: `${product.id}-default`, productId: product.id,
    sku: `DEMO-${byId.get(product.categoryId).slug}`.toUpperCase(),
    attributes: {}, price: null, isActive: true,
  }]);
  const stocks = variants.map((variant) => ({
    id: `${variant.id}-stock`, variantId: variant.id, quantity: 12, maxStock: 24,
    minThreshold: 3, status: 'IN_STOCK',
  }));
  seen.clear();
  const images = products.map((product) => ({
    id: `${product.id}-image`, productId: product.id,
    ...photoFor(byId.get(product.categoryId)),
    alt: 'Sample image - not actual product photography', isMain: true, order: 0,
  }));
  const phone = products.find((product) => rootOf(byId.get(product.categoryId)).slug === 'phones-tablets');
  const gallery = (product, photos, ids) => photos.forEach(({ variant: color, ...photo }, index) => {
    const variant = color && variants.find((item) => item.productId === product.id && item.attributes.color === color);
    images.push({
      id: ids[index], productId: product.id, ...photo, variantId: variant?.id ?? null, isMain: false, order: index + 1,
      alt: variant ? `Sample image for the ${color} option - not actual product photography`
        : 'Sample image of a different item - not actual product photography',
    });
  });
  if (varied) gallery(varied, galleryPhotos.fashion, [`${varied.id}-detail`, `${varied.id}-gallery-2`, `${varied.id}-gallery-3`]);
  if (phone) gallery(phone, galleryPhotos['phones-tablets'], [`${phone.id}-gallery-1`, `${phone.id}-gallery-2`]);
  return {
    categories, products, variants, stocks, images,
    designers: [{
      id: 'apex-demo-studio', designerId: 'apex-demo-studio', fullName: 'Apex demo studio',
      specialty: 'Development sample catalog', location: 'Demo', isActive: true, isDemo: true,
    }],
    discounts: [{
      id: 'apex-demo-percentage', name: 'Demo 10 percent preview', type: 'PERCENTAGE', value: 10,
      applyTo: 'SELECTED', targetIds: [products[0].id], startDate: new Date('2000-01-01T00:00:00Z'),
      endDate: new Date('2100-01-01T00:00:00Z'), isActive: true, isDemo: true,
    }],
  };
}
