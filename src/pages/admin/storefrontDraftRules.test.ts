import { describe, expect, it } from "vitest";
import examples from "../../../backend/test/storefront-section-examples.json";
import type { StorefrontSettings } from "../../api/catalog";
import { isStorefrontSettings } from "../../store/storefrontModel";
import { fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { draftProblems } from "./StorefrontDraft";

/*
 * The API's section rules (P8.7), mirrored by the editor so it never sends a document the API refuses. Both sides are
 * checked against one table of examples; the API's copy is in `backend/test/unit/storefrontSections.test.js`.
 */
type Section = StorefrontSettings["sections"][number];
type Example = { name: string; sections: unknown[]; campaigns?: unknown[] };

const settingsOf = (example: Example) =>
  fixtureStorefrontSettings({ sections: example.sections, campaigns: example.campaigns ?? [] } as Partial<StorefrontSettings>);
/** The editor holds a document back when it can't read it at all or lists a problem with it. */
const heldBack = (settings: StorefrontSettings) => !isStorefrontSettings(settings) || draftProblems(settings).length > 0;
const section = (id: string, type: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra }) as Section;
const problems = (...sections: Section[]) => draftProblems(fixtureStorefrontSettings({ sections }));

describe("the editor's mirror of the API's section rules", () => {
  it("lets every allowed example through", () => {
    for (const example of examples.allowed as Example[]) {
      const settings = settingsOf(example);
      expect(isStorefrontSettings(settings), example.name).toBe(true);
      expect(draftProblems(settings), example.name).toEqual([]);
    }
  });

  it("holds back every refused example", () => {
    for (const example of examples.refused as Example[]) expect(heldBack(settingsOf(example)), example.name).toBe(true);
  });

  it("names the rule each section breaks", () => {
    expect(problems(section("row", "category", "Department row"))).toEqual(['"Department row" needs exactly one department.']);
    expect(problems(section("row", "category", "Two", { categoryIds: ["cat-a", "cat-b"] }))).toEqual(['"Two" needs exactly one department.']);
    expect(problems(section("row", "category", "Fashion", { categoryIds: ["cat-a"], productIds: ["prod-1"] })))
      .toEqual(['"Fashion" shows its department\'s products, not chosen ones.']);
    expect(problems(section("facts", "promises", "How shopping works", { categoryIds: ["cat-a"] })))
      .toEqual(['"How shopping works" takes no products or categories.']);
    expect(problems(section("best", "bestSellers", "Best sellers", { productIds: ["prod-1"] })))
      .toEqual(['"Best sellers" takes no products or categories.']);
    expect(problems(section("facts", "promises", "How shopping works", { layout: "grid" }))).toEqual(['"How shopping works" has no layout to choose.']);
    expect(problems(section("facts", "promises", "One"), section("facts-2", "promises", "Two")))
      .toEqual(["Only one shopping facts section is allowed."]);
    expect(problems(section("best", "bestSellers", "Best sellers"), section("best-2", "bestSellers", "Best sellers")))
      .toEqual(["Only one best sellers section is allowed."]);
    expect(problems(section("best", "bestSellers", "Top picks"))).toEqual(['The best sellers heading is always "Best sellers".']);
  });

  it("checks every heading for ranking claims except the measured best sellers'", () => {
    expect(problems(section("best", "bestSellers", "Best sellers"))).toEqual([]);
    expect(problems(section("featured", "featured", "Best sellers"))).toEqual([
      'Section "Best sellers": headings can\'t claim a ranking or popularity the store doesn\'t measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".',
    ]);
  });
});
