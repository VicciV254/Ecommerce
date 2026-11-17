import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "../../api/admin";
import { CustomersManager } from "./CustomersManager";

const api = vi.hoisted(() => ({ getAll: vi.fn(), sendVerification: vi.fn(), sendVerificationBulk: vi.fn(), setDisabled: vi.fn(), delete: vi.fn() }));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: { users: api } }));

const account = (id: string, firstName: string, lastName: string): AdminUser => ({
  id, email: `${id}@example.test`, firstName, lastName, emailVerified: false, isDisabled: false, createdAt: "2026-11-01T00:00:00Z",
  _count: { orders: 0, addresses: 0, wishlist: 0 },
});
const ana = account("user-ana", "Ana", "Mwangi");
const ben = account("user-ben", "Ben", "Otieno");

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getAll.mockResolvedValue({ data: { users: [ana, ben] } });
  api.sendVerificationBulk.mockResolvedValue({ data: { results: [{ sent: true }] } });
});

describe("customer accounts for writers", () => {
  it("names each row's selection and actions with the customer, keeping the visible text short", async () => {
    render(<CustomersManager canWrite showToast={vi.fn()} />);
    const row = (await screen.findByText("user-ana@example.test")).closest("tr")!;
    expect(within(row).getByRole("checkbox", { name: "Select Ana Mwangi" })).toBeTruthy();
    // The checkbox sits in a label that is the 44px target.
    expect(within(row).getByRole("checkbox").closest("label")?.className).toMatch(/size-\[44px\]/);
    // jsdom drops the space before visually hidden text in accessible names; browsers keep it.
    for (const action of ["Verify", "Disable", "Delete"]) {
      const button = within(row).getByRole("button", { name: new RegExp(`^${action}\\s*Ana Mwangi$`) });
      expect(button.firstChild?.textContent).toBe(action);
    }
  });

  it("counts selected rows out of those shown, and sends verification only to them", async () => {
    const showToast = vi.fn();
    render(<CustomersManager canWrite showToast={showToast} />);
    await screen.findByText("user-ana@example.test");
    const bulk = screen.getByRole("button", { name: "Send verification to 0 selected" });
    expect(bulk).toHaveProperty("disabled", true);
    expect(screen.getByText("0 of 2 accounts shown selected.")).toBeTruthy();
    expect(screen.getByText(/Bulk actions apply only to the selected accounts\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Mwangi" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ben Otieno" }));
    expect(screen.getByText("2 of 2 accounts shown selected.")).toBeTruthy();

    // A search that no longer shows Ben drops him from the selection, so bulk work reaches only listed rows.
    api.getAll.mockResolvedValue({ data: { users: [ana] } });
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.queryByText("user-ben@example.test")).toBeNull());
    expect(screen.getByText("1 of 1 account shown selected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send verification to 1 selected" }));
    await waitFor(() => expect(api.sendVerificationBulk).toHaveBeenCalledWith(["user-ana"]));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Verification sent to 1 account"));
  });
});
