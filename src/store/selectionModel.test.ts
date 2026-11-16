import { describe, expect, it } from "vitest";
import { fixtureImage, fixtureProduct, fixtureVariant, linenShirt, listPricing, poloShirt } from "../test-support/catalogFixtures";
import { clampQuantity, galleryImages, lineImage, resolveSelection } from "./selectionModel";

const choiceValues = (product: typeof linenShirt, choices: Record<string, string>, key: string) => {
  const option = resolveSelection(product, choices, 1).options.find((item) => item.key === key);
  return option?.kind === "choice" ? option.values : [];
};

describe("resolveSelection", () => {
  it("shows a single-valued option as a fixed fact and leaves options with several values unselected", () => {
    const product = fixtureProduct({
      id: "prod-tee", name: "Tee",
      variants: [
        fixtureVariant({ id: "tee-m", attributes: { size: "M", color: "White" } }),
        fixtureVariant({ id: "tee-l", attributes: { size: "L", color: "White" } }),
      ],
    });
    const selection = resolveSelection(product, {}, 1);
    expect(selection.options).toEqual([
      { key: "size", label: "Size", kind: "choice", chosen: null, values: [{ value: "M", status: "available" }, { value: "L", status: "available" }] },
      { key: "color", label: "Color", kind: "fixed", value: "White" },
    ]);
    expect(selection.status).toEqual({ kind: "incomplete", missing: ["Size"] });
    // A fixed value is never a choice: picking it changes nothing, and the SKU still needs the size.
    expect(resolveSelection(product, { color: "White" }, 1).choices).toEqual({});
    expect(resolveSelection(product, { size: "L" }, 1).variant?.id).toBe("tee-l");
  });

  it("never picks a SKU until every choice has a value, even when only one is in stock", () => {
    const selection = resolveSelection(linenShirt, {}, 1);
    expect(selection.status).toEqual({ kind: "incomplete", missing: ["Size", "Color"] });
    expect(selection.variant).toBeUndefined();
    expect(selection.canAdd).toBe(false);
    expect(selection.maxQuantity).toBe(0);
    expect(selection.message).toBe("Select size and color to continue.");
    const partial = resolveSelection(linenShirt, { size: "S" }, 1);
    // Only S/White exists, but it is still not chosen for the shopper.
    expect(partial.status).toEqual({ kind: "incomplete", missing: ["Color"] });
    expect(partial.variant).toBeUndefined();
    expect(partial.message).toBe("Select color to continue.");
  });

  it("marks values that are sold out or impossible with the other choices, and refuses those combinations", () => {
    expect(choiceValues(linenShirt, {}, "color")).toEqual([{ value: "White", status: "available" }, { value: "Blue", status: "sold-out" }]);
    expect(choiceValues(linenShirt, { size: "S" }, "color")).toEqual([{ value: "White", status: "available" }, { value: "Blue", status: "unavailable" }]);
    expect(choiceValues(linenShirt, { color: "Blue" }, "size")).toEqual([{ value: "S", status: "unavailable" }, { value: "M", status: "sold-out" }]);

    const impossible = resolveSelection(linenShirt, { size: "S", color: "Blue" }, 1);
    expect(impossible.status).toEqual({ kind: "no-combination" });
    expect(impossible.canAdd).toBe(false);
    expect(impossible.message).toBe("This combination is not available. Choose different options.");

    const soldOut = resolveSelection(linenShirt, { size: "M", color: "Blue" }, 3);
    expect(soldOut.status.kind).toBe("sold-out");
    expect(soldOut.variant?.id).toBe("var-linen-m-blue");
    expect([soldOut.canAdd, soldOut.maxQuantity, soldOut.quantity, soldOut.level]).toEqual([false, 0, 1, "out"]);
    expect(soldOut.message).toBe("This combination is sold out. Choose different options.");
  });

  it("keeps the quantity between 1 and the chosen SKU's stock", () => {
    const ready = resolveSelection(linenShirt, { size: "M", color: "White" }, 5);
    expect(ready.status.kind).toBe("ready");
    expect([ready.canAdd, ready.maxQuantity, ready.quantity, ready.message]).toEqual([true, 2, 2, null]);
    expect(resolveSelection(linenShirt, { size: "M", color: "White" }, 0).quantity).toBe(1);
    expect(resolveSelection(linenShirt, { size: "S", color: "White" }, 2.9).quantity).toBe(2);
    expect([clampQuantity(Number.NaN, 4), clampQuantity(-3, 4), clampQuantity(9, 4), clampQuantity(3, 0)]).toEqual([1, 1, 4, 1]);
  });

  it("drops choices the catalog no longer offers instead of keeping a stale SKU", () => {
    const selection = resolveSelection(linenShirt, { size: "XL", color: "White" }, 1);
    expect(selection.choices).toEqual({ color: "White" });
    expect(selection.status).toEqual({ kind: "incomplete", missing: ["Size"] });
  });

  it("prices the chosen SKU, or the lowest possible price marked as a from-price", () => {
    const product = fixtureProduct({
      id: "prod-priced", name: "Priced",
      variants: [
        fixtureVariant({ id: "p-s", attributes: { size: "S" }, pricing: listPricing(1200) }),
        fixtureVariant({ id: "p-l", attributes: { size: "L" }, pricing: listPricing(1500) }),
      ],
    });
    expect(resolveSelection(product, {}, 1).price).toMatchObject({ price: 1200, isFromPrice: true });
    expect(resolveSelection(product, { size: "L" }, 1).price).toMatchObject({ price: 1500, isFromPrice: false });
  });

  it("reports a product without active SKUs as unavailable, and a sold-out single SKU as sold out", () => {
    const retired = fixtureProduct({ id: "prod-retired", name: "Retired", variants: [fixtureVariant({ id: "r", isActive: false })] });
    expect(resolveSelection(retired, {}, 1)).toMatchObject({ status: { kind: "unavailable" }, canAdd: false, message: "This product is not currently available." });
    const empty = fixtureProduct({ id: "prod-empty", name: "Empty", variants: [fixtureVariant({ id: "e", stock: 0 })] });
    expect(resolveSelection(empty, {}, 1)).toMatchObject({ status: { kind: "sold-out" }, message: "This product is sold out." });
    expect(resolveSelection(poloShirt, {}, 4)).toMatchObject({ status: { kind: "ready" }, quantity: 4, options: [] });
  });
});

describe("gallery order", () => {
  const image = (id: string, variantId: string | null, order: number, isMain = false) =>
    fixtureImage({ id, url: `https://media.example.test/${id}.jpg`, variantId, order, isMain });
  const product = fixtureProduct({
    id: "prod-gallery", name: "Gallery shirt",
    images: [
      image("blue-front", "g-m-blue", 0),
      image("general-detail", null, 2),
      image("white-front", "g-m-white", 1),
      image("cover", null, 3, true),
      image("retired", "g-retired", 4),
      image("small-white", "g-s-white", 5),
    ],
    variants: [
      fixtureVariant({ id: "g-s-white", attributes: { size: "S", color: "White" } }),
      fixtureVariant({ id: "g-m-white", attributes: { size: "M", color: "White" } }),
      fixtureVariant({ id: "g-m-blue", attributes: { size: "M", color: "Blue" }, stock: 0 }),
      fixtureVariant({ id: "g-retired", attributes: { size: "L", color: "Red" }, isActive: false }),
    ],
  });
  const ids = (choices: Record<string, string>) => galleryImages(product, resolveSelection(product, choices, 1)).map((item) => item.id);

  it("shows general images first, then images of active SKUs, before any choice", () => {
    expect(ids({})).toEqual(["cover", "general-detail", "blue-front", "white-front", "small-white"]);
  });

  it("puts images of the still-possible SKUs first after a choice and hides those of excluded SKUs", () => {
    expect(ids({ color: "Blue" })).toEqual(["blue-front", "cover", "general-detail"]);
    expect(ids({ size: "M" })).toEqual(["blue-front", "white-front", "cover", "general-detail"]);
    expect(ids({ size: "S", color: "White" })).toEqual(["small-white", "cover", "general-detail"]);
  });

  it("picks a cart line's image as the server does: the SKU's first image, else the cover", () => {
    expect(lineImage(product.images, "g-m-white")?.id).toBe("white-front");
    expect(lineImage(product.images, "unknown")?.id).toBe("cover");
    const variantOnly = [image("v2", "other", 2), image("v1", "other", 1, true)];
    expect(lineImage(variantOnly, "missing")?.id).toBe("v1");
    expect(lineImage([], "missing")).toBeUndefined();
  });
});
