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

  describe("the hero carousel", () => {
    const campaign = (id: string) => ({
      id, title: `Campaign ${id}`, body: "", conditions: "", cta: { label: "Shop now", target: "shop" as const, targetId: null },
      desktopMediaId: null, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "split" as const,
    });
    const SIX = ["one", "two", "three", "four", "five", "six"];
    const carouselProblems = (...sections: Section[]) => draftProblems(fixtureStorefrontSettings({ sections, campaigns: SIX.map(campaign) }));
    const carousel = (campaignIds: unknown, extra: Record<string, unknown> = {}) =>
      section("hero-carousel", "carousel", "Highlights", { campaignIds, ...extra });

    it("lists 1 to 5 different campaigns that exist", () => {
      for (let count = 1; count <= 5; count += 1) expect(carouselProblems(carousel(SIX.slice(0, count))), `${count}`).toEqual([]);
      expect(carouselProblems(carousel([]))).toEqual(['"Highlights" needs 1 to 5 campaigns.']);
      expect(carouselProblems(section("hero-carousel", "carousel", "Highlights"))).toEqual(['"Highlights" needs 1 to 5 campaigns.']);
      expect(carouselProblems(carousel(SIX))).toEqual(['"Highlights" needs 1 to 5 campaigns.']);
      expect(carouselProblems(carousel(["one", "one"]))).toEqual(['"Highlights" lists a campaign more than once.']);
      expect(carouselProblems(carousel(["one", "retired"]))).toEqual(['"Highlights" lists a campaign that doesn\'t exist: retired.']);
    });

    it("takes no products, categories, single campaign or layout, and appears once at most", () => {
      expect(carouselProblems(carousel(["one"], { productIds: ["prod-1"] }))).toEqual(['"Highlights" takes no products or categories.']);
      expect(carouselProblems(carousel(["one"], { categoryIds: ["cat-a"] }))).toEqual(['"Highlights" takes no products or categories.']);
      expect(carouselProblems(carousel(["one"], { campaignId: "one" }))).toEqual(['"Highlights" can\'t use a single campaign; only a campaign section does.']);
      expect(carouselProblems(carousel(["one"], { layout: "rail" }))).toEqual(['"Highlights" has no layout to choose.']);
      expect(carouselProblems(carousel(["one"]), section("hero-carousel-2", "carousel", "More", { campaignIds: ["two"], enabled: false })))
        .toEqual(["Only one hero carousel is allowed."]);
    });

    it("lets only a carousel list campaigns", () => {
      expect(carouselProblems(section("hero", "campaign", "Hero", { campaignId: "one", campaignIds: ["one"] })))
        .toEqual(['"Hero" can\'t list campaigns; only a hero carousel does.']);
      expect(carouselProblems(section("featured", "featured", "Featured products", { campaignIds: [] })))
        .toEqual(['"Featured products" can\'t list campaigns; only a hero carousel does.']);
    });

    it("checks the carousel's heading for ranking claims", () => {
      expect(carouselProblems(carousel(["one"], { title: "Trending now" }))).toEqual([
        'Section "Trending now": headings can\'t claim a ranking or popularity the store doesn\'t measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".',
      ]);
    });
  });
});
