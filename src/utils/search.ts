import type { CatalogCategory, CatalogProduct } from "../api/catalog";
import type { CategoryTree } from "../store/catalogModel";

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

/** Splits a category name into words, so "Phones & Tablets" matches "tab". */
const WORD_BREAK = /[\s&,/()-]+/;

/**
 * Categories at any level whose name matches, best first: exact, prefix, word prefix, then anywhere in the name.
 * Ties go to the broader category, then catalog order. Empty categories are left out: they would list nothing.
 */
export function searchCategories(query: string, tree: CategoryTree, limit = 3): CatalogCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { category: CatalogCategory; score: number; depth: number }[] = [];
  for (const category of tree.byId.values()) {
    if (category.productCount <= 0) continue;
    const name = category.name.toLowerCase();
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(WORD_BREAK).some((word) => word.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    else continue;
    scored.push({ category, score, depth: tree.path(category.id).length });
  }
  return scored.sort((a, b) => a.score - b.score || a.depth - b.depth).slice(0, limit).map((entry) => entry.category);
}
