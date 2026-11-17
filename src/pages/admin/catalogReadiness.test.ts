import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import { demoPhone, fixtureCategories, fixtureImage, fixtureVariant, linenShirt } from "../../test-support/catalogFixtures";
import { PRODUCT_READINESS } from "./adminRoutes";
import {
  HIDDEN_LABEL,
  READINESS_CHECKS,
  VISIBLE_LABEL,
  matchesReadiness,
  needsImages,
  productReadiness,
  readinessLabels,
  visibilityLabel,
} from "./catalogReadiness";

const tree = buildCategoryTree(fixtureCategories);
const hide = (...ids: string[]) => buildCategoryTree(fixtureCategories.map((category) => ({ ...category, isActive: !ids.includes(category.id) })));
const photo = fixtureImage({ id: "img-real", url: "https://media.example.test/real.jpg", isMain: true });
const sample = fixtureImage({ id: "img-sample", url: "https://media.example.test/sample.jpg", isPlaceholder: true, sourceUrl: "https://example.test/s", license: "Test" });
/** A hidden draft with a real photo, one active option with units, in a visible category: ready to publish. */
const draft: CatalogProduct = {
  ...linenShirt, isActive: false, isDemo: false, images: [photo],
  variants: [fixtureVariant({ id: "var-ready", stock: 3 })],
};

describe("product readiness", () => {
  it("calls a hidden, non-demo product with no open check ready to publish", () => {
    expect(productReadiness(draft, tree)).toEqual({ open: [], hiddenCategory: null, demo: false, readyToPublish: true });
    expect(readinessLabels(productReadiness(draft, tree))).toEqual(["Ready to publish"]);
  });

  it("needs images when there are none or only sample images; one real photo is enough", () => {
    expect(needsImages({ images: [] })).toBe(true);
    expect(needsImages({ images: [sample] })).toBe(true);
    expect(needsImages({ images: [sample, photo] })).toBe(false);
    expect(productReadiness({ ...draft, images: [sample] }, tree).open).toEqual(["needs-images"]);
  });

  it("counts only active options: none active means no active option and nothing to sell", () => {
    const inactive = { ...draft, variants: [fixtureVariant({ id: "var-off", stock: 9, isActive: false })] };
    expect(productReadiness(inactive, tree).open).toEqual(["no-active-option", "out-of-stock"]);
    expect(productReadiness({ ...draft, variants: [] }, tree).open).toEqual(["no-active-option", "out-of-stock"]);
  });

  it("is out of stock when no active option has available units; reserved units are not available", () => {
    const empty = { ...draft, variants: [fixtureVariant({ id: "var-a", stock: 0, reserved: 2 }), fixtureVariant({ id: "var-b", stock: 0 })] };
    expect(productReadiness(empty, tree).open).toEqual(["out-of-stock"]);
    const someLeft = { ...empty, variants: [...empty.variants, fixtureVariant({ id: "var-c", stock: 1 })] };
    expect(productReadiness(someLeft, tree).open).toEqual([]);
  });

  it("flags a hidden category or any hidden category above it, naming the highest hidden one", () => {
    expect(productReadiness(draft, hide("cat-shirts"))).toMatchObject({ open: ["category-hidden"], hiddenCategory: { id: "cat-shirts" } });
    expect(productReadiness(draft, hide("cat-fashion"))).toMatchObject({ open: ["category-hidden"], hiddenCategory: { id: "cat-fashion" } });
    expect(productReadiness(draft, hide("cat-men", "cat-shirts")).hiddenCategory?.id).toBe("cat-men");
    expect(productReadiness(draft, hide("cat-smartphones")).open).toEqual([]);
    // A category missing from the snapshot cannot be reached by shoppers either.
    expect(productReadiness({ ...draft, categoryId: "cat-missing" }, tree)).toMatchObject({ open: ["category-hidden"], hiddenCategory: null });
  });

  it("reports demo listings for information only, and never calls them or visible products ready to publish", () => {
    const demoDraft = { ...draft, isDemo: true };
    expect(productReadiness(demoDraft, tree)).toEqual({ open: [], hiddenCategory: null, demo: true, readyToPublish: false });
    expect(readinessLabels(productReadiness(demoDraft, tree))).toEqual(["Demo listing"]);
    expect(productReadiness({ ...draft, isActive: true }, tree).readyToPublish).toBe(false);
    expect(readinessLabels(productReadiness({ ...draft, isActive: true }, tree))).toEqual([]);
  });

  it("labels open checks in checklist order, then demo, and names visibility in words", () => {
    const everything = { ...demoPhone, isActive: false, variants: [] };
    expect(readinessLabels(productReadiness(everything, hide("cat-phones-tablets"))))
      .toEqual(["Needs images", "No active option", "Out of stock", "Category hidden", "Demo listing"]);
    expect(READINESS_CHECKS.map((check) => check.id)).toEqual(["needs-images", "no-active-option", "out-of-stock", "category-hidden"]);
    expect([visibilityLabel(false), visibilityLabel(true)]).toEqual([HIDDEN_LABEL, VISIBLE_LABEL]);
    expect([HIDDEN_LABEL, VISIBLE_LABEL]).toEqual(["Hidden (draft)", "Visible to shoppers"]);
  });

  it("matches each readiness filter value", () => {
    const ready = productReadiness(draft, tree);
    const blocked = productReadiness({ ...draft, images: [], variants: [fixtureVariant({ id: "var-z", stock: 0 })] }, hide("cat-men"));
    expect(PRODUCT_READINESS).toEqual(["ready", "needs-images", "out-of-stock", "category-hidden"]);
    expect(PRODUCT_READINESS.map((filter) => matchesReadiness(ready, filter))).toEqual([true, false, false, false]);
    expect(PRODUCT_READINESS.map((filter) => matchesReadiness(blocked, filter))).toEqual([false, true, true, true]);
  });
});
