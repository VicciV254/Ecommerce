import type { Product } from "../data/products";

export interface ImageSet {
  front: string;
  side: string;
  top: string;
  closeup: string;
}

export function resolveImageSet(product: Product): ImageSet {
  const gallery = product.gallery_images ?? [];
  const imgs = [product.main_image || product.image, ...gallery];

  while (imgs.length < 4) imgs.push(product.main_image || product.image);

  return { front: imgs[0], side: imgs[1], top: imgs[2], closeup: imgs[3] };
}
