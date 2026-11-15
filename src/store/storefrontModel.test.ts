import { describe, expect, it } from "vitest";
import { campaignMedia, fixtureStorefront } from "../test-support/catalogFixtures";
import { StorefrontFormatError, parsePublishedStorefront } from "./storefrontModel";

describe("published storefront media", () => {
  it("reads fields that older media payloads omit as null", () => {
    const { variantId: _variant, format: _format, bytes: _bytes, width: _width, height: _height, ...older } = campaignMedia[0];
    const parsed = parsePublishedStorefront({ ...fixtureStorefront(), media: [older] });
    expect(parsed.media).toEqual([{ ...older, variantId: null, format: null, bytes: null, width: null, height: null }]);
  });

  it("rejects malformed uploaded-file facts", () => {
    expect(() => parsePublishedStorefront({ ...fixtureStorefront(), media: [{ ...campaignMedia[0], bytes: "245000" }] }))
      .toThrow(StorefrontFormatError);
  });
});
