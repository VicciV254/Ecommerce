import { isRecord } from "../utils/storage";
import type { CloudinaryUpload, UploadIntent } from "./catalog";

/** A finished signed upload: what a product save sends back, plus Cloudinary's address for previews. */
export type UploadedImage = {
  cloudinary: CloudinaryUpload;
  width: number;
  height: number;
  secureUrl: string;
};

type UploadFailureKind = "rejected" | "network" | "aborted" | "unexpected";

/** Why a direct upload ended without a usable result; `message` is safe to show staff. */
export class UploadFailure extends Error {
  readonly kind: UploadFailureKind;

  constructor(kind: UploadFailureKind, message: string) {
    super(message);
    this.name = "UploadFailure";
    this.kind = kind;
  }
}

const SIGNATURE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const CANCELLED = "Upload cancelled.";
const NETWORK_FAILURE = "The upload could not reach Cloudinary. Check your connection, then retry.";
const UNREADABLE_REPLY = "Cloudinary's reply could not be read. Retry the upload.";

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Cloudinary's success response; anything missing or malformed is not a usable upload. */
function parseUploaded(data: unknown): UploadedImage | null {
  if (!isRecord(data)) return null;
  const { public_id: publicId, version, signature, format, bytes, width, height, secure_url: secureUrl } = data;
  if (
    typeof publicId !== "string" || !publicId || !isPositiveInteger(version) ||
    typeof signature !== "string" || !SIGNATURE.test(signature) || typeof format !== "string" || !format ||
    !isPositiveInteger(bytes) || !isPositiveInteger(width) || !isPositiveInteger(height) || !isHttpsUrl(secureUrl)
  ) return null;
  return { cloudinary: { publicId, version, signature, format, bytes }, width, height, secureUrl };
}

/** Cloudinary reports a refused upload as `{ error: { message } }`. */
function refusalMessage(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.error) || typeof data.error.message !== "string") return null;
  return data.error.message.trim() || null;
}

/**
 * POSTs one file straight to Cloudinary with the intent's signed fields, unchanged and with nothing added.
 * XMLHttpRequest is used because fetch cannot report upload progress; aborting `signal` cancels the request.
 */
export function uploadToCloudinary(
  intent: UploadIntent,
  file: File,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadFailure("aborted", CANCELLED));
      return;
    }
    const body = new FormData();
    for (const [name, value] of Object.entries(intent.fields)) body.append(name, value);
    body.append("file", file);

    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (outcome: () => void) => {
      signal?.removeEventListener("abort", abort);
      outcome();
    };
    request.open("POST", intent.uploadUrl);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => finish(() => {
      if (request.status >= 200 && request.status < 300) {
        const uploaded = parseUploaded(request.response);
        if (uploaded) resolve(uploaded);
        else reject(new UploadFailure("unexpected", UNREADABLE_REPLY));
        return;
      }
      const message = refusalMessage(request.response) ?? `Cloudinary refused the upload (HTTP ${request.status}). Retry the upload.`;
      reject(new UploadFailure("rejected", message));
    });
    request.onerror = () => finish(() => reject(new UploadFailure("network", NETWORK_FAILURE)));
    request.onabort = () => finish(() => reject(new UploadFailure("aborted", CANCELLED)));
    signal?.addEventListener("abort", abort, { once: true });
    request.send(body);
  });
}
