import { describe, expect, it } from "vitest";
import { campaignMedia, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { MAX_FRAME_HEIGHT, PREVIEW_MESSAGES, previewPercent, readDraftMessage, readFrameMessage } from "./storefrontPreviewModel";

const ORIGIN = "http://127.0.0.1:4393";
/** Stand-ins for windows: the readers only compare identity. */
const parentWindow = {} as Window;
const frameWindow = {} as Window;
const otherWindow = {} as Window;

const settings = fixtureStorefrontSettings({ brand: { name: "Apex Cart Draft", tagline: "", logoMediaId: null, faviconMediaId: null } });
const draftData = { type: PREVIEW_MESSAGES.draft, settings, media: campaignMedia };

describe("the frame reads its parent's draft", () => {
  it("accepts the draft its parent posts from its own origin, with media read as the draft editor reads it", () => {
    const { width: _width, height: _height, format: _format, ...olderAsset } = campaignMedia[0];
    const read = readDraftMessage({ source: parentWindow, origin: ORIGIN, data: { ...draftData, media: [olderAsset] } }, parentWindow, ORIGIN);
    expect(read?.settings.brand.name).toBe("Apex Cart Draft");
    expect(read?.media).toEqual([{ ...olderAsset, width: null, height: null, format: null }]);
  });

  it("ignores a draft from another window, even at its own origin", () => {
    expect(readDraftMessage({ source: otherWindow, origin: ORIGIN, data: draftData }, parentWindow, ORIGIN)).toBeNull();
  });

  it("ignores a draft from its parent window at another origin", () => {
    expect(readDraftMessage({ source: parentWindow, origin: "http://evil.example.test", data: draftData }, parentWindow, ORIGIN)).toBeNull();
  });

  it("ignores everything when it has no parent (opened directly)", () => {
    expect(readDraftMessage({ source: null, origin: ORIGIN, data: draftData }, null, ORIGIN)).toBeNull();
  });

  it.each([
    ["another message type", { ...draftData, type: PREVIEW_MESSAGES.ready }],
    ["settings with a section in the wrong shape", { ...draftData, settings: { ...settings, sections: [{ id: "x", type: "carousel" }] } }],
    ["settings without a brand", { ...draftData, settings: { ...settings, brand: undefined } }],
    ["media that is not a list", { ...draftData, media: { 0: campaignMedia[0] } }],
    ["a media asset without an address", { ...draftData, media: [{ ...campaignMedia[0], url: 7 }] }],
    ["no data", null],
  ])("ignores a malformed draft from its parent: %s", (_case, data) => {
    expect(readDraftMessage({ source: parentWindow, origin: ORIGIN, data }, parentWindow, ORIGIN)).toBeNull();
  });
});

describe("the preview reads its frame's reports", () => {
  it("accepts ready and the content height from its own frame, the height rounded up", () => {
    expect(readFrameMessage({ source: frameWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.ready } }, frameWindow, ORIGIN)).toEqual({ type: "ready" });
    expect(readFrameMessage({ source: frameWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.height, height: 1234.2 } }, frameWindow, ORIGIN))
      .toEqual({ type: "height", height: 1235 });
    expect(readFrameMessage({ source: frameWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.height, height: 0 } }, frameWindow, ORIGIN))
      .toEqual({ type: "height", height: 0 });
  });

  it("caps the height at 20,000 px", () => {
    const at = (height: number) => readFrameMessage({ source: frameWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.height, height } }, frameWindow, ORIGIN);
    expect(at(MAX_FRAME_HEIGHT)).toEqual({ type: "height", height: 20_000 });
    expect(at(MAX_FRAME_HEIGHT + 0.5)).toEqual({ type: "height", height: 20_000 });
    expect(at(1e9)).toEqual({ type: "height", height: 20_000 });
  });

  it("ignores reports from another window, even at its own origin", () => {
    expect(readFrameMessage({ source: otherWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.ready } }, frameWindow, ORIGIN)).toBeNull();
    expect(readFrameMessage({ source: otherWindow, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.height, height: 900 } }, frameWindow, ORIGIN)).toBeNull();
  });

  it("ignores reports from its frame's window at another origin", () => {
    expect(readFrameMessage({ source: frameWindow, origin: "http://evil.example.test", data: { type: PREVIEW_MESSAGES.ready } }, frameWindow, ORIGIN)).toBeNull();
  });

  it("ignores everything while it has no frame", () => {
    expect(readFrameMessage({ source: null, origin: ORIGIN, data: { type: PREVIEW_MESSAGES.ready } }, null, ORIGIN)).toBeNull();
  });

  it.each([
    ["a negative height", { type: PREVIEW_MESSAGES.height, height: -1 }],
    ["a height that is not a number", { type: PREVIEW_MESSAGES.height, height: "900" }],
    ["a height that is not finite", { type: PREVIEW_MESSAGES.height, height: Number.POSITIVE_INFINITY }],
    ["no height", { type: PREVIEW_MESSAGES.height }],
    ["the draft message echoed back", draftData],
    ["a string", PREVIEW_MESSAGES.ready],
  ])("ignores a malformed report from its frame: %s", (_case, data) => {
    expect(readFrameMessage({ source: frameWindow, origin: ORIGIN, data }, frameWindow, ORIGIN)).toBeNull();
  });
});

describe("the shown size", () => {
  it("shows a frame that fits at full size, and full size while the space is unmeasured", () => {
    expect(previewPercent(1040, 768)).toBe(100);
    expect(previewPercent(390, 390)).toBe(100);
    expect(previewPercent(0, 1280)).toBe(100);
  });

  it("states the scale of a frame wider than the space as a whole percentage", () => {
    expect(previewPercent(390, 768)).toBe(50);
    expect(previewPercent(390, 1280)).toBe(30);
    expect(previewPercent(1040, 1280)).toBe(81);
    expect(previewPercent(360, 390)).toBe(92);
  });

  it("chooses the largest whole percentage that still fits, never less than 1%", () => {
    for (let available = 13; available < 1280; available += 1) {
      const percent = previewPercent(available, 1280);
      expect(1280 * percent / 100, `${available}px`).toBeLessThanOrEqual(available);
      expect(1280 * (percent + 1) / 100, `${available}px`).toBeGreaterThan(available);
    }
    expect(previewPercent(5, 1280)).toBe(1);
  });
});
