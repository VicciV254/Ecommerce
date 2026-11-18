import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogCategory } from "../api/catalog";
import type { ReturnRule } from "../api/orders";
import { fixtureCategory } from "../test-support/catalogFixtures";
import { returnRuleGroups } from "./returnRules";

const category = (id: string, name: string, parentId: string | null, returnRule: ReturnRule | null = null, extra: Partial<CatalogCategory> = {}) =>
  fixtureCategory({ id, name, parentId, returnRule, ...extra });

describe("return rule groups", () => {
  it("lists each restricted rule's highest categories in category order, with the highest exceptions below them", () => {
    const groups = returnRuleGroups([
      category("baby", "Baby", null, null, { order: 2 }),
      category("feeding", "Feeding", "baby"),
      category("bottles", "Bottles", "feeding", "UNOPENED_OR_FAULT"),
      category("brushes", "Bottle Brushes", "bottles", "STANDARD"),
      category("teats", "Teats", "brushes", "UNOPENED_OR_FAULT"),
      category("health", "Health", null, "UNOPENED_OR_FAULT", { order: 0 }),
      category("skin", "Skin", "health"),
      category("hair", "Hair", "health"),
      category("tools", "Tools", "hair", "STANDARD"),
      category("dryers", "Dryers", "tools"),
      category("fashion", "Fashion", null, null, { order: 1 }),
      category("men", "Men", "fashion", null, { order: 0 }),
      category("men-underwear", "Underwear", "men", "FAULT_ONLY"),
      category("women", "Women", "fashion", null, { order: 1 }),
      category("women-underwear", "Underwear", "women", "FAULT_ONLY"),
      category("garden", "Garden", null, "STANDARD", { order: 3 }),
    ]);
    expect(groups).toEqual({
      UNOPENED_OR_FAULT: [
        { name: "Health", exceptions: ["Tools"] },
        // A rule that returns below an exception starts a group of its own.
        { name: "Bottles", exceptions: ["Bottle Brushes"] },
        { name: "Teats", exceptions: [] },
      ],
      FAULT_ONLY: [{ name: "Men › Underwear", exceptions: [] }, { name: "Women › Underwear", exceptions: [] }],
    });
  });

  it("leaves out inactive categories and everything under them", () => {
    const groups = returnRuleGroups([
      category("fashion", "Fashion", null),
      category("kids", "Kids", "fashion", "FAULT_ONLY", { isActive: false }),
      category("socks", "Socks", "kids", "UNOPENED_OR_FAULT"),
      category("women", "Women", "fashion", "FAULT_ONLY"),
      category("sleepwear", "Sleepwear", "women", "STANDARD", { isActive: false }),
      category("hosiery", "Hosiery", "women"),
    ]);
    expect(groups).toEqual({ UNOPENED_OR_FAULT: [], FAULT_ONLY: [{ name: "Women", exceptions: [] }] });
  });

  it("tells apart same-named groups across both rules, and same-named exceptions within a group", () => {
    const groups = returnRuleGroups([
      category("health", "Health", null, "UNOPENED_OR_FAULT", { order: 0 }),
      category("hair", "Hair", "health", null, { order: 0 }),
      category("hair-tools", "Tools", "hair", "STANDARD"),
      category("body", "Body", "health", null, { order: 1 }),
      category("body-tools", "Tools", "body", "FAULT_ONLY"),
      category("baby", "Baby", null, null, { order: 1 }),
      category("baby-tools", "Tools", "baby", "UNOPENED_OR_FAULT"),
    ]);
    expect(groups).toEqual({
      UNOPENED_OR_FAULT: [
        { name: "Health", exceptions: ["Hair › Tools", "Body › Tools"] },
        { name: "Baby › Tools", exceptions: [] },
      ],
      FAULT_ONLY: [{ name: "Body › Tools", exceptions: [] }],
    });
  });

  it("finds no groups when every category is standard", () => {
    expect(returnRuleGroups([category("a", "A", null), category("b", "B", "a", "STANDARD")]))
      .toEqual({ UNOPENED_OR_FAULT: [], FAULT_ONLY: [] });
  });

  it("matches the seeded taxonomy's rules", () => {
    type Seeded = { id: string; name: string; parentId: string | null; order: number; returnRule?: ReturnRule };
    const { categories } = JSON.parse(readFileSync(resolve(process.cwd(), "backend/src/data/taxonomy.json"), "utf8")) as { categories: Seeded[] };
    const groups = returnRuleGroups(categories.map(({ returnRule = null, ...seeded }) => fixtureCategory({ ...seeded, returnRule })));
    expect(groups).toEqual({
      UNOPENED_OR_FAULT: [
        { name: "Health & Beauty", exceptions: ["Hair Tools"] },
        ...["Bottle-Feeding", "Breastfeeding", "Pacifiers & Accessories", "Disposable Diapers", "Cloth Diapers", "Wipes & Holders"]
          .map((name) => ({ name, exceptions: [] })),
      ],
      FAULT_ONLY: ["Underwear", "Lingerie Sleep & Lounge", "Dairy"].map((name) => ({ name, exceptions: [] })),
    });
  });
});
