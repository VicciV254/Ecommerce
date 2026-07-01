import type { Product } from "../data/products";

/**
 * Ranked product search.
 *
 * Ranking (best first):
 *   0 — exact name match
 *   1 — name starts with query
 *   2 — name contains query
 *   3 — a tag exactly equals query
 *   4 — a tag contains query
 *   5 — category contains query
 *
 * So searching "shirt" returns products literally named "...Shirt..." first,
 * then everything tagged "shirt" (polos, tees, blouses, flannels, etc.).
 */
export function searchProducts(query: string, catalog: Product[]): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { p: Product; score: number }[] = [];

  for (const p of catalog) {
    const name = p.name.toLowerCase();
    const tags = (p.tags ?? []).map((t) => t.toLowerCase());
    const cat = p.category.toLowerCase();

    let score = Infinity;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (tags.includes(q)) score = 3;
    else if (tags.some((t) => t.includes(q) || q.includes(t))) score = 4;
    else if (cat.includes(q)) score = 5;

    if (score !== Infinity) scored.push({ p, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // tie-break: higher rating first
    return b.p.rating - a.p.rating;
  });

  return scored.map((s) => s.p);
}

/** Lightweight suggestions for the autocomplete dropdown. */
export function searchSuggestions(query: string, catalog: Product[], limit = 6): Product[] {
  return searchProducts(query, catalog).slice(0, limit);
}
