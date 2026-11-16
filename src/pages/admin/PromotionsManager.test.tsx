import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "../../api/admin";
import { PromotionsManager } from "./PromotionsManager";

const api = vi.hoisted(() => ({ getAll: vi.fn(), sendPromotional: vi.fn(), delete: vi.fn() }));
vi.mock("../../api/admin", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/admin")>(),
  adminAPI: { subscriptions: api },
}));

const subscriber = (id: string): Subscription => ({
  id, email: `${id}@example.test`, isActive: true, createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z",
} as Subscription);

const SUBJECT = "November offers";
const CONTENT = "<p>Linen shirts are back.</p>";

async function composeAndSend(showToast = vi.fn()) {
  render(<PromotionsManager showToast={showToast} />);
  const send = await screen.findByRole("button", { name: /^Send to 2 subscribers$/ });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: SUBJECT } });
  fireEvent.change(screen.getByLabelText("Content (HTML supported)"), { target: { value: CONTENT } });
  fireEvent.click(send);
  await waitFor(() => expect(api.sendPromotional).toHaveBeenCalledWith({ subject: SUBJECT, content: CONTENT }));
  return showToast;
}

const draft = () => [(screen.getByLabelText("Subject") as HTMLInputElement).value, (screen.getByLabelText("Content (HTML supported)") as HTMLTextAreaElement).value];

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getAll.mockResolvedValue({ data: { subscriptions: [subscriber("ana"), subscriber("ben")] } });
});

describe("sending a promotional email", () => {
  it("keeps the draft and says nothing was sent when every email failed, naming missing email delivery", async () => {
    api.sendPromotional.mockResolvedValue({ data: {
      successful: 0, failed: 2,
      results: [{ success: false, code: "MAIL_NOT_CONFIGURED" }, { success: false, code: "MAIL_NOT_CONFIGURED" }],
    } });
    const showToast = await composeAndSend();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^No emails were sent\./);
    expect(alert.textContent).toMatch(/email delivery isn't set up/i);
    expect(alert.textContent).toMatch(/draft is kept/i);
    expect(draft()).toEqual([SUBJECT, CONTENT]);
    // A total failure is never announced like a success.
    expect(showToast).not.toHaveBeenCalledWith(expect.stringMatching(/sent to/i));
  });

  it("keeps the draft when every email failed for another reason, and says so plainly", async () => {
    api.sendPromotional.mockResolvedValue({ data: { successful: 0, failed: 2, results: [{ success: false }, { success: false }] } });
    await composeAndSend();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^No emails were sent\. 2 could not be sent/);
    expect(draft()).toEqual([SUBJECT, CONTENT]);
  });

  it("reports a partial send as a warning with the counts, and clears the draft so nobody gets it twice", async () => {
    api.sendPromotional.mockResolvedValue({ data: { successful: 1, failed: 1, results: [{ success: true }, { success: false }] } });
    const showToast = await composeAndSend();
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toBe("Sent to 1 of 2 subscribers. 1 could not be sent.");
    expect(draft()).toEqual(["", ""]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("confirms a complete send and clears the draft", async () => {
    api.sendPromotional.mockResolvedValue({ data: { successful: 2, failed: 0, results: [{ success: true }, { success: true }] } });
    const showToast = await composeAndSend();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Email sent to 2 subscribers"));
    expect(draft()).toEqual(["", ""]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the draft and shows the error in place when the request itself fails", async () => {
    api.sendPromotional.mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    const showToast = await composeAndSend();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not reach the server. Check your connection and try again. Your draft is kept.");
    expect(draft()).toEqual([SUBJECT, CONTENT]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("ends the server's refusal as a sentence before saying the draft is kept (no active subscribers)", async () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    api.sendPromotional.mockRejectedValue(new AxiosError("Bad Request", "ERR_BAD_REQUEST", config, undefined, {
      status: 400, statusText: "Bad Request", data: { error: "No active subscribers found" }, headers: new AxiosHeaders(), config,
    }));
    await composeAndSend();
    expect((await screen.findByRole("alert")).textContent).toBe("No active subscribers found. Your draft is kept.");
    expect(draft()).toEqual([SUBJECT, CONTENT]);
  });

  it("keeps the draft and warns against sending again blindly when the server's tally cannot be read", async () => {
    api.sendPromotional.mockResolvedValue({ data: { message: "Queued" } });
    const showToast = await composeAndSend();
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be read.+Check before sending again\. Your draft is kept\.$/);
    expect(draft()).toEqual([SUBJECT, CONTENT]);
    expect(showToast).not.toHaveBeenCalled();
  });
});
