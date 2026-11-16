import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, navigate, useRoute } from "../../router";
import { UnsavedChangesProvider, useLeaveGuard, useUnsavedChanges } from "./unsavedChanges";

/** A form whose draft is dirty while it differs from the saved value; saving can succeed or fail. */
function Editor({ label = "Product editor", keeps, saveFails = false, closeOnSave = false }: {
  label?: string;
  keeps?: (route: string) => boolean;
  saveFails?: boolean;
  closeOnSave?: boolean;
}) {
  const [saved, setSaved] = useState("Linen");
  const [draft, setDraft] = useState("Linen");
  const [error, setError] = useState("");
  const { confirmLeave, release } = useUnsavedChanges(draft !== saved, label, keeps);
  const save = () => {
    if (saveFails) {
      setError("The product could not be saved.");
      return;
    }
    setSaved(draft);
    if (closeOnSave) {
      release();
      navigate("/admin/catalog/products", { replace: true });
    }
  };
  return (
    <div>
      <label>Name <input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <button type="button" onClick={save}>Save</button>
      <button type="button" onClick={() => confirmLeave(() => setDraft(saved))}>Close form</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const [signedOut, setSignedOut] = useState(false);
  return (
    <UnsavedChangesProvider>
      <p>route:{route}</p>
      {signedOut ? <p>Signed out</p> : children}
      <Link to="/admin/overview/dashboard">Dashboard</Link>
      <SignOut onSignOut={() => setSignedOut(true)} />
    </UnsavedChangesProvider>
  );
}

/** Reads the guard from inside the provider, as the shell's sign-out button does. */
function SignOut({ onSignOut }: { onSignOut: () => void }) {
  const guard = useLeaveGuard();
  return <button type="button" onClick={() => guard(onSignOut)}>Sign out</button>;
}

const onSecondProduct = (route: string) => route === "/admin/catalog/products?product=prod-2";

const unloadPrevented = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const typeName = (value: string) => fireEvent.change(screen.getByLabelText("Name"), { target: { value } });
const guardDialog = () => screen.queryByRole("dialog", { name: "Discard unsaved changes?" });

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.history.replaceState(null, "", "#/admin/catalog/products?product=prod-1");
});

describe("unsaved-change guard", () => {
  it("never asks about an untouched editor", async () => {
    render(<Shell><Editor /></Shell>);
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await screen.findByText("route:/admin/overview/dashboard");
    expect(guardDialog()).toBeNull();
  });

  it("holds a link while dirty, names the editor, and keeps editing or discards on request", async () => {
    render(<Shell><Editor /></Shell>);
    typeName("Linen shirt");
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    const dialog = guardDialog()!;
    expect(within(dialog).getByText("Product editor has unsaved changes. Leaving now discards them.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(guardDialog()).toBeNull();
    expect(screen.getByText("route:/admin/catalog/products?product=prod-1")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Linen shirt");

    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    fireEvent.click(within(guardDialog()!).getByRole("button", { name: "Discard changes" }));
    await screen.findByText("route:/admin/overview/dashboard");
    expect(guardDialog()).toBeNull();
  });

  it("stops asking once the edits are saved, and keeps asking after a failed save", async () => {
    const { unmount } = render(<Shell><Editor saveFails /></Shell>);
    typeName("Linen shirt");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("The product could not be saved.");
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(guardDialog()).not.toBeNull();
    unmount();

    render(<Shell><Editor /></Shell>);
    typeName("Linen shirt");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await screen.findByText("route:/admin/overview/dashboard");
    expect(guardDialog()).toBeNull();
  });

  it("lets an editor close itself straight after a successful save", async () => {
    render(<Shell><Editor closeOnSave /></Shell>);
    typeName("Linen shirt");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(guardDialog()).toBeNull();
    expect(screen.getByText("route:/admin/catalog/products")).toBeTruthy();
  });

  it("does not ask for routes that keep the editor open", async () => {
    const keeps = (route: string) => route.startsWith("/admin/storefront/");
    window.history.replaceState(null, "", "#/admin/storefront/editor");
    render(<Shell><Editor label="Storefront draft" keeps={keeps} /></Shell>);
    typeName("Draft name");
    act(() => navigate("/admin/storefront/preview"));
    await screen.findByText("route:/admin/storefront/preview");
    expect(guardDialog()).toBeNull();
    act(() => window.history.back());
    await screen.findByText("route:/admin/storefront/editor");
    expect(guardDialog()).toBeNull();
    act(() => navigate("/"));
    expect(within(guardDialog()!).getByText("Storefront draft has unsaved changes. Leaving now discards them.")).toBeTruthy();
  });

  it("holds Back with one dialog, keeps the editor, then continues the same way on discard", async () => {
    // Like the product editor: only its own product's route keeps it open.
    render(<Shell><Editor keeps={onSecondProduct} /></Shell>);
    act(() => navigate("/admin/catalog/products?product=prod-2"));
    await screen.findByText("route:/admin/catalog/products?product=prod-2");
    typeName("Linen shirt");
    act(() => window.history.back());
    await waitFor(() => expect(guardDialog()).not.toBeNull());
    await waitFor(() => expect(window.location.hash).toBe("#/admin/catalog/products?product=prod-2"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByRole("dialog", { name: "Discard unsaved changes?" })).toHaveLength(1);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Linen shirt");
    expect(screen.getByText("route:/admin/catalog/products?product=prod-2")).toBeTruthy();

    fireEvent.click(within(guardDialog()!).getByRole("button", { name: "Discard changes" }));
    await screen.findByText("route:/admin/catalog/products?product=prod-1");
    expect(guardDialog()).toBeNull();
  });

  it("asks before signing out, and closing one form names only that form", () => {
    function TwoForms() {
      return (
        <>
          <Editor label="Category form" />
          <OtherEditor />
        </>
      );
    }
    function OtherEditor() {
      const [value, setValue] = useState("");
      useUnsavedChanges(value !== "", "Discount form", useCallback(() => true, []));
      return <label>Discount <input value={value} onChange={(event) => setValue(event.target.value)} /></label>;
    }
    render(<Shell><TwoForms /></Shell>);
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(guardDialog()).toBeNull();

    typeName("Linen shirt");
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(within(guardDialog()!).getByText("Category form has unsaved changes. Leaving now discards them.")).toBeTruthy();
    fireEvent.click(within(guardDialog()!).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Linen");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(within(guardDialog()!).getByText("Discount form has unsaved changes. Leaving now discards them.")).toBeTruthy();
    fireEvent.click(within(guardDialog()!).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("Signed out")).toBeTruthy();
  });
});
