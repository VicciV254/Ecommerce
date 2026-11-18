import type { MediaAsset, StorefrontSettings } from "../../api/catalog";
import { withMediaDefaults } from "../../store/catalogModel";
import { isMedia, isStorefrontSettings } from "../../store/storefrontModel";
import { isRecord } from "../../utils/storage";

/**
 * Messages between the draft preview and its frame. Each side posts only to its own origin, and reads a message only
 * from the window it expects (the frame from its parent, the preview from its frame) at its own origin.
 */
export const PREVIEW_MESSAGES = {
  /** Preview to frame: the draft to show, `{ settings, media }`. */
  draft: "apex-cart:storefront-preview:draft",
  /** Frame to preview: mounted and listening for the draft. */
  ready: "apex-cart:storefront-preview:ready",
  /** Frame to preview: its content's height in CSS px, `{ height }`. */
  height: "apex-cart:storefront-preview:height",
} as const;

/** The tallest the frame is shown, in CSS px; anything longer scrolls inside it. */
export const MAX_FRAME_HEIGHT = 20_000;

export type PreviewDraft = { settings: StorefrontSettings; media: MediaAsset[] };
export type FrameReport = { type: "ready" } | { type: "height"; height: number };
type Received = Pick<MessageEvent, "data" | "origin" | "source">;

const fromExpected = (event: Received, expected: Window | null, origin: string) =>
  expected !== null && event.source === expected && event.origin === origin;

/** Frame side: the draft its parent posted, checked as the draft editor checks the API's; null for anything else. */
export function readDraftMessage(event: Received, parent: Window | null, origin: string): PreviewDraft | null {
  if (!fromExpected(event, parent, origin) || !isRecord(event.data)) return null;
  const { type, settings, media } = event.data;
  if (type !== PREVIEW_MESSAGES.draft || !isStorefrontSettings(settings)) return null;
  if (!Array.isArray(media) || !media.every(isMedia)) return null;
  return { settings, media: media.map(withMediaDefaults) };
}

/** Preview side: what its own frame reported, the height rounded up and capped; null for anything else. */
export function readFrameMessage(event: Received, frame: Window | null, origin: string): FrameReport | null {
  if (!fromExpected(event, frame, origin) || !isRecord(event.data)) return null;
  const { type, height } = event.data;
  if (type === PREVIEW_MESSAGES.ready) return { type: "ready" };
  if (type === PREVIEW_MESSAGES.height && typeof height === "number" && Number.isFinite(height) && height >= 0) {
    return { type: "height", height: Math.min(Math.ceil(height), MAX_FRAME_HEIGHT) };
  }
  return null;
}

/**
 * The whole percentage a frame `width` px wide is shown at in `available` px: 100 when it fits, else the largest that
 * fits (at least 1), so the stated percentage is the scale applied. Space not yet measured (0) shows full size.
 */
export function previewPercent(available: number, width: number): number {
  if (!(available > 0) || available >= width) return 100;
  return Math.max(1, Math.floor((available * 100) / width));
}
