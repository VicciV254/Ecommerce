/**
 * A catalog shaped like the approved taxonomy for browser tests of discovery: 14 departments, each with groups of
 * leaves (one group with more leaves than the desktop panel lists), long names, and one leaf with enough products
 * for several listing pages. Explicitly test data; nothing here is imported by the application bundle.
 */
import type { CatalogCategory, CatalogProduct, CatalogSnapshot } from "../api/catalog";
import {
  fixtureCategory,
  fixtureDelivery,
  fixtureDesigners,
  fixtureDiscounts,
  fixtureImage,
  fixtureProduct,
  fixtureReturnPolicy,
  fixtureVariant,
  listPricing,
} from "./catalogFixtures";

export const DISCOVERY_DEPARTMENTS = [
  { name: "Phones & Tablets", keys: ["Brand", "Storage"] },
  { name: "TVs & Audio", keys: ["Brand", "Connectivity"] },
  { name: "Appliances", keys: ["Brand", "Capacity"] },
  { name: "Health & Beauty", keys: ["Brand", "Size"] },
  { name: "Home & Office", keys: ["Material", "Care"] },
  { name: "Fashion", keys: ["Brand", "Material"] },
  { name: "Computing", keys: ["Brand", "Memory"] },
  { name: "Gaming", keys: ["Brand", "Platform"] },
  { name: "Supermarket", keys: ["Brand", "Weight"] },
  { name: "Baby Products", keys: ["Brand", "Age range"] },
  { name: "Sporting Goods", keys: ["Brand", "Material"] },
  { name: "Automobile", keys: ["Brand", "Compatibility"] },
  { name: "Garden & Outdoors", keys: ["Material", "Care"] },
  { name: "Books, Movies & Music", keys: ["Format", "Language"] },
] as const;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
/** Leaves in each department's first group: more than the panel's eight. */
const WIDE_GROUP_LEAVES = 10;
export const SHIRT_COUNT = 30;
const SIZES = ["S", "M", "L"];
const COLORS = ["White", "Navy", "Black"];

type Node = Omit<CatalogCategory, "productCount">;

function departmentTree(name: string, keys: readonly string[], order: number): Node[] {
  const department = fixtureCategory({ id: `dept-${slug(name)}`, name, order, attributeKeys: [...keys] });
  const groups = [
    { name: `${name} Essentials`, leaves: WIDE_GROUP_LEAVES },
    // The taxonomy's longest group name, to check wrapping.
    { name: name === "Supermarket" ? "Margarine Jams Honey & Spreads" : `${name} Accessories`, leaves: 2 },
    { name: `${name} Specials`, leaves: 0 },
  ];
  const nodes: Node[] = [department];
  groups.forEach((group, groupIndex) => {
    const groupNode = fixtureCategory({ id: `${department.id}-g${groupIndex}`, name: group.name, parentId: department.id, order: groupIndex });
    nodes.push(groupNode);
    for (let leaf = 0; leaf < group.leaves; leaf += 1) {
      const leafName = name === "Fashion" && groupIndex === 0 && leaf === 0 ? "Shirts" : `${group.name} ${leaf + 1}`;
      nodes.push(fixtureCategory({ id: `${groupNode.id}-l${leaf}`, name: leafName, parentId: groupNode.id, order: leaf }));
    }
  });
  return nodes;
}

const nodes = DISCOVERY_DEPARTMENTS.flatMap((department, index) => departmentTree(department.name, department.keys, index));
const byId = new Map(nodes.map((node) => [node.id, node]));
const pathOf = (id: string) => {
  const chain: string[] = [];
  for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) chain.unshift(node.id);
  return chain;
};
const leafNamed = (name: string) => nodes.find((node) => node.name === name)!;

function productIn(leaf: Node, overrides: Partial<CatalogProduct> & Pick<CatalogProduct, "id" | "name">) {
  return fixtureProduct({
    categoryId: leaf.id, categoryName: leaf.name, categorySlug: leaf.slug, categoryPath: pathOf(leaf.id), isDemo: true,
    images: [fixtureImage({ id: `${overrides.id}-image`, url: `https://media.example.test/${overrides.id}.jpg`, isMain: true, isPlaceholder: true })],
    ...overrides,
  });
}

const shirtsLeaf = leafNamed("Shirts");
/** Shirts 1-30: sizes and colours rotate, every third is sold out, prices rise by KES 50; brands alternate. */
export const discoveryShirts: CatalogProduct[] = Array.from({ length: SHIRT_COUNT }, (_, index) => {
  const price = 1000 + index * 50;
  return productIn(shirtsLeaf, {
    id: `shirt-${index + 1}`,
    name: `Discovery Shirt ${index + 1}`,
    isFeatured: index < 10,
    tags: ["shirt"],
    specifications: { Brand: index % 2 ? "Kora" : "Apex", Material: index % 3 ? "Cotton" : "Linen" },
    variants: [fixtureVariant({
      id: `shirt-${index + 1}-sku`, attributes: { size: SIZES[index % 3], color: COLORS[index % 3] },
      stock: index % 3 === 2 ? 0 : 6, price, pricing: listPricing(price),
    })],
  });
});

/** One product in the first leaf of every other department, so each department lists something. */
const departmentSamples = DISCOVERY_DEPARTMENTS.filter((department) => department.name !== "Fashion").map((department, index) => {
  const leaf = nodes.find((node) => node.parentId === `dept-${slug(department.name)}-g0`)!;
  return productIn(leaf, {
    id: `sample-${slug(department.name)}`, name: `${department.name} sample`, isFeatured: index < 2,
    specifications: { [department.keys[0]]: "Sample" },
    variants: [fixtureVariant({ id: `sample-${slug(department.name)}-sku`, price: 2500, pricing: listPricing(2500) })],
  });
});

export const discoveryProducts = [...discoveryShirts, ...departmentSamples];

/** Counts include every descendant, as the catalog API reports them. */
export const discoveryCategories: CatalogCategory[] = nodes.map((node) => ({
  ...node,
  productCount: discoveryProducts.filter((product) => product.categoryPath.includes(node.id)).length,
}));

export function discoverySnapshot(): CatalogSnapshot {
  return {
    version: 2, mode: "demo", demonstrationOrders: false, products: discoveryProducts, categories: discoveryCategories,
    designers: fixtureDesigners, discounts: fixtureDiscounts, returnPolicy: fixtureReturnPolicy, delivery: fixtureDelivery,
  };
}
