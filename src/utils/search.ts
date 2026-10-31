import type { CatalogProduct } from "../api/catalog";

/**
 * Ranked product search over the canonical catalog.
 *
 * Ranking (best first): exact name, name prefix, name contains, exact tag,
 * partial tag, then category name. Ties keep the catalog's own order.
 */
export function searchProducts(query: string, products: readonly CatalogProduct[]): CatalogProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { product: CatalogProduct; score: number }[] = [];
  for (const product of products) {
    const name = product.name.toLowerCase();
    const tags = product.tags.map((tag) => tag.toLowerCase());
    let score = Infinity;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (tags.includes(q)) score = 3;
    else if (tags.some((tag) => tag.includes(q) || q.includes(tag))) score = 4;
    else if (product.categoryName.toLowerCase().includes(q)) score = 5;
    if (score !== Infinity) scored.push({ product, score });
  }
  // Array.prototype.sort is stable, so equal scores keep catalog order.
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.product);
}

export function searchSuggestions(query: string, products: readonly CatalogProduct[], limit = 6) {
  return searchProducts(query, products).slice(0, limit);
}
