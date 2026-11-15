import { useId, useLayoutEffect, useRef } from "react";
import type { CatalogProduct, CatalogVariant, MediaInput } from "../../api/catalog";
import type { UploadedImage } from "../../api/cloudinaryUpload";
import { ResponsiveImage } from "../../components/ui";
import { describeVariant } from "../../store/catalogModel";
import { formatFileSize } from "../../utils/format";
import { dangerButtonClass, inputClass, isAcceptedImageUrl, smallButtonClass } from "./shared";
import { MAX_PRODUCT_IMAGES, UPLOAD_LIMITS, isActiveUpload, type UploadJob, type UploadTarget, type useImageUploads } from "./useImageUploads";

/** An uploaded file's facts; such an image's file never changes in place. */
type UploadedFile = { format: string; bytes: number | null; width: number | null; height: number | null };

export type ImageRow = {
  rowKey: string;
  /** Saved image ID; images added in this editor have none until the product is saved. */
  id?: string;
  /** A URL image's editable address, or an uploaded file's delivery address (preview only). */
  url: string;
  /** Saved or new uploads; their address and dimensions are never sent back. */
  file: UploadedFile | null;
  /** A new upload's verified result, sent once with the product save. */
  upload: UploadedImage | null;
  alt: string;
  /** The saved variant this image shows, or null for the whole product. */
  variantId: string | null;
  isPlaceholder: boolean;
  sourceUrl: string;
  license: string;
  credit: string;
};

let imageCounter = 0;
const nextImageKey = () => `image-${(imageCounter += 1)}`;
const UNSET_DETAILS = { alt: "", variantId: null, isPlaceholder: false, sourceUrl: "", license: "", credit: "" };

export function initialGallery(product: CatalogProduct | null): { rows: ImageRow[]; cover: number } {
  // Saved gallery order (then ID), not the cover-first display order, so saving again keeps every position.
  const images = [...(product?.images ?? [])].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = images.map((image) => ({
    rowKey: nextImageKey(),
    id: image.id,
    url: image.url,
    file: image.format === null ? null : { format: image.format, bytes: image.bytes, width: image.width, height: image.height },
    upload: null,
    alt: image.alt ?? "",
    variantId: image.variantId,
    isPlaceholder: image.isPlaceholder,
    sourceUrl: image.sourceUrl ?? "",
    license: image.license ?? "",
    credit: image.credit ?? "",
  }));
  return { rows, cover: Math.max(0, images.findIndex((image) => image.isMain)) };
}

function urlImageRow(): ImageRow {
  return { rowKey: nextImageKey(), url: "", file: null, upload: null, ...UNSET_DETAILS };
}

export function uploadedImageRow(upload: UploadedImage): ImageRow {
  const { format, bytes } = upload.cloudinary;
  return {
    rowKey: nextImageKey(), url: upload.secureUrl, file: { format, bytes, width: upload.width, height: upload.height }, upload,
    ...UNSET_DETAILS,
  };
}

/**
 * Places a finished upload. A replacement takes the replaced image's position, alt text and variant (the cover
 * follows the position); its sample details start unset. If that image was removed meanwhile, the upload is added
 * when the product has room. Returns null when there is no place for it.
 */
export function placeUpload(rows: ImageRow[], target: UploadTarget, row: ImageRow): ImageRow[] | null {
  const index = target.kind === "replace" ? rows.findIndex((item) => item.rowKey === target.rowKey) : -1;
  if (index < 0) return rows.length < MAX_PRODUCT_IMAGES ? [...rows, row] : null;
  return rows.map((item, position) => (position === index ? { ...row, alt: item.alt, variantId: item.variantId } : item));
}

/** The `images` payload: retained images send their ID; uploads send `cloudinary` and never an address. */
export function buildImages(rows: readonly ImageRow[], mainImage: number): MediaInput[] {
  return rows.map((row, index) => {
    const details: MediaInput = {
      alt: row.alt.trim() || null,
      isMain: index === mainImage,
      order: index,
      variantId: row.variantId,
      isPlaceholder: row.isPlaceholder,
      sourceUrl: row.sourceUrl.trim() || null,
      license: row.license.trim() || null,
      credit: row.credit.trim() || null,
    };
    if (row.upload) return { cloudinary: row.upload.cloudinary, width: row.upload.width, height: row.upload.height, ...details };
    if (row.id) return row.file ? { id: row.id, ...details } : { id: row.id, url: row.url.trim(), ...details };
    return { url: row.url.trim(), ...details };
  });
}

export function imageProblems(rows: readonly ImageRow[]): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    if (!row.file && !isAcceptedImageUrl(row.url.trim())) problems.push("Image addresses must be HTTPS URLs or /images/ paths.");
    if (row.isPlaceholder && (!isAcceptedImageUrl(row.sourceUrl.trim()) || !row.license.trim())) {
      problems.push("Sample images need their source URL and reuse licence.");
    }
  }
  if (rows.length > MAX_PRODUCT_IMAGES) problems.push(`A product can have at most ${MAX_PRODUCT_IMAGES} images.`);
  return problems;
}

function variantLabel(variant: CatalogVariant) {
  const label = describeVariant(variant) || variant.sku;
  return variant.isActive ? label : `${label} (inactive)`;
}

function fileFacts(file: UploadedFile) {
  const size = file.bytes === null ? null : formatFileSize(file.bytes);
  const dimensions = file.width && file.height ? `${file.width} × ${file.height} px` : null;
  return ["Uploaded", file.format.toUpperCase(), size, dimensions].filter(Boolean).join(" · ");
}

const labelClass = "mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600";
/** Touch targets are sized in px so doubled text cannot double them. */
const actionClass = `${smallButtonClass} min-h-[44px] min-w-[44px]`;
const removeClass = `${dangerButtonClass} min-h-[44px] min-w-[44px]`;
const ACCEPT = UPLOAD_LIMITS.acceptedTypes.join(",");

function Preview({ row, className = "" }: { row: ImageRow; className?: string }) {
  const url = row.url.trim();
  return (
    <div className={`relative h-[72px] w-[72px] overflow-hidden rounded-sm bg-warm-beige md:h-[96px] md:w-[96px] ${className}`}>
      {(row.file !== null || isAcceptedImageUrl(url)) && (
        <ResponsiveImage url={url} preset="thumbnail" width={row.file?.width} height={row.file?.height} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

function ImageHeading({ row, number, isMain }: { row: ImageRow; number: number; isMain: boolean }) {
  const badge = "rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider";
  return (
    <div className="min-w-0 space-y-1">
      <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-brand-primary">
        Image {number}
        {isMain && <span className={`${badge} bg-brand-secondary/25 text-brand-accent`}>Cover</span>}
        {row.upload && <span className={`${badge} bg-ocean-blue/15 text-ocean-blue-dark`}>Unsaved upload</span>}
        {!row.id && !row.upload && <span className={`${badge} bg-gray-100 text-gray-600`}>New</span>}
      </h4>
      <p className="text-[11px] text-gray-600 [overflow-wrap:anywhere]">{row.file ? fileFacts(row.file) : "Image URL"}</p>
    </div>
  );
}

type CardProps = {
  row: ImageRow;
  index: number;
  count: number;
  isMain: boolean;
  radioName: string;
  variants: readonly CatalogVariant[];
  canReplace: boolean;
  replacing: boolean;
  /** A save is in flight: nothing may change until it settles. */
  locked: boolean;
  onPatch: (patch: Partial<ImageRow>) => void;
  onMain: () => void;
  onMove: (offset: number) => void;
  onReplace: () => void;
  onRemove: () => void;
};

function ImageCard({ row, index, count, isMain, radioName, variants, canReplace, replacing, locked, onPatch, onMain, onMove, onReplace, onRemove }: CardProps) {
  const number = index + 1;
  const altId = useId();
  const urlId = useId();
  const variantId = useId();
  const validUrl = row.file !== null || isAcceptedImageUrl(row.url.trim());
  return (
    <li data-row-list="image" data-row-index={index} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-md border border-light-gray p-3 md:grid-cols-[96px_minmax(0,1fr)]">
      <Preview row={row} className="md:row-span-2" />
      <ImageHeading row={row} number={number} isMain={isMain} />
      <div className="col-span-2 space-y-3 md:col-span-1 md:col-start-2">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={altId} className={labelClass}>Alt text</label>
            <input id={altId} aria-label={`Image ${number} alt text`} value={row.alt} disabled={locked} onChange={(event) => onPatch({ alt: event.target.value })} placeholder="Describe the image" className={inputClass} />
          </div>
          {!row.file && (
            <div>
              <label htmlFor={urlId} className={labelClass}>Image URL</label>
              <input id={urlId} aria-label={`Image ${number} URL`} value={row.url} disabled={locked} onChange={(event) => onPatch({ url: event.target.value })} placeholder="https://…" aria-invalid={!validUrl} className={inputClass} />
            </div>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 md:items-end">
          <div className="flex flex-wrap items-center gap-x-5 text-xs text-charcoal">
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name={radioName} checked={isMain} disabled={locked} onChange={onMain} aria-label={`Image ${number} is the cover image`} className="h-4 w-4 accent-brand-secondary" />
              Cover image
            </label>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" checked={row.isPlaceholder} disabled={locked} onChange={(event) => onPatch({ isPlaceholder: event.target.checked })} aria-label={`Image ${number} is a sample image`} className="h-4 w-4 accent-brand-secondary" />
              Sample image
            </label>
          </div>
          {variants.length > 0 && (
            <div>
              <label htmlFor={variantId} className={labelClass}>Variant</label>
              <select id={variantId} aria-label={`Image ${number} variant`} value={row.variantId ?? ""} disabled={locked} onChange={(event) => onPatch({ variantId: event.target.value || null })} className={inputClass}>
                <option value="">All variants</option>
                {variants.map((variant) => <option key={variant.id} value={variant.id}>{variantLabel(variant)}</option>)}
              </select>
            </div>
          )}
        </div>
        {row.isPlaceholder && (
          <div className="grid gap-2 sm:grid-cols-3">
            <input aria-label={`Image ${number} source URL`} value={row.sourceUrl} disabled={locked} onChange={(event) => onPatch({ sourceUrl: event.target.value })} placeholder="Source page (https://…)" className={inputClass} />
            <input aria-label={`Image ${number} licence`} value={row.license} disabled={locked} onChange={(event) => onPatch({ license: event.target.value })} placeholder="Reuse licence" className={inputClass} />
            <input aria-label={`Image ${number} credit`} value={row.credit} disabled={locked} onChange={(event) => onPatch({ credit: event.target.value })} placeholder="Credit (optional)" className={inputClass} />
          </div>
        )}
        <div data-row-actions className="flex flex-wrap gap-2">
          <button type="button" aria-label={`Move image ${number} up`} disabled={locked || index === 0} onClick={() => onMove(-1)} className={actionClass}>
            <span aria-hidden="true">↑ </span>Up
          </button>
          <button type="button" aria-label={`Move image ${number} down`} disabled={locked || index === count - 1} onClick={() => onMove(1)} className={actionClass}>
            <span aria-hidden="true">↓ </span>Down
          </button>
          {canReplace && (
            <button type="button" aria-label={`Replace image ${number}`} disabled={locked || replacing} onClick={onReplace} className={actionClass}>
              {replacing ? "Replacing…" : "Replace"}
            </button>
          )}
          <button type="button" aria-label={`Remove image ${number}`} disabled={locked} onClick={onRemove} className={removeClass}>Remove</button>
        </div>
      </div>
    </li>
  );
}

/** What a viewer sees: the same facts with no controls. */
function ImageSummary({ row, index, isMain, variants }: { row: ImageRow; index: number; isMain: boolean; variants: readonly CatalogVariant[] }) {
  const variant = row.variantId ? variants.find((item) => item.id === row.variantId) : undefined;
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-md border border-light-gray p-3 md:grid-cols-[96px_minmax(0,1fr)]">
      <Preview row={row} />
      <div className="min-w-0 space-y-1 text-xs text-charcoal [overflow-wrap:anywhere]">
        <ImageHeading row={row} number={index + 1} isMain={isMain} />
        {!row.file && <p className="text-gray-600">{row.url}</p>}
        <p><span className="font-semibold">Alt text:</span> {row.alt || "None"}</p>
        <p><span className="font-semibold">Variant:</span> {variant ? variantLabel(variant) : row.variantId ?? "All variants"}</p>
        {row.isPlaceholder && (
          <p><span className="font-semibold">Sample image</span>{row.license && ` · ${row.license}`}{row.credit && ` · ${row.credit}`}</p>
        )}
      </div>
    </li>
  );
}

function UploadRow({ job, index, replaces, canRetry, locked, onCancel, onRetry, onDismiss }: {
  job: UploadJob;
  index: number;
  replaces: string | null;
  canRetry: boolean;
  /** A save is in flight: a retry could add an image the save misses. */
  locked: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const actions = useRef<HTMLDivElement>(null);
  const keepFocus = useRef(false);
  // Cancel and Retry swap places; keep keyboard focus on the row's next action.
  useLayoutEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    actions.current?.querySelector("button")?.focus();
  }, [job.status, job.attempt]);
  const withFocus = (action: () => void) => () => {
    keepFocus.current = true;
    action();
  };
  const name = job.file.name;
  const percent = Math.round(job.progress * 100);
  const active = isActiveUpload(job);
  const status = {
    queued: "Waiting to upload",
    uploading: percent < 100 ? `Uploading… ${percent}%` : "Finishing…",
    cancelled: "Cancelled",
    failed: job.error,
  }[job.status];
  return (
    <li data-row-list="upload" data-row-index={index} className="grid gap-2 rounded-md border border-light-gray bg-off-white p-3 md:grid-cols-[minmax(0,1fr)_minmax(112px,176px)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-brand-primary" title={name}>{name}</p>
        <p className={`text-[11px] [overflow-wrap:anywhere] ${job.status === "failed" ? "font-semibold text-error" : "text-gray-600"}`}>
          {replaces && `${replaces} · `}{status}
        </p>
      </div>
      {job.status === "uploading"
        ? <progress max={100} value={percent} aria-label={`Upload progress for ${name}`} className="h-2 w-full accent-brand-secondary" />
        : <span aria-hidden="true" className="hidden md:block" />}
      <div ref={actions} data-row-actions className="flex flex-wrap gap-2">
        {active && <button type="button" aria-label={`Cancel upload of ${name}`} onClick={withFocus(onCancel)} className={actionClass}>Cancel</button>}
        {!active && canRetry && <button type="button" aria-label={`Retry upload of ${name}`} disabled={locked} onClick={withFocus(onRetry)} className={actionClass}>Retry</button>}
        {!active && <button type="button" aria-label={`Dismiss ${name}`} onClick={onDismiss} className={actionClass}>Dismiss</button>}
      </div>
    </li>
  );
}

type SectionProps = {
  rows: ImageRow[];
  mainImage: number;
  /** Viewers see the images with no upload or edit controls. */
  canWrite: boolean;
  /** A save is in flight: every image control waits, so nothing changes that the saved payload misses. */
  locked: boolean;
  /** Saved variants, the only ones an image can be linked to. */
  variants: readonly CatalogVariant[];
  variantHint: string | null;
  uploads: ReturnType<typeof useImageUploads>;
  onEdit: (update: (rows: ImageRow[]) => ImageRow[]) => void;
  onMainChange: (index: number) => void;
  onMove: (index: number, offset: number) => void;
  onRemove: (index: number) => void;
};

export function ProductImagesSection({
  rows, mainImage, canWrite, locked, variants, variantHint, uploads, onEdit, onMainChange, onMove, onRemove,
}: SectionProps) {
  const headingId = useId();
  const uploadId = useId();
  const uploadHintId = useId();
  const radioName = useId();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const addUrlButton = useRef<HTMLButtonElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const focusedRow = useRef<{ element: Element; list: string; index: number } | null>(null);
  const full = uploads.room <= 0;

  // A removed image or a finished upload may take the focused control with it: keep focus in the editor.
  useLayoutEffect(() => {
    const lost = focusedRow.current;
    if (!lost || lost.element.isConnected || !section.current) return;
    focusedRow.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName !== "DIALOG") return;
    const remaining = section.current.querySelectorAll<HTMLElement>(`[data-row-list="${lost.list}"]`);
    const firstAction = (row: HTMLElement | undefined) => row?.querySelector<HTMLElement>("[data-row-actions] button:not(:disabled)");
    const usable = (control: HTMLInputElement | HTMLButtonElement | null) => (control && !control.disabled ? control : null);
    const target = firstAction(remaining[lost.index]) ?? firstAction(remaining[lost.index - 1]) ??
      usable(uploadInput.current) ?? usable(addUrlButton.current) ?? heading.current;
    target?.focus();
  });
  const replacing = new Set(uploads.jobs.flatMap((job) =>
    job.target.kind === "replace" && isActiveUpload(job) ? [job.target.rowKey] : []));
  const replaces = (job: UploadJob) => {
    if (job.target.kind !== "replace") return null;
    const { rowKey } = job.target;
    const index = rows.findIndex((row) => row.rowKey === rowKey);
    return index < 0 ? "Will be added as a new image; the one it replaced was removed" : `Replaces image ${index + 1}`;
  };
  const patch = (rowKey: string, changes: Partial<ImageRow>) =>
    onEdit((list) => list.map((item) => (item.rowKey === rowKey ? { ...item, ...changes } : item)));
  const addUrlImage = () => {
    const row = urlImageRow();
    onEdit((list) => [...list, row]);
  };

  return (
    <section
      ref={section}
      aria-labelledby={headingId}
      className="space-y-3"
      onFocus={(event) => {
        const row = event.target.closest<HTMLElement>("[data-row-list]");
        focusedRow.current = row ? { element: event.target, list: row.dataset.rowList ?? "", index: Number(row.dataset.rowIndex) } : null;
      }}
    >
      <h3 ref={heading} id={headingId} tabIndex={-1} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">Images</h3>
      {!canWrite && <p className="text-[11px] text-gray-600">View only: your role can see these images but cannot change them.</p>}
      {canWrite && (
        <div className="space-y-3 rounded-md border border-dashed border-light-gray p-3">
          <div>
            <label htmlFor={uploadId} className={labelClass}>Upload images</label>
            <input
              ref={uploadInput}
              id={uploadId}
              type="file"
              multiple
              accept={ACCEPT}
              disabled={locked || uploads.disabled || full}
              aria-describedby={uploadHintId}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                uploads.addFiles(files, { kind: "add" });
              }}
              className="block min-h-[44px] w-full text-xs text-charcoal file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-sm file:border-0 file:bg-brand-primary file:px-4 file:text-[11px] file:font-bold file:uppercase file:tracking-wider file:text-white disabled:opacity-60"
            />
            <p id={uploadHintId} className="mt-1 text-[11px] text-gray-600">
              JPEG, PNG, WebP or AVIF, up to {formatFileSize(UPLOAD_LIMITS.maxBytes)} each. Uploads appear below and are kept only when you save the product.
              {full && ` This product has reached the ${MAX_PRODUCT_IMAGES}-image limit.`}
            </p>
          </div>
          {uploads.disabled && (
            <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-charcoal">
              Image uploads are not configured. You can still add images by URL.
            </p>
          )}
          <div role="status" className="text-xs text-error [overflow-wrap:anywhere]">
            {uploads.rejections.length > 0 && (
              <>
                <p className="font-semibold">Not uploaded:</p>
                <ul className="list-inside list-disc">{uploads.rejections.map((message) => <li key={message}>{message}</li>)}</ul>
              </>
            )}
          </div>
          <p role="status" className="sr-only">{uploads.announcement}</p>
          {uploads.jobs.length > 0 && (
            <ul aria-label="Uploads" className="space-y-2">
              {uploads.jobs.map((job, index) => (
                <UploadRow
                  key={job.key}
                  job={job}
                  index={index}
                  replaces={replaces(job)}
                  canRetry={!uploads.disabled}
                  locked={locked}
                  onCancel={() => uploads.cancel(job.key)}
                  onRetry={() => uploads.retry(job.key)}
                  onDismiss={() => {
                    uploads.dismiss(job.key);
                    uploadInput.current?.focus();
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {canWrite && variantHint && <p className="text-[11px] text-gray-600">{variantHint}</p>}
      {!rows.length && (
        <p className="rounded-md bg-warning/10 p-3 text-xs font-semibold text-charcoal">Needs images: shoppers will see an “image not yet available” placeholder.</p>
      )}
      {rows.length > 0 && (
        <ol aria-label="Product images" className="space-y-3">
          {rows.map((row, index) => canWrite ? (
            <ImageCard
              key={row.rowKey}
              row={row}
              index={index}
              count={rows.length}
              isMain={index === mainImage}
              radioName={radioName}
              variants={variants}
              canReplace={!uploads.disabled}
              replacing={replacing.has(row.rowKey)}
              locked={locked}
              onPatch={(changes) => patch(row.rowKey, changes)}
              onMain={() => onMainChange(index)}
              onMove={(offset) => onMove(index, offset)}
              onReplace={() => {
                replaceTarget.current = row.rowKey;
                replaceInput.current?.click();
              }}
              onRemove={() => onRemove(index)}
            />
          ) : (
            <ImageSummary key={row.rowKey} row={row} index={index} isMain={index === mainImage} variants={variants} />
          ))}
        </ol>
      )}
      {canWrite && (
        <>
          <input
            ref={replaceInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              const rowKey = replaceTarget.current;
              event.target.value = "";
              if (file && rowKey) uploads.addFiles([file], { kind: "replace", rowKey });
            }}
          />
          <button ref={addUrlButton} type="button" disabled={locked || full} onClick={addUrlImage} className={actionClass}>+ Image URL</button>
        </>
      )}
    </section>
  );
}
