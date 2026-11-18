import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct, MediaInput, UploadIntent } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import { demoPhone, fixtureImage, fixtureSnapshot, imagelessShirt, linenShirt, poloShirt, staffRecord } from "../../test-support/catalogFixtures";
import { FakeXhr, cloudinaryReply, fixtureUploadIntent, imageFile, installFakeXhr } from "../../test-support/uploadFixtures";
import { CatalogManager } from "./CatalogManager";
import { ProductEditor } from "./ProductEditor";
import { initialGallery, placeUpload, uploadedImageRow } from "./ProductImages";
import { useImageUploads } from "./useImageUploads";

const mocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  requestMediaUpload: vi.fn(),
  snapshot: null as unknown,
}));

vi.mock("./AdminCatalogContext", () => ({
  useAdminCatalog: () => {
    const snapshot = mocks.snapshot as ReturnType<typeof fixtureSnapshot>;
    return {
      status: "ready", data: { snapshot, stocks: [] }, categories: buildCategoryTree(snapshot.categories),
      error: null, sessionExpired: false, refreshing: false, reload: vi.fn(),
    };
  },
}));
vi.mock("../../api/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/catalog")>();
  return {
    ...actual,
    catalogAdminAPI: { createProduct: mocks.createProduct, updateProduct: mocks.updateProduct },
    requestMediaUpload: mocks.requestMediaUpload,
  };
});
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => ({ mode: "live" }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const STORED = "https://res.cloudinary.com/apex-test/image/upload/v1763100000/apex-cart/products/20261114-aaaaaaaaaaaaaaaaaaaaaaaa.webp";
/** A saved upload (cover) and a saved URL image linked to the blue variant. */
const editable: CatalogProduct = {
  ...linenShirt,
  images: [
    fixtureImage({ id: "img-up", url: STORED, alt: "Linen shirt, front", isMain: true, width: 2400, height: 3000, format: "webp", bytes: 245_000 }),
    fixtureImage({ id: "img-url", url: "https://images.unsplash.com/photo-1?w=800", alt: "Linen shirt, collar", order: 1, variantId: "var-linen-m-blue" }),
  ],
};
const unsetSample = { isPlaceholder: false, sourceUrl: null, license: null, credit: null };
let intents: UploadIntent[] = [];

function apiError(status: number, data: unknown) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status, statusText: "", data, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

function renderEditor(product: CatalogProduct | null = editable, canWrite = true) {
  const onSaved = vi.fn();
  // The staff catalog lists every product with its version (P8.2).
  render(<ProductEditor product={product && staffRecord(product)} canWrite={canWrite} onClose={vi.fn()} onSaved={onSaved} />);
  return { onSaved };
}

const chooseFiles = (...files: File[]) => fireEvent.change(screen.getByLabelText("Upload images"), { target: { files } });

async function request(count: number) {
  await waitFor(() => expect(FakeXhr.instances).toHaveLength(count));
  return FakeXhr.instances[count - 1];
}

async function finish(xhr: FakeXhr, intent: UploadIntent, overrides: Record<string, unknown> = {}) {
  await act(async () => xhr.respond(200, cloudinaryReply(intent, overrides)));
}

async function savedImages(): Promise<MediaInput[]> {
  fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(mocks.updateProduct.mock.calls.length + mocks.createProduct.mock.calls.length).toBe(1));
  const call = mocks.updateProduct.mock.calls[0]?.[1] ?? mocks.createProduct.mock.calls[0][0];
  return call.images;
}

/** A saved product with `count` URL images, the first one the cover. */
const withImages = (count: number): CatalogProduct => ({
  ...linenShirt,
  images: Array.from({ length: count }, (_, index) =>
    fixtureImage({ id: `img-${index}`, url: `https://media.example.test/view-${index}.jpg`, order: index, isMain: index === 0 })),
});
const replacementPicker = () => document.querySelector<HTMLInputElement>('input[type="file"][hidden]')!;
const orderOf = (images: MediaInput[]) => images.map(({ id, order, isMain }) => ({ id, order, isMain }));

/** The widest slot a `sizes` list describes for viewports up to 1440px: each entry at the top of its range. */
function widestSlot(sizes: string, widestViewport = 1440) {
  let top = widestViewport;
  let widest = 0;
  for (const entry of sizes.split(", ")) {
    const [, min, value] = /^(?:\(min-width: (\d+)px\) )?(.+)$/.exec(entry)!;
    const fixed = /^([\d.]+)px$/.exec(value);
    const fluid = /^calc\(([\d.]+)vw - ([\d.]+)px\)$/.exec(value);
    widest = Math.max(widest, fixed ? Number(fixed[1]) : (Number(fluid![1]) / 100) * top - Number(fluid![2]));
    top = Number(min ?? 0) - 1;
  }
  return widest;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  // The products list keeps its filters in the address (P8.2), so each test starts on the unfiltered list.
  window.history.replaceState(null, "", "#/admin/catalog/products");
  installFakeXhr();
  intents = [];
  mocks.snapshot = fixtureSnapshot({ mode: "admin" });
  mocks.createProduct.mockReset().mockResolvedValue({ data: {} });
  mocks.updateProduct.mockReset().mockResolvedValue({ data: {} });
  mocks.requestMediaUpload.mockReset().mockImplementation(async () => {
    const intent = fixtureUploadIntent();
    intents.push(intent);
    return intent;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("product image uploads", () => {
  it("uploads a checked file with progress and saves it as a Cloudinary result with no address", async () => {
    renderEditor();
    expect(screen.queryByRole("textbox", { name: "Image 1 URL" })).toBeNull();
    expect(screen.getByText("Uploaded · WEBP · 239 KB · 2400 × 3000 px")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Image 2 URL" })).toBeTruthy();

    chooseFiles(imageFile("photo.webp"));
    const xhr = await request(1);
    expect([xhr.method, xhr.url]).toEqual(["POST", intents[0].uploadUrl]);
    expect(xhr.entries().map(([name]) => name)).toEqual([...Object.keys(intents[0].fields), "file"]);
    act(() => xhr.progress(512, 1024));
    expect(screen.getByRole("progressbar", { name: "Upload progress for photo.webp" }).getAttribute("value")).toBe("50");
    expect(screen.getByText("Uploading… 50%")).toBeTruthy();

    await finish(xhr, intents[0]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("photo.webp uploaded. Save the product to keep it.")).toBeTruthy();
    const card = screen.getByRole("heading", { name: /^Image 3/ }).closest("li")!;
    expect(within(card).getByText("Unsaved upload")).toBeTruthy();
    expect(card.querySelector("img")?.getAttribute("sizes")).toBe("80px");
    expect(card.querySelector("img")?.getAttribute("srcset")).toContain(`/upload/c_limit,w_96/q_auto/f_auto/v1763200001/${intents[0].fields.public_id}.webp 96w`);

    fireEvent.change(screen.getByRole("textbox", { name: "Image 1 alt text" }), { target: { value: "Front view" } });
    const images = await savedImages();
    expect(images).toEqual([
      { id: "img-up", alt: "Front view", isMain: true, order: 0, variantId: null, ...unsetSample },
      { id: "img-url", url: "https://images.unsplash.com/photo-1?w=800", alt: "Linen shirt, collar", isMain: false, order: 1, variantId: "var-linen-m-blue", ...unsetSample },
      {
        cloudinary: { publicId: intents[0].fields.public_id, version: 1763200001, signature: "0123456789abcdef0123456789abcdef01234567", format: "webp", bytes: 245_000 },
        width: 2400, height: 3000, alt: null, isMain: false, order: 2, variantId: null, ...unsetSample,
      },
    ]);
  });

  it("rejects unsupported and oversized files with their names before requesting any upload", async () => {
    renderEditor();
    chooseFiles(imageFile("notes.pdf", "application/pdf"), imageFile("huge.webp", "image/webp", 10 * 1024 * 1024 + 1), imageFile("empty.png", "image/png", 0));
    const status = screen.getByText("Not uploaded:").closest<HTMLElement>("[role=status]")!;
    expect(within(status).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "notes.pdf: PDF files are not accepted; use JPEG, PNG, WebP or AVIF.",
      "huge.webp: It is larger than the 10 MB limit.",
      "empty.png: The file is empty.",
    ]);
    await act(async () => {});
    expect(mocks.requestMediaUpload).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("cancels, shows Cloudinary's error and retries with a fresh signed intent each time", async () => {
    renderEditor();
    chooseFiles(imageFile("photo.webp"));
    const first = await request(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload of photo.webp" }));
    expect(first.aborted).toBe(true);
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry upload of photo.webp" }));

    fireEvent.click(screen.getByRole("button", { name: "Retry upload of photo.webp" }));
    const second = await request(2);
    expect(second.entries()).toContainEqual(["public_id", intents[1].fields.public_id]);
    await act(async () => second.respond(400, { error: { message: "Invalid image file" } }));
    expect(screen.getByText("Invalid image file")).toBeTruthy();
    expect(screen.getByText("photo.webp was not uploaded: Invalid image file")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry upload of photo.webp" }));
    const third = await request(3);
    await act(async () => third.failNetwork());
    expect(screen.getByText("The upload could not reach Cloudinary. Check your connection, then retry.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry upload of photo.webp" }));
    const fourth = await request(4);
    await finish(fourth, intents[3]);
    expect(mocks.requestMediaUpload).toHaveBeenCalledTimes(4);
    expect(new Set(intents.map((intent) => intent.fields.public_id)).size).toBe(4);
    expect(mocks.requestMediaUpload.mock.calls.every(([purpose]) => purpose === "PRODUCT")).toBe(true);
    expect(screen.getByRole("heading", { name: /^Image 3/ })).toBeTruthy();
  });

  it("runs at most two uploads at once and blocks saving until they finish", async () => {
    renderEditor();
    chooseFiles(imageFile("a.webp"), imageFile("b.webp"), imageFile("c.webp"));
    await request(2);
    await act(async () => {});
    expect(FakeXhr.instances).toHaveLength(2);
    expect(screen.getByText("Waiting to upload")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    expect(screen.getByRole("alert").textContent).toContain("Wait for image uploads to finish, or cancel them, before saving.");
    expect(mocks.updateProduct).not.toHaveBeenCalled();

    await finish(FakeXhr.instances[0], intents[0]);
    const third = await request(3);
    await finish(FakeXhr.instances[1], intents[1]);
    await finish(third, intents[2]);
    expect(screen.getAllByText("Unsaved upload")).toHaveLength(3);
  });

  it("replaces an image in place, keeping alt text, cover and variant and resetting sample details", async () => {
    const sample = { ...editable, images: [{ ...editable.images[0], variantId: "var-linen-m-white", isPlaceholder: true, sourceUrl: "https://unsplash.com/photos/x", license: "Unsplash License" }, editable.images[1]] };
    renderEditor(sample);
    expect((screen.getByRole("checkbox", { name: "Image 1 is a sample image" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Replace image 1" }));
    const picker = document.querySelector<HTMLInputElement>('input[type="file"][hidden]')!;
    fireEvent.change(picker, { target: { files: [imageFile("better.jpg", "image/jpeg")] } });
    const xhr = await request(1);
    expect(screen.getByText(/Replaces image 1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace image 1" }).hasAttribute("disabled")).toBe(true);
    await finish(xhr, intents[0], { format: "jpg", width: 1600, height: 2000, bytes: 180_000 });

    expect(screen.getAllByRole("heading", { name: /^Image \d/ })).toHaveLength(2);
    expect((screen.getByRole("radio", { name: "Image 1 is the cover image" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Image 1 is a sample image" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("combobox", { name: "Image 1 variant" }) as HTMLSelectElement).value).toBe("var-linen-m-white");
    const images = await savedImages();
    expect(images[0]).toEqual({
      cloudinary: { publicId: intents[0].fields.public_id, version: 1763200001, signature: "0123456789abcdef0123456789abcdef01234567", format: "jpg", bytes: 180_000 },
      width: 1600, height: 2000, alt: "Linen shirt, front", isMain: true, order: 0, variantId: "var-linen-m-white", ...unsetSample,
    });
    expect(images.map((image) => image.id)).toEqual([undefined, "img-url"]);
  });

  it("offers only saved variants, moves the cover with its image and links images by variant", async () => {
    renderEditor();
    const select = screen.getByRole("combobox", { name: "Image 1 variant" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All variants", "Size: S · Color: White", "Size: M · Color: White", "Size: M · Color: Blue",
    ]);
    fireEvent.change(select, { target: { value: "var-linen-s-white" } });
    fireEvent.click(screen.getByRole("button", { name: "Move image 1 down" }));
    expect((screen.getByRole("radio", { name: "Image 2 is the cover image" }) as HTMLInputElement).checked).toBe(true);
    const images = await savedImages();
    expect(images.map(({ id, isMain, order, variantId }) => ({ id, isMain, order, variantId }))).toEqual([
      { id: "img-url", isMain: false, order: 0, variantId: "var-linen-m-blue" },
      { id: "img-up", isMain: true, order: 1, variantId: "var-linen-s-white" },
    ]);
  });

  it("asks staff to save a new product before linking variants, and creates its uploads for the whole product", async () => {
    renderEditor(null);
    expect(screen.getByText("Images can be linked to variants after the product is saved.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Uploaded tee" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "A tee with an uploaded photo." } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Price (KES)" }), { target: { value: "1500" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "cat-shirts" } });
    chooseFiles(imageFile("tee.png", "image/png"));
    await finish(await request(1), intents[0], { format: "png" });
    expect(screen.queryByRole("combobox", { name: "Image 1 variant" })).toBeNull();
    const images = await savedImages();
    expect(images).toEqual([expect.objectContaining({ isMain: true, order: 0, variantId: null, cloudinary: expect.objectContaining({ format: "png" }) })]);
    expect(images[0]).not.toHaveProperty("url");
  });

  it("explains that uploads are not configured while image addresses keep working", async () => {
    mocks.requestMediaUpload.mockRejectedValue(apiError(503, { error: "Image uploads are not configured.", code: "MEDIA_UPLOADS_DISABLED" }));
    renderEditor();
    chooseFiles(imageFile("photo.webp"));
    expect(await screen.findByText("Image uploads are not configured. You can still add images by URL.")).toBeTruthy();
    expect(screen.getByText("Image uploads are not configured.")).toBeTruthy();
    expect(screen.getByLabelText("Upload images").hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry upload of photo.webp" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Replace image/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss photo.webp" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Image URL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Image 3 URL" }), { target: { value: "https://media.example.test/extra.jpg" } });
    const images = await savedImages();
    expect(images[2]).toEqual({ url: "https://media.example.test/extra.jpg", alt: null, isMain: false, order: 2, variantId: null, ...unsetSample });
  });

  it("shows the server's media error when saving fails", async () => {
    mocks.updateProduct.mockRejectedValue(apiError(400, {
      error: "The upload could not be verified with Cloudinary. Upload the image again.", code: "MEDIA_SIGNATURE_INVALID",
    }));
    renderEditor();
    chooseFiles(imageFile("photo.webp"));
    await finish(await request(1), intents[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The upload could not be verified with Cloudinary. Upload the image again.");
  });

  it("shows viewers the images with no upload or edit controls", () => {
    renderEditor(editable, false);
    expect(screen.getByText("View only: your role can see these images but cannot change them.")).toBeTruthy();
    expect(screen.queryByLabelText("Upload images")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Replace|Remove|Move) image/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Image URL" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /^Image \d/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    const list = screen.getByRole("list", { name: "Product images" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Linen shirt, collar")).toBeTruthy();
    expect(within(list).getByText("Size: M · Color: Blue")).toBeTruthy();
    expect(list.querySelectorAll("img")).toHaveLength(2);
  });
});

describe("review fixes: gallery order", () => {
  it("[1] keeps a moved cover's saved order when the product is reopened and only alt text changes", async () => {
    // Saved after moving cover A below B: the API lists B (order 0) then A (order 1, still the cover).
    const [coverA, imageB] = editable.images;
    renderEditor({ ...editable, images: [{ ...imageB, order: 0 }, { ...coverA, order: 1 }] });
    expect((screen.getByRole("radio", { name: "Image 2 is the cover image" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Image 1 alt text" }), { target: { value: "Collar close-up" } });
    const images = await savedImages();
    expect(images.map(({ id, order, isMain, alt }) => ({ id, order, isMain, alt }))).toEqual([
      { id: "img-url", order: 0, isMain: false, alt: "Collar close-up" },
      { id: "img-up", order: 1, isMain: true, alt: "Linen shirt, front" },
    ]);
  });

  it("[1] orders rows by saved order then ID, with the first image as cover when none is marked", async () => {
    const image = (id: string, order: number) => fixtureImage({ id, url: `https://media.example.test/${id}.jpg`, order });
    renderEditor({ ...linenShirt, images: [image("img-b", 1), image("img-a", 1), image("img-z", 0)] });
    fireEvent.change(screen.getByRole("textbox", { name: "Image 1 alt text" }), { target: { value: "First" } });
    expect(orderOf(await savedImages())).toEqual([
      { id: "img-z", order: 0, isMain: true },
      { id: "img-a", order: 1, isMain: false },
      { id: "img-b", order: 2, isMain: false },
    ]);
  });
});

describe("review fixes: pending save", () => {
  it("[2] locks image additions, replacements, removals, moves and edits until the save settles", async () => {
    const pending = deferred<{ data: unknown }>();
    mocks.updateProduct.mockReturnValue(pending.promise);
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Image 1 alt text" }), { target: { value: "Front view" } });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    const section = screen.getByRole("region", { name: "Images" });
    const controls = () => [
      within(section).getByLabelText("Upload images"),
      ...within(section).getAllByRole("button"),
      ...within(section).getAllByRole("textbox"),
      ...within(section).getAllByRole("radio"),
      ...within(section).getAllByRole("checkbox"),
      ...within(section).getAllByRole("combobox"),
    ];
    const enabled = () => controls().filter((control) => !control.hasAttribute("disabled"))
      .map((control) => control.getAttribute("aria-label") ?? control.textContent);
    expect(enabled()).toEqual([]);

    await act(async () => pending.resolve({ data: {} }));
    expect(within(section).getByLabelText("Upload images").hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Remove image 1" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("review fixes: 16-image limit", () => {
  function UploadHarness({ refuse, rowKeys }: { refuse: string | null; rowKeys: string[] }) {
    const uploads = useImageUploads(() => refuse, rowKeys);
    return (
      <>
        <button type="button" onClick={() => uploads.addFiles([imageFile("extra.webp")], { kind: "add" })}>Add upload</button>
        <ul aria-label="Jobs">{uploads.jobs.map((job) => <li key={job.key}>{`${job.file.name}: ${job.status} ${job.error}`}</li>)}</ul>
        <p role="status">{uploads.announcement}</p>
      </>
    );
  }

  it("[3a] refuses to retry a failed new upload once the product is full, without requesting an upload", async () => {
    renderEditor(withImages(15));
    chooseFiles(imageFile("late.webp"));
    await act(async () => (await request(1)).respond(400, { error: { message: "Invalid image file" } }));
    fireEvent.click(screen.getByRole("button", { name: "+ Image URL" }));
    expect(screen.getAllByRole("heading", { name: /^Image \d+/ })).toHaveLength(16);
    fireEvent.click(screen.getByRole("button", { name: "Retry upload of late.webp" }));
    await act(async () => {});
    expect(mocks.requestMediaUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A product can have at most 16 images.")).toBeTruthy();
  });

  it("[3b] keeps the last slot for a replacement whose image was removed, so image 17 is never created", async () => {
    renderEditor(withImages(16));
    fireEvent.click(screen.getByRole("button", { name: "Replace image 1" }));
    fireEvent.change(replacementPicker(), { target: { files: [imageFile("swap.webp")] } });
    const xhr = await request(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(screen.getByRole("button", { name: "+ Image URL" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Upload images").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ Image URL" }));
    await finish(xhr, intents[0]);
    expect(screen.getAllByRole("heading", { name: /^Image \d+/ })).toHaveLength(16);
  });

  it("[3b] places a replacement whose image was removed only when the product has room", () => {
    const rows = initialGallery(withImages(16)).rows;
    const row = uploadedImageRow({
      cloudinary: { publicId: "apex-cart/products/x", version: 1, signature: "a".repeat(40), format: "webp", bytes: 10 },
      width: 10, height: 10, secureUrl: "https://res.cloudinary.com/apex-test/image/upload/v1/apex-cart/products/x.webp",
    });
    expect(placeUpload(rows, { kind: "replace", rowKey: "removed-row" }, row)).toBeNull();
    expect(placeUpload(rows.slice(1), { kind: "replace", rowKey: "removed-row" }, row)?.at(-1)).toBe(row);
  });

  it("[3b] reports an upload that finished without room as not added, with its file name and reason", async () => {
    render(<UploadHarness refuse="A product can have at most 16 images." rowKeys={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add upload" }));
    await finish(await request(1), intents[0]);
    expect(within(screen.getByRole("list", { name: "Jobs" })).getByRole("listitem").textContent)
      .toBe("extra.webp: failed Not added: A product can have at most 16 images.");
    expect(screen.getByRole("status").textContent).toBe("extra.webp was uploaded but not added: A product can have at most 16 images.");
  });
});

describe("review fixes: focus after removal", () => {
  it("[6] moves focus from a removed image to the next image's first action, then the previous, then the upload control", () => {
    renderEditor(withImages(3));
    const removeMiddle = screen.getByRole("button", { name: "Remove image 2" });
    removeMiddle.focus();
    fireEvent.click(removeMiddle);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move image 2 up" }));

    const removeLast = screen.getByRole("button", { name: "Remove image 2" });
    removeLast.focus();
    fireEvent.click(removeLast);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Replace image 1" }));

    const removeOnly = screen.getByRole("button", { name: "Remove image 1" });
    removeOnly.focus();
    fireEvent.click(removeOnly);
    expect(document.activeElement).toBe(screen.getByLabelText("Upload images"));
  });

  it("[6] moves focus to the upload control when the focused upload row finishes", async () => {
    renderEditor();
    chooseFiles(imageFile("photo.webp"));
    const xhr = await request(1);
    screen.getByRole("button", { name: "Cancel upload of photo.webp" }).focus();
    await finish(xhr, intents[0]);
    expect(screen.queryByRole("button", { name: "Cancel upload of photo.webp" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Upload images"));
  });
});

describe("review fixes: image addresses", () => {
  it("[7] refuses to save an image address containing whitespace", () => {
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Image 2 URL" }), { target: { value: "https://media.example.test/a.jpg 2000w, https://elsewhere.example/x.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    expect(screen.getByRole("alert").textContent).toContain("Image addresses must be HTTPS URLs or /images/ paths.");
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });
});

describe("compare-at price", () => {
  const RULE = "Compare-at price must be higher than the price, or left empty.";
  const compareAt = () => screen.getByLabelText("Compare-at price (optional)") as HTMLInputElement;
  const price = () => screen.getByLabelText("Price (KES)") as HTMLInputElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  /** The message the field points to, or null when it points to none. */
  const fieldError = () => {
    const id = compareAt().getAttribute("aria-describedby");
    return id ? document.getElementById(id)?.textContent ?? "" : null;
  };

  it("shows the rule on the field while the compare-at price is not above the price, and blocks saving", async () => {
    renderEditor();
    for (const value of ["1000", "999.99", "0.5"]) {
      fireEvent.change(compareAt(), { target: { value } });
      expect([compareAt().getAttribute("aria-invalid"), fieldError()], value).toEqual(["true", RULE]);
    }
    save();
    expect(screen.getByRole("alert").textContent).toContain(RULE);
    expect(mocks.updateProduct).not.toHaveBeenCalled();
    // A price lowered below it is fine, and the check follows every edit of either price.
    fireEvent.change(price(), { target: { value: "0.49" } });
    expect([compareAt().hasAttribute("aria-invalid"), fieldError()]).toEqual([false, null]);
    fireEvent.change(price(), { target: { value: "1000" } });
    fireEvent.change(compareAt(), { target: { value: "1000.01" } });
    expect([compareAt().hasAttribute("aria-invalid"), fieldError()]).toEqual([false, null]);
    save();
    await waitFor(() => expect(mocks.updateProduct).toHaveBeenCalledTimes(1));
    expect(mocks.updateProduct.mock.calls[0][1]).toMatchObject({ price: 1000, compareAtPrice: 1000.01 });
  });

  it("saves an empty compare-at price as none", async () => {
    renderEditor({ ...editable, comparePrice: 1200 });
    fireEvent.change(compareAt(), { target: { value: "" } });
    expect(fieldError()).toBeNull();
    save();
    await waitFor(() => expect(mocks.updateProduct).toHaveBeenCalledTimes(1));
    expect(mocks.updateProduct.mock.calls[0][1]).toMatchObject({ compareAtPrice: null });
  });

  it("shows the server's refusal on the field, and keeps saving blocked until a price changes", async () => {
    mocks.updateProduct.mockRejectedValue(apiError(400, { error: RULE, code: "COMPARE_AT_PRICE_INVALID" }));
    renderEditor();
    fireEvent.change(compareAt(), { target: { value: "1500" } });
    save();
    expect((await screen.findByRole("alert")).textContent).toBe(RULE);
    expect([compareAt().getAttribute("aria-invalid"), fieldError()]).toEqual(["true", RULE]);
    save();
    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    fireEvent.change(compareAt(), { target: { value: "1600" } });
    expect([compareAt().hasAttribute("aria-invalid"), fieldError()]).toEqual([false, null]);
  });

  it("does not point the field at an error the server gave for something else", async () => {
    mocks.updateProduct.mockRejectedValue(apiError(400, { error: "Select an existing category", code: "CATEGORY_INVALID" }));
    renderEditor();
    fireEvent.change(compareAt(), { target: { value: "1500" } });
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("Select an existing category");
    expect(fieldError()).toBeNull();
  });
});

describe("catalog manager image filter", () => {
  it("counts and lists products with no images or only sample images", () => {
    const sampleOnly = { ...poloShirt, id: "prod-sample-only", name: "Sample-only Polo", images: [{ ...poloShirt.images[0], isPlaceholder: true }] };
    mocks.snapshot = fixtureSnapshot({ mode: "admin", products: [linenShirt, poloShirt, imagelessShirt, demoPhone, sampleOnly] });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Needs images (3)" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Oxford Shirt Without Images", "Demo Smartphone", "Sample-only Polo"]) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
    }
    for (const name of ["Linen Short-Sleeve Shirt", "Cotton Polo Shirt"]) {
      expect(screen.queryByRole("button", { name: `Edit ${name}` })).toBeNull();
    }
    expect(screen.getByText("3 of 5 products")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search products" }), { target: { value: "polo" } });
    expect(screen.getByText("1 of 5 products")).toBeTruthy();
  });

  it("[5] offers product tiles a candidate at least twice their widest slot, for 2x screens", () => {
    mocks.snapshot = fixtureSnapshot({ mode: "admin", products: [editable, poloShirt] });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).querySelector("img")!;
    const widths = tile.getAttribute("srcset")!.split(", ").map((entry) => Number(entry.split(" ")[1].replace("w", "")));
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(2 * widestSlot(tile.getAttribute("sizes")!));
  });

  it("sizes product tiles to the grid with card renditions", () => {
    mocks.snapshot = fixtureSnapshot({ mode: "admin", products: [editable, poloShirt] });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).querySelector("img")!;
    expect(tile.getAttribute("sizes")).toBe(
      "(min-width: 1280px) calc(20vw - 82.8px), (min-width: 1024px) calc(25vw - 40px), (min-width: 640px) calc(33.34vw - 43px), calc(50vw - 46px)");
    expect(tile.getAttribute("srcset")?.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["240w", "320w", "480w", "640w", "960w"]);
    expect(tile.getAttribute("loading")).toBe("lazy");
  });
});
