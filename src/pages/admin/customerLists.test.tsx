import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersManager } from "./CustomersManager";
import { PromotionsManager } from "./PromotionsManager";
import { UnsavedChangesProvider } from "./unsavedChanges";

const api = vi.hoisted(() => ({
  users: { getAll: vi.fn() },
  subscriptions: { getAll: vi.fn() },
}));

vi.mock("../../api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/admin")>();
  return { ...actual, adminAPI: { ...actual.adminAPI, users: { ...actual.adminAPI.users, ...api.users }, subscriptions: { ...actual.adminAPI.subscriptions, ...api.subscriptions } } };
});

beforeEach(() => {
  vi.clearAllMocks();
  api.users.getAll.mockResolvedValue({ data: { users: [] } });
  api.subscriptions.getAll.mockResolvedValue({ data: { subscriptions: [] } });
});

describe("customer and subscription lists", () => {
  it("customers load once, again on each filter change with the typed search, and the search itself waits for Search", async () => {
    render(<CustomersManager canWrite={false} showToast={vi.fn()} />);
    await waitFor(() => expect(api.users.getAll).toHaveBeenCalledTimes(1));
    expect(api.users.getAll).toHaveBeenLastCalledWith({ q: undefined, verified: undefined, disabled: undefined });

    fireEvent.change(screen.getByRole("textbox", { name: "Search users" }), { target: { value: "wanjiku" } });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(api.users.getAll).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by verification" }), { target: { value: "true" } });
    await waitFor(() => expect(api.users.getAll).toHaveBeenCalledTimes(2));
    expect(api.users.getAll).toHaveBeenLastCalledWith({ q: "wanjiku", verified: "true", disabled: undefined });

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by account status" }), { target: { value: "false" } });
    await waitFor(() => expect(api.users.getAll).toHaveBeenCalledTimes(3));
    expect(api.users.getAll).toHaveBeenLastCalledWith({ q: "wanjiku", verified: "true", disabled: "false" });

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(api.users.getAll).toHaveBeenCalledTimes(4));
  });

  it("subscriptions load once, then again for each filter change", async () => {
    render(<UnsavedChangesProvider><PromotionsManager showToast={vi.fn()} /></UnsavedChangesProvider>);
    await waitFor(() => expect(api.subscriptions.getAll).toHaveBeenCalledTimes(1));
    expect(api.subscriptions.getAll).toHaveBeenLastCalledWith({ active: undefined });

    fireEvent.change(screen.getByRole("combobox", { name: "Filter subscriptions" }), { target: { value: "true" } });
    await waitFor(() => expect(api.subscriptions.getAll).toHaveBeenCalledTimes(2));
    expect(api.subscriptions.getAll).toHaveBeenLastCalledWith({ active: "true" });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(api.subscriptions.getAll).toHaveBeenCalledTimes(2);
  });
});
