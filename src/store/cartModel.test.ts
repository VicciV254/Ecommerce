import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../api/catalog";
import { demoPhone, fixtureImage, fixtureProduct, fixtureVariant, linenShirt, listPricing, poloShirt } from "../test-support/catalogFixtures";
import { cartEstimate, cartLineViews, clampedAddMessage, mergeChanged, mergeGuestCart, planAdd } from "./cartModel";

const catalog = (products: CatalogProduct[]) => new Map(products.map((product) => [product.id, product]));
const products = catalog([linenShirt, poloShirt, demoPhone]);
const linenM = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const linenS = { productId: linenShirt.id, variantId: "var-linen-s-white", quantity: 1 };
const linenBlue = { productId: linenShirt.id, variantId: "var-linen-m-blue", quantity: 1 };
const polo = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };
const retired = { productId: "prod-retired", variantId: "var-retired", quantity: 2 };

describe("cart line views and the estimated subtotal", () => {
  it("prices each line from the catalog, flags what cannot be ordered and leaves unpriced lines out of the subtotal", () => {
    const lines = cartLineViews([{ ...linenM, quantity: 2 }, { ...polo, quantity: 3 }, linenBlue, retired], products);
    expect(lines.map((line) => [line.key, line.unitPrice, line.subtotal, line.stock, line.problem])).toEqual([
      [`${linenShirt.id}\u0000var-linen-m-white`, 900, 1800, 2, null],
      [`${poloShirt.id}\u0000var-polo`, 2200, 6600, 12, null],
      [`${linenShirt.id}\u0000var-linen-m-blue`, 900, 900, 0, "out-of-stock"],
      [`prod-retired\u0000var-retired`, null, null, 0, "unavailable"],
    ]);
    expect(lines[0].variantLabel).toBe("Size: M · Color: White");
    expect(lines[0].comparePrice).toBe(1000);
    expect(lines[0].image?.id).toBe("img-linen-1");
    // Every priced line counts, flagged or not; a line whose SKU is no longer sold has no price and is left out.
    expect(cartEstimate(lines)).toEqual({ quantity: 8, subtotal: 9300, excluded: 1 });
  });

  it("adds amounts in whole cents, so decimal prices never drift", () => {
    const cents = fixtureProduct({ id: "prod-cents", name: "Cents", variants: [fixtureVariant({ id: "var-cents", pricing: listPricing(0.1) })] });
    const tenths = fixtureProduct({ id: "prod-tenths", name: "Tenths", variants: [fixtureVariant({ id: "var-tenths", pricing: listPricing(0.2) })] });
    const lines = cartLineViews([
      { productId: cents.id, variantId: "var-cents", quantity: 3 },
      { productId: tenths.id, variantId: "var-tenths", quantity: 1 },
    ], catalog([cents, tenths]));
    expect(cartEstimate(lines).subtotal).toBe(0.5);
  });

  it("uses the SKU's own image for a line, as the server does", () => {
    const shirt = fixtureProduct({
      id: "prod-photo", name: "Photo shirt",
      images: [
        fixtureImage({ id: "cover", url: "https://media.example.test/cover.jpg", isMain: true }),
        fixtureImage({ id: "navy", url: "https://media.example.test/navy.jpg", variantId: "var-navy", order: 1 }),
      ],
      variants: [fixtureVariant({ id: "var-navy", attributes: { color: "Navy" } }), fixtureVariant({ id: "var-white", attributes: { color: "White" } })],
    });
    const lines = cartLineViews([
      { productId: shirt.id, variantId: "var-navy", quantity: 1 },
      { productId: shirt.id, variantId: "var-white", quantity: 1 },
    ], catalog([shirt]));
    expect(lines.map((line) => line.image?.id)).toEqual(["navy", "cover"]);
  });
});

describe("adding within stock", () => {
  it("adds in full when the SKU has room, and cuts an identical line down to the stock with a message", () => {
    expect(planAdd([], { ...linenM, quantity: 2 }, 2)).toEqual({ quantity: 2, total: 2, clamped: false });
    const partly = planAdd([{ ...linenM, quantity: 1 }], { ...linenM, quantity: 3 }, 2);
    expect(partly).toEqual({ quantity: 1, total: 2, clamped: true });
    expect(clampedAddMessage(partly, 2)).toBe("Only 2 available, so your cart now has 2.");
    const full = planAdd([{ ...linenM, quantity: 2 }], linenM, 2);
    expect(full).toEqual({ quantity: 0, total: 2, clamped: true });
    expect(clampedAddMessage(full, 2)).toBe("Your cart already has all 2 available, so nothing more was added.");
    expect(clampedAddMessage(planAdd([linenS], linenM, 2), 2)).toBeNull();
  });
});

describe("merging a guest cart into an account", () => {
  it("sums quantities per SKU, clamps to stock and drops lines that cannot be ordered, saying which", () => {
    const outcome = mergeGuestCart(
      [{ ...linenM, quantity: 1 }, linenS],
      [{ ...linenM, quantity: 2 }, { ...polo, quantity: 2 }, linenBlue, retired],
      products,
    );
    expect(outcome.cart).toEqual([{ ...linenM, quantity: 2 }, linenS, { ...polo, quantity: 2 }]);
    expect(outcome.added).toEqual([
      { productId: poloShirt.id, variantId: "var-polo", name: "Cotton Polo Shirt", variantLabel: "", requested: 2, quantity: 2 },
    ]);
    expect(outcome.reduced).toEqual([
      { productId: linenShirt.id, variantId: "var-linen-m-white", name: linenShirt.name, variantLabel: "Size: M · Color: White", requested: 2, quantity: 2 },
    ]);
    expect(outcome.removed.map((entry) => [entry.variantId, entry.reason, entry.name])).toEqual([
      ["var-linen-m-blue", "sold-out", linenShirt.name],
      ["var-retired", "unavailable", "An item you added earlier"],
    ]);
    expect(mergeChanged(outcome)).toBe(true);
  });

  it("is idempotent: once the guest cart is cleared, merging again adds nothing", () => {
    const first = mergeGuestCart([polo], [{ ...polo, quantity: 2 }], products);
    const again = mergeGuestCart(first.cart, [], products);
    expect(again.cart).toEqual(first.cart);
    expect(mergeChanged(again)).toBe(false);
    // Account lines without a guest counterpart are left exactly as they were, even when over stock.
    const untouched = mergeGuestCart([{ ...linenM, quantity: 9 }], [], products);
    expect(untouched.cart).toEqual([{ ...linenM, quantity: 9 }]);
  });
});
