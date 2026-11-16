import { describe, expect, it } from "vitest";
import { MAX_ZOOM, NO_ZOOM, clampZoom, fittedSize, steppedScale, zoomAt } from "./lightboxZoom";

const frame = { width: 400, height: 800 };

describe("image viewer zoom", () => {
  it("fits the image inside the frame at 1×, or fills it when the size is unknown", () => {
    expect(fittedSize(frame, { width: 2400, height: 1200 })).toEqual({ width: 400, height: 200 });
    expect(fittedSize(frame, { width: 1000, height: 4000 })).toEqual({ width: 200, height: 800 });
    expect(fittedSize(frame, null)).toEqual(frame);
  });

  it("keeps the scale between 1× and 4×", () => {
    expect(clampZoom({ scale: 9, x: 0, y: 0 }, frame, frame).scale).toBe(MAX_ZOOM);
    expect(clampZoom({ scale: 0.2, x: 50, y: -50 }, frame, frame)).toEqual(NO_ZOOM);
    const steps = [1];
    for (let press = 0; press < 5; press += 1) steps.push(steppedScale(steps[steps.length - 1], 1));
    expect(steps).toEqual([1, 1.5, 2.25, 3.375, 4, 4]);
    expect(steppedScale(1.2, -1)).toBe(1);
  });

  it("pans only as far as keeps the frame covered, and keeps a smaller axis centred", () => {
    const content = { width: 400, height: 200 };
    // At 2× the image is 800×400: 200px of overflow each side horizontally; vertically it is still shorter than the frame.
    expect(clampZoom({ scale: 2, x: 500, y: 300 }, frame, content)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(clampZoom({ scale: 2, x: -150, y: -300 }, frame, content)).toEqual({ scale: 2, x: -150, y: 0 });
    // At 4× it is 1600×800, which now covers the frame's height exactly: still no vertical movement.
    expect(clampZoom({ scale: 4, x: -900, y: 40 }, frame, content)).toEqual({ scale: 4, x: -600, y: 0 });
  });

  it("zooms about the pinch or tap point, which stays under the finger", () => {
    const content = frame;
    const point = { x: 100, y: -200 };
    const zoomed = zoomAt(NO_ZOOM, 2, point, frame, content);
    expect(zoomed).toEqual({ scale: 2, x: -100, y: 200 });
    // The image point under the finger: (point - translation) / scale is unchanged.
    expect([(point.x - zoomed.x) / zoomed.scale, (point.y - zoomed.y) / zoomed.scale]).toEqual([point.x, point.y]);
    // Zooming back out returns to the untranslated 1× view.
    expect(zoomAt(zoomed, 1, point, frame, content)).toEqual(NO_ZOOM);
  });
});
