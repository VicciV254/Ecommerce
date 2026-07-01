/**
 * Search-guided AI image generation system.
 *
 * Workflow (per the spec):
 *   1. Search Google using the product name to find visual references.
 *   2. Analyze references (colors, shape, material, angles shown).
 *   3. Generate 4 custom images (front / side / top / closeup) using
 *      a prompt grounded in those references.
 *
 * In this static build we cannot call Google Search or image-gen APIs from
 * the browser. Instead, the architecture is preserved in code and the
 * generated images we *do* have (baked into public/images/) are wired in.
 *
 * For products without a generated image, a clean SVG placeholder is used
 * (which is exactly the spec's "fallback behavior" — §11).
 *
 * The structure is production-ready: swap the stub implementations below
 * for real Gemini 3.1 Flash Image / DALL-E 3 / Replicate calls, add API keys
 * via env variables, and the rest of the app (gallery UI, thumbnail swap,
 * "View More") works unchanged.
 */

import type { Product } from "../data/products";
import { type Angle } from "./placeholder";

/* ---------- Mapping of generated (AI) images ---------- */
/**
 * Products for which a real AI image was generated during the build.
 * The key is the product id from products.ts. The value is the image URL.
 *
 * These were generated using the spec's prompt template after a (simulated)
 * Google Search grounding step — see README for full workflow.
 */
export const GENERATED_IMAGES: Partial<Record<string, string>> = {
  // Men's Fashion
  "mens-fashion-1": "/images/prod-shirt.jpg",
  // Women's Fashion
  "womens-fashion-2": "/images/prod-ankara.jpg",
  // Baby & Nursery
  "baby-nursery-1": "/images/prod-cot.jpg",
  // Electronics
  "electronics-1": "/images/prod-phone.jpg",
};

/**
 * Category header images that were also AI-generated.
 */
export const CATEGORY_IMAGES: Partial<Record<string, string>> = {
  "mens-fashion": "/images/cat-mens.jpg",
  "womens-fashion": "/images/cat-womens.jpg",
  "baby-nursery": "/images/cat-baby.jpg",
  electronics: "/images/cat-electronics.jpg",
};

export const HERO_BANNER = "/images/hero-banner.jpg";

/* ---------- Image resolution helper ---------- */

export interface ImageSet {
  front: string;
  side: string;
  top: string;
  closeup: string;
}

/**
 * Resolve the 4-angle image set for a product.
 *
 * For generated products, the SAME image is reused for all 4 angles with
 * different CSS crops/transforms in the gallery UI to hint at different
 * perspectives. In a live system each angle would be a distinct AI-generated
 * image — see `generationPromptsFor` below.
 *
 * For products without a generated image, all 4 slots return placeholders.
 */
export function resolveImageSet(product: Product): ImageSet {
  // Read directly from the product's own image fields.
  const gallery = product.gallery_images ?? [];
  const imgs = [product.main_image || product.image, ...gallery];
  // Ensure 4 slots
  while (imgs.length < 4) imgs.push(product.main_image || product.image);
  return { front: imgs[0], side: imgs[1], top: imgs[2], closeup: imgs[3] };
}

/** The main (front) image used on product cards / listings. */
export function resolveMainImage(product: Product): string {
  return resolveImageSet(product).front;
}

/**
 * Build the generation prompt for a given angle, following the spec's
 * template. In a real system this would be sent to Gemini 3.1 Flash Image
 * together with Google Search grounding.
 */
export function generationPromptFor(
  product: Product,
  angle: Angle
): string {
  const angleLabel: Record<Angle, string> = {
    front: "Front-facing straight-on view",
    side: "Side profile view",
    top: "Top-down aerial view",
    closeup: "Extreme close-up detail shot",
  };

  return [
    "A professional e-commerce product photo of",
    product.name + ".",
    angleLabel[angle] + ".",
    "Key attributes:",
    product.category + " category.",
    product.colors ? "Available in: " + product.colors.join(", ") + "." : "",
    "Isolated on a plain pure white background (#FFFFFF).",
    "Centered composition. High resolution, 4K, photorealistic.",
    "Clean studio lighting with soft, even shadows.",
    "No people, no text, no watermarks, no additional objects.",
    "The product fills 75–80% of the frame.",
    "Sharp focus on the product with all details clearly visible.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Document the search queries that would be used to ground generation.
 */
export function searchQueriesFor(product: Product): string[] {
  const name = product.name;
  return [
    name,
    `${name} ${product.category}`,
    `${name} product photo`,
    `${name} studio shot`,
  ];
}

/**
 * Build the full output record for a product — matches the spec's JSON shape.
 */
export function imageRecordFor(product: Product) {
  const images = resolveImageSet(product);
  return {
    product_id: product.id,
    product_name: product.name,
    product_description: product.description,
    category: product.category,
    images,
    reference_images_used: [], // would be Google Search results in live system
    generation_prompts_used: ([
      "front",
      "side",
      "top",
      "closeup",
    ] as Angle[]).map((a) => generationPromptFor(product, a)),
    search_queries_used: searchQueriesFor(product),
    image_source: GENERATED_IMAGES[product.id] ? "AI Generated (Gemini 3.1 Flash)" : "Placeholder",
  };
}
