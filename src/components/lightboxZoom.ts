/** Zoom and pan arithmetic for the image viewer: bounded scale, and panning that never uncovers the frame. */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Each Zoom in or Zoom out press multiplies or divides the scale by this. */
export const ZOOM_STEP = 1.5;
/** Double-tap or double-click zooms to this scale, or back to 1×. */
export const DOUBLE_TAP_ZOOM = 2;

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
/** `x` and `y` translate the image from the frame's centre, in CSS pixels. */
export type Zoom = { scale: number; x: number; y: number };

export const NO_ZOOM: Zoom = { scale: MIN_ZOOM, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max) + 0;

/** The image's displayed size at 1×, contained in the frame; an unknown natural size fills the frame. */
export function fittedSize(frame: Size, natural: Size | null): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0) return frame;
  const fit = Math.min(frame.width / natural.width, frame.height / natural.height);
  return { width: natural.width * fit, height: natural.height * fit };
}

/**
 * Keeps the scale within 1× and 4×. Along each axis where the zoomed image is larger than the frame, it may move only
 * as far as keeps the frame covered; where it is smaller, it stays centred.
 */
export function clampZoom(zoom: Zoom, frame: Size, content: Size): Zoom {
  const scale = clamp(zoom.scale, MIN_ZOOM, MAX_ZOOM);
  const limitX = Math.max(0, (content.width * scale - frame.width) / 2);
  const limitY = Math.max(0, (content.height * scale - frame.height) / 2);
  return { scale, x: clamp(zoom.x, -limitX, limitX), y: clamp(zoom.y, -limitY, limitY) };
}

/** Zooms to `scale` while the image point under `point` (measured from the frame's centre) stays where it is. */
export function zoomAt(zoom: Zoom, scale: number, point: Point, frame: Size, content: Size): Zoom {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / zoom.scale;
  return clampZoom({ scale: next, x: point.x - (point.x - zoom.x) * ratio, y: point.y - (point.y - zoom.y) * ratio }, frame, content);
}

/** The next step in or out; zooming out from just above 1× lands exactly on 1×. */
export function steppedScale(scale: number, direction: 1 | -1) {
  const next = direction > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
  return clamp(next, MIN_ZOOM, MAX_ZOOM);
}
