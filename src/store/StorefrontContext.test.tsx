import { render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorefrontProvider, useStorefront } from "./StorefrontContext";
import { fixtureStorefront, fixtureStorefrontSettings } from "../test-support/catalogFixtures";

const api = vi.hoisted(() => ({ getStorefront: vi.fn() }));
vi.mock("../api/catalog", () => ({ catalogAPI: api }));

function Probe() {
  const { status, brandName, error } = useStorefront();
  return <p>{status}:{brandName}:{error ?? ""}</p>;
}

const rootStyle = () => document.documentElement.style;

beforeEach(() => {
  rootStyle().cssText = "";
  document.getElementById("apex-cart-font-link")?.remove();
});

describe("published storefront settings", () => {
  it("applies the published brand and theme, ignoring legacy browser overrides", async () => {
    localStorage.setItem("nmb-colors", "custom");
    localStorage.setItem("nmb-colors-custom", JSON.stringify({ primary: "#ff0000" }));
    localStorage.setItem("nmb-font", "cinzel");
    const settings = fixtureStorefrontSettings({ theme: { ...fixtureStorefrontSettings().theme, fontId: "lora" } });
    api.getStorefront.mockResolvedValue({ data: fixtureStorefront({ settings: { ...settings, brand: { ...settings.brand, name: "Apex Cart Test" } } }) });
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");

    const { unmount } = render(<StorefrontProvider><Probe /></StorefrontProvider>);
    expect(await screen.findByText("ready:Apex Cart Test:")).toBeTruthy();
    // The theme is applied by a passive effect, which can flush after the text appears.
    await waitFor(() => {
      expect(rootStyle().getPropertyValue("--color-brand-primary")).toBe("#14213d");
      expect(rootStyle().getPropertyValue("--font-display")).toBe('"Lora", serif');
      expect(document.getElementById("apex-cart-font-link")?.getAttribute("href")).toContain("family=Lora");
      expect(document.title).toBe("Apex Cart Test");
    });
    expect(storageWrites).not.toHaveBeenCalled();
    expect(localStorage.getItem("nmb-colors")).toBe("custom");

    unmount();
    expect(rootStyle().getPropertyValue("--color-brand-primary")).toBe("");
  });

  it("reports an invalid or unavailable storefront without applying a theme", async () => {
    api.getStorefront.mockResolvedValueOnce({ data: { fontId: "default", colorId: "custom" } });
    const { unmount } = render(<StorefrontProvider><Probe /></StorefrontProvider>);
    expect(await screen.findByText(/^error:Apex Cart:Storefront settings were not in the expected format/)).toBeTruthy();
    expect(rootStyle().getPropertyValue("--color-brand-primary")).toBe("");
    unmount();

    api.getStorefront.mockRejectedValueOnce(new AxiosError("Gone", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 410, statusText: "Gone", data: { error: "Legacy settings are retired." }, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
    }));
    render(<StorefrontProvider><Probe /></StorefrontProvider>);
    expect(await screen.findByText("error:Apex Cart:Legacy settings are retired.")).toBeTruthy();
  });
});
