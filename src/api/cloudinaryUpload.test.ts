import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadFailure, uploadToCloudinary } from "./cloudinaryUpload";
import { FakeXhr, cloudinaryReply, fixtureUploadIntent, imageFile, installFakeXhr } from "../test-support/uploadFixtures";

beforeEach(installFakeXhr);
afterEach(() => vi.unstubAllGlobals());

const lastRequest = () => FakeXhr.instances.at(-1)!;

async function failure(promise: Promise<unknown>) {
  const reason = await promise.then(() => null, (error: unknown) => error);
  expect(reason).toBeInstanceOf(UploadFailure);
  return reason as UploadFailure;
}

describe("uploadToCloudinary", () => {
  it("posts the file with every signed field unchanged, reports progress and maps Cloudinary's reply", async () => {
    const intent = fixtureUploadIntent();
    const file = imageFile("photo.webp");
    const progress = vi.fn();
    const upload = uploadToCloudinary(intent, file, { onProgress: progress });
    const request = lastRequest();
    expect([request.method, request.url, request.responseType]).toEqual(["POST", intent.uploadUrl, "json"]);
    expect(request.entries()).toEqual([...Object.entries(intent.fields), ["file", file]]);

    request.progress(512, 1024);
    request.progress(1024, 1024);
    expect(progress.mock.calls).toEqual([[0.5], [1]]);
    const reply = cloudinaryReply(intent);
    request.respond(200, reply);
    await expect(upload).resolves.toEqual({
      cloudinary: { publicId: intent.fields.public_id, version: 1763200001, signature: reply.signature, format: "webp", bytes: 245_000 },
      width: 2400, height: 3000, secureUrl: reply.secure_url,
    });
  });

  it("shows Cloudinary's own refusal message", async () => {
    const upload = uploadToCloudinary(fixtureUploadIntent(), imageFile("photo.webp"));
    lastRequest().respond(400, { error: { message: "Stale request - reported time is 2026-11-15 08:00:00 +0000 which is out of range" } });
    const reason = await failure(upload);
    expect([reason.kind, reason.message]).toEqual(["rejected", "Stale request - reported time is 2026-11-15 08:00:00 +0000 which is out of range"]);
  });

  it("explains a refusal without a readable message by its status", async () => {
    const upload = uploadToCloudinary(fixtureUploadIntent(), imageFile("photo.webp"));
    lastRequest().respond(502, null);
    const reason = await failure(upload);
    expect([reason.kind, reason.message]).toEqual(["rejected", "Cloudinary refused the upload (HTTP 502). Retry the upload."]);
  });

  it("gives a plain retry message for network failures", async () => {
    const upload = uploadToCloudinary(fixtureUploadIntent(), imageFile("photo.webp"));
    lastRequest().failNetwork();
    const reason = await failure(upload);
    expect([reason.kind, reason.message]).toEqual(["network", "The upload could not reach Cloudinary. Check your connection, then retry."]);
  });

  it.each([
    ["no signature", { signature: undefined }],
    ["a malformed signature", { signature: "not-hex" }],
    ["no dimensions", { width: undefined }],
    ["an insecure address", { secure_url: "http://res.cloudinary.com/apex-test/image/upload/v1/a.webp" }],
  ])("treats a success reply with %s as unusable", async (_label, overrides) => {
    const intent = fixtureUploadIntent();
    const upload = uploadToCloudinary(intent, imageFile("photo.webp"));
    lastRequest().respond(200, cloudinaryReply(intent, overrides));
    expect((await failure(upload)).kind).toBe("unexpected");
  });

  it("aborts the request when cancelled, and never starts one for an already cancelled signal", async () => {
    const controller = new AbortController();
    const upload = uploadToCloudinary(fixtureUploadIntent(), imageFile("photo.webp"), { signal: controller.signal });
    controller.abort();
    expect(lastRequest().aborted).toBe(true);
    expect((await failure(upload)).kind).toBe("aborted");

    const before = FakeXhr.instances.length;
    expect((await failure(uploadToCloudinary(fixtureUploadIntent(), imageFile("photo.webp"), { signal: controller.signal }))).kind).toBe("aborted");
    expect(FakeXhr.instances).toHaveLength(before);
  });
});
