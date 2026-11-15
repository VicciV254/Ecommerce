import { useCallback, useEffect, useRef, useState } from "react";
import { UploadIntentFormatError, requestMediaUpload, type UploadIntent } from "../../api/catalog";
import { UploadFailure, uploadToCloudinary, type UploadedImage } from "../../api/cloudinaryUpload";
import { apiErrorCode, describeApiError } from "../../api/errors";
import { formatFileSize } from "../../utils/format";

type UploadLimits = Pick<UploadIntent, "maxBytes" | "acceptedTypes">;

/** The contract's limits, checked before an upload is requested; each signed intent's own limits are checked again. */
export const UPLOAD_LIMITS: UploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
};
/** Images the catalog API accepts per product. */
export const MAX_PRODUCT_IMAGES = 16;
const MAX_CONCURRENT_UPLOADS = 2;
const TYPE_NAMES: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP", "image/avif": "AVIF" };

export type UploadTarget = { kind: "add" } | { kind: "replace"; rowKey: string };
export type UploadJob = {
  key: string;
  file: File;
  target: UploadTarget;
  status: "queued" | "uploading" | "failed" | "cancelled";
  /** Counts retries, so a superseded attempt can never update the job. */
  attempt: number;
  /** Fraction of the file sent while uploading. */
  progress: number;
  error: string;
};

const typeName = (type: string) => TYPE_NAMES[type] ?? type.split("/").pop()?.toUpperCase() ?? type;

function listTypes(types: readonly string[]) {
  const names = types.map(typeName);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names.join("");
}

/** Why `file` cannot be uploaded under `limits`, or null when it can. */
function fileProblem(file: File, limits: UploadLimits = UPLOAD_LIMITS): string | null {
  if (!limits.acceptedTypes.includes(file.type)) {
    const kind = file.type ? `${typeName(file.type)} files are` : "This file type is";
    return `${kind} not accepted; use ${listTypes(limits.acceptedTypes)}.`;
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > limits.maxBytes) return `It is larger than the ${formatFileSize(limits.maxBytes)} limit.`;
  return null;
}

let jobCounter = 0;
const nextJobKey = () => `upload-${(jobCounter += 1)}`;
/** Waiting for a slot or sending: such a job can still be cancelled and is not finished. */
export const isActiveUpload = (job: UploadJob) => job.status === "queued" || job.status === "uploading";

const FULL = `A product can have at most ${MAX_PRODUCT_IMAGES} images.`;

/**
 * Direct, signed product-image uploads: a fresh intent for every file and attempt, at most two at once.
 * `onUploaded` places each finished upload, or returns why it could not; `rowKeys` are the editor's current images.
 * Cancelled, failed and unplaced files stay listed for retry or dismissal.
 */
export function useImageUploads(
  onUploaded: (target: UploadTarget, image: UploadedImage) => string | null,
  rowKeys: readonly string[],
) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [disabled, setDisabled] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const latestOnUploaded = useRef(onUploaded);
  useEffect(() => {
    latestOnUploaded.current = onUploaded;
  });

  const start = useCallback(async ({ key, file, target, attempt }: UploadJob) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    const current = (job: UploadJob) => job.key === key && job.attempt === attempt;
    const whileUploading = (changes: Partial<UploadJob>) =>
      setJobs((list) => list.map((job) => (current(job) && job.status === "uploading" ? { ...job, ...changes } : job)));
    setJobs((list) => list.map((job) => (current(job) && job.status === "queued" ? { ...job, status: "uploading", progress: 0, error: "" } : job)));
    try {
      const intent = await requestMediaUpload("PRODUCT");
      if (controller.signal.aborted) return;
      const problem = fileProblem(file, intent);
      if (problem) throw new UploadFailure("rejected", problem);
      const image = await uploadToCloudinary(intent, file, {
        signal: controller.signal,
        onProgress: (progress) => whileUploading({ progress }),
      });
      // A cancel that raced the reply still wins; the unused file stays in Cloudinary as an orphan.
      if (controller.signal.aborted) return;
      const refused = latestOnUploaded.current(target, image);
      if (refused) {
        setJobs((list) => list.map((job) => (current(job) ? { ...job, status: "failed", progress: 0, error: `Not added: ${refused}` } : job)));
        setAnnouncement(`${file.name} was uploaded but not added: ${refused}`);
        return;
      }
      setJobs((list) => list.filter((job) => !current(job)));
      setAnnouncement(`${file.name} uploaded. Save the product to keep it.`);
    } catch (reason) {
      // Cancelled attempts were already reported when the cancel was requested.
      if (controller.signal.aborted) return;
      const uploadsOff = apiErrorCode(reason) === "MEDIA_UPLOADS_DISABLED";
      const error = reason instanceof UploadFailure || reason instanceof UploadIntentFormatError
        ? reason.message
        : describeApiError(reason, "The upload could not be prepared.");
      if (uploadsOff) setDisabled(true);
      setJobs((list) => list.map((job) =>
        (current(job) && job.status === "uploading") || (uploadsOff && job.status === "queued")
          ? { ...job, status: "failed", progress: 0, error }
          : job));
      setAnnouncement(`${file.name} was not uploaded: ${error}`);
    } finally {
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
    }
  }, []);

  // Start queued files while fewer than the limit are uploading.
  useEffect(() => {
    const running = jobs.filter((job) => job.status === "uploading").length;
    const waiting = jobs.filter((job) => job.status === "queued").slice(0, Math.max(0, MAX_CONCURRENT_UPLOADS - running));
    for (const job of waiting) void start(job);
  }, [jobs, start]);

  // Closing the editor cancels anything still in flight.
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
    };
  }, []);

  // New images, and replacements whose image was removed meanwhile, each need a free place when they finish.
  const addsRow = (job: UploadJob) => job.target.kind === "add" || !rowKeys.includes(job.target.rowKey);
  const room = MAX_PRODUCT_IMAGES - rowKeys.length - jobs.filter((job) => isActiveUpload(job) && addsRow(job)).length;

  /** Checks each file and queues the acceptable ones, within the product's remaining room for images. */
  const addFiles = (files: readonly File[], target: UploadTarget) => {
    let free = room;
    const accepted: UploadJob[] = [];
    const refused: string[] = [];
    for (const file of files) {
      const problem = fileProblem(file);
      const job: UploadJob = { key: nextJobKey(), file, target, status: "queued", attempt: 0, progress: 0, error: "" };
      if (problem) {
        refused.push(`${file.name}: ${problem}`);
      } else if (addsRow(job) && free <= 0) {
        refused.push(`${file.name}: ${FULL}`);
      } else {
        if (addsRow(job)) free -= 1;
        accepted.push(job);
      }
    }
    setRejections(refused);
    if (accepted.length) setJobs((list) => [...list, ...accepted]);
  };

  const cancel = useCallback((key: string) => {
    const job = jobs.find((item) => item.key === key);
    if (!job || !isActiveUpload(job)) return;
    controllers.current.get(key)?.abort();
    setJobs((list) => list.map((item) => (item.key === key && isActiveUpload(item) ? { ...item, status: "cancelled", progress: 0 } : item)));
    setAnnouncement(`Upload of ${job.file.name} cancelled.`);
  }, [jobs]);

  /** Tries a failed or cancelled file again with a new signed intent, if its image still has a place. */
  const retry = (key: string) => {
    const job = jobs.find((item) => item.key === key);
    if (!job || isActiveUpload(job)) return;
    if (addsRow(job) && room <= 0) {
      setJobs((list) => list.map((item) => (item.key === key ? { ...item, status: "failed", error: FULL } : item)));
      setAnnouncement(`${job.file.name} was not uploaded: ${FULL}`);
      return;
    }
    setJobs((list) => list.map((item) =>
      item.key === key && !isActiveUpload(item) ? { ...item, status: "queued", attempt: item.attempt + 1, progress: 0, error: "" } : item));
  };

  const dismiss = useCallback((key: string) => {
    setJobs((list) => list.filter((job) => job.key !== key || isActiveUpload(job)));
  }, []);

  return {
    jobs,
    rejections,
    announcement,
    /** The server reported that uploads are not configured; image addresses still work. */
    disabled,
    busy: jobs.some(isActiveUpload),
    /** Images that may still be added, after current images and uploads that will add one. */
    room,
    addFiles,
    cancel,
    retry,
    dismiss,
  };
}
