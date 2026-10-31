import taxonomy from './taxonomy.json' with { type: 'json' };

const photoIds = [
  'photo-1511707171634-5f897ff02aa9',
  'photo-1496181133206-80ce9b88a853',
  'photo-1490481651871-ab68de25d43d',
  'photo-1555041469-a586c61ea9bc',
  'photo-1481627834876-b7833e8f5570',
  'photo-1416879595882-3373a0480b5b',
];
export const demoPhotos = photoIds.map((id) => ({
  url: `https://images.unsplash.com/${id}?w=640&auto=format&fit=crop&q=75`,
  sourceUrl: `https://images.unsplash.com/${id}`,
  license: 'https://unsplash.com/license',
  credit: 'Unsplash - reusable demo placeholder',
  isPlaceholder: true,
}));

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
  const roots = nodes.filter((item) => !item.parentId);
  const leaves = nodes.filter((item) => !parentIds.has(item.id));
  const rootOf = (node) => {
    let current = node;
    while (current.parentId) current = byId.get(current.parentId);
    return current;
  };
  const photoFor = (node) => demoPhotos[roots.findIndex((root) => root.id === rootOf(node).id) % demoPhotos.length];
  const categories = nodes.map((node) => ({
    ...node, headerImage: photoFor(node).url, isActive: true,
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
  const images = products.map((product) => ({
    id: `${product.id}-image`, productId: product.id,
    ...photoFor(byId.get(product.categoryId)),
    alt: 'Demo placeholder - not actual product photography', isMain: true, order: 0,
  }));
  if (varied) images.push({
    id: `${varied.id}-detail`, productId: varied.id, ...demoPhotos[1],
    alt: 'Additional demo placeholder', isMain: false, order: 1,
  });
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
