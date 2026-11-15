/**
 * A scriptable XMLHttpRequest and Cloudinary replies for upload tests. Nothing here is imported by the
 * application bundle and nothing reaches a network.
 */
import { vi } from "vitest";
import type { UploadIntent } from "../api/catalog";

export class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  body: FormData | null = null;
  responseType = "";
  status = 0;
  response: unknown = null;
  aborted = false;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: FormData) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.(new ProgressEvent("progress", { lengthComputable: true, loaded, total }));
  }

  respond(status: number, response: unknown) {
    this.status = status;
    this.response = response;
    this.onload?.();
  }

  failNetwork() {
    this.onerror?.();
  }

  /** Form fields in the order they were appended. */
  entries(): [string, FormDataEntryValue][] {
    return this.body ? [...this.body.entries()] : [];
  }
}

/** Replaces the global XMLHttpRequest until `vi.unstubAllGlobals()`. */
export function installFakeXhr() {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}

let intentCount = 0;

/** A signed intent as `POST /media/uploads` returns it; each call names a new public ID. */
export function fixtureUploadIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  intentCount += 1;
  const publicId = `apex-cart/products/20261115-${String(intentCount).padStart(24, "0")}`;
  return {
    uploadUrl: "https://api.cloudinary.com/v1_1/apex-test/image/upload",
    fields: {
      api_key: "123456789012345", timestamp: "1763200000", signature: "f".repeat(40), public_id: publicId,
      asset_folder: "apex-cart/products", allowed_formats: "jpg,png,webp,avif", overwrite: "false",
      tags: "apex-cart,product", transformation: "c_limit,w_3000,h_3000",
    },
    maxBytes: 10_485_760,
    acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    expiresAt: "2026-11-15T10:50:00.000Z",
    ...overrides,
  };
}

/** Cloudinary's success response for an upload made with `intent`. */
export function cloudinaryReply(intent: UploadIntent, overrides: Record<string, unknown> = {}) {
  const publicId = intent.fields.public_id;
  return {
    public_id: publicId, version: 1763200001, signature: "0123456789abcdef0123456789abcdef01234567",
    width: 2400, height: 3000, format: "webp", bytes: 245_000, resource_type: "image",
    secure_url: `https://res.cloudinary.com/apex-test/image/upload/v1763200001/${publicId}.webp`,
    ...overrides,
  };
}

export const imageFile = (name: string, type = "image/webp", size = 1024) =>
  new File([new Uint8Array(size)], name, { type });
