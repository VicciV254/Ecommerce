import { describe, expect, it } from "vitest";
import examples from "../../backend/test/storefront-claim-examples.json";
import { claimsUnmeasuredRanking, headingClaimProblem } from "./storefrontClaims";

/* One table of examples for both sides of the rule; the API's copy is checked in `backend/test/unit/storefrontClaims.test.js`. */

describe("section heading claims", () => {
  it("refuses every shared example that claims a ranking or popularity the store does not measure", () => {
    expect(examples.refused.filter((title) => !claimsUnmeasuredRanking(title))).toEqual([]);
  });

  it("allows every shared example that claims nothing", () => {
    expect(examples.allowed.filter(claimsUnmeasuredRanking)).toEqual([]);
  });

  it("explains a refused heading in the API's words, quoting it as the API trims it", () => {
    expect(headingClaimProblem("  Customers’ picks ")).toBe(
      'Section "Customers’ picks": headings can\'t claim a ranking or popularity the store doesn\'t measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".',
    );
    expect(headingClaimProblem("Staff picks")).toBeNull();
  });
});
